// Envía el correo de aviso de creación de despacho (replica PASO 6 del inbound).
// Uso: node scripts/enviar-aviso-creacion.mjs <nro_operacion>
// Requiere RESEND_API_KEY real (ejecutar en el servidor). Lee .env del cwd si existe.
import fs from "fs";
import pg from "pg";
import { Resend } from "resend";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// cargar .env del cwd (servidor) si las vars no están en el entorno
try {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {}

const NRO = process.argv[2];
if (!NRO) { console.error("Falta nro_operacion"); process.exit(1); }

const PG = process.env.POSTGRES_URL;
if (!PG) { console.error("Falta POSTGRES_URL en el entorno/.env"); process.exit(1); }
const { Client } = pg;
const c = new Client({ connectionString: PG, ssl: { rejectUnauthorized: false } });
await c.connect();

const opR = await c.query("SELECT rut_cliente, notas FROM operaciones WHERE nro_operacion=$1", [NRO]);
if (!opR.rows.length) { console.error("Operación no existe en BD"); process.exit(1); }
const notas = opR.rows[0].notas || "";
const referencia = (notas.match(/ref:\s*([0-9A-Za-z_-]+)/) || [])[1] || "";

const docsR = await c.query("SELECT id, tipo_documento, nombre_archivo, datos_extraidos::text AS d FROM documentos WHERE nro_operacion=$1 ORDER BY id", [NRO]);
const docs = docsR.rows.map(r => { let datos = {}; try { datos = JSON.parse(r.d); } catch {} return { tipo: r.tipo_documento, nombre: r.nombre_archivo, datos }; });

const find = t => docs.find(d => d.tipo === t)?.datos || {};
const invData = find("Invoice (Factura Comercial)");
const plData = find("Lista de Empaque (Packing List)");
const coData = find("Certificado de Origen");
const micData = find("MIC/DTA");
const crt = micData.crt || micData || {};

const esTerrestre = docs.some(d => d.tipo === "MIC/DTA" || d.tipo === "Carta de Porte Internacional (CRT)");
const clienteNombre = "PETROQUIMICA DOW S.A.";
const provRaw = invData?.proveedor ?? crt?.remitente;
const proveedor = (provRaw && typeof provRaw === "object")
  ? String(provRaw.razon_social || provRaw.nombre || provRaw.name || provRaw.nombre_comercial || "")
  : String(provRaw || "");
const montoTotal = invData.monto_total || "";
const moneda = String(invData.moneda || "USD").replace(/[^A-Z]/g, "") || "USD";
const incoterm = String(invData.incoterm || crt.incoterm || "");
const pesoBruto = plData.peso_bruto_total || (Array.isArray(plData.items) ? plData.items.reduce((s,i)=>s+Number(i.peso_bruto||0),0) : "") || "";
const totalBultos = plData.total_bultos || (Array.isArray(plData.items) ? plData.items.reduce((s,i)=>s+Number(i.cantidad||0),0) : "") || "";
const producto = (invData.items || [])[0]?.descripcion || "";
const paisOrigen = String(coData?.pais_origen || invData.pais_origen || crt?.pais_origen || "ARGENTINA");
const porteador = String(crt?.porteador?.nombre || "");
const puertoDesembarque = esTerrestre ? "LOS ANDES" : "SAN ANTONIO";

const docsTable = docs.map(d => `<tr><td style="padding:4px 12px;border:1px solid #ddd;">${d.nombre}</td><td style="padding:4px 12px;border:1px solid #ddd;">${d.tipo}</td></tr>`).join("");

const RECIPIENTS = [
  "BARomanini@dow.com", "HZachariotto@dow.com", "LNuez@dow.com", "MLIbarraRocha@dow.com",
  "jfernandez@agenciaguerra.com", "losandes@agenciaguerra.com",
  "boris@agenciaguerra.com", "bdpcl.dow@bdpint.com", "isabel.riveros@psabdp.com",
  "roberto.santibanez@psabdp.com", "sara.arcos@psabdp.com",
  "bastian.monsalve@agenciaguerra.com", "ehenriquez@agenciaguerra.com", "fguerrab@agenciaguerra.com",
];

const html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Se ha creado un nuevo despacho:</p>
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${NRO}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Cliente</td><td style="padding:8px 12px;border:1px solid #ddd;">${clienteNombre}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Proveedor</td><td style="padding:8px 12px;border:1px solid #ddd;">${proveedor}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Producto</td><td style="padding:8px 12px;border:1px solid #ddd;">${producto}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Incoterm</td><td style="padding:8px 12px;border:1px solid #ddd;">${incoterm}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Monto Total</td><td style="padding:8px 12px;border:1px solid #ddd;">${moneda} ${montoTotal ? Number(montoTotal).toLocaleString() : ""}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">País Origen</td><td style="padding:8px 12px;border:1px solid #ddd;">${paisOrigen}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Peso Bruto</td><td style="padding:8px 12px;border:1px solid #ddd;">${pesoBruto} KG</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Bultos</td><td style="padding:8px 12px;border:1px solid #ddd;">${totalBultos}</td></tr>
    ${porteador ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Transportista</td><td style="padding:8px 12px;border:1px solid #ddd;">${porteador}</td></tr>` : ""}
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Puerto Desembarque</td><td style="padding:8px 12px;border:1px solid #ddd;">${puertoDesembarque}</td></tr>
  </table>
  <h3 style="margin-top:20px;">Documentos Procesados</h3>
  <table style="border-collapse:collapse;border:1px solid #ddd;width:100%;max-width:600px;">
    <thead><tr style="background:#f5f5f5;"><th style="padding:6px 12px;border:1px solid #ddd;">Archivo</th><th style="padding:6px 12px;border:1px solid #ddd;">Clasificación</th></tr></thead>
    <tbody>${docsTable}</tbody>
  </table>
  <p style="margin-top:20px;color:#666;font-size:12px;">Creado automáticamente por AgaTrack.</p>
  <p style="color:#666;font-size:12px;">Agencia de Aduanas Fernando Guerra y Cía. Ltda.</p>
</div>`;

const apiKey = process.env.RESEND_API_KEY || "";
if (!apiKey || /DISABLED/i.test(apiKey)) {
  console.error("❌ RESEND_API_KEY no válida en este entorno (", apiKey.slice(0,12), "). Ejecutar en el servidor.");
  process.exit(2);
}
const resend = new Resend(apiKey);
const r = await resend.emails.send({
  from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
  to: RECIPIENTS,
  subject: `Nuevo Despacho ${NRO} - ${clienteNombre} - REF: ${referencia}`,
  html,
});
console.log("Resend resp:", JSON.stringify(r).slice(0, 300));
await c.end();
console.log("✅ Aviso de creación enviado para", NRO);
