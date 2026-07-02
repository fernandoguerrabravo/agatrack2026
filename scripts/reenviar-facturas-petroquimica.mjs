#!/usr/bin/env node
/**
 * Reenvía el correo de facturas semanales de Petroquímica con los despachos indicados,
 * SIN tocar el flag factura_enviada y SIN filtrar por fecha.
 * Uso: node scripts/reenviar-facturas-petroquimica.mjs 190420 190428 190458 190643
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
const RESEND_API_KEY = get("RESEND_API_KEY");
const RESEND_FROM = get("RESEND_FROM") || "AgaTrack <reportes@agatrack.agenciaguerra.com>";
const BASE_URL = "https://fguerragodoy.aduananet2.cl";

const despachos = process.argv.slice(2).filter(a => /^\d+$/.test(a));
if (despachos.length === 0) { console.error("Uso: node reenviar-facturas-petroquimica.mjs <despacho1> <despacho2> ..."); process.exit(1); }
console.log("Reenviando facturas para:", despachos.join(", "));

(async () => {
  const { PDFDocument } = await import("pdf-lib");
  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.referencia, dr.nro_aceptacion, dr.fecha_aceptacion, dr.total_cif, o.notas
    FROM despachos_replica dr JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE dr.despacho = ANY($1) ORDER BY dr.fecha_aceptacion`, [despachos]);
  if (rows.length === 0) { console.log("no se encontraron operaciones"); await pool.end(); return; }

  // Sesión AduanaNet compartida
  const loginPage = await fetch(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
  const baseCookies = loginPage.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
  const loginBody = new URLSearchParams({ login: get("ADUANANET_LOGIN"), clave: get("ADUANANET_CLAVE") });
  const loginRes = await fetch(`${BASE_URL}/modulos/usuarios/validar.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: baseCookies, Referer: `${BASE_URL}/modulos/usuarios/login.php` }, body: loginBody.toString(), redirect: "manual" });
  const sessCookies = loginRes.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
  const cookies = [baseCookies, sessCookies].filter(Boolean).join("; ");

  const attachments = [], tableRows = [];
  for (const r of rows) {
    const notas = r.notas || "";
    const tgrUrl = (notas.match(/tgr_url:(https?:\/\/[^\s\n]+)/) || [])[1] || "";
    const dteUrl = (notas.match(/dte_url:(https?:\/\/[^\s\n]+)/) || [])[1] || "";
    if (!dteUrl) { console.log(`  ⚠️ ${r.despacho} sin dte_url — se salta`); continue; }
    const merged = await PDFDocument.create();
    try {
      const dteRes = await fetch(dteUrl, { headers: { Cookie: cookies } });
      if (dteRes.ok) { try { const p = await PDFDocument.load(await dteRes.arrayBuffer()); (await merged.copyPages(p, p.getPageIndices())).forEach(pg => merged.addPage(pg)); } catch {} }
      const dinUrl = `${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${r.despacho}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`;
      const dinRes = await fetch(dinUrl, { headers: { Cookie: cookies } });
      if (dinRes.ok) { try { const p = await PDFDocument.load(await dinRes.arrayBuffer()); (await merged.copyPages(p, p.getPageIndices())).forEach(pg => merged.addPage(pg)); } catch {} }
    } catch {}
    if (tgrUrl) { try { const tgrRes = await fetch(tgrUrl); if (tgrRes.ok) { const p = await PDFDocument.load(await tgrRes.arrayBuffer()); (await merged.copyPages(p, p.getPageIndices())).forEach(pg => merged.addPage(pg)); } } catch {} }
    if (merged.getPageCount() > 0) {
      attachments.push({ filename: `Factura_DIN_TGR_${r.despacho}.pdf`, content: Buffer.from(await merged.save()) });
      console.log(`  ✅ PDF ${r.despacho} (${merged.getPageCount()} pág)`);
    }
    let nroFactura = "";
    try {
      const { execSync } = await import("child_process");
      const cmd = `curl -sk -u fguerragodoy:Uj7UarxZafsTL9G -X GET "${BASE_URL}/modulos/endpoints/api.php?endpoint=listaDTEs" -H "Content-Type: application/json" -d '{"despacho":${r.despacho}}'`;
      const data = JSON.parse(execSync(cmd, { timeout: 10000 }).toString());
      const fac = data.data?.find(d => d.codigo_tipo_dte === "33"); if (fac) nroFactura = fac.dte_folio;
    } catch {}
    const fechaAcept = r.fecha_aceptacion ? new Date(r.fecha_aceptacion).toLocaleDateString("es-CL") : "";
    tableRows.push(`<tr>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.despacho}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${nroFactura}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.referencia || ""}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.nro_aceptacion || ""}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${fechaAcept}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.total_cif ? Number(r.total_cif).toLocaleString("es-CL") : ""}</td>
    </tr>`);
  }
  if (attachments.length === 0) { console.log("no se generaron PDFs"); await pool.end(); return; }

  const { Resend } = await import("resend");
  const resend = new Resend(RESEND_API_KEY);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
    <p>Estimados,</p>
    <p>Reenvío de las facturas — PETROQUIMICA DOW S.A.</p>
    <table style="border-collapse:collapse;margin:16px 0;width:100%;">
      <thead><tr style="background:#f5f5f5;">
        <th style="padding:8px 12px;border:1px solid #ddd;">Despacho</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Nro Factura</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Referencia</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Nro Aceptación</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">Fecha</th>
        <th style="padding:8px 12px;border:1px solid #ddd;">CIF USD</th>
      </tr></thead>
      <tbody>${tableRows.join("")}</tbody>
    </table>
    <p><b>${attachments.length}</b> factura(s) adjunta(s) (Factura + DIN + TGR)</p>
    <p style="color:#666;font-size:12px;">Agencia de Aduanas Fernando Guerra y Cía. Ltda.</p>
  </div>`;

  const result = await resend.emails.send({
    from: RESEND_FROM,
    to: ["controlfactura@agenciaguerra.com", "Sara.Arcos@psabdp.com", "monica.arancibia@psabdp.com", "bdpcl.dow@bdpint.com", "felipe.salas@psabdp.com", "roberto.santibanez@psabdp.com"],
    cc: ["oscar@agenciaguerra.com", "rodrigo@agenciaguerra.com", "garqueros@agenciaguerra.com", "fguerra@agenciaguerra.com", "fguerrab@agenciaguerra.com"],
    subject: `Facturas de Honorarios - PETROQUIMICA DOW S.A. (${attachments.length} facturas) - Reenvío`,
    html, attachments,
  });
  if (result.error) console.error("❌ error:", result.error);
  else console.log(`✅ Reenviado id=${result.data?.id} con ${attachments.length} facturas`);
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
