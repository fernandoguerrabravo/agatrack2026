// Envía correo de confirmación "OK" al remitente de la remesa procesada.
// Uso: node scripts/enviar-confirmacion-remesa.mjs [email_id]   (si no, toma la más reciente)
import fs from "fs";
import pg from "pg";
import { Resend } from "resend";
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
try { if (fs.existsSync(".env")) for (const l of fs.readFileSync(".env","utf8").split("\n")) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,""); } } catch {}

const { Client } = pg;
const c = new Client({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const arg = process.argv[2];
const q = arg
  ? await c.query('SELECT * FROM remesas_ingresos WHERE email_id=$1', [arg])
  : await c.query('SELECT * FROM remesas_ingresos ORDER BY created_at DESC LIMIT 1');
if (!q.rows.length) { console.error("no hay remesa"); process.exit(1); }
const r = q.rows[0];
const lineas = typeof r.lineas === "string" ? JSON.parse(r.lineas) : (r.lineas || []);
const total = Number(r.total);
const to = r.from;
console.log("Enviando confirmación a:", to, "| líneas:", lineas.length, "| total:", total);

const filas = lineas.map(l => `<tr><td style="padding:4px 10px;border:1px solid #ddd;">${l.despacho}</td><td style="padding:4px 10px;border:1px solid #ddd;text-align:right;">${Number(l.monto).toLocaleString("es-CL")}</td></tr>`).join("");
const resend = new Resend(process.env.RESEND_API_KEY);
const out = await resend.emails.send({
  from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
  to: [to],
  subject: `✅ Comprobante de Ingreso de Remesa generado OK — Total ${total.toLocaleString("es-CL")}`,
  html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
    <p>Estimados,</p>
    <p>El comprobante de <b>Ingreso de Remesa</b> se generó correctamente en AduanaNet (cuenta KSB CHILE S.A., glosa PROVISIÓN DE IMPORTACIÓN).</p>
    <table style="border-collapse:collapse;border:1px solid #ddd;margin:12px 0;">
      <thead><tr style="background:#f5f5f5;"><th style="padding:6px 10px;border:1px solid #ddd;">N° Despacho</th><th style="padding:6px 10px;border:1px solid #ddd;">Monto</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><td style="padding:6px 10px;border:1px solid #ddd;font-weight:bold;">TOTAL (${lineas.length} despachos)</td><td style="padding:6px 10px;border:1px solid #ddd;text-align:right;font-weight:bold;">${total.toLocaleString("es-CL")}</td></tr></tfoot>
    </table>
    <p style="color:#666;font-size:12px;">Generado automáticamente por AgaTrack.</p>
  </div>`,
});
console.log("Resend:", JSON.stringify(out).slice(0,200));
await c.end();
console.log("✅ Confirmación enviada");
