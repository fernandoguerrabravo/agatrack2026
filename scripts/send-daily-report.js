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
    rut: "96691060-7",
    nombre: "KSB CHILE S.A.",
    emails: ["mauricio.munoz@ksb.com"], // Agregar más destinatarios aquí
  },
  // Agregar más clientes aquí
];

async function generateReport(pgPool, rut, nombre) {
  // Columnas para el reporte (las mismas del Excel adjunto)
  const columns = [
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

  // Traer operaciones del mes en curso
  const now = new Date();
  const desde = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const hasta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const colSelect = columns.map(c => `"${c}"`).join(", ");
  const { rows } = await pgPool.query(
    `SELECT ${colSelect} FROM despachos_replica WHERE rut_cliente = $1 AND fecha_aceptacion >= $2 AND fecha_aceptacion <= $3 ORDER BY fecha_aceptacion DESC`,
    [rut, desde, hasta]
  );

  console.log(`[report] ${nombre} (${rut}): ${rows.length} operaciones del ${desde} al ${hasta}`);

  if (rows.length === 0) return null;

  // Generar Excel
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Despachos");

  const fileName = `agatrack-reporte-despachos-${desde}-${hasta}.xlsx`;
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return { fileName, buffer, rowCount: rows.length, desde, hasta };
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
      const report = await generateReport(pgPool, cliente.rut, cliente.nombre);

      if (!report) {
        console.log(`[report] No data for ${cliente.nombre}, skipping email`);
        continue;
      }

      const today = new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });

      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM || "AGATrack <reportes@agenciaguerra.com>",
        to: cliente.emails,
        subject: `Reporte Despachos ${cliente.nombre} - ${today}`,
        html: `
          <h2>Reporte de Despachos - ${cliente.nombre}</h2>
          <p>Estimado cliente,</p>
          <p>Adjunto encontrará el reporte de operaciones del período <strong>${report.desde}</strong> al <strong>${report.hasta}</strong>.</p>
          <ul>
            <li><strong>Total operaciones:</strong> ${report.rowCount}</li>
            <li><strong>Período:</strong> Mes en curso</li>
          </ul>
          <p>Este reporte se genera automáticamente desde AGATrack.</p>
          <br>
          <p style="color: #666; font-size: 12px;">Agencia de Aduanas Guerra - Sistema AGATrack</p>
        `,
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
