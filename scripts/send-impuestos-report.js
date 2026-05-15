#!/usr/bin/env node

/**
 * Envía un reporte diario de Eficiencia Arancelaria y Bien de Capital por email.
 * 
 * Uso: node scripts/send-impuestos-report.js
 * Cron: 0 13 * * 1-5 cd /opt/agatrack2026 && /usr/bin/node scripts/send-impuestos-report.js >> /var/log/agatrack-impuestos.log 2>&1
 * (13:00 UTC = 9:00 AM Chile, lunes a viernes)
 */

const { Pool } = require("pg");
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

function formatUSD(value) {
  return "$" + Math.round(value).toLocaleString("en-US");
}

const OPERACIONES_EXPORT = [
  "EXPORTACION NORMAL", "EXPORTACION S/CARACTER COMERC.", "EXPORTACION DE SERVICIOS",
  "EXPORTACION DE SERVICIOS SIMPLIFICADA", "EXPORTACION ABONA DAPEX DTO. 224",
  "EXPORTACION CANCELA DAPEX DTO. 135", "EXPORTACION ABONA DAPEX DTO. 473",
  "EXPORT. ABONA SALIDA TEMPORAL", "EXPORTACION VIA COURIER",
  "EXPORTACIÓN ABONA DATPA DTO. 28", "SALIDA TEMPORAL",
  "SALIDA TEMPORAL PARA PERFECCIONAMIENTO PASIVO", "SALIDA TEMP.EFECTOS DE TURISTA",
  "SALIDA ABONA RANCHO DE IMPORTACION",
];

// Clientes que reciben este reporte
const CLIENTES = [
  {
    rut: "96691060-7",
    nombre: "KSB CHILE S.A.",
    emails: ["mauricio.munoz@ksb.com"],
  },
  {
    rut: "88579800-4",
    nombre: "MICROGEO INGENIERIA S.A.",
    emails: ["patricio.hernandez@tecnoglobal.cl", "hernan.valenzuela@tecnoglobal.cl"],
  },
  {
    rut: "77762940-9",
    nombre: "ANGLO AMERICAN SUR S.A.",
    emails: ["sergio.llanos@angloamerican.com"],
  },
  {
    rut: "99505340-3",
    nombre: "NOVAGRI S.A.",
    emails: ["mjcandia@novagri.cl", "mariajose@novagri.cl", "paula@novagri.cl", "eduardo@novagri.org"],
  },
  {
    rut: "92933000-5",
    nombre: "PETROQUIMICA DOW S.A.",
    emails: ["VMartinezHerraez@dow.com", "LNuez@dow.com", "agiampieri@dow.com", "Felipe.Salas@psabdp.com", "Sara.Arcos@psabdp.com", "Yisel.Moraga@psabdp.com"],
  },
  {
    rut: "96979680-5",
    nombre: "SOUTHERN TECHNOLOGY GROUP",
    emails: ["elba.rojas@stgchile.cl", "luzmira.leiva@stgchile.cl", "lily.lopez@stgchile.cl", "jimena.diaz@stgchile.cl"],
  },
  {
    rut: "78581570-K",
    nombre: "BROTHER INT.DE CHILE LTDA.",
    emails: ["salvarez@brother.cl", "earaya@brother.cl"],
  },
];

async function getImpuestosData(pgPool, rut) {
  const now = new Date();
  const desde = `${now.getFullYear()}-01-01`;
  const hasta = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const placeholders = OPERACIONES_EXPORT.map((_, i) => `$${i + 1}`).join(",");
  const rutIdx = OPERACIONES_EXPORT.length + 1;
  const desdeIdx = rutIdx + 1;
  const hastaIdx = desdeIdx + 1;

  // Totales IVA y Derechos
  const totalsRes = await pgPool.query(
    `SELECT 
      COUNT(*) as total_operaciones,
      COALESCE(SUM(NULLIF(iva,'')::numeric), 0) as total_iva,
      COALESCE(SUM(NULLIF(gravamenes_valor_1,'')::numeric), 0) as total_derechos,
      COALESCE(SUM(NULLIF(total_cif,'')::numeric), 0) as total_cif,
      COALESCE(SUM(NULLIF(total_fob,'')::numeric), 0) as total_fob,
      COALESCE(SUM(NULLIF(total_peso_bruto,'')::numeric), 0) as total_kilos,
      COALESCE(SUM(NULLIF(valor_flete,'')::numeric), 0) as total_flete,
      COALESCE(SUM(NULLIF(valor_seguro,'')::numeric), 0) as total_seguro
    FROM despachos_replica 
    WHERE operacion NOT IN (${placeholders}) 
      AND rut_cliente = $${rutIdx} 
      AND fecha_aceptacion >= $${desdeIdx}::date 
      AND fecha_aceptacion <= $${hastaIdx}::date`,
    [...OPERACIONES_EXPORT, rut, desde, hasta]
  );
  const totals = totalsRes.rows[0];

  // Bien de Capital (régimen GENERAL, derechos = 0)
  const bkRes = await pgPool.query(
    `SELECT COUNT(*) as cantidad, COALESCE(SUM(NULLIF(total_cif,'')::numeric), 0) as total_cif_bk
    FROM despachos_replica 
    WHERE operacion NOT IN (${placeholders}) 
      AND rut_cliente = $${rutIdx} 
      AND fecha_aceptacion >= $${desdeIdx}::date 
      AND fecha_aceptacion <= $${hastaIdx}::date
      AND regimen = 'GENERAL' 
      AND (NULLIF(gravamenes_valor_1,'')::numeric = 0 OR gravamenes_valor_1 IS NULL OR gravamenes_valor_1 = '')`,
    [...OPERACIONES_EXPORT, rut, desde, hasta]
  );
  const bienCapital = bkRes.rows[0];

  // IVA y Derechos por mes
  const porMesRes = await pgPool.query(
    `SELECT 
      TO_CHAR(fecha_aceptacion::date, 'YYYY-MM') as mes,
      COUNT(*) as cantidad,
      COALESCE(SUM(NULLIF(iva,'')::numeric), 0) as iva_mes,
      COALESCE(SUM(NULLIF(gravamenes_valor_1,'')::numeric), 0) as derechos_mes
    FROM despachos_replica 
    WHERE operacion NOT IN (${placeholders}) 
      AND rut_cliente = $${rutIdx} 
      AND fecha_aceptacion >= $${desdeIdx}::date 
      AND fecha_aceptacion <= $${hastaIdx}::date
    GROUP BY mes ORDER BY mes`,
    [...OPERACIONES_EXPORT, rut, desde, hasta]
  );

  return { totals, bienCapital, porMes: porMesRes.rows, desde, hasta };
}

function buildEmailHtml(cliente, data) {
  const cifTotal = Number(data.totals.total_cif);
  const fobTotal = Number(data.totals.total_fob);
  const kilosTotal = Number(data.totals.total_kilos);
  const fleteTotal = Number(data.totals.total_flete);
  const seguroTotal = Number(data.totals.total_seguro);
  const derechosTeoricos = cifTotal * 0.06;
  const derechosPagados = Number(data.totals.total_derechos);
  const ahorroBK = Number(data.bienCapital.total_cif_bk) * 0.06;
  const ahorroTLC = derechosTeoricos - derechosPagados - ahorroBK;
  const pctEficiencia = derechosTeoricos > 0 ? ((derechosTeoricos - derechosPagados) / derechosTeoricos * 100) : 0;
  const pctBK = derechosTeoricos > 0 ? (ahorroBK / derechosTeoricos * 100) : 0;
  const pctTLC = derechosTeoricos > 0 ? (Math.max(0, ahorroTLC) / derechosTeoricos * 100) : 0;
  const pctPagado = derechosTeoricos > 0 ? (derechosPagados / derechosTeoricos * 100) : 0;

  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const now = new Date();
  const periodoTexto = `1 de enero al ${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}`;

  // Tabla mensual
  let tablaMensual = "";
  for (const row of data.porMes) {
    const mesLabel = row.mes;
    tablaMensual += `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${mesLabel}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${row.cantidad}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatUSD(Number(row.iva_mes))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatUSD(Number(row.derechos_mes))}</td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<div style="background:#f4f4f4;color:#000;font-family:Arial,sans-serif;max-width:700px;margin:0 auto;border:2px solid #d3d3d3;">
  <!-- Header -->
  <div style="background:#1a2b4a;padding:16px;text-align:center;">
    <img src="https://agatrack.agenciaguerra.com/logo_agatrack.png" alt="AGATrack" width="240" height="75" style="height:auto" />
  </div>

  <!-- Contenido -->
  <div style="padding:24px;background:#fff;">
    <h1 style="font-size:18px;color:#1a2b4a;margin:0 0 8px 0;">Estadísticas de Comercio Exterior Agencia Guerra</h1>
    <p style="font-size:13px;color:#666;margin:0 0 20px 0;">${cliente.nombre} (${cliente.rut}) | Período: ${periodoTexto}</p>

    <!-- KPIs Estadísticas Generales de Importación -->
    <h2 style="font-size:15px;color:#1a2b4a;border-bottom:2px solid #e8a838;padding-bottom:6px;margin:0 0 16px 0;">Estadísticas Generales de Importación</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:10px;background:#f0f7ff;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#666;">Operaciones</div>
          <div style="font-size:18px;font-weight:bold;color:#1a2b4a;">${data.totals.total_operaciones}</div>
        </td>
        <td style="width:6px;"></td>
        <td style="padding:10px;background:#f0f7ff;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#666;">Total CIF (USD)</div>
          <div style="font-size:18px;font-weight:bold;color:#1a2b4a;">${formatUSD(cifTotal)}</div>
        </td>
        <td style="width:6px;"></td>
        <td style="padding:10px;background:#f0f7ff;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#666;">Total FOB (USD)</div>
          <div style="font-size:18px;font-weight:bold;color:#1a2b4a;">${formatUSD(fobTotal)}</div>
        </td>
      </tr>
      <tr><td colspan="5" style="height:6px;"></td></tr>
      <tr>
        <td style="padding:10px;background:#f0f7ff;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#666;">Peso Bruto (kg)</div>
          <div style="font-size:18px;font-weight:bold;color:#1a2b4a;">${Math.round(kilosTotal).toLocaleString("es-CL")}</div>
        </td>
        <td style="width:6px;"></td>
        <td style="padding:10px;background:#f0f7ff;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#666;">Flete (USD)</div>
          <div style="font-size:18px;font-weight:bold;color:#1a2b4a;">${formatUSD(fleteTotal)}</div>
        </td>
        <td style="width:6px;"></td>
        <td style="padding:10px;background:#f0f7ff;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#666;">Seguro (USD)</div>
          <div style="font-size:18px;font-weight:bold;color:#1a2b4a;">${formatUSD(seguroTotal)}</div>
        </td>
      </tr>
    </table>

    <!-- KPIs principales -->
    <h2 style="font-size:15px;color:#1a2b4a;border-bottom:2px solid #e8a838;padding-bottom:6px;margin:0 0 16px 0;">Impuestos Pagados</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:12px;background:#fef2f2;border-radius:4px;text-align:center;width:50%;">
          <div style="font-size:12px;color:#991b1b;">IVA Pagado (USD)</div>
          <div style="font-size:20px;font-weight:bold;color:#dc2626;">${formatUSD(Number(data.totals.total_iva))}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px;background:#fef3c7;border-radius:4px;text-align:center;width:50%;">
          <div style="font-size:12px;color:#92400e;">Derechos de Aduana (USD)</div>
          <div style="font-size:20px;font-weight:bold;color:#d97706;">${formatUSD(derechosPagados)}</div>
        </td>
      </tr>
    </table>

    <!-- Eficiencia Arancelaria -->
    <h2 style="font-size:15px;color:#1a2b4a;border-bottom:2px solid #e8a838;padding-bottom:6px;margin:0 0 16px 0;">Eficiencia en Uso de Beneficios Arancelarios</h2>
    <p style="font-size:13px;color:#333;margin:0 0 12px 0;">Derechos teóricos (6% sobre CIF): <strong>${formatUSD(derechosTeoricos)}</strong></p>
    
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:10px;background:#d1fae5;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#065f46;">Eficiencia Total</div>
          <div style="font-size:22px;font-weight:bold;color:#059669;">${pctEficiencia.toFixed(1)}%</div>
        </td>
        <td style="width:6px;"></td>
        <td style="padding:10px;background:#dbeafe;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#1e40af;">Ahorro TLC</div>
          <div style="font-size:22px;font-weight:bold;color:#2563eb;">${pctTLC.toFixed(1)}%</div>
          <div style="font-size:11px;color:#666;">${formatUSD(Math.max(0, ahorroTLC))}</div>
        </td>
        <td style="width:6px;"></td>
        <td style="padding:10px;background:#ede9fe;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#5b21b6;">Ahorro Bien Capital</div>
          <div style="font-size:22px;font-weight:bold;color:#7c3aed;">${pctBK.toFixed(1)}%</div>
          <div style="font-size:11px;color:#666;">${formatUSD(ahorroBK)}</div>
        </td>
        <td style="width:6px;"></td>
        <td style="padding:10px;background:#fef3c7;border-radius:4px;text-align:center;">
          <div style="font-size:11px;color:#92400e;">Derechos Pagados</div>
          <div style="font-size:22px;font-weight:bold;color:#d97706;">${pctPagado.toFixed(1)}%</div>
          <div style="font-size:11px;color:#666;">${formatUSD(derechosPagados)}</div>
        </td>
      </tr>
    </table>

    <!-- Bien de Capital -->
    <h2 style="font-size:15px;color:#1a2b4a;border-bottom:2px solid #e8a838;padding-bottom:6px;margin:0 0 16px 0;">Aplicaciones de Beneficios de Bienes de Capital</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:10px;background:#f0f7ff;border-radius:4px;text-align:center;width:50%;">
          <div style="font-size:11px;color:#666;">Operaciones Aplicadas</div>
          <div style="font-size:20px;font-weight:bold;color:#1a2b4a;">${data.bienCapital.cantidad}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:10px;background:#d1fae5;border-radius:4px;text-align:center;width:50%;">
          <div style="font-size:11px;color:#065f46;">Ahorro Estimado (6% CIF)</div>
          <div style="font-size:20px;font-weight:bold;color:#059669;">${formatUSD(ahorroBK)}</div>
        </td>
      </tr>
    </table>

    <!-- Tabla mensual -->
    <h2 style="font-size:15px;color:#1a2b4a;border-bottom:2px solid #e8a838;padding-bottom:6px;margin:0 0 16px 0;">IVA y Derechos por Mes (USD)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#1a2b4a;color:#fff;">
          <th style="padding:8px;text-align:left;">Mes</th>
          <th style="padding:8px;text-align:right;">Operaciones</th>
          <th style="padding:8px;text-align:right;">IVA</th>
          <th style="padding:8px;text-align:right;">Derechos</th>
        </tr>
      </thead>
      <tbody>
        ${tablaMensual}
      </tbody>
    </table>

    <p style="font-size:13px;color:#333;margin:20px 0 0 0;">Para más detalles, acceda a <a href="https://agatrack.agenciaguerra.com" style="color:#e8a838;font-weight:bold;">AGATrack</a>.</p>
  </div>

  <!-- Disclaimer -->
  <div style="padding:16px 24px;">
    <div style="background:#1a2b4a;padding:16px;font-size:11px;color:#fff;border-radius:4px;">
      <p style="margin:0 0 8px 0;">Los datos presentados corresponden a operaciones tramitadas a través de Agencia Guerra. No solicitaremos información sensible por correo electrónico, <b>salvo expresa solicitud del cliente</b>.</p>
      <p style="margin:0;">Este es un correo automático. No es necesario responder.</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#1a2b4a;padding:12px;text-align:center;">
    <small style="color:#e8a838;">AGATrack - Sistema Seguimiento Operaciones Comex</small>
  </div>
</div>`;
}

async function sendReports() {
  const startTime = Date.now();
  console.log("\n[impuestos] ===== Report started at", new Date().toISOString(), "=====");

  if (!process.env.RESEND_API_KEY) {
    console.error("[impuestos] RESEND_API_KEY not configured");
    process.exit(1);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const pgPool = getPgPool();

  try {
    for (const cliente of CLIENTES) {
      const data = await getImpuestosData(pgPool, cliente.rut);

      if (Number(data.totals.total_operaciones) === 0) {
        console.log(`[impuestos] No data for ${cliente.nombre}, skipping`);
        continue;
      }

      const html = buildEmailHtml(cliente, data);
      const today = new Date().toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });

      const { data: resData, error } = await resend.emails.send({
        from: process.env.RESEND_FROM || "AGATrack <reportes@agatrack.agenciaguerra.com>",
        to: cliente.emails,
        subject: `Estadísticas de Comercio Exterior Agencia Guerra - ${cliente.nombre} - ${today}`,
        html,
      });

      if (error) {
        console.error(`[impuestos] Error sending to ${cliente.nombre}:`, error);
      } else {
        console.log(`[impuestos] Email sent to ${cliente.emails.join(", ")} (ID: ${resData?.id})`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[impuestos] DONE in ${elapsed}s`);
  } catch (error) {
    console.error("[impuestos] FATAL:", error.message || error);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

sendReports();
