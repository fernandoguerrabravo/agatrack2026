#!/usr/bin/env node
/**
 * Cron: Envía reporte de operaciones pendientes de aprobación.
 * Para marítimas muestra ETA en rojo grande.
 * 
 * Uso: node scripts/cron-reporte-pendientes.mjs
 * Cron (hora Chile = UTC-4):
 *   0 14 * * 1-5  (10:00 AM Chile)
 *   0 19 * * 1-5  (15:00 PM Chile)
 *   30 21 * * 1-5 (17:30 PM Chile)
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Obtener operaciones pendientes y nombres de clientes
  const { rows: pendientes } = await pool.query(
    `SELECT o.nro_operacion, o.estado, o.rut_cliente, o.notas, o.fecha_apertura, c.razon as cliente_nombre
     FROM operaciones o LEFT JOIN clientes c ON o.rut_cliente = c.rut
     WHERE o.estado NOT IN ('aprobada', 'cerrada', 'procesando') ORDER BY o.nro_operacion`
  );

  if (pendientes.length === 0) {
    console.log(`[${new Date().toISOString()}] Sin operaciones pendientes`);
    await pool.end();
    return;
  }

  // Obtener datos de BL/ShipsGo para ETA de cada operación
  const rows = [];
  for (const op of pendientes) {
    const refMatch = (op.notas || "").match(/ref:\s*([^\s|\n]+)/i);
    const referencia = refMatch ? refMatch[1] : "";

    // Buscar BL con ShipsGo para ETA
    const blRows = await pool.query(
      "SELECT datos_extraidos, datos_shipsgo FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)' LIMIT 1",
      [op.nro_operacion]
    );
    // Verificar si es terrestre (MIC/CRT)
    const crtRows = await pool.query(
      "SELECT id FROM documentos WHERE nro_operacion = $1 AND tipo_documento IN ('MIC/DTA', 'Carta de Porte Internacional (CRT)') LIMIT 1",
      [op.nro_operacion]
    );
    const esTerrestre = crtRows.rows.length > 0 && blRows.rows.length === 0;

    let eta = "";
    let nave = "";
    let blMaster = "";
    let puertoDesembarque = esTerrestre ? "LOS ANDES" : "SAN ANTONIO";

    if (blRows.rows.length > 0) {
      const bl = typeof blRows.rows[0].datos_extraidos === "string" ? JSON.parse(blRows.rows[0].datos_extraidos) : blRows.rows[0].datos_extraidos;
      const sg = blRows.rows[0].datos_shipsgo ? (typeof blRows.rows[0].datos_shipsgo === "string" ? JSON.parse(blRows.rows[0].datos_shipsgo) : blRows.rows[0].datos_shipsgo) : null;
      
      blMaster = bl.numero_bl_master || bl.numero_bl || "";
      nave = bl.nave_corregida || bl.nave || "";
      puertoDesembarque = bl.puerto_desembarque || "SAN ANTONIO";

      if (sg?.route?.port_of_discharge?.date_of_discharge) {
        const d = new Date(sg.route.port_of_discharge.date_of_discharge);
        const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
        eta = `${String(d.getDate()).padStart(2, "0")}${meses[d.getMonth()]} ${d.getFullYear()}`;
      }
    }

    rows.push({ ...op, referencia, eta, nave, blMaster, puertoDesembarque, esTerrestre, clienteNombre: op.cliente_nombre || op.rut_cliente });
  }

  // Generar HTML del reporte
  const tableRows = rows.map(op => {
    const etaCell = op.eta
      ? `<td style="padding:6px 12px;border:1px solid #ddd;color:#dc2626;font-weight:bold;font-size:16px;">${op.eta}</td>`
      : `<td style="padding:6px 12px;border:1px solid #ddd;color:#666;">-</td>`;
    const tipo = op.esTerrestre ? "🚛" : "🚢";
    const estadoLabel = op.estado === "confeccionada" ? "Enviada a Confección" : op.estado === "abierta" ? "Abierta" : op.estado;
    return `<tr>
      <td style="padding:6px 12px;border:1px solid #ddd;font-weight:bold;">${op.nro_operacion}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${tipo}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${op.clienteNombre}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${op.referencia}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${estadoLabel}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${op.nave || "-"}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${op.puertoDesembarque}</td>
      ${etaCell}
    </tr>`;
  }).join("");

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Reporte de <b>${pendientes.length}</b> operaciones pendientes de aprobación:</p>
  
  <table style="border-collapse:collapse;width:100%;max-width:800px;margin:16px 0;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:8px 12px;border:1px solid #ddd;">Despacho</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Vía</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Cliente</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Referencia</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Estado</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Nave/TTE</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Puerto</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">ETA</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>

  <p style="color:#666;font-size:12px;margin-top:20px;">Reporte automático de AgaTrack — ${new Date().toLocaleString("es-CL", { timeZone: "America/Santiago" })}</p>
</div>`;

  // Enviar correo
  const { Resend } = await import("resend");
  const resend = new Resend(get("RESEND_API_KEY"));

  // CC ejecutivos
  const ejecutivos = await pool.query(
    "SELECT DISTINCT u.email FROM usuarios u INNER JOIN asignaciones_ejecutivo a ON u.rut = a.rut_ejecutivo WHERE u.email IS NOT NULL AND u.email != ''"
  );
  const ccEmails = ejecutivos.rows.map(r => r.email).filter(Boolean);

  await resend.emails.send({
    from: get("RESEND_FROM") || "AgaTrack <reportes@agatrack.com>",
    to: ["documentos@agenciaguerra.com", "fguerrab@agenciaguerra.com", "fguerra@agenciaguerra.com"],
    cc: ccEmails.length > 0 ? ccEmails : undefined,
    subject: `📋 Operaciones Pendientes de Aprobación (${pendientes.length}) - ${new Date().toLocaleDateString("es-CL", { timeZone: "America/Santiago" })}`,
    html,
  });

  console.log(`[${new Date().toISOString()}] Reporte pendientes enviado: ${pendientes.length} operaciones`);
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
