#!/usr/bin/env node
/**
 * Test: Enviar email de solicitud de transporte para la operación 190153
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { Resend } from "resend";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });
const resend = new Resend(get("RESEND_API_KEY"));

const NRO_OP = "190153";

(async () => {
  // Obtener datos
  const blRow = await pool.query("SELECT datos_extraidos, datos_shipsgo, storage_url FROM documentos WHERE nro_operacion=$1 AND tipo_documento='Bill of Lading (BL)'", [NRO_OP]);
  const invRow = await pool.query("SELECT datos_extraidos FROM documentos WHERE nro_operacion=$1 AND tipo_documento='Invoice (Factura Comercial)'", [NRO_OP]);

  const bl = typeof blRow.rows[0].datos_extraidos === "string" ? JSON.parse(blRow.rows[0].datos_extraidos) : blRow.rows[0].datos_extraidos;
  const sg = blRow.rows[0].datos_shipsgo ? (typeof blRow.rows[0].datos_shipsgo === "string" ? JSON.parse(blRow.rows[0].datos_shipsgo) : blRow.rows[0].datos_shipsgo) : {};
  const inv = typeof invRow.rows[0].datos_extraidos === "string" ? JSON.parse(invRow.rows[0].datos_extraidos) : invRow.rows[0].datos_extraidos;
  const blUrl = blRow.rows[0].storage_url;

  // Datos
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

  // Tipo contenedores
  const cantCont = contenedores.length;
  const tipoCont = String(contenedores[0]?.tipo_contenedor || "").includes("40") ? "40" : "20";

  // Subject
  const subject = `FCL/FCL ${cantCont}X${tipoCont} | SOL. TTE. DESPACHO ${NRO_OP} | Documentos de importación marítima PETROQUIMICA DOW REF: ${referencia} // BL ${blMaster} // MN ${nave} ${viaje} // ETA: ${eta} // PUERTO: ${puertoDesembarque}`;

  // Body HTML
  const contTable = contenedores.map(c => `<tr><td>${c.numero_contenedor}</td><td>${c.peso_bruto || ""} KG</td><td>${c.tipo_contenedor || ""}</td></tr>`).join("");
  const itemsList = items.map(i => `<li>${i.descripcion || i.description || ""} — ${i.cantidad || ""} ${i.unidad || "KG"}</li>`).join("");

  const html = `
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
  <p>Estimados,</p>
  <p>Adjunto Bill of Lading para solicitud de transporte terrestre:</p>
  
  <table style="border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 4px 12px; font-weight: bold;">Nro. BL:</td><td style="padding: 4px 12px;">${blMaster}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Nave:</td><td style="padding: 4px 12px;">${nave}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Viaje:</td><td style="padding: 4px 12px;">${viaje}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Puerto Embarque:</td><td style="padding: 4px 12px;">${bl.puerto_embarque || ""}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Puerto Transbordo:</td><td style="padding: 4px 12px;">${bl.puerto_transbordo || ""}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Puerto Desembarque:</td><td style="padding: 4px 12px;">${puertoDesembarque}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">ETA:</td><td style="padding: 4px 12px;">${eta}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Huella de Carbono:</td><td style="padding: 4px 12px;">${sg?.route?.co2_emission ? sg.route.co2_emission + " ton CO₂" : "N/D"}</td></tr>
  </table>

  <h3 style="margin-top: 20px;">Contenedores</h3>
  <table style="border-collapse: collapse; border: 1px solid #ddd;">
    <thead><tr style="background: #f5f5f5;"><th style="padding: 6px 12px; border: 1px solid #ddd;">Contenedor</th><th style="padding: 6px 12px; border: 1px solid #ddd;">Peso Bruto</th><th style="padding: 6px 12px; border: 1px solid #ddd;">Tipo</th></tr></thead>
    <tbody>${contTable}</tbody>
  </table>

  <h3 style="margin-top: 20px;">Productos</h3>
  <ul>${itemsList}</ul>

  <h3 style="margin-top: 20px;">Seguimiento del Embarque</h3>
  ${(() => {
    const containers = sg?.containers || [];
    const cont = containers[0] || {};
    const movements = cont.movements || [];
    const polLocation = sg?.route?.port_of_loading?.location || {};
    const podLocation = sg?.route?.port_of_discharge?.location || {};
    const polDate = sg?.route?.port_of_loading?.date_of_loading ? new Date(sg.route.port_of_loading.date_of_loading).toLocaleDateString("es-CL") : "";
    const podDate = sg?.route?.port_of_discharge?.date_of_discharge ? new Date(sg.route.port_of_discharge.date_of_discharge).toLocaleDateString("es-CL") : "";

    const eventNames = { EMSH: "Empty to Shipper", GTIN: "Gate In", LOAD: "Loaded", DEPA: "Departure", ARRV: "Arrival", DISC: "Discharged", GTOT: "Gate Out" };

    let movementsHtml = "";
    let currentPort = "";
    for (const m of movements) {
      const portName = m.location?.name || "";
      const portCode = m.location?.code || "";
      if (portCode !== currentPort) {
        currentPort = portCode;
        movementsHtml += `<tr><td colspan="4" style="padding: 8px 12px; font-weight: bold; background: #f0f0f0;">⚓ ${portCode} ${portName}</td></tr>`;
      }
      const fecha = m.timestamp ? new Date(m.timestamp).toLocaleDateString("es-CL") : "";
      const vessel = m.vessel?.name || "-";
      const voyage = m.voyage || "";
      const status = m.status === "ACT" ? "✅" : "⏳";
      movementsHtml += `<tr>
        <td style="padding: 4px 12px;"><span style="background: #e8e8ff; padding: 2px 8px; border-radius: 10px; font-size: 12px;">${m.event}</span></td>
        <td style="padding: 4px 12px;">${fecha}</td>
        <td style="padding: 4px 12px;">${vessel}${voyage ? " " + voyage : ""}</td>
        <td style="padding: 4px 12px;">${status}</td>
      </tr>`;
    }

    return `
  <table style="border-collapse: collapse; margin: 8px 0; font-size: 13px;">
    <tr><td style="padding: 4px 12px; font-weight: bold;">Booking:</td><td>${sg?.booking_number || blMaster}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Container:</td><td>${cont.number || ""} - ${cont.size || ""}${cont.type || ""}</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Ruta:</td><td>${polLocation.code || ""} ${polLocation.name || ""} (${polDate}) → ${podLocation.code || ""} ${podLocation.name || ""} (${podDate})</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Tránsito:</td><td>${sg?.route?.transit_time || ""} días (${sg?.route?.transit_percentage || 0}%)</td></tr>
    <tr><td style="padding: 4px 12px; font-weight: bold;">Estado:</td><td>${sg?.status || ""}</td></tr>
  </table>

  <table style="border-collapse: collapse; border: 1px solid #ddd; width: 100%; margin-top: 8px;">
    <thead><tr style="background: #f5f5f5;"><th style="padding: 6px 12px; border: 1px solid #ddd;">Evento</th><th style="padding: 6px 12px; border: 1px solid #ddd;">Fecha</th><th style="padding: 6px 12px; border: 1px solid #ddd;">Nave</th><th style="padding: 6px 12px; border: 1px solid #ddd;">Estado</th></tr></thead>
    <tbody>${movementsHtml}</tbody>
  </table>`;
  })()}

  <h3 style="margin-top: 20px;">Tracking en Vivo</h3>
  <p><a href="https://agatrack.com/tracking/${NRO_OP}" target="_blank" style="color: #2563eb; text-decoration: underline;">Ver tracking interactivo del embarque →</a></p>

  <p style="margin-top: 20px; color: #666; font-size: 12px;">Referencia: ${referencia} | Operación: ${NRO_OP}</p>
  <p style="color: #666; font-size: 12px;">Agencia de Aduanas Fernando Guerra y Cía. Ltda.</p>
</div>`;

  // Descargar BL PDF para adjuntar
  let attachment = undefined;
  if (blUrl) {
    try {
      const pdfRes = await fetch(blUrl);
      if (pdfRes.ok) {
        const buf = Buffer.from(await pdfRes.arrayBuffer());
        attachment = [{ filename: `BL_${blMaster}.pdf`, content: buf }];
      }
    } catch (e) { console.error("Error descargando PDF:", e.message); }
  }

  console.log("Subject:", subject);
  console.log("To: fguerrab@agenciaguerra.com");
  console.log("Attachment:", attachment ? "BL PDF adjunto" : "sin adjunto");

  // Enviar
  const result = await resend.emails.send({
    from: get("RESEND_FROM"),
    to: ["fguerrab@agenciaguerra.com", "fguerra@agenciaguerra.com"],
    subject,
    html,
    attachments: attachment,
  });

  console.log("\n✅ Email enviado:", JSON.stringify(result));
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
