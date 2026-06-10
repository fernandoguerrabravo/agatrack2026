import { NextResponse } from "next/server";
import { pgQuery } from "@/lib/postgres";
import { uploadToSpaces } from "@/lib/spaces";
import { aduananetLogin } from "@/lib/aduananet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * Mapeo de dirección de recepción → configuración del cliente
 */
const INBOUND_MAP: Record<string, { cli_id: string; rut_cliente: string; cliente_nombre: string }> = {
  "dow@agatrack.agenciaguerra.com": { cli_id: "2710", rut_cliente: "92933000-5", cliente_nombre: "PETROQUIMICA DOW S.A." },
};

/**
 * POST /api/inbound-email
 * 
 * Webhook receptor de Resend para emails inbound.
 * Cuando un cliente envía un email con documentos adjuntos a dow@agatrack.agenciaguerra.com,
 * este endpoint:
 * 1. Obtiene los attachments via Resend API
 * 2. Sube cada doc al bucket y lo procesa con IA (clasificar + extraer)
 * 3. Extrae referencia del invoice
 * 4. Crea la operación en AduanaNet (igual que el ejecutivo)
 * 5. Asocia todos los docs al nro_operacion
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const payload = JSON.parse(body);

    const eventType = payload.type;
    if (eventType !== "email.received") {
      return NextResponse.json({ ok: true, message: "Evento ignorado" });
    }

    const { email_id, from, to, subject } = payload.data;
    console.log(`[inbound] Email recibido: from=${from} to=${JSON.stringify(to)} subject=${subject} id=${email_id}`);

    // Idempotencia: no procesar el mismo email dos veces
    // Verificar tanto en documentos como en operaciones temporales
    const existingDoc = await pgQuery<{ id: number }>(
      "SELECT id FROM documentos WHERE nro_operacion LIKE $1 LIMIT 1",
      [`INBOUND_${email_id.substring(0, 8)}%`]
    );
    const existingOp = await pgQuery<{ nro_operacion: string }>(
      "SELECT nro_operacion FROM operaciones WHERE nro_operacion = $1 LIMIT 1",
      [`INBOUND_${email_id.substring(0, 8)}`]
    );
    if (existingDoc.length > 0 || existingOp.length > 0) {
      console.log(`[inbound] Email ${email_id} ya procesado/en proceso, ignorando`);
      return NextResponse.json({ ok: true, message: "Ya procesado" });
    }

    // Determinar cliente por dirección de destino
    const toAddr = Array.isArray(to) ? to[0] : to;
    const config = INBOUND_MAP[toAddr?.toLowerCase()];
    if (!config) {
      console.log(`[inbound] Dirección no configurada: ${toAddr}`);
      return NextResponse.json({ ok: true, message: "Dirección no configurada" });
    }

    // Marcar como en proceso (para idempotencia inmediata)
    const tempNro = "INBOUND_" + email_id.substring(0, 8);
    await pgQuery(
      `INSERT INTO operaciones (nro_operacion, rut_cliente, estado, notas) VALUES ($1, $2, 'procesando', $3) ON CONFLICT DO NOTHING`,
      [tempNro, config.rut_cliente, `inbound email_id: ${email_id}`]
    );

    // Procesar en background (no bloquear el webhook response)
    processInboundEmail(email_id, from, subject, config, tempNro).catch(err => {
      console.error(`[inbound] Error en procesamiento background:`, err instanceof Error ? err.message : err);
    });

    // Responder inmediatamente al webhook
    return NextResponse.json({ ok: true, message: "Recibido, procesando en background" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[inbound] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Procesa el email inbound en background
 */
async function processInboundEmail(
  email_id: string,
  from: string,
  subject: string,
  config: { cli_id: string; rut_cliente: string; cliente_nombre: string },
  tempNro: string
) {

    // Obtener attachments via Resend API
    const attachmentsRes = await fetch(`https://api.resend.com/emails/receiving/${email_id}/attachments`, {
      headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}` },
    });
    
    if (!attachmentsRes.ok) {
      console.error(`[inbound] Error obteniendo attachments: ${attachmentsRes.status}`);
      return;
    }

    const attachmentsData = await attachmentsRes.json();
    const attachments = attachmentsData.data || [];
    
    if (attachments.length === 0) {
      console.log("[inbound] Email sin attachments, ignorando");
      return;
    }

    console.log(`[inbound] ${attachments.length} attachment(s) encontrados`);

    // PASO 1: Descargar todos los attachments y subirlos al bucket
    const archivos: Array<{ filename: string; buffer: Buffer; contentType: string; storageUrl: string }> = [];
    for (const att of attachments) {
      const { filename, content_type, download_url } = att;
      if (!content_type?.match(/pdf|image/i)) {
        console.log(`[inbound] Ignorando ${filename} (${content_type})`);
        continue;
      }
      const fileRes = await fetch(download_url);
      if (!fileRes.ok) continue;
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const storageKey = `documentos/${config.rut_cliente}/inbound_${email_id}/${filename}`;
      const storageUrl = await uploadToSpaces(buffer, storageKey, content_type);
      archivos.push({ filename, buffer, contentType: content_type, storageUrl });
      console.log(`[inbound] Descargado y subido: ${filename} (${buffer.length} bytes)`);
    }

    if (archivos.length === 0) {
      return;
    }

    // PASO 2: Procesar cada archivo con IA (clasificar + extraer datos)
    const processedDocs: Array<{ id: number; tipo: string; nombre: string; datos: Record<string, unknown> }> = [];

    for (const archivo of archivos) {
      try {
        const formData = new FormData();
        const blob = new Blob([new Uint8Array(archivo.buffer)], { type: archivo.contentType });
        formData.append("file", blob, archivo.filename);
        formData.append("nro_operacion", tempNro);
        formData.append("rut_cliente", config.rut_cliente);
        formData.append("inbound_secret", process.env.INBOUND_SECRET || "");

        const uploadRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/documentos/upload`, {
          method: "POST",
          body: formData,
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          const doc = uploadData.documento;
          if (doc) {
            const datos = typeof doc.datos_extraidos === "string" ? JSON.parse(doc.datos_extraidos) : (doc.datos_extraidos || {});
            processedDocs.push({ id: doc.id, tipo: doc.tipo_documento, nombre: archivo.filename, datos });
            console.log(`[inbound] Procesado: ${archivo.filename} → ${doc.tipo_documento}`);
          }
        } else {
          const errText = await uploadRes.text().catch(() => "");
          console.error(`[inbound] Error procesando ${archivo.filename}: ${uploadRes.status} ${errText.substring(0, 200)}`);
        }
      } catch (err) {
        console.error(`[inbound] Error en ${archivo.filename}:`, err instanceof Error ? err.message : err);
      }
    }

    // PASO 3: Extraer referencia del invoice
    let referencia = "";
    const invoiceDoc = processedDocs.find(d => d.tipo === "Invoice (Factura Comercial)");
    if (invoiceDoc) {
      const d = invoiceDoc.datos;
      referencia = String(d.customer_order_number || d.internal_document_number || d.orden || d.our_reference || d.orden_compra || d.po_number || d.numero_factura || "");
    }

    // Fallback: extraer referencia del subject del email (formato: REF: XXXX o REF:XXXX)
    if (!referencia && subject) {
      const refMatch = subject.match(/REF:?\s*([A-Z0-9_-]+)/i);
      if (refMatch) referencia = refMatch[1];
    }

    if (!referencia) {
      console.log(`[inbound] No se encontró referencia en los documentos. Docs procesados: ${processedDocs.length}`);
      // Borrar operación temporal
      await pgQuery("DELETE FROM operaciones WHERE nro_operacion = $1", [tempNro]);
      return;
    }

    // PASO 4: Detectar terrestre y crear operación en AduanaNet
    const esTerrestreDoc = processedDocs.some(d => d.tipo === "Carta de Porte Internacional (CRT)" || d.tipo === "MIC/DTA");
    const puertoDesembarque = esTerrestreDoc ? "LOS ANDES" : "SAN ANTONIO";

    // Crear operación directamente (sin llamar al endpoint)
    const cookies = await aduananetLogin();
    const grabarBody = new URLSearchParams();
    grabarBody.set("accion", "N");
    grabarBody.set("cli_id", config.cli_id);
    grabarBody.set("txt_cli_id", "");
    grabarBody.set("orc_tio", "DIN");
    grabarBody.set("tipo_doc", "IMPO");
    grabarBody.set("tio_id", "101");
    grabarBody.set("sel_tio_id", "101");
    grabarBody.set("emp_id", "C69");
    grabarBody.set("sel_emp_id", "C69");
    grabarBody.set("ejecutivo_id", "");
    grabarBody.set("sel_ejecutivo_id", "");
    const PUERTO_ADUANA_MAP: Record<string, string> = { "SAN ANTONIO": "39", "LOS ANDES": "33" };
    const aduId = PUERTO_ADUANA_MAP[puertoDesembarque] || "39";
    grabarBody.set("adu_id", aduId);
    grabarBody.set("sel_adu_id", aduId);
    grabarBody.set("fpa_id", "");
    grabarBody.set("sel_fpa_id", "");
    grabarBody.set("mon_id", "13");
    grabarBody.set("sel_mon_id", "13");
    grabarBody.set("cvt_id", "");
    grabarBody.set("sel_cvt_id", "");
    grabarBody.set("reg_id", "");
    grabarBody.set("sel_reg_id", "");
    grabarBody.set("sel_tna_id", "");
    grabarBody.set("nro_libro", "");
    grabarBody.set("orc_referencia", referencia);
    grabarBody.set("orc_bodega", "");
    grabarBody.set("usua_id", "100");
    grabarBody.set("lineas", "0");
    grabarBody.set("ineditable", "false");
    grabarBody.set("generar_despacho", "1");
    grabarBody.set("email", "1");

    await fetch(`${BASE_URL}/modulos/comex/orden_compra/grabar.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies, Referer: `${BASE_URL}/modulos/comex/orden_compra/formulario.php` },
      body: grabarBody.toString(),
      redirect: "manual",
    });

    // Buscar el nro_operacion creado
    const filterBody = new URLSearchParams();
    filterBody.set("accion", "F");
    filterBody.set("fil_cli_id", config.cli_id);
    const listaRes = await fetch(`${BASE_URL}/modulos/comex/orden_compra/lista.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: filterBody.toString(),
    });
    const listaHtml = await listaRes.text();
    const allOrcIds = [...listaHtml.matchAll(/agregar\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    const maxOrcId = allOrcIds.length > 0 ? Math.max(...allOrcIds) : 0;

    let nroOperacion = "";
    if (maxOrcId) {
      const filter2 = new URLSearchParams();
      filter2.set("accion", "F");
      filter2.set("fil_orc_id", String(maxOrcId));
      const res2 = await fetch(`${BASE_URL}/modulos/comex/orden_compra/lista.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
        body: filter2.toString(),
      });
      const html2 = await res2.text();
      const libNidLink = html2.match(/lib_nid=(\d+)/);
      if (libNidLink) nroOperacion = libNidLink[1];
    }

    console.log(`[inbound] Operación AduanaNet creada: ${nroOperacion} (ref: ${referencia}, aduana: ${aduId})`);

    // PASO 5: Guardar en BD y actualizar documentos con nro_operacion real
    if (nroOperacion) {
      await pgQuery(
        `INSERT INTO operaciones (nro_operacion, rut_cliente, estado, notas)
         VALUES ($1, $2, 'abierta', $3)
         ON CONFLICT (nro_operacion) DO NOTHING`,
        [nroOperacion, config.rut_cliente, `ref: ${referencia} | inbound: ${email_id}`]
      );

      // Mover documentos del temp al nro_operacion real
      await pgQuery(
        "UPDATE documentos SET nro_operacion = $1 WHERE nro_operacion = $2",
        [nroOperacion, tempNro]
      );
      console.log(`[inbound] Documentos asociados a op ${nroOperacion}`);

      // Enviar notificación email
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
          to: ["fguerrab@agenciaguerra.com"],
          subject: `Nuevo Despacho ${nroOperacion} - ${config.cliente_nombre} - REF: ${referencia}`,
          html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Se ha creado un nuevo despacho via email inbound:</p>
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;">${nroOperacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Cliente</td><td style="padding:8px 12px;border:1px solid #ddd;">${config.cliente_nombre}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Email de</td><td style="padding:8px 12px;border:1px solid #ddd;">${from}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Documentos</td><td style="padding:8px 12px;border:1px solid #ddd;">${processedDocs.map(d => d.nombre + " (" + d.tipo + ")").join("<br>")}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Puerto</td><td style="padding:8px 12px;border:1px solid #ddd;">${puertoDesembarque}</td></tr>
  </table>
  <p style="color:#666;font-size:12px;">Creado automáticamente via email inbound por AgaTrack.</p>
</div>`,
        });
      } catch (emailErr) {
        console.error("[inbound] Error enviando notificación:", emailErr instanceof Error ? emailErr.message : emailErr);
      }
    }

    console.log(`[inbound] ✅ Completado: ${processedDocs.length} docs, op=${nroOperacion}, ref=${referencia}`);

    // Borrar operación temporal
    await pgQuery("DELETE FROM operaciones WHERE nro_operacion = $1", [tempNro]);
}
