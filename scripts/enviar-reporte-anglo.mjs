#!/usr/bin/env node
/**
 * Script: Genera reporte Anglo American (Excel + PDFs TGR+DIN) y envía por correo.
 * Uso: node scripts/enviar-reporte-anglo.mjs
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
const PORT = get("PORT") || "3000";
const INBOUND_SECRET = get("INBOUND_SECRET");
const RESEND_API_KEY = get("RESEND_API_KEY");
const RESEND_FROM = get("RESEND_FROM") || "AgaTrack <reportes@agatrack.agenciaguerra.com>";

(async () => {
  const XLSX = (await import("xlsx")).default;
  const { PDFDocument } = await import("pdf-lib");
  const pdfParse = (await import("pdf-parse")).default;

  // 1. Obtener operaciones Anglo American junio 2026
  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.referencia, dr.consignante, dr.nro_aceptacion,
           dr.total_cif, dr.total_fob, dr.iva, dr.gravamenes_valor_1,
           dr.total_gravamenes_chs, dr.total_gravamenes_uss, dr.tipo_cambio,
           dr.pais_origen_mercancias, dr.descripcion_item_1,
           o.notas
    FROM despachos_replica dr
    LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE UPPER(dr.cliente) LIKE '%ANGLO%'
      AND dr.fecha_aceptacion >= '2026-06-01'
      AND dr.fecha_aceptacion < '2026-07-01'
      AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
    ORDER BY dr.fecha_aceptacion
  `);

  console.log(`[reporte] ${rows.length} operaciones Anglo American junio 2026`);

  // 2. Para cada op con TGR, extraer fecha pago del PDF y generar TGR+DIN
  const attachments = [];
  const excelData = [];

  for (const r of rows) {
    const tgrMatch = (r.notas || "").match(/tgr_url:(https?:\/\/[^\s\n]+)/);
    const tgrUrl = tgrMatch ? tgrMatch[1] : "";

    let fechaPago = "";
    if (tgrUrl) {
      // Extraer fecha pago del PDF TGR
      try {
        const tgrRes = await fetch(tgrUrl);
        if (tgrRes.ok) {
          const tgrBuf = Buffer.from(await tgrRes.arrayBuffer());
          const pdfData = await pdfParse(tgrBuf);
          const fMatch = pdfData.text.match(/Fecha\s*Pago\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
          if (fMatch) fechaPago = `${fMatch[1]}/${fMatch[2]}/${fMatch[3]}`;
        }
      } catch {}

      // Generar PDF TGR+DIN combinado
      try {
        const res = await fetch(`http://localhost:${PORT}/api/operaciones/imprimir-tgr-din?nro_operacion=${r.despacho}`, {
          headers: { Cookie: `agatrack_session=${INBOUND_SECRET}` },
        });
        // No puede usar session — usar endpoint directo
        // Alternativa: descargar TGR + DIN por separado y combinar
        const tgrRes2 = await fetch(tgrUrl);
        const BASE_URL = "https://fguerragodoy.aduananet2.cl";
        
        // Login AduanaNet para DIN
        const loginPage = await fetch(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
        const baseCookies = loginPage.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
        const loginBody = new URLSearchParams({ login: get("ADUANANET_LOGIN"), clave: get("ADUANANET_CLAVE") });
        const loginRes = await fetch(`${BASE_URL}/modulos/usuarios/validar.php`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: baseCookies, Referer: `${BASE_URL}/modulos/usuarios/login.php` },
          body: loginBody.toString(),
          redirect: "manual",
        });
        const sessionCookies = loginRes.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
        const cookies = [baseCookies, sessionCookies].filter(Boolean).join("; ");

        const dinUrl = `${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${r.despacho}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`;
        const dinRes = await fetch(dinUrl, { headers: { Cookie: cookies } });

        const merged = await PDFDocument.create();

        if (tgrRes2.ok) {
          const tgrBuf = await tgrRes2.arrayBuffer();
          try {
            const tgrPdf = await PDFDocument.load(tgrBuf);
            const pages = await merged.copyPages(tgrPdf, tgrPdf.getPageIndices());
            pages.forEach(p => merged.addPage(p));
          } catch {}
        }

        if (dinRes.ok) {
          const dinBuf = await dinRes.arrayBuffer();
          try {
            const dinPdf = await PDFDocument.load(dinBuf);
            const pages = await merged.copyPages(dinPdf, dinPdf.getPageIndices());
            pages.forEach(p => merged.addPage(p));
          } catch {}
        }

        if (merged.getPageCount() > 0) {
          const pdfBytes = await merged.save();
          attachments.push({ filename: `TGR_DIN_${r.despacho}.pdf`, content: Buffer.from(pdfBytes) });
          console.log(`  ✅ PDF ${r.despacho} (${merged.getPageCount()} páginas)`);
        }
      } catch (err) {
        console.error(`  ❌ PDF ${r.despacho}:`, err.message);
      }
    }

    // Excel row
    const cif = parseFloat(r.total_cif || "0");
    const fob = parseFloat(r.total_fob || "0");
    const ivaUSD = parseFloat(r.iva || "0");
    const derechosUSD = parseFloat(r.gravamenes_valor_1 || "0");
    const totalGravCLP = parseFloat(r.total_gravamenes_chs || "0");
    const totalGravUSD = parseFloat(r.total_gravamenes_uss || "0");
    const tc = parseFloat(r.tipo_cambio || "0");

    excelData.push({
      "Referencia": r.referencia || "",
      "Proveedor": r.consignante || "",
      "Nro Aceptación": r.nro_aceptacion || "",
      "Fecha Pago TGR": fechaPago || "",
      "CIF + Derechos CLP": Math.round((cif + derechosUSD) * tc),
      "Derechos CLP": Math.round(derechosUSD * tc),
      "Total Pagado CLP": totalGravCLP,
      "Tipo Cambio": tc,
      "CIF + Derechos USD": Math.round((cif + derechosUSD) * 100) / 100,
      "IVA USD": ivaUSD,
      "Derechos USD": derechosUSD,
      "Total Impuestos USD": totalGravUSD,
      "Valor FOB": fob,
      "País Origen": r.pais_origen_mercancias || "",
      "Mercadería": r.descripcion_item_1 || "",
    });
  }

  // 3. Generar Excel
  const ws = XLSX.utils.json_to_sheet(excelData);
  ws["!cols"] = [
    { wch: 25 }, { wch: 30 }, { wch: 14 }, { wch: 14 },
    { wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 12 },
    { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 18 },
    { wch: 12 }, { wch: 15 }, { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Junio 2026");
  const excelBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  attachments.unshift({ filename: "Reporte_Anglo_American_Junio_2026.xlsx", content: excelBuf });

  console.log(`[reporte] Excel + ${attachments.length - 1} PDFs generados`);

  // 4. Enviar correo
  const { Resend } = await import("resend");
  const resend = new Resend(RESEND_API_KEY);

  const result = await resend.emails.send({
    from: RESEND_FROM,
    to: ["fguerrab@agenciaguerra.com"],
    subject: `Reporte Anglo American - Junio 2026 (${rows.length} operaciones)`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
      <p>Estimado,</p>
      <p>Adjunto reporte de importaciones Anglo American Sur S.A. del mes de Junio 2026.</p>
      <ul>
        <li><b>${rows.length}</b> operaciones en el período</li>
        <li><b>${attachments.length - 1}</b> comprobantes TGR+DIN adjuntos</li>
      </ul>
      <p style="color:#666;font-size:12px;">Generado automáticamente por AgaTrack.</p>
    </div>`,
    attachments,
  });

  if (result.error) {
    console.error("[reporte] Error email:", result.error);
  } else {
    console.log(`[reporte] ✅ Correo enviado a fguerrab@agenciaguerra.com`);
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
