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
  const { createRequire } = await import("module");
  const require2 = createRequire(import.meta.url);
  const pdfParse = require2("pdf-parse");

  const API_URL = "https://fguerragodoy.aduananet2.cl/modulos/endpoints/api.php";
  const API_USER = "fguerragodoy";
  const API_PASS = "Uj7UarxZafsTL9G";
  const API_AUTH = "Basic " + Buffer.from(`${API_USER}:${API_PASS}`).toString("base64");

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

  // 2. Para cada operación, consultar API de DTEs + generar PDF TGR+DIN
  const attachments = [];
  const excelData = [];

  for (const r of rows) {
    const tgrMatch = (r.notas || "").match(/tgr_url:(https?:\/\/[^\s\n]+)/);
    const tgrUrl = tgrMatch ? tgrMatch[1] : "";

    // Consultar API para datos precisos
    let fechaPago = "";
    let apiCif = "";
    let apiFob = "";
    let apiIva = "";
    let apiDerechos = "";
    let apiTc = "";
    let apiMercancia = "";

    try {
      const apiRes = await fetch(`${API_URL}?endpoint=listaDTEs`, {
        method: "GET",
        headers: { "Authorization": API_AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ despacho: parseInt(r.despacho) }),
      });
      const apiData = await apiRes.json();
      if (apiData.data && apiData.data.length > 0) {
        // Buscar la factura electrónica (código 33)
        const factura = apiData.data.find(d => d.codigo_tipo_dte === "33");
        if (factura) {
          const det = factura.dte_detalle_aduanero;
          fechaPago = det?.ADUANAS?.FECHA_PAGO_DE_DERECHOS || "";
          apiCif = det?.VALORES?.CIF_USD || "";
          apiFob = det?.VALORES?.FOB_USD || "";
          apiIva = det?.ADUANAS?.IVA_USD || "";
          apiDerechos = det?.ADUANAS?.TOTAL_DERECHOS_USD || "";
          apiTc = det?.VALORES?.TIPO_CAMBIO || "";
          const mercs = det?.MERCANCIAS?.MERCANCIA || [];
          if (Array.isArray(mercs) && mercs.length > 0) {
            apiMercancia = mercs[0]?.DESCRIPCION_CORTA || mercs[0]?.NOMBRE || "";
          }
        }
      }
    } catch (apiErr) {
      console.log(`  ⚠️ API error ${r.despacho}:`, apiErr.message);
    }

    // Fallback fecha del TGR si API no la tiene
    if (!fechaPago && tgrUrl) {
      try {
        const tgrRes = await fetch(tgrUrl);
        if (tgrRes.ok) {
          const tgrBuf = Buffer.from(await tgrRes.arrayBuffer());
          const pdfData = await pdfParse(tgrBuf);
          const fMatch = pdfData.text.match(/Fecha\s*Pago\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
          if (fMatch) fechaPago = `${fMatch[1]}/${fMatch[2]}/${fMatch[3]}`;
        }
      } catch {}
    }

    // Generar PDF TGR+DIN
    if (tgrUrl) {
      try {
        const tgrRes2 = await fetch(tgrUrl);
        const BASE_URL = "https://fguerragodoy.aduananet2.cl";
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
          try {
            const tgrPdf = await PDFDocument.load(await tgrRes2.arrayBuffer());
            const pages = await merged.copyPages(tgrPdf, tgrPdf.getPageIndices());
            pages.forEach(p => merged.addPage(p));
          } catch {}
        }
        if (dinRes.ok) {
          try {
            const dinPdf = await PDFDocument.load(await dinRes.arrayBuffer());
            const pages = await merged.copyPages(dinPdf, dinPdf.getPageIndices());
            pages.forEach(p => merged.addPage(p));
          } catch {}
        }
        if (merged.getPageCount() > 0) {
          const pdfBytes = await merged.save();
          attachments.push({ filename: `TGR_DIN_${r.despacho}.pdf`, content: Buffer.from(pdfBytes) });
          console.log(`  ✅ PDF ${r.despacho} (${merged.getPageCount()} pág)`);
        }
      } catch (err) {
        console.error(`  ❌ PDF ${r.despacho}:`, err.message);
      }
    }

    // Usar datos de API si disponibles, sino fallback a despachos_replica
    const cif = parseFloat(apiCif || r.total_cif || "0");
    const fob = parseFloat(apiFob || r.total_fob || "0");
    const ivaUSD = parseFloat(apiIva || r.iva || "0");
    const derechosUSD = parseFloat(apiDerechos || r.gravamenes_valor_1 || "0");
    const totalGravCLP = parseFloat(r.total_gravamenes_chs || "0");
    const totalGravUSD = parseFloat(r.total_gravamenes_uss || "0");
    const tc = parseFloat(apiTc || r.tipo_cambio || "0");
    const mercancia = apiMercancia || r.descripcion_item_1 || "";

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
      "Mercadería": mercancia,
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
