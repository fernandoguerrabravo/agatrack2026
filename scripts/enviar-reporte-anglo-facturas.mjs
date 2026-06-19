#!/usr/bin/env node
/**
 * Script: Genera reporte Anglo American - Detalle Facturas (código 33)
 * Campos: Referencia, Tipo (Aéreo/Marítimo), Nro Factura, Honorarios,
 * Desembolso Transporte Local, Desembolso Almacén, Otros Desembolsos,
 * Pago Directo, Fecha Pago TGR, Total Factura, Peso (KG), Despacho,
 * Fecha Aceptación, Total a Nuestro Favor
 * 
 * Uso: node scripts/enviar-reporte-anglo-facturas.mjs
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

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

(async () => {
  const XLSX = (await import("xlsx")).default;

  // 1. Obtener operaciones Anglo American junio 2026
  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.referencia, dr.fecha_aceptacion, dr.via,
           dr.total_peso_bruto, dr.puerto_desembarque,
           o.notas
    FROM despachos_replica dr
    LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE UPPER(dr.cliente) LIKE '%ANGLO%'
      AND dr.fecha_aceptacion >= '2026-06-01'
      AND dr.fecha_aceptacion < '2026-07-01'
      AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
    ORDER BY dr.fecha_aceptacion
  `);

  console.log(`[reporte-fact] ${rows.length} operaciones Anglo American junio 2026`);

  const excelData = [];

  for (const r of rows) {
    // Obtener TGR URL de las notas
    const tgrMatch = (r.notas || "").match(/tgr_url:(https?:\/\/[^\s\n]+)/);
    const tgrUrl = tgrMatch ? tgrMatch[1] : "";

    // Consultar API DTEs
    let factura = null;
    try {
      const curlCmd = `curl -sk -u ${API_USER}:${API_PASS} -X GET "${API_URL}?endpoint=listaDTEs" -H "Content-Type: application/json" -d '{"despacho":${r.despacho}}'`;
      const apiRaw = execSync(curlCmd, { timeout: 10000 }).toString();
      const apiData = JSON.parse(apiRaw);
      if (apiData.data && apiData.data.length > 0) {
        factura = apiData.data.find(d => d.codigo_tipo_dte === "33");
      }
    } catch (err) {
      console.log(`  ⚠️ API error ${r.despacho}:`, err.message);
    }

    if (!factura) {
      console.log(`  ⏳ ${r.despacho}: sin factura código 33`);
      let fechaAceptFb = "";
      if (r.fecha_aceptacion) {
        const d = new Date(r.fecha_aceptacion);
        fechaAceptFb = `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
      }
      excelData.push({
        "Referencia": r.referencia || "",
        "Tipo": "",
        "Nro Factura": "",
        "Honorarios": "",
        "Desembolso Transporte Local": "",
        "Desembolso Almacén": "",
        "Otros Desembolsos": "",
        "Pago Directo": "",
        "Fecha Pago TGR": "",
        "Total Factura": "",
        "Peso (KG)": r.total_peso_bruto || "",
        "Despacho": r.despacho,
        "Fecha Aceptación": fechaAceptFb,
        "Total a Nuestro Favor": "",
      });
      continue;
    }

    const det = factura.dte_detalle_aduanero;
    const despachoInfo = det?.DESPACHO || {};
    const valores = det?.VALORES || {};
    const gastos = det?.GASTOS || {};
    const desembolsos = det?.DESEMBOLSOS || {};
    const aduanas = det?.ADUANAS || {};
    const totales = det?.TOTALES || {};

    // Tipo: determinar si es aéreo o marítimo
    const via = String(r.via || "").toUpperCase();
    let tipo = "Marítimo";
    if (via.includes("AERE") || via.includes("AEREO") || via.includes("AIR")) tipo = "Aéreo";
    else if (via.includes("TERR")) tipo = "Terrestre";

    // Honorarios
    const honorarios = parseFloat(gastos.HONORARIOS || gastos.AFECTO_IVA || "0");

    // Desembolsos: separar transporte local, almacén y otros
    const desembolsoList = Array.isArray(desembolsos.DESEMBOLSO) ? desembolsos.DESEMBOLSO : (desembolsos.DESEMBOLSO ? [desembolsos.DESEMBOLSO] : []);
    
    let transporteLocal = 0;
    let almacen = 0;
    let otrosDesembolsos = 0;

    const KEYWORDS_TRANSPORTE = ["TRADE", "TRANSPORTE", "LOGISTICA", "FLETE LOCAL", "CAMION", "ACARREO"];
    const KEYWORDS_ALMACEN = ["ULTRAMAR", "STI", "AGUNSA", "PUERT", "ALMACEN", "SAAM", "TPS", "SVTI", "DPWORLD", "TERMIN", "AEROPUERTO", "AIRPORT", "BODEGA"];

    for (const d of desembolsoList) {
      const nombre = String(d.NOMBRE || d.PROVEEDOR || "").toUpperCase();
      const valor = parseFloat(d.VALOR || "0");

      if (KEYWORDS_TRANSPORTE.some(k => nombre.includes(k))) {
        transporteLocal += valor;
      } else if (KEYWORDS_ALMACEN.some(k => nombre.includes(k))) {
        almacen += valor;
      } else {
        otrosDesembolsos += valor;
      }
    }

    // Pago directo
    const pagoDirecto = parseFloat(totales.PAGO_DIRECTO || "0");

    // Fecha pago TGR — de API o extraer del PDF TGR
    let fechaPago = aduanas.FECHA_PAGO_DE_DERECHOS || "";
    if (!fechaPago && tgrUrl) {
      try {
        const { createRequire } = await import("module");
        const require2 = createRequire(import.meta.url);
        const pdfParse = require2("pdf-parse");
        const tgrRes = await fetch(tgrUrl);
        if (tgrRes.ok) {
          const tgrBuf = Buffer.from(await tgrRes.arrayBuffer());
          const pdfData = await pdfParse(tgrBuf);
          const fMatch = pdfData.text.match(/Fecha\s*Pago\s*(\d{2})[\/\-](\d{2})[\/\-](\d{4})/i);
          if (fMatch) fechaPago = `${fMatch[3]}-${fMatch[2]}-${fMatch[1]}`; // yyyy-mm-dd para formato uniforme
        }
      } catch {}
    }

    // Total factura
    const totalFactura = parseFloat(totales.TOTAL || "0");

    // Peso
    const peso = despachoInfo.PESO_BRUTO || r.total_peso_bruto || "";

    // Total a nuestro favor (saldo agencia)
    const saldoAgencia = parseFloat(totales.SALDO || totales.ABS_SALDO || "0");

    // Formatear fecha aceptación dd/mm/yyyy
    let fechaAcept = "";
    if (r.fecha_aceptacion) {
      const d = new Date(r.fecha_aceptacion);
      fechaAcept = `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
    }

    // Formatear fecha pago dd/mm/yyyy
    let fechaPagoFmt = "";
    if (fechaPago) {
      const parts = fechaPago.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (parts) fechaPagoFmt = `${parts[3]}/${parts[2]}/${parts[1]}`;
      else fechaPagoFmt = fechaPago;
    }

    excelData.push({
      "Referencia": despachoInfo.REFERENCIA || r.referencia || "",
      "Tipo": tipo,
      "Nro Factura": factura.dte_folio || "",
      "Honorarios": honorarios,
      "Desembolso Transporte Local": transporteLocal,
      "Desembolso Almacén": almacen,
      "Otros Desembolsos": otrosDesembolsos,
      "Pago Directo": pagoDirecto,
      "Fecha Pago TGR": fechaPagoFmt,
      "Total Factura": totalFactura,
      "Peso (KG)": peso,
      "Despacho": r.despacho,
      "Fecha Aceptación": fechaAcept,
      "Total a Nuestro Favor": saldoAgencia,
    });

    console.log(`  ✅ ${r.despacho}: Factura ${factura.dte_folio} | $${totalFactura.toLocaleString()}`);
  }

  // Generar Excel
  const ws = XLSX.utils.json_to_sheet(excelData);

  // Aplicar formato moneda ($#,##0) a columnas numéricas
  const moneyFmt = "$#,##0";
  const numRows = excelData.length + 1; // +1 por header
  const moneyCols = [3, 4, 5, 6, 7, 9, 13]; // D,E,F,G,H,J,N (0-indexed: Honorarios, Transporte, Almacén, Otros, PagoDirecto, TotalFactura, Saldo)
  for (let row = 1; row < numRows; row++) {
    for (const col of moneyCols) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      if (ws[cellRef] && typeof ws[cellRef].v === "number") {
        ws[cellRef].z = moneyFmt;
      }
    }
  }
  ws["!cols"] = [
    { wch: 25 }, // Referencia
    { wch: 10 }, // Tipo
    { wch: 12 }, // Nro Factura
    { wch: 12 }, // Honorarios
    { wch: 22 }, // Transporte Local
    { wch: 18 }, // Almacén
    { wch: 18 }, // Otros
    { wch: 14 }, // Pago Directo
    { wch: 14 }, // Fecha Pago
    { wch: 14 }, // Total Factura
    { wch: 12 }, // Peso
    { wch: 10 }, // Despacho
    { wch: 14 }, // Fecha Acept
    { wch: 20 }, // Saldo Agencia
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Facturas Junio 2026");
  const excelBuf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Enviar correo
  const { Resend } = await import("resend");
  const resend = new Resend(RESEND_API_KEY);

  const result = await resend.emails.send({
    from: RESEND_FROM,
    to: ["fguerrab@agenciaguerra.com"],
    subject: `Reporte Facturas Anglo American - Junio 2026 (${rows.length} operaciones)`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
      <p>Estimado,</p>
      <p>Adjunto reporte de facturas (código 33) Anglo American Sur S.A. del mes de Junio 2026.</p>
      <ul>
        <li><b>${rows.length}</b> operaciones</li>
        <li><b>${excelData.filter(d => d["Nro Factura"]).length}</b> con factura emitida</li>
      </ul>
      <p style="color:#666;font-size:12px;">Generado automáticamente por AgaTrack.</p>
    </div>`,
    attachments: [{ filename: "Reporte_Facturas_Anglo_American_Junio_2026.xlsx", content: excelBuf }],
  });

  if (result.error) {
    console.error("[reporte-fact] Error email:", result.error);
  } else {
    console.log(`[reporte-fact] ✅ Correo enviado a fguerrab@agenciaguerra.com`);
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
