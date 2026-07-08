#!/usr/bin/env node
/**
 * Script: Genera Libro Importaciones Anglo American (un solo correo)
 * Adjuntos: Excel Impuestos + Excel Facturas + PDFs TGR+DIN
 * 
 * Uso: node scripts/enviar-libro-importaciones-anglo.mjs
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
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

const API_URL = "https://fguerragodoy.aduananet2.cl/modulos/endpoints/api.php";
const API_USER = "fguerragodoy";
const API_PASS = "Uj7UarxZafsTL9G";
const BASE_URL = "https://fguerragodoy.aduananet2.cl";

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

(async () => {
  const XLSX = (await import("xlsx")).default;
  const { PDFDocument } = await import("pdf-lib");

  const now = new Date();
  // Reportar mes anterior (se ejecuta el 7 del mes siguiente)
  const mesReporte = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mes = mesReporte.getMonth();
  const anio = mesReporte.getFullYear();
  const mesNombre = MESES[mes];
  const mesInicio = `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
  const mesFin = `${anio}-${String(mes + 2 > 12 ? 1 : mes + 2).padStart(2, "0")}-01`;
  const mesFinalAnio = mes + 2 > 12 ? anio + 1 : anio;
  const mesFinalStr = `${mesFinalAnio}-${String((mes + 2) > 12 ? 1 : mes + 2).padStart(2, "0")}-01`;

  // El reporte se arma por FECHA DE FACTURA (dte_fecha) del mes. Una operación facturada
  // en el mes puede haberse aceptado meses antes, por eso ampliamos la ventana de aceptación
  // hacia atrás (la factura siempre es posterior o igual a la aceptación).
  const LOOKBACK_MESES = 6;
  const lookbackDate = new Date(anio, mes - LOOKBACK_MESES, 1);
  const lookbackStr = `${lookbackDate.getFullYear()}-${String(lookbackDate.getMonth() + 1).padStart(2, "0")}-01`;

  // 1. Obtener operaciones
  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.referencia, dr.consignante, dr.nro_aceptacion,
           dr.fecha_aceptacion, dr.via, dr.total_peso_bruto,
           dr.total_cif, dr.total_fob, dr.iva, dr.gravamenes_valor_1,
           dr.total_gravamenes_chs, dr.total_gravamenes_uss, dr.tipo_cambio,
           dr.pais_origen_mercancias, dr.descripcion_item_1,
           o.notas
    FROM despachos_replica dr
    LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE UPPER(dr.cliente) LIKE '%ANGLO%'
      AND dr.fecha_aceptacion >= $1
      AND dr.fecha_aceptacion < $2
      AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
    ORDER BY dr.fecha_aceptacion
  `, [lookbackStr, mesFinalStr]);

  console.log(`[libro] ${rows.length} operaciones en ventana (lookback ${LOOKBACK_MESES}m); se filtrarán por fecha de factura + fecha de pago del mes ${mesNombre} ${anio}`);

  const impuestosData = [];
  const facturasData = [];
  const pdfAttachments = [];

  for (const r of rows) {
    const tgrMatch = (r.notas || "").match(/tgr_url:(https?:\/\/[^\s\n]+)/);
    const tgrUrl = tgrMatch ? tgrMatch[1] : "";

    // Formatear fecha aceptación
    let fechaAcept = "";
    if (r.fecha_aceptacion) {
      const d = new Date(r.fecha_aceptacion);
      fechaAcept = `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
    }

    // Tipo vía
    const via = String(r.via || "").toUpperCase();
    let tipo = "Marítimo";
    if (via.includes("AERE") || via.includes("AIR")) tipo = "Aéreo";
    else if (via.includes("TERR")) tipo = "Terrestre";

    // Consultar API DTEs
    let factura = null;
    let fechaPago = "";
    try {
      const curlCmd = `curl -sk -u ${API_USER}:${API_PASS} -X GET "${API_URL}?endpoint=listaDTEs" -H "Content-Type: application/json" -d '{"despacho":${r.despacho}}'`;
      const apiRaw = execSync(curlCmd, { timeout: 10000 }).toString();
      const apiData = JSON.parse(apiRaw);
      if (apiData.data && apiData.data.length > 0) {
        factura = apiData.data.find(d => d.codigo_tipo_dte === "33");
        if (factura) {
          fechaPago = factura.dte_detalle_aduanero?.ADUANAS?.FECHA_PAGO_DE_DERECHOS || "";
        }
      }
    } catch {}

    // FILTRO PRINCIPAL: el reporte (ambas hojas) se arma por FECHA DE FACTURA.
    // Solo se incluyen operaciones con factura 33 emitida (dte_fecha) dentro del mes del reporte.
    const dteFecha = factura?.dte_fecha || "";
    if (!factura || !(dteFecha >= mesInicio && dteFecha < mesFinalStr)) {
      continue;
    }

    // Fallback fecha del TGR
    if (!fechaPago && tgrUrl) {
      try {
        const tgrRes = await fetch(tgrUrl);
        if (tgrRes.ok) {
          const tgrBuf = Buffer.from(await tgrRes.arrayBuffer());
          const pdfData = await pdfParse(tgrBuf);
          const fMatch = pdfData.text.match(/Fecha\s*Pago\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
          if (fMatch) fechaPago = `${fMatch[3]}-${fMatch[2]}-${fMatch[1]}`;
        }
      } catch {}
    }

    // Formatear fecha pago
    let fechaPagoFmt = "";
    if (fechaPago) {
      const parts = fechaPago.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (parts) fechaPagoFmt = `${parts[3]}/${parts[2]}/${parts[1]}`;
      else fechaPagoFmt = fechaPago;
    }

    // FILTRO: solo operaciones con FECHA DE PAGO (de derechos) existente. Aplica a ambas hojas.
    if (!fechaPagoFmt) continue;

    // === EXCEL 1: Impuestos ===
    const cif = parseFloat(r.total_cif || "0");
    const fob = parseFloat(r.total_fob || "0");
    const ivaUSD = parseFloat(r.iva || "0");
    const derechosUSD = parseFloat(r.gravamenes_valor_1 || "0");
    const totalGravCLP = parseFloat(r.total_gravamenes_chs || "0");
    const totalGravUSD = parseFloat(r.total_gravamenes_uss || "0");
    const tc = parseFloat(r.tipo_cambio || "0");

    impuestosData.push({
      "OC": r.referencia || "",
      "Proveedor": r.consignante || "",
      "Nro Aceptación": r.nro_aceptacion || "",
      "Fecha Pago TGR": fechaPagoFmt,
      "CIF CLP": Math.round(cif * tc),
      "Derechos CLP": Math.round(derechosUSD * tc),
      "Total Pagado CLP": totalGravCLP,
      "Tipo Cambio": tc,
      "CIF USD": Math.round(cif * 100) / 100,
      "IVA USD": ivaUSD,
      "Derechos USD": derechosUSD,
      "Total Impuestos USD": totalGravUSD,
      "Valor FOB": fob,
      "País Origen": r.pais_origen_mercancias || "",
      "Mercadería": r.descripcion_item_1 || "",
    });

    // === EXCEL 2: Facturas ===
    if (factura) {
      const det = factura.dte_detalle_aduanero;
      const gastos = det?.GASTOS || {};
      const desembolsos = det?.DESEMBOLSOS || {};
      const totales = det?.TOTALES || {};
      const despachoInfo = det?.DESPACHO || {};

      const honorarios = parseFloat(gastos.HONORARIOS || gastos.AFECTO_IVA || "0");
      const desembolsoList = Array.isArray(desembolsos.DESEMBOLSO) ? desembolsos.DESEMBOLSO : (desembolsos.DESEMBOLSO ? [desembolsos.DESEMBOLSO] : []);

      let transporteLocal = 0, almacenVal = 0, otrosDesemb = 0;
      const KW_TRANS = ["TRADE","TRANSPORTE","LOGISTICA","FLETE LOCAL","CAMION","ACARREO"];
      const KW_ALM = ["ULTRAMAR","STI","AGUNSA","PUERT","ALMACEN","SAAM","TPS","SVTI","DPWORLD","TERMIN","AEROPUERTO","BODEGA"];
      for (const d of desembolsoList) {
        const nom = String(d.NOMBRE || d.PROVEEDOR || "").toUpperCase();
        const val = parseFloat(d.VALOR || "0");
        if (KW_TRANS.some(k => nom.includes(k))) transporteLocal += val;
        else if (KW_ALM.some(k => nom.includes(k))) almacenVal += val;
        else otrosDesemb += val;
      }

      facturasData.push({
        "Referencia": despachoInfo.REFERENCIA || r.referencia || "",
        "Tipo": tipo,
        "Nro Factura": factura.dte_folio || "",
        "Honorarios": honorarios,
        "Desembolso Transporte Local": transporteLocal,
        "Desembolso Almacén": almacenVal,
        "Otros Desembolsos": otrosDesemb,
        "Pago Directo": parseFloat(totales.PAGO_DIRECTO || "0"),
        "Fecha Pago TGR": fechaPagoFmt,
        "Total Factura": parseFloat(totales.TOTAL || "0"),
        "Peso (KG)": despachoInfo.PESO_BRUTO || r.total_peso_bruto || "",
        "Despacho": r.despacho,
        "Fecha Aceptación": fechaAcept,
        "Total a Nuestro Favor": parseFloat(totales.SALDO || "0"),
      });
    } else {
      facturasData.push({
        "Referencia": r.referencia || "", "Tipo": tipo, "Nro Factura": "",
        "Honorarios": "", "Desembolso Transporte Local": "", "Desembolso Almacén": "",
        "Otros Desembolsos": "", "Pago Directo": "", "Fecha Pago TGR": fechaPagoFmt,
        "Total Factura": "", "Peso (KG)": r.total_peso_bruto || "",
        "Despacho": r.despacho, "Fecha Aceptación": fechaAcept, "Total a Nuestro Favor": "",
      });
    }

    // === PDF TGR+DIN ===
    if (tgrUrl) {
      try {
        const tgrRes = await fetch(tgrUrl);
        const loginPage = await fetch(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
        const baseCookies = loginPage.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
        const loginBody = new URLSearchParams({ login: get("ADUANANET_LOGIN"), clave: get("ADUANANET_CLAVE") });
        const loginRes = await fetch(`${BASE_URL}/modulos/usuarios/validar.php`, {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: baseCookies, Referer: `${BASE_URL}/modulos/usuarios/login.php` },
          body: loginBody.toString(), redirect: "manual",
        });
        const sessCookies = loginRes.headers.getSetCookie?.()?.map(c => c.split(";")[0]).join("; ") || "";
        const cookies = [baseCookies, sessCookies].filter(Boolean).join("; ");
        const dinRes = await fetch(`${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${r.despacho}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`, { headers: { Cookie: cookies } });

        const merged = await PDFDocument.create();
        if (tgrRes.ok) { try { const p = await PDFDocument.load(await tgrRes.arrayBuffer()); (await merged.copyPages(p, p.getPageIndices())).forEach(pg => merged.addPage(pg)); } catch {} }
        if (dinRes.ok) { try { const p = await PDFDocument.load(await dinRes.arrayBuffer()); (await merged.copyPages(p, p.getPageIndices())).forEach(pg => merged.addPage(pg)); } catch {} }
        if (merged.getPageCount() > 0) {
          pdfAttachments.push({ filename: `TGR_DIN_${r.despacho}.pdf`, content: Buffer.from(await merged.save()) });
          console.log(`  ✅ PDF ${r.despacho}`);
        }
      } catch (err) { console.error(`  ❌ PDF ${r.despacho}:`, err.message); }
    }
  }

  // Generar Excels
  const moneyFmt = "$#,##0";
  
  // Excel 1: Impuestos
  const ws1 = XLSX.utils.json_to_sheet(impuestosData);
  ws1["!cols"] = [{ wch: 25 },{ wch: 30 },{ wch: 14 },{ wch: 14 },{ wch: 18 },{ wch: 14 },{ wch: 16 },{ wch: 12 },{ wch: 18 },{ wch: 12 },{ wch: 14 },{ wch: 18 },{ wch: 12 },{ wch: 15 },{ wch: 40 }];
  for (let row = 1; row <= impuestosData.length; row++) {
    for (const col of [4,5,6,8]) { const c = XLSX.utils.encode_cell({r:row,c:col}); if(ws1[c]&&typeof ws1[c].v==="number") ws1[c].z=moneyFmt; }
  }

  // Excel 2: Facturas
  const ws2 = XLSX.utils.json_to_sheet(facturasData);
  ws2["!cols"] = [{ wch: 25 },{ wch: 10 },{ wch: 12 },{ wch: 12 },{ wch: 22 },{ wch: 18 },{ wch: 18 },{ wch: 14 },{ wch: 14 },{ wch: 14 },{ wch: 12 },{ wch: 10 },{ wch: 14 },{ wch: 20 }];
  for (let row = 1; row <= facturasData.length; row++) {
    for (const col of [3,4,5,6,7,9,13]) { const c = XLSX.utils.encode_cell({r:row,c:col}); if(ws2[c]&&typeof ws2[c].v==="number") ws2[c].z=moneyFmt; }
  }

  const wb1 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb1, ws1, "Impuestos"); 
  const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, ws2, "Facturas");
  const excel1 = XLSX.write(wb1, { type: "buffer", bookType: "xlsx" });
  const excel2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });

  // Enviar un solo correo
  const { Resend } = await import("resend");
  const resend = new Resend(RESEND_API_KEY);

  const allAttachments = [
    { filename: `Impuestos_Anglo_American_${mesNombre}_${anio}.xlsx`, content: excel1 },
    { filename: `Facturas_Anglo_American_${mesNombre}_${anio}.xlsx`, content: excel2 },
    ...pdfAttachments,
  ];

  const result = await resend.emails.send({
    from: RESEND_FROM,
    to: ["cagonzalezm@deloitte.com", "michelle.penailillo@angloamerican.com", "nicole.pino@angloamerican.com", "sergio.llanos@angloamerican.com", "oscar@agenciaguerra.com"],
    subject: `Libro Importaciones ${mesNombre} ${anio} Anglo American Sur S.A.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
      <p>Estimado,</p>
      <p>Adjunto Libro de Importaciones de <b>Anglo American Sur S.A.</b> correspondiente a <b>${mesNombre} ${anio}</b>.</p>
      <ul>
        <li><b>${impuestosData.length}</b> operaciones</li>
        <li><b>${pdfAttachments.length}</b> comprobantes TGR+DIN</li>
      </ul>
      <p style="color:#666;font-size:12px;">Generado automáticamente por AgaTrack.</p>
    </div>`,
    attachments: allAttachments,
  });

  if (result.error) console.error("[libro] Error:", result.error);
  else console.log(`[libro] ✅ Correo enviado: Libro Importaciones ${mesNombre} ${anio} Anglo American`);

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
