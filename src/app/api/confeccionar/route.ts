import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { confeccionarDIN } from "@/lib/confeccionar-din";
import { emailsEjecutivosCliente } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/confeccionar
 * Body: { nro_operacion: string }
 * 
 * Valida que la operación tenga al menos BL corregido + Factura.
 * Si es válida, ejecuta la confección de DIN en AduanaNet.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    // Permitir acceso via inbound_secret (para scripts/crons)
    const inboundSecret = request.headers.get("x-inbound-secret");
    if (!inboundSecret || inboundSecret !== process.env.INBOUND_SECRET) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const skipEmail = request.headers.get("x-skip-email") === "true";

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  // Obtener documentos de la operación
  const docs = await pgQuery<{
    id: number;
    tipo_documento: string;
    datos_extraidos: string | Record<string, unknown>;
    datos_extraidos_claude?: string | Record<string, unknown>;
    datos_shipsgo?: string | Record<string, unknown>;
  }>(
    "SELECT id, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo FROM documentos WHERE nro_operacion = $1",
    [nro_operacion]
  );

  if (docs.length === 0) {
    return NextResponse.json({ error: "No se encontraron documentos para esta operación." }, { status: 400 });
  }

  // Verificar documentos mínimos: BL+Factura (marítimo) o CRT+Factura (terrestre)
  const tiposPresentes = docs.map(d => d.tipo_documento);
  const tieneBL = tiposPresentes.includes("Bill of Lading (BL)");
  const tieneCRT = tiposPresentes.includes("Carta de Porte Internacional (CRT)");
  const tieneMIC = tiposPresentes.includes("MIC/DTA");
  const tieneFactura = tiposPresentes.includes("Invoice (Factura Comercial)");
  const esTerrestre = (tieneCRT || tieneMIC) && !tieneBL;

  if (!tieneFactura) {
    return NextResponse.json({ error: "Falta la Factura Comercial para confeccionar." }, { status: 400 });
  }

  if (!tieneBL && !tieneCRT && !tieneMIC) {
    return NextResponse.json({ error: "Falta el documento de transporte (BL o CRT) para confeccionar." }, { status: 400 });
  }

  // Para marítimo: verificar que el BL esté corregido
  if (!esTerrestre) {
    const blDoc = docs.find(d => d.tipo_documento === "Bill of Lading (BL)");
    const blDatos = typeof blDoc!.datos_extraidos === "string"
      ? JSON.parse(blDoc!.datos_extraidos)
      : blDoc!.datos_extraidos;

    const blCorregido = blDatos._nave_corregida_shipsgo
      || blDatos.nave_corregida
      || blDatos.viaje_corregido
      || blDoc!.datos_shipsgo;

    if (!blCorregido) {
      return NextResponse.json({
        error: "El BL no está corregido. Debe tener datos de ShipsGo (nave/viaje corregido) antes de confeccionar.",
      }, { status: 400 });
    }
  }

  // Ejecutar confección
  try {
    const resultado = await confeccionarDIN(nro_operacion, docs);

    // Marcar operación como confeccionada
    await pgQuery(
      "UPDATE operaciones SET estado = 'confeccionada', fecha_confeccion = NOW(), updated_at = NOW() WHERE nro_operacion = $1",
      [nro_operacion]
    );

    // Enviar correo de instrucción de confección a documentos@agenciaguerra.com
    if (!skipEmail) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Obtener datos para el email
      const blDoc = docs.find(d => d.tipo_documento === "Bill of Lading (BL)");
      const invDoc = docs.find(d => d.tipo_documento === "Invoice (Factura Comercial)");
      const blDatos = blDoc ? (typeof blDoc.datos_extraidos === "string" ? JSON.parse(blDoc.datos_extraidos) : blDoc.datos_extraidos) : {};
      const invDatos = invDoc ? (typeof invDoc.datos_extraidos === "string" ? JSON.parse(invDoc.datos_extraidos) : invDoc.datos_extraidos) : {};
      const sgDatos = blDoc?.datos_shipsgo ? (typeof blDoc.datos_shipsgo === "string" ? JSON.parse(blDoc.datos_shipsgo as string) : blDoc.datos_shipsgo) as Record<string, unknown> : {};

      const blMaster = String(blDatos.numero_bl_master || blDatos.numero_bl || "");
      const nave = String(blDatos.nave_corregida || blDatos.nave || "");
      const viaje = String(blDatos.viaje_corregido || blDatos.viaje || "");
      
      // Referencia: para terrestres usar CRT orden, para marítimos usar invoice
      let referencia = String(invDatos.customer_order_number || invDatos.internal_document_number || "");
      if (!referencia || referencia === "undefined") {
        // Buscar en CRT (terrestres)
        const crtDoc = docs.find(d => d.tipo_documento === "Carta de Porte Internacional (CRT)" || d.tipo_documento === "MIC/DTA");
        if (crtDoc) {
          const crtDatos = typeof crtDoc.datos_extraidos === "string" ? JSON.parse(crtDoc.datos_extraidos) : crtDoc.datos_extraidos;
          referencia = String(crtDatos?.crt?.orden || crtDatos?.orden || "");
        }
      }
      if (!referencia || referencia === "undefined") {
        // Fallback: packing list shipment_number (10 dígitos)
        const plDoc = docs.find(d => d.tipo_documento === "Lista de Empaque (Packing List)");
        if (plDoc) {
          const plDatos = typeof plDoc.datos_extraidos === "string" ? JSON.parse(plDoc.datos_extraidos) : plDoc.datos_extraidos;
          referencia = String(plDatos?.shipment_number || plDatos?.order_number || "").substring(0, 10);
        }
      }
      if (!referencia || referencia === "undefined") referencia = invDatos.numero_factura || "";
      const sgRoute = (sgDatos as Record<string, unknown>)?.route as Record<string, unknown> | undefined;
      const etaRaw = (sgRoute?.port_of_discharge as Record<string, unknown>)?.date_of_discharge || "";
      let eta = "";
      if (etaRaw) {
        const d = new Date(String(etaRaw));
        const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
        eta = `${String(d.getDate()).padStart(2, "0")}${meses[d.getMonth()]} ${d.getFullYear()}`;
      }

      // Generar carpeta del despacho (todos los PDFs combinados en uno solo)
      const { PDFDocument } = await import("pdf-lib");
      const mergedPdf = await PDFDocument.create();

      // Agregar carátula al principio
      try {
        const { aduananetLogin } = await import("@/lib/aduananet");
        const cookiesCaratula = await aduananetLogin();
        const BASE_URL_C = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";
        const caratulaUrl = `${BASE_URL_C}/modulos/comex/orden_compra/antecedentes_pdf.php?lib_nid=${nro_operacion}&lib_base=1`;
        const caratulaRes = await fetch(caratulaUrl, { headers: { Cookie: cookiesCaratula } });
        if (caratulaRes.ok) {
          const caratulaBuf = await caratulaRes.arrayBuffer();
          if (caratulaBuf.byteLength > 100) {
            const header = new Uint8Array(caratulaBuf.slice(0, 5));
            if (String.fromCharCode(...header) === "%PDF-") {
              const caratulaPdf = await PDFDocument.load(caratulaBuf, { ignoreEncryption: true });
              const pages = await mergedPdf.copyPages(caratulaPdf, caratulaPdf.getPageIndices());
              for (const page of pages) mergedPdf.addPage(page);
            }
          }
        }
      } catch {}

      // Agregar todos los documentos de la operación
      const allDocs = await pgQuery<{ nombre_archivo: string; storage_url: string }>(
        "SELECT nombre_archivo, storage_url FROM documentos WHERE nro_operacion = $1 AND storage_url IS NOT NULL ORDER BY created_at",
        [nro_operacion]
      );
      for (const doc of allDocs) {
        if (!doc.storage_url) continue;
        try {
          const res = await fetch(doc.storage_url);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          if (buf.byteLength < 100) continue;
          const header = new Uint8Array(buf.slice(0, 5));
          if (String.fromCharCode(...header) !== "%PDF-") continue;
          const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
          const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
          for (const page of pages) mergedPdf.addPage(page);
        } catch {}
      }

      const attachments: Array<{ filename: string; content: Buffer }> = [];
      if (mergedPdf.getPageCount() > 0) {
        const pdfBytes = await mergedPdf.save();
        attachments.push({ filename: `Carpeta_Despacho_${nro_operacion}.pdf`, content: Buffer.from(pdfBytes) });
      }

      // Obtener ejecutivos asignados al cliente para CC
      const opInfo = await pgQuery<{ rut_cliente: string }>("SELECT rut_cliente FROM operaciones WHERE nro_operacion = $1", [nro_operacion]);
      const ejecutivosCC = opInfo[0]?.rut_cliente ? await emailsEjecutivosCliente(opInfo[0].rut_cliente) : [];
      
      // Obtener nombre del cliente
      const clienteRow = await pgQuery<{ razon: string }>("SELECT razon FROM clientes WHERE rut = $1", [opInfo[0]?.rut_cliente || ""]);
      const clienteNombre = clienteRow[0]?.razon || "";

      await resend.emails.send({
        from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
        to: ["documentos@agenciaguerra.com", "fguerrab@agenciaguerra.com", "fguerra@agenciaguerra.com"],
        cc: ejecutivosCC.length > 0 ? ejecutivosCC : undefined,
        subject: `Confección Despacho ${nro_operacion} - ${clienteNombre} - REF: ${referencia}${eta ? " - ETA: " + eta : ""}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Se instruye la confección del siguiente despacho:</p>
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${nro_operacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>
    ${blMaster ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">BL</td><td style="padding:8px 12px;border:1px solid #ddd;">${blMaster}</td></tr>` : ""}
    ${nave ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Nave</td><td style="padding:8px 12px;border:1px solid #ddd;">${nave} ${viaje}</td></tr>` : ""}
    ${eta ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">ETA</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#16a34a;">${eta}</td></tr>` : ""}
  </table>
  <p>Adjuntos: ${attachments.length} documento(s)</p>
  <p style="color:#666;font-size:12px;margin-top:20px;">Generado automáticamente por AgaTrack.</p>
</div>`,
        attachments,
      });
      console.log(`[confeccionar] Email instrucción enviado para op ${nro_operacion}`);
    } catch (emailErr) {
      console.error("[confeccionar] Error enviando email:", emailErr instanceof Error ? emailErr.message : emailErr);
    }
    } // end if (!skipEmail)

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[confeccionar] Error:", msg);
    return NextResponse.json({ error: `Error en confección: ${msg}` }, { status: 500 });
  }
}
