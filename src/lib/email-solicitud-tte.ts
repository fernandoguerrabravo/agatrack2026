import "server-only";
import { Resend } from "resend";
import { pgQuery } from "./postgres";
import { emailsEjecutivosCliente } from "./permisos";

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>";

// Contactos fijos para solicitud de transporte — Petroquímica DOW
const CONTACTOS_PETROQUIMICA = [
  "BARomanini@dow.com",
  "HZachariotto@dow.com",
  "LNuez@dow.com",
  "MLIbarraRocha@dow.com",
  "jfernandez@agenciaguerra.com",
  "jaime.ascencio@axf.cl",
  "losandes@agenciaguerra.com",
  "hector@agenciaguerra.com",
  "bdpcl.dow@bdpint.com",
  "amedina@lamaignere.com",
  "coordinacion@atlogistica.cl",
  "elizabeth.rojas@atlogistica.cl",
  "agustin@agenciaguerra.com",
  "alejandro.avalos@atlogistica.cl",
  "boris@agenciaguerra.com",
  "isabel.riveros@psabdp.com",
  "roberto.santibanez@psabdp.com",
  "sara.arcos@psabdp.com",
  "bastian.monsalve@agenciaguerra.com",
  "ehenriquez@agenciaguerra.com",
  "camila.quinones@atlogistica.cl",
  "sai@agenciaguerra.com",
  "sanantonio@agenciaguerra.com",
  "josue@agenciaguerra.com",
  "jgonzalez@agenciaguerra.com",
  "valparaiso@agenciaguerra.com",
  "fguerrab@agenciaguerra.com",
];

/**
 * Envía email de solicitud de transporte terrestre con BL adjunto.
 * Se dispara automáticamente cuando se sube un BL y se obtiene info de ShipsGo.
 */
export async function enviarEmailSolicitudTTE(nroOperacion: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Obtener datos
    const blRows = await pgQuery<{ datos_extraidos: string; datos_shipsgo: string; storage_url: string }>(
      "SELECT datos_extraidos, datos_shipsgo, storage_url FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)' LIMIT 1",
      [nroOperacion]
    );
    const invRows = await pgQuery<{ datos_extraidos: string }>(
      "SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Invoice (Factura Comercial)' LIMIT 1",
      [nroOperacion]
    );

    if (blRows.length === 0) return { ok: false, error: "No hay BL" };

    const bl = typeof blRows[0].datos_extraidos === "string" ? JSON.parse(blRows[0].datos_extraidos) : blRows[0].datos_extraidos;
    const sg = blRows[0].datos_shipsgo ? (typeof blRows[0].datos_shipsgo === "string" ? JSON.parse(blRows[0].datos_shipsgo) : blRows[0].datos_shipsgo) : {};
    const inv = invRows.length > 0 ? (typeof invRows[0].datos_extraidos === "string" ? JSON.parse(invRows[0].datos_extraidos) : invRows[0].datos_extraidos) : {};
    const blUrl = blRows[0].storage_url;

    const blMaster = bl.mbl_shipsgo || bl.numero_bl_master || bl.numero_bl || "";
    const nave = bl.nave_corregida || bl.nave || "";
    const viaje = bl.viaje_corregido || bl.viaje || "";
    const puertoDesembarque = "SAN ANTONIO";
    const referencia = inv.customer_order_number || inv.our_reference || inv.numero_factura || "";
    const contenedores = bl.contenedores || [];
    const items = inv.items || [];

    // ETA desde ShipsGo
    const etaRaw = sg?.route?.port_of_discharge?.date_of_discharge || "";
    let eta = "";
    if (etaRaw) {
      const d = new Date(etaRaw);
      const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
      eta = `${String(d.getDate()).padStart(2, "0")}${meses[d.getMonth()]} ${d.getFullYear()}`;
    }

    const cantCont = contenedores.length;
    const tipoCont = String(contenedores[0]?.tipo_contenedor || "").includes("40") ? "40" : "20";

    // Subject
    const subject = `FCL/FCL ${cantCont}X${tipoCont} | SOL. TTE. DESPACHO ${nroOperacion} | Documentos de importación marítima PETROQUIMICA DOW REF: ${referencia} // BL ${blMaster} // MN ${nave} ${viaje} // ETA: ${eta} // PUERTO: ${puertoDesembarque}`;

    // Body
    const contTable = contenedores.map((c: Record<string, unknown>) => `<tr><td style="padding:4px 12px;border:1px solid #ddd;">${c.numero_contenedor}</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.peso_bruto || ""} KG</td><td style="padding:4px 12px;border:1px solid #ddd;">${c.tipo_contenedor || ""}</td></tr>`).join("");
    const itemsList = items.map((i: Record<string, unknown>) => `<li>${i.descripcion || i.description || ""} — ${i.cantidad || ""} ${i.unidad || "KG"}</li>`).join("");

    // Seguimiento ShipsGo
    let seguimientoHtml = "";
    if (sg?.containers?.length > 0) {
      const cont = sg.containers[0];
      const movements = cont.movements || [];
      const polLocation = sg.route?.port_of_loading?.location || {};
      const podLocation = sg.route?.port_of_discharge?.location || {};
      const polDate = sg.route?.port_of_loading?.date_of_loading ? new Date(sg.route.port_of_loading.date_of_loading).toLocaleDateString("es-CL") : "";
      const podDate = sg.route?.port_of_discharge?.date_of_discharge ? new Date(sg.route.port_of_discharge.date_of_discharge).toLocaleDateString("es-CL") : "";

      let movementsHtml = "";
      let currentPort = "";
      for (const m of movements) {
        const portCode = m.location?.code || "";
        const portName = m.location?.name || "";
        if (portCode !== currentPort) {
          currentPort = portCode;
          movementsHtml += `<tr><td colspan="4" style="padding:8px 12px;font-weight:bold;background:#f0f0f0;">⚓ ${portCode} ${portName}</td></tr>`;
        }
        const fecha = m.timestamp ? new Date(m.timestamp).toLocaleDateString("es-CL") : "";
        const vessel = m.vessel?.name || "-";
        const voyage = m.voyage || "";
        const status = m.status === "ACT" ? "✅" : "⏳";
        movementsHtml += `<tr><td style="padding:4px 12px;"><span style="background:#e8e8ff;padding:2px 8px;border-radius:10px;font-size:12px;">${m.event}</span></td><td style="padding:4px 12px;">${fecha}</td><td style="padding:4px 12px;">${vessel}${voyage ? " " + voyage : ""}</td><td style="padding:4px 12px;">${status}</td></tr>`;
      }

      seguimientoHtml = `
  <h3 style="margin-top:20px;">Seguimiento del Embarque</h3>
  <table style="border-collapse:collapse;margin:8px 0;font-size:13px;">
    <tr><td style="padding:4px 12px;font-weight:bold;">Booking:</td><td>${sg.booking_number || blMaster}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Container:</td><td>${cont.number || ""} - ${cont.size || ""}${cont.type || ""}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Ruta:</td><td>${polLocation.code || ""} ${polLocation.name || ""} (${polDate}) → ${podLocation.code || ""} ${podLocation.name || ""} (${podDate})</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Tránsito:</td><td>${sg.route?.transit_time || ""} días (${sg.route?.transit_percentage || 0}%)</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Estado:</td><td>${sg.status || ""}</td></tr>
  </table>
  <table style="border-collapse:collapse;border:1px solid #ddd;width:100%;margin-top:8px;">
    <thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;border:1px solid #ddd;">Evento</th><th style="padding:6px 12px;border:1px solid #ddd;">Fecha</th><th style="padding:6px 12px;border:1px solid #ddd;">Nave</th><th style="padding:6px 12px;border:1px solid #ddd;">Estado</th></tr></thead>
    <tbody>${movementsHtml}</tbody>
  </table>`;
    }

    const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Adjunto Bill of Lading para solicitud de transporte terrestre:</p>
  
  <table style="border-collapse:collapse;margin:16px 0;">
    <tr><td style="padding:4px 12px;font-weight:bold;">Nro. BL:</td><td style="padding:4px 12px;">${blMaster}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Nave:</td><td style="padding:4px 12px;">${nave}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Viaje:</td><td style="padding:4px 12px;">${viaje}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Puerto Embarque:</td><td style="padding:4px 12px;">${bl.puerto_embarque || ""}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Puerto Transbordo:</td><td style="padding:4px 12px;">${bl.puerto_transbordo || ""}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Puerto Desembarque:</td><td style="padding:4px 12px;">${puertoDesembarque}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">ETA:</td><td style="padding:4px 12px;">${eta}</td></tr>
    <tr><td style="padding:4px 12px;font-weight:bold;">Huella de Carbono:</td><td style="padding:4px 12px;">${sg?.route?.co2_emission ? sg.route.co2_emission + " ton CO₂" : "N/D"}</td></tr>
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
  <p><a href="https://agatrack.com/tracking/${nroOperacion}" target="_blank" style="color:#2563eb;text-decoration:underline;">Ver tracking interactivo del embarque →</a></p>

  <p style="margin-top:20px;color:#666;font-size:12px;">Referencia: ${referencia} | Operación: ${nroOperacion}</p>
  <p style="color:#666;font-size:12px;">Agencia de Aduanas Fernando Guerra y Cía. Ltda.</p>
</div>`;

    // Adjuntar BL PDF
    let attachments: Array<{ filename: string; content: Buffer }> | undefined;
    if (blUrl) {
      try {
        const pdfRes = await fetch(blUrl);
        if (pdfRes.ok) {
          const buf = Buffer.from(await pdfRes.arrayBuffer());
          attachments = [{ filename: `BL_${blMaster}.pdf`, content: buf }];
        }
      } catch { /* ignore */ }
    }

    // Enviar
    // Obtener ejecutivos asignados para CC
    const ejecutivosCCTte = await emailsEjecutivosCliente("92933000-5");
    const result = await resend.emails.send({
      from: FROM,
      to: CONTACTOS_PETROQUIMICA,
      cc: ejecutivosCCTte.filter(e => !CONTACTOS_PETROQUIMICA.includes(e)).length > 0 ? ejecutivosCCTte.filter(e => !CONTACTOS_PETROQUIMICA.includes(e)) : undefined,
      subject,
      html,
      attachments,
    });

    if (result.error) {
      console.error("[email-tte] Error:", result.error);
      return { ok: false, error: String(result.error) };
    }

    console.log(`[email-tte] ✅ Email enviado para op ${nroOperacion} a ${CONTACTOS_PETROQUIMICA.length} contactos`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[email-tte] Error:", msg);
    return { ok: false, error: msg };
  }
}
