import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { aduananetLogin } from "@/lib/aduananet";
import { browserProvisionFondos } from "@/lib/aduananet-browser";
import { uploadToSpaces } from "@/lib/spaces";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * POST /api/operaciones/provision-fondos
 * Body: { nro_operacion: string }
 * 
 * 1. Crea provisión de fondos en AduanaNet (Puppeteer)
 * 2. Obtiene el sofo_id de la provisión creada
 * 3. Descarga el PDF
 * 4. Guarda en bucket
 * 5. Envía por correo
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  try {
    // 1. Crear provisión con Puppeteer
    console.log(`[provision] Creando provisión para op ${nro_operacion}...`);
    const result = await browserProvisionFondos(nro_operacion);

    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Error creando provisión" }, { status: 500 });
    }

    console.log(`[provision] Provisión creada. Total: ${result.total}`);

    // 2. Buscar el sofo_id de la provisión recién creada (la más reciente para este lib_nid)
    const cookies = await aduananetLogin();
    const filterBody = new URLSearchParams();
    filterBody.set("accion", "F");
    filterBody.set("fil_lib_nid", nro_operacion);

    const listaRes = await fetch(`${BASE_URL}/modulos/contabilidad/solicitud_fondos/lista.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: filterBody.toString(),
    });
    const listaHtml = await listaRes.text();

    // Extraer sofo_id más reciente
    const sofoIds = [...listaHtml.matchAll(/reporte\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    const sofoId = sofoIds.length > 0 ? Math.max(...sofoIds) : 0;

    if (!sofoId) {
      return NextResponse.json({ error: "Provisión creada pero no se encontró el ID para el PDF" }, { status: 500 });
    }

    console.log(`[provision] sofo_id: ${sofoId}. Descargando PDF...`);

    // 3. Descargar PDF
    const pdfBody = new URLSearchParams({ accion: "E", sofo_id: String(sofoId), det: "1" });
    const pdfRes = await fetch(`${BASE_URL}/modulos/contabilidad/solicitud_fondos/reporte_pdf.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: pdfBody.toString(),
    });

    if (!pdfRes.ok || !pdfRes.headers.get("content-type")?.includes("pdf")) {
      return NextResponse.json({ error: "Error descargando PDF de provisión" }, { status: 500 });
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
    console.log(`[provision] PDF descargado: ${pdfBuffer.length} bytes`);

    // 4. Guardar en bucket
    const opRow = await pgQuery<{ rut_cliente: string }>("SELECT rut_cliente FROM operaciones WHERE nro_operacion = $1", [nro_operacion]);
    const rutCliente = opRow[0]?.rut_cliente || "92933000-5";
    const fileKey = `documentos/${rutCliente}/${nro_operacion}/provision_fondos_${sofoId}.pdf`;
    let storageUrl = "";
    try {
      storageUrl = await uploadToSpaces(pdfBuffer, fileKey, "application/pdf");
      console.log(`[provision] PDF guardado en bucket: ${storageUrl}`);
    } catch (err) {
      console.error("[provision] Error subiendo a Spaces:", err instanceof Error ? err.message : err);
    }

    // 5. Enviar por correo con detalle del embarque
    // Obtener datos del BL y ShipsGo
    const blRows = await pgQuery<{ datos_extraidos: string; datos_shipsgo: string }>(
      "SELECT datos_extraidos, datos_shipsgo FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)' LIMIT 1",
      [nro_operacion]
    );
    const invRows = await pgQuery<{ datos_extraidos: string }>(
      "SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Invoice (Factura Comercial)' LIMIT 1",
      [nro_operacion]
    );

    const bl = blRows.length > 0 ? (typeof blRows[0].datos_extraidos === "string" ? JSON.parse(blRows[0].datos_extraidos) : blRows[0].datos_extraidos) : {};
    const sg = blRows.length > 0 && blRows[0].datos_shipsgo ? (typeof blRows[0].datos_shipsgo === "string" ? JSON.parse(blRows[0].datos_shipsgo) : blRows[0].datos_shipsgo) : {} as Record<string, unknown>;
    const inv = invRows.length > 0 ? (typeof invRows[0].datos_extraidos === "string" ? JSON.parse(invRows[0].datos_extraidos) : invRows[0].datos_extraidos) : {};

    const blMaster = bl.mbl_shipsgo || bl.numero_bl_master || bl.numero_bl || "";
    const nave = bl.nave_corregida || bl.nave || "";
    const viaje = bl.viaje_corregido || bl.viaje || "";
    const referencia = inv.customer_order_number || inv.our_reference || inv.numero_factura || "";
    const contenedores = bl.contenedores || [];
    const items = inv.items || [];

    // ETA
    const sgRoute = (sg as Record<string, unknown>).route as Record<string, unknown> | undefined;
    const etaRaw = (sgRoute?.port_of_discharge as Record<string, unknown>)?.date_of_discharge || "";
    let eta = "";
    if (etaRaw) {
      const d = new Date(String(etaRaw));
      const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
      eta = `${String(d.getDate()).padStart(2, "0")}${meses[d.getMonth()]} ${d.getFullYear()}`;
    }

    // Seguimiento
    let seguimientoHtml = "";
    const sgContainers = ((sg as Record<string, unknown>).containers || []) as Array<Record<string, unknown>>;
    if (sgContainers.length > 0) {
      const cont = sgContainers[0];
      const movements = (cont.movements || []) as Array<Record<string, unknown>>;
      let movementsHtml = "";
      let currentPort = "";
      for (const m of movements) {
        const loc = m.location as Record<string, unknown> | undefined;
        const portCode = String(loc?.code || "");
        const portName = String(loc?.name || "");
        if (portCode !== currentPort) { currentPort = portCode; movementsHtml += `<tr><td colspan="4" style="padding:8px 12px;font-weight:bold;background:#f0f0f0;">⚓ ${portCode} ${portName}</td></tr>`; }
        const fecha = m.timestamp ? new Date(String(m.timestamp)).toLocaleDateString("es-CL") : "";
        const vessel = String((m.vessel as Record<string, unknown>)?.name || "-");
        const voyage = m.voyage ? " " + String(m.voyage) : "";
        const status = m.status === "ACT" ? "✅" : "⏳";
        movementsHtml += `<tr><td style="padding:4px 12px;"><span style="background:#e8e8ff;padding:2px 8px;border-radius:10px;font-size:12px;">${m.event}</span></td><td style="padding:4px 12px;">${fecha}</td><td style="padding:4px 12px;">${vessel}${voyage}</td><td style="padding:4px 12px;">${status}</td></tr>`;
      }
      seguimientoHtml = `<h3 style="margin-top:20px;">Seguimiento del Embarque</h3><table style="border-collapse:collapse;border:1px solid #ddd;width:100%;"><thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;border:1px solid #ddd;">Evento</th><th style="padding:6px 12px;border:1px solid #ddd;">Fecha</th><th style="padding:6px 12px;border:1px solid #ddd;">Nave</th><th style="padding:6px 12px;border:1px solid #ddd;">Estado</th></tr></thead><tbody>${movementsHtml}</tbody></table>`;
    }

    const contTable = contenedores.map((c: Record<string, unknown>) => `<tr><td style="padding:4px 12px;border:1px solid #ddd;">${c.numero_contenedor}</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.peso_bruto || ""} KG</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.tipo_contenedor || ""}</td></tr>`).join("");
    const itemsList = items.map((i: Record<string, unknown>) => `<li>${i.descripcion || i.description || ""} — ${i.cantidad || ""} ${i.unidad || "KG"}</li>`).join("");

    const emailResult = await resend.emails.send({
      from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.agenciaguerra.com>",
      to: ["fguerrab@agenciaguerra.com"],
      subject: `Provisión de Fondos - Despacho ${nro_operacion} - PETROQUIMICA DOW S.A. REF: ${referencia}`,
      html: `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Adjunto Provisión de Fondos para el despacho <b>${nro_operacion}</b>.</p>
  
  <table style="border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:4px 12px;font-weight:bold;">Operación:</td><td style="padding:4px 12px;">${nro_operacion}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Total Provisión:</td><td style="padding:4px 12px;">$${result.total || ""}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Nro. BL:</td><td style="padding:4px 12px;">${blMaster}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Nave:</td><td style="padding:4px 12px;">${nave}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Viaje:</td><td style="padding:4px 12px;">${viaje}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Puerto Embarque:</td><td style="padding:4px 12px;">${bl.puerto_embarque || ""}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Puerto Transbordo:</td><td style="padding:4px 12px;">${bl.puerto_transbordo || ""}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Puerto Desembarque:</td><td style="padding:4px 12px;">SAN ANTONIO</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">ETA:</td><td style="padding:4px 12px;">${eta}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Huella de Carbono:</td><td style="padding:4px 12px;">${sgRoute?.co2_emission ? sgRoute.co2_emission + " ton CO₂" : "N/D"}</td></tr>
  </table>

  <h3 style="margin-top:20px;">Contenedores</h3>
  <table style="border-collapse:collapse;border:1px solid #ddd;">
    <thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;border:1px solid #ddd;">Contenedor</th><th style="padding:6px 12px;border:1px solid #ddd;">Peso Bruto</th><th style="padding:6px 12px;border:1px solid #ddd;">Tipo</th></tr></thead>
    <tbody>${contTable}</tbody>
  </table>

  <h3 style="margin-top:20px;">Productos</h3>
  <ul>${itemsList}</ul>

  ${seguimientoHtml}

  <h3 style="margin-top:20px;">Tracking en Vivo</h3>
  <p><a href="https://agatrack.agenciaguerra.com/tracking/${nro_operacion}" target="_blank" style="color:#2563eb;text-decoration:underline;">Ver tracking interactivo del embarque →</a></p>

  <p style="margin-top:20px;color:#666;font-size:12px;">Referencia: ${referencia} | Operación: ${nro_operacion}</p>
  <p style="color:#666;font-size:12px;">Agencia de Aduanas Fernando Guerra y Cía. Ltda.</p>
</div>`,
      attachments: [{ filename: `Provision_Fondos_${nro_operacion}.pdf`, content: pdfBuffer }],
    });

    if (emailResult.error) {
      console.error("[provision] Error email:", emailResult.error);
    } else {
      console.log(`[provision] Email enviado`);
    }

    return NextResponse.json({
      ok: true,
      sofo_id: sofoId,
      total: result.total,
      storage_url: storageUrl,
      email_enviado: !emailResult.error,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[provision] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
