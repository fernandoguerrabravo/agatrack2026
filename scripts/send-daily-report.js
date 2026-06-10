#!/usr/bin/env node

/**
 * Envía un reporte diario por email con las operaciones del día/semana.
 * Genera un Excel con los despachos y lo envía como adjunto via Resend.
 * 
 * Uso: node scripts/send-daily-report.js
 * Cron: 0 13 * * 1-5 cd /opt/agatrack2026 && /usr/bin/node scripts/send-daily-report.js >> /var/log/agatrack-report.log 2>&1
 * (13:00 UTC = 9:00 AM Chile, lunes a viernes)
 */

const { Pool } = require("pg");
const XLSX = require("xlsx");
const { Resend } = require("resend");
const fs = require("fs");
const path = require("path");
const { getEmailTemplate } = require("./email-template");

// Cargar .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

function getPgPool() {
  const url = (process.env.POSTGRES_URL || "").replace(/[?&]sslmode=[^&]*/g, "");
  return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });
}

// Configuración de destinatarios por RUT
const CLIENTES = [
  {
    rut: "88579800-4",
    nombre: "MICROGEO INGENIERIA S.A.",
    emails: ["patricio.hernandez@tecnoglobal.cl", "hernan.valenzuela@tecnoglobal.cl"],
    periodo: "mes", // mes en curso
  },
  {
    rut: "77762940-9",
    nombre: "ANGLO AMERICAN SUR S.A.",
    emails: ["sergio.llanos@angloamerican.com"],
    periodo: "anio", // año en curso a la fecha
    columnas: [
      "operacion", "aduana", "fecha_aceptacion", "cliente", "despacho",
      "total_itemes", "total_bultos", "identificacion_bultos", "total_peso_bruto",
      "total_fob", "valor_seguro", "valor_flete", "total_cif", "tipo_cambio",
      "puerto_embarque", "puerto_desembarque", "cia_transportadora",
      "pais_origen_mercancias", "pais_adquisicion_mercancias", "iva",
      "consignante", "regimen", "documento_transporte", "descripcion_item_1",
      "codigo_arancel_tratado_item_1", "nro_aceptacion", "referencia",
      "gravamenes_valor_1", "gravamenes_valor_2", "gravamenes_valor_3", "via"
    ],
  },
  // Agregar más clientes aquí
  {
    rut: "92933000-5",
    nombre: "PETROQUIMICA DOW S.A.",
    emails: ["Yisel.Moraga@psabdp.com", "sara.arcos@psabdp.com", "fguerrab@agenciaguerra.com"],
    periodo: "mes",
    columnas: [
      "operacion", "aduana", "fecha_aceptacion", "cliente", "despacho",
      "total_itemes", "total_bultos", "identificacion_bultos", "total_peso_bruto",
      "total_fob", "valor_seguro", "valor_flete", "total_cif", "tipo_cambio",
      "puerto_embarque", "puerto_desembarque", "cia_transportadora",
      "pais_origen_mercancias", "pais_adquisicion_mercancias", "iva",
      "consignante", "regimen", "documento_transporte", "descripcion_item_1",
      "codigo_arancel_tratado_item_1", "nro_aceptacion", "referencia",
      "gravamenes_valor_1", "gravamenes_valor_2", "gravamenes_valor_3", "via"
    ],
  },
];

// Columnas por defecto (todas) para clientes sin columnas personalizadas
const ALL_COLUMNS = [
  "operacion", "despacho", "lbac_nid", "resolucion", "dus_tipo_envio",
  "aduana", "referencia", "nro_aceptacion", "fecha_aceptacion", "fecha_vencto",
  "aforo", "autor_salida", "eta", "dus_observaciones", "parcial",
  "nro_parcial", "total_parciales", "total_itemes", "total_bultos", "total_peso_bruto",
  "total_fob", "seguro_teorico", "valor_seguro", "flete_teorico", "valor_flete",
  "total_cif", "identificacion_bultos", "observaciones_bco_central", "signo_ajuste", "total_ajuste",
  "valor_exfabrica", "gastos_hasta_fob", "paridad", "total_peso_neto", "estimacion_peso",
  "puerto_embarque", "region_origen", "tipo_carga", "via", "puerto_desembarque",
  "pais_destino", "cia_transportadora", "pais_cia_transportadora", "emisor_docto_transporte", "nave",
  "nro_viaje", "pais_adquisicion_mercancias", "pais_origen_mercancias", "fecha_manifiesto", "manifiesto_1",
  "manifiesto_2", "almacenista", "fecha_recepcion_almacenista", "fecha_retiro_almacenista", "transbordo",
  "documento_transporte", "fecha_docto_transporte_din", "certificado_isp", "certificado_sesma",
  "regla_vb_codigo", "regla_vb_numero", "regla_vb_agno", "registro_reconoc_parte1", "registro_reconoc_parte2",
  "tipo_rut", "rut_cliente", "cliente", "direccion_cliente", "comuna",
  "representante_legal", "representante_legal_rut", "consignante", "consignante_direccion", "pais_consignante",
  "nid_regimen_suspensivo", "fecha_nid_reg_susp", "aduana_reg_suspensivo", "plazo_vigencia_reg_sup",
  "direccion_almacenamiento_reg_susp", "comuna_almacen_reg_susp", "aduana_control_reg_susp",
  "moneda_export", "valor_clausula_venta", "modalidad_venta", "comisiones_exterior",
  "clausula_venta_incoterms", "otros_gtos_deducibles", "forma_pago_export", "valor_liquido_retorno",
  "forma_pago_gravamenes", "regimen", "valor_ex_fabrica", "gtos_hta_fob", "moneda_import",
  "gravamenes_codigo_1", "gravamenes_valor_1", "gravamenes_codigo_2", "gravamenes_valor_2",
  "gravamenes_codigo_3", "gravamenes_valor_3", "gravamenes_codigo_4", "gravamenes_valor_4",
  "gravamenes_codigo_5", "gravamenes_valor_5", "gravamenes_codigo_6", "gravamenes_valor_6",
  "gravamenes_codigo_7", "gravamenes_valor_7", "gravamenes_codigo_8", "gravamenes_valor_8",
  "iva", "total_gravamenes_uss", "tipo_cambio", "total_gravamenes_chs",
  "nro_item", "descripcion_item_1", "codigo_arancel_tratado_item_1", "codigo_arancel_item_2",
  "nro_secuencia", "nro_docto_transporte", "fecha_docto_transporte", "fecha_hora_ingreso_despacho",
  "estado", "factura", "anulado", "fecha_pago_gravamenes", "nro_apertura_carpeta",
  "guia_despacho", "factura_despacho", "bulto_cod_tipo", "bulto_cantidad", "bulto_glosa",
  "url_dte", "url_factura", "url_despacho", "fecha_carga_data"
];

async function generateReport(pgPool, cliente) {
  const { rut, nombre, periodo, columnas } = cliente;

  // Usar columnas personalizadas del cliente o todas por defecto
  const columns = columnas || ALL_COLUMNS;

  // Calcular rango de fechas según periodo
  const now = new Date();
  let desde, hasta;

  if (periodo === "anio") {
    // Año en curso: desde 1 de enero hasta hoy
    desde = `${now.getFullYear()}-01-01`;
    hasta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  } else {
    // Mes en curso (default): desde 1 del mes actual hasta hoy
    desde = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    hasta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  const colSelect = columns.map(c => `"${c}"`).join(", ");
  const { rows } = await pgPool.query(
    `SELECT ${colSelect} FROM despachos_replica WHERE rut_cliente = $1 AND fecha_aceptacion >= $2 AND fecha_aceptacion <= $3 ORDER BY fecha_aceptacion DESC`,
    [rut, desde, hasta]
  );

  console.log(`[report] ${nombre} (${rut}): ${rows.length} operaciones del ${desde} al ${hasta} [periodo: ${periodo || "mes"}]`);

  if (rows.length === 0) return null;

  // Generar Excel
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Despachos");

  const fileName = `agatrack-reporte-despachos-${nombre.replace(/\s+/g, "_")}-${desde}-a-${hasta}.xlsx`;
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return { fileName, buffer, rowCount: rows.length, desde, hasta, periodo: periodo || "mes" };
}

async function sendReport() {
  const startTime = Date.now();
  console.log("\n[report] ===== Daily report started at", new Date().toISOString(), "=====");

  if (!process.env.RESEND_API_KEY) {
    console.error("[report] RESEND_API_KEY not configured");
    process.exit(1);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const pgPool = getPgPool();

  try {
    for (const cliente of CLIENTES) {
      const report = await generateReport(pgPool, cliente);

      if (!report) {
        console.log(`[report] No data for ${cliente.nombre}, skipping email`);
        continue;
      }

      const today = new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
      const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
      const now = new Date();

      // Título del periodo según configuración
      let mesAnio;
      if (report.periodo === "anio") {
        mesAnio = `año ${now.getFullYear()} (al ${now.getDate()} de ${meses[now.getMonth()]})`;
      } else {
        mesAnio = `${meses[now.getMonth()]} de ${now.getFullYear()}`;
      }

      const desdeFormatted = `${report.desde.split("-")[2]} de ${meses[parseInt(report.desde.split("-")[1])-1]} de ${report.desde.split("-")[0]}`;
      const hastaFormatted = `${report.hasta.split("-")[2]} de ${meses[parseInt(report.hasta.split("-")[1])-1]} de ${report.hasta.split("-")[0]}`;

      const htmlContent = getEmailTemplate({
        nombre: cliente.nombre,
        rut: cliente.rut,
        desde: desdeFormatted,
        hasta: hastaFormatted,
        rowCount: report.rowCount,
        mesAnio,
      });

      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM || "AGATrack <reportes@agenciaguerra.com>",
        to: cliente.emails,
        subject: `Reporte Despachos ${cliente.nombre} - ${today}`,
        html: htmlContent,
        attachments: [
          {
            filename: report.fileName,
            content: report.buffer.toString("base64"),
          },
        ],
      });

      if (error) {
        console.error(`[report] Error sending to ${cliente.nombre}:`, error);
      } else {
        console.log(`[report] Email sent to ${cliente.emails.join(", ")} (ID: ${data?.id})`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[report] DONE in ${elapsed}s`);
  } catch (error) {
    console.error("[report] FATAL:", error.message || error);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

sendReport();
