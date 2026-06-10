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
    const insertResult = await pgQuery<{ nro_operacion: string }>(
      `INSERT INTO operaciones (nro_operacion, rut_cliente, estado, notas) VALUES ($1, $2, 'procesando', $3) ON CONFLICT (nro_operacion) DO NOTHING RETURNING nro_operacion`,
      [tempNro, config.rut_cliente, `inbound email_id: ${email_id}`]
    );
    if (insertResult.length === 0) {
      // Ya existía — otro webhook ya lo está procesando
      console.log(`[inbound] Email ${email_id} ya en proceso (op ${tempNro}), ignorando duplicado`);
      return NextResponse.json({ ok: true, message: "Ya en proceso" });
    }

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

      // Extraer ETA del subject del email (no esperar ShipsGo)
      let eta = "";
      if (subject) {
        const etaMatch = subject.match(/ETA:?\s*(\d{1,2}\s*[A-Z]{3}\s*\d{4})/i);
        if (etaMatch) eta = etaMatch[1];
      }

      // Enviar notificación email INMEDIATAMENTE (sin esperar ShipsGo)
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);

        // Extraer datos de los documentos procesados para el email
        const blDoc = processedDocs.find(d => d.tipo === "Bill of Lading (BL)");
        const invDoc = processedDocs.find(d => d.tipo === "Invoice (Factura Comercial)");
        const plDoc = processedDocs.find(d => d.tipo === "Lista de Empaque (Packing List)");
        const polDoc = processedDocs.find(d => d.tipo === "Póliza de Seguro");
        const coDoc = processedDocs.find(d => d.tipo === "Certificado de Origen");

        const blData = blDoc?.datos || {};
        const invData = invDoc?.datos || {};
        const plData = plDoc?.datos || {};

        const blMaster = String(blData.numero_bl_master || blData.numero_bl || "");
        const nave = String(blData.nave_corregida || blData.nave || "");
        const viaje = String(blData.viaje_corregido || blData.viaje || "");
        const naviera = String(blData.naviera || "");
        const ptoEmbarque = String(blData.puerto_embarque || "");
        const ptoTransbordo = String(blData.puerto_transbordo || "");
        const contenedores = (blData.contenedores || []) as Array<Record<string, unknown>>;
        const proveedor = String((invData.proveedor as Record<string, unknown>)?.nombre || invData.proveedor || "");
        const montoTotal = invData.monto_total || "";
        const moneda = String(invData.moneda || "USD").replace(/[^A-Z]/g, "") || "USD";
        const incoterm = String(invData.incoterm || "");
        const pesoBruto = plData.peso_bruto_total || blData.peso_bruto_total || "";
        const totalBultos = plData.total_bultos || blData.total_bultos || "";
        const producto = (invData.items as Array<Record<string, unknown>>)?.[0]?.descripcion || "";
        const paisOrigen = String(coDoc?.datos?.pais_origen || invData.pais_origen || "");

        const contTable = contenedores.length > 0
          ? contenedores.map((c: Record<string, unknown>) => `<tr><td style="padding:4px 12px;border:1px solid #ddd;">${c.numero_contenedor || ""}</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.tipo_contenedor || ""}</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.peso_bruto || ""} KG</td></tr>`).join("")
          : "";

        const docsTable = processedDocs.map(d => `<tr><td style="padding:4px 12px;border:1px solid #ddd;">${d.nombre}</td><td style="padding:4px 12px;border:1px solid #ddd;">${d.tipo}</td></tr>`).join("");

        await resend.emails.send({
          from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
          to: ["fguerrab@agenciaguerra.com"],
          subject: `Nuevo Despacho ${nroOperacion} - ${config.cliente_nombre} - REF: ${referencia}${eta ? " - ETA: " + eta : ""}`,
          html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Se ha creado un nuevo despacho automáticamente via email:</p>
  
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${nroOperacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Cliente</td><td style="padding:8px 12px;border:1px solid #ddd;">${config.cliente_nombre}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Proveedor</td><td style="padding:8px 12px;border:1px solid #ddd;">${proveedor}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Producto</td><td style="padding:8px 12px;border:1px solid #ddd;">${producto}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Incoterm</td><td style="padding:8px 12px;border:1px solid #ddd;">${incoterm}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Monto Total</td><td style="padding:8px 12px;border:1px solid #ddd;">${moneda} ${montoTotal ? Number(montoTotal).toLocaleString() : ""}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">País Origen</td><td style="padding:8px 12px;border:1px solid #ddd;">${paisOrigen}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Peso Bruto</td><td style="padding:8px 12px;border:1px solid #ddd;">${pesoBruto} KG</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Bultos</td><td style="padding:8px 12px;border:1px solid #ddd;">${totalBultos}</td></tr>
    ${blMaster ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">BL Master</td><td style="padding:8px 12px;border:1px solid #ddd;">${blMaster}</td></tr>` : ""}
    ${nave ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Nave</td><td style="padding:8px 12px;border:1px solid #ddd;">${nave} ${viaje}</td></tr>` : ""}
    ${naviera ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Naviera</td><td style="padding:8px 12px;border:1px solid #ddd;">${naviera}</td></tr>` : ""}
    ${ptoEmbarque ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Puerto Embarque</td><td style="padding:8px 12px;border:1px solid #ddd;">${ptoEmbarque}</td></tr>` : ""}
    ${ptoTransbordo ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Puerto Transbordo</td><td style="padding:8px 12px;border:1px solid #ddd;">${ptoTransbordo}</td></tr>` : ""}
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Puerto Desembarque</td><td style="padding:8px 12px;border:1px solid #ddd;">${puertoDesembarque}</td></tr>
    ${eta ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">ETA</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#16a34a;">${eta}</td></tr>` : ""}
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Email de</td><td style="padding:8px 12px;border:1px solid #ddd;">${from}</td></tr>
  </table>

  ${contTable ? `<h3 style="margin-top:20px;">Contenedores</h3>
  <table style="border-collapse:collapse;border:1px solid #ddd;width:100%;max-width:600px;">
    <thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;border:1px solid #ddd;">Contenedor</th><th style="padding:6px 12px;border:1px solid #ddd;">Tipo</th><th style="padding:6px 12px;border:1px solid #ddd;">Peso Bruto</th></tr></thead>
    <tbody>${contTable}</tbody>
  </table>` : ""}

  <h3 style="margin-top:20px;">Tracking en Vivo</h3>
  <p><a href="https://agatrack.com/tracking/${nroOperacion}" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:600;">Ver seguimiento del embarque →</a></p>

  <h3 style="margin-top:20px;">Documentos Procesados</h3>
  <table style="border-collapse:collapse;border:1px solid #ddd;width:100%;max-width:600px;">
    <thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;border:1px solid #ddd;">Archivo</th><th style="padding:6px 12px;border:1px solid #ddd;">Clasificación</th></tr></thead>
    <tbody>${docsTable}</tbody>
  </table>

  <p style="margin-top:20px;color:#666;font-size:12px;">Creado automáticamente via email inbound por AgaTrack.</p>
  <p style="color:#666;font-size:12px;">Agencia de Aduanas Fernando Guerra y Cía. Ltda.</p>
</div>`,
        });
      } catch (emailErr) {
        console.error("[inbound] Error enviando notificación:", emailErr instanceof Error ? emailErr.message : emailErr);
      }

      // PASO 7: Consultar ShipsGo en background (solo marítimas, no bloquea)
      if (!esTerrestreDoc) {
        const blDocForShipsgo = processedDocs.find(d => d.tipo === "Bill of Lading (BL)");
        const blNumberForShipsgo = String(blDocForShipsgo?.datos?.numero_bl_master || blDocForShipsgo?.datos?.numero_bl || "");
        if (blNumberForShipsgo) {
          try {
            const shipsgoToken = process.env.SHIPSGO_API_KEY;
            if (shipsgoToken) {
              console.log(`[inbound] Consultando ShipsGo para BL: ${blNumberForShipsgo}`);
              const createRes = await fetch("https://api.shipsgo.com/v2/ocean/shipments", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Shipsgo-User-Token": shipsgoToken },
                body: JSON.stringify({ booking_number: blNumberForShipsgo }),
              });
              const createJson = await createRes.json();
              const sgId = createJson.shipment?.id;
              if (sgId) {
                for (let i = 0; i < 5; i++) {
                  await new Promise(r => setTimeout(r, 3000));
                  const detailRes = await fetch(`https://api.shipsgo.com/v2/ocean/shipments/${sgId}`, {
                    headers: { "X-Shipsgo-User-Token": shipsgoToken },
                  });
                  if (detailRes.ok) {
                    const detailJson = await detailRes.json();
                    const sgData = detailJson.shipment || {};
                    if (sgData.route) {
                      await pgQuery("UPDATE documentos SET datos_shipsgo = $1, shipsgo_id = $2 WHERE id = $3",
                        [JSON.stringify(sgData), sgId, blDocForShipsgo!.id]);
                      console.log(`[inbound] ShipsGo data guardada, id=${sgId}`);

                      // Enviar correo de actualización ETA
                      try {
                        const sgRoute = sgData.route as Record<string, unknown>;
                        const podData = sgRoute?.port_of_discharge as Record<string, unknown>;
                        const etaDate = podData?.date_of_discharge ? new Date(String(podData.date_of_discharge)) : null;
                        const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
                        const etaStr = etaDate ? `${String(etaDate.getDate()).padStart(2, "0")}${meses[etaDate.getMonth()]} ${etaDate.getFullYear()}` : "";
                        const polData = sgRoute?.port_of_loading as Record<string, unknown>;
                        const polName = (polData?.location as Record<string, unknown>)?.name || "";
                        const podName = (podData?.location as Record<string, unknown>)?.name || "";
                        const transitTime = sgRoute?.transit_time || "";
                        const transitPct = sgRoute?.transit_percentage || 0;
                        const co2 = sgRoute?.co2_emission || "";
                        const naveShipsgo = (() => {
                          try {
                            const containers = (sgData as Record<string, unknown>).containers as Array<Record<string, unknown>> | undefined;
                            const movements = containers?.[0]?.movements as Array<Record<string, unknown>> | undefined;
                            const vessel = movements?.[0]?.vessel as Record<string, unknown> | undefined;
                            return String(vessel?.name || "");
                          } catch { return ""; }
                        })() || blNumberForShipsgo;

                        // Datos de contenedores y producto del BL/Invoice
                        const blDataEmail = blDocForShipsgo?.datos || {};
                        const invDocEmail = processedDocs.find(d => d.tipo === "Invoice (Factura Comercial)");
                        const invDataEmail = invDocEmail?.datos || {};
                        const contenedoresEmail = (blDataEmail.contenedores || []) as Array<Record<string, unknown>>;
                        const productoEmail = String((invDataEmail.items as Array<Record<string, unknown>>)?.[0]?.descripcion || "");
                        const contTableEmail = contenedoresEmail.length > 0
                          ? contenedoresEmail.map((c: Record<string, unknown>) => `<tr><td style="padding:4px 12px;border:1px solid #ddd;">${c.numero_contenedor || ""}</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.tipo_contenedor || ""}</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.peso_bruto || ""} KG</td></tr>`).join("")
                          : "";

                        const { Resend: ResendUpdate } = await import("resend");
                        const resendUpdate = new ResendUpdate(process.env.RESEND_API_KEY);
                        await resendUpdate.emails.send({
                          from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
                          to: ["fguerrab@agenciaguerra.com"],
                          subject: `Actualización ETA Despacho ${nroOperacion} - REF: ${referencia} - ETA: ${etaStr}`,
                          html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Se ha actualizado la información de seguimiento para el despacho <b>${nroOperacion}</b>:</p>
  
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${nroOperacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">BL</td><td style="padding:8px 12px;border:1px solid #ddd;">${blNumberForShipsgo}</td></tr>
    ${productoEmail ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Producto</td><td style="padding:8px 12px;border:1px solid #ddd;">${productoEmail}</td></tr>` : ""}
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Nave</td><td style="padding:8px 12px;border:1px solid #ddd;">${naveShipsgo}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Ruta</td><td style="padding:8px 12px;border:1px solid #ddd;">${polName} → ${podName}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Tránsito</td><td style="padding:8px 12px;border:1px solid #ddd;">${transitTime} días (${transitPct}%)</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">ETA</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#16a34a;font-size:16px;">${etaStr}</td></tr>
    ${co2 ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">CO₂</td><td style="padding:8px 12px;border:1px solid #ddd;">${co2} ton</td></tr>` : ""}
  </table>

  ${contTableEmail ? `<h3 style="margin-top:20px;">Contenedores</h3>
  <table style="border-collapse:collapse;border:1px solid #ddd;width:100%;max-width:600px;">
    <thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;border:1px solid #ddd;">Contenedor</th><th style="padding:6px 12px;border:1px solid #ddd;">Tipo</th><th style="padding:6px 12px;border:1px solid #ddd;">Peso Bruto</th></tr></thead>
    <tbody>${contTableEmail}</tbody>
  </table>` : ""}

  <h3 style="margin-top:20px;">Tracking en Vivo</h3>
  <p><a href="https://agatrack.com/tracking/${nroOperacion}" target="_blank" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:4px;text-decoration:none;font-weight:600;">Ver seguimiento del embarque →</a></p>

  <p style="margin-top:20px;color:#666;font-size:12px;">Actualización automática de tracking por AgaTrack.</p>
</div>`,
                        });
                        console.log(`[inbound] Correo actualización ETA enviado para op ${nroOperacion}`);
                      } catch (etaEmailErr) {
                        console.error("[inbound] Error correo actualización ETA:", etaEmailErr instanceof Error ? etaEmailErr.message : etaEmailErr);
                      }

                      break;
                    }
                  }
                }
              }
            }
          } catch (sgErr) {
            console.error("[inbound] Error ShipsGo:", sgErr instanceof Error ? sgErr.message : sgErr);
          }
        }
      }
    }

    console.log(`[inbound] ✅ Completado: ${processedDocs.length} docs, op=${nroOperacion}, ref=${referencia}`);

    // Borrar operación temporal
    await pgQuery("DELETE FROM operaciones WHERE nro_operacion = $1", [tempNro]);
}
