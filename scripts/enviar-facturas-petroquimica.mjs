#!/usr/bin/env node
/**
 * Cron: Envía facturas de Petroquímica (Factura+DIN+TGR) cada jueves 9AM.
 * Solo envía las que no se han enviado previamente.
 * 
 * Uso: node scripts/enviar-facturas-petroquimica.mjs
 * Cron: 0 13 * * 4 (jueves 9AM Chile = 13 UTC)
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require2 = createRequire(import.meta.url);
const pdfParse = require2("pdf-parse");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });
const RESEND_API_KEY = get("RESEND_API_KEY");
const RESEND_FROM = get("RESEND_FROM") || "AgaTrack <reportes@agatrack.agenciaguerra.com>";
const BASE_URL = "https://fguerragodoy.aduananet2.cl";

(async () => {
  const { PDFDocument } = await import("pdf-lib");

  // 1. Buscar operaciones Petroquímica con factura (dte_url) desde 22/06/2026 no enviadas
  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.referencia, dr.nro_aceptacion, dr.fecha_aceptacion,
           dr.total_cif, dr.tipo_cambio, o.notas
    FROM despachos_replica dr
    JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE dr.rut_cliente = '92933000-5'
      AND dr.fecha_aceptacion >= '2026-06-22'
      AND (o.notas LIKE '%dte_url:%')
      AND (o.notas NOT LIKE '%factura_enviada:true%')
      AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
    ORDER BY dr.fecha_aceptacion
  `);

  if (rows.length === 0) {
    console.log(`[${new Date().toISOString()}] Sin facturas pendientes de envío`);
    await pool.end();
    return;
  }

  console.log(`[facturas-petro] ${rows.length} facturas pendientes de envío`);

  const attachments = [];
  const tableRows = [];

  for (const r of rows) {
    const tgrMatch = (r.notas || "").match(/tgr_url:(https?:\/\/[^\s\n]+)/);
    const dteMatch = (r.notas || "").match(/dte_url:(https?:\/\/[^\s\n]+)/);
    const tgrUrl = tgrMatch ? tgrMatch[1] : "";
    const dteUrl = dteMatch ? dteMatch[1] : "";

    if (!dteUrl) continue;

    // Generar PDF combinado: Factura + DIN + TGR
    const merged = await PDFDocument.create();

    // Factura DTE (necesita sesión AduanaNet)
    try {
      // Login
      const loginPage = await fetch(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
      const baseCookies = loginPage.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
      const loginBody = new URLSearchParams({ login: get("ADUANANET_LOGIN"), clave: get("ADUANANET_CLAVE") });
      const loginRes = await fetch(`${BASE_URL}/modulos/usuarios/validar.php`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: baseCookies, Referer: `${BASE_URL}/modulos/usuarios/login.php` },
        body: loginBody.toString(), redirect: "manual",
      });
      const sessCookies = loginRes.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
      const cookies = [baseCookies, sessCookies].filter(Boolean).join("; ");

      // Descargar Factura DTE PDF
      const dteRes = await fetch(dteUrl, { headers: { Cookie: cookies } });
      if (dteRes.ok) {
        const dteBuf = await dteRes.arrayBuffer();
        try {
          const dtePdf = await PDFDocument.load(dteBuf);
          const pages = await merged.copyPages(dtePdf, dtePdf.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        } catch {}
      }

      // Descargar DIN
      const dinUrl = `${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${r.despacho}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`;
      const dinRes = await fetch(dinUrl, { headers: { Cookie: cookies } });
      if (dinRes.ok) {
        try {
          const dinPdf = await PDFDocument.load(await dinRes.arrayBuffer());
          const pages = await merged.copyPages(dinPdf, dinPdf.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        } catch {}
      }
    } catch {}

    // TGR
    if (tgrUrl) {
      try {
        const tgrRes = await fetch(tgrUrl);
        if (tgrRes.ok) {
          const tgrPdf = await PDFDocument.load(await tgrRes.arrayBuffer());
          const pages = await merged.copyPages(tgrPdf, tgrPdf.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        }
      } catch {}
    }

    if (merged.getPageCount() > 0) {
      const pdfBytes = await merged.save();
      attachments.push({ filename: `Factura_DIN_TGR_${r.despacho}.pdf`, content: Buffer.from(pdfBytes) });
      console.log(`  ✅ PDF ${r.despacho} (${merged.getPageCount()} pág)`);
    }

    // Tabla
    const fechaAcept = r.fecha_aceptacion ? new Date(r.fecha_aceptacion).toLocaleDateString("es-CL") : "";
    // Obtener nro factura de la API
    let nroFactura = "";
    try {
      const { execSync } = await import("child_process");
      const curlCmd = `curl -sk -u fguerragodoy:Uj7UarxZafsTL9G -X GET "${BASE_URL}/modulos/endpoints/api.php?endpoint=listaDTEs" -H "Content-Type: application/json" -d '{"despacho":${r.despacho}}'`;
      const apiRaw = execSync(curlCmd, { timeout: 10000 }).toString();
      const apiData = JSON.parse(apiRaw);
      const fac = apiData.data?.find(d => d.codigo_tipo_dte === "33");
      if (fac) nroFactura = fac.dte_folio;
    } catch {}

    tableRows.push(`<tr>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.despacho}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${nroFactura}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.referencia || ""}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.nro_aceptacion || ""}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${fechaAcept}</td>
      <td style="padding:6px 12px;border:1px solid #ddd;">${r.total_cif ? Number(r.total_cif).toLocaleString("es-CL") : ""}</td>
    </tr>`);
  }

  if (attachments.length === 0) {
    console.log("[facturas-petro] No se generaron PDFs");
    await pool.end();
    return;
  }

  // Enviar correo
  const { Resend } = await import("resend");
  const resend = new Resend(RESEND_API_KEY);

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
    <p>Estimados,</p>
    <p>Adjunto facturas de la semana — PETROQUIMICA DOW S.A.</p>
    <table style="border-collapse:collapse;margin:16px 0;width:100%;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:8px 12px;border:1px solid #ddd;">Despacho</th>
          <th style="padding:8px 12px;border:1px solid #ddd;">Nro Factura</th>
          <th style="padding:8px 12px;border:1px solid #ddd;">Referencia</th>
          <th style="padding:8px 12px;border:1px solid #ddd;">Nro Aceptación</th>
          <th style="padding:8px 12px;border:1px solid #ddd;">Fecha</th>
          <th style="padding:8px 12px;border:1px solid #ddd;">CIF USD</th>
        </tr>
      </thead>
      <tbody>${tableRows.join("")}</tbody>
    </table>
    <p><b>${attachments.length}</b> factura(s) adjunta(s) (Factura + DIN + TGR)</p>
    <p style="color:#666;font-size:12px;">Agencia de Aduanas Fernando Guerra y Cía. Ltda.</p>
  </div>`;

  const result = await resend.emails.send({
    from: RESEND_FROM,
    to: ["fguerrab@agenciaguerra.com", "garqueros@agenciaguerra.com"],
    subject: `Facturas de Honorarios - PETROQUIMICA DOW S.A. (${attachments.length} facturas)`,
    html,
    attachments,
  });

  if (result.error) {
    console.error("[facturas-petro] Error email:", result.error);
  } else {
    console.log(`[facturas-petro] ✅ Correo enviado con ${attachments.length} facturas`);
    // Marcar como enviadas
    for (const r of rows) {
      await pool.query("UPDATE operaciones SET notas = COALESCE(notas, '') || $1 WHERE nro_operacion = $2",
        ["\nfactura_enviada:true", r.despacho]);
    }
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
