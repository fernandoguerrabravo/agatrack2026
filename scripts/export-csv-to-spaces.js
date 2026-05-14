#!/usr/bin/env node

/**
 * Exporta despachos_replica de PostgreSQL a CSV y lo sube a DigitalOcean Spaces.
 * El agente GenAI de DigitalOcean puede usar este CSV como Knowledge Base.
 * 
 * Uso: node scripts/export-csv-to-spaces.js
 * Cron: 30 2 * * * cd /opt/agatrack2026 && /usr/bin/node scripts/export-csv-to-spaces.js >> /var/log/agatrack-export.log 2>&1
 */

const { Pool } = require("pg");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
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

function getS3Client() {
  return new S3Client({
    endpoint: process.env.DO_SPACES_ENDPOINT || "https://sfo3.digitaloceanspaces.com",
    region: process.env.DO_SPACES_REGION || "sfo3",
    credentials: {
      accessKeyId: process.env.DO_SPACES_KEY || "",
      secretAccessKey: process.env.DO_SPACES_SECRET || "",
    },
    forcePathStyle: false,
  });
}

function escapeCsv(val) {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

async function exportAndUpload() {
  const startTime = Date.now();
  console.log("\n[export] ===== CSV Export started at", new Date().toISOString(), "=====");

  const pgPool = getPgPool();

  try {
    // Columnas relevantes para el agente (no todas las 136)
    const columns = [
      "nro_aceptacion", "operacion", "fecha_aceptacion", "aduana",
      "rut_cliente", "cliente", "consignante",
      "pais_destino", "pais_origen_mercancias", "pais_adquisicion_mercancias",
      "puerto_embarque", "puerto_desembarque", "via", "nave",
      "emisor_docto_transporte", "clausula_venta_incoterms", "regimen",
      "total_fob", "valor_flete", "valor_seguro", "total_cif",
      "total_peso_bruto", "total_bultos",
      "gravamenes_valor_1", "iva",
      "referencias", "descripcion_item_1", "autor_salida"
    ];

    const { rows } = await pgPool.query(
      `SELECT ${columns.map(c => `"${c}"`).join(", ")} FROM despachos_replica ORDER BY fecha_aceptacion DESC`
    );
    console.log("[export] Rows fetched:", rows.length);

    if (rows.length === 0) {
      console.log("[export] No data to export");
      return;
    }

    // Generar CSV
    const header = columns.join(",");
    const csvRows = rows.map(row => columns.map(col => escapeCsv(row[col])).join(","));
    const csv = [header, ...csvRows].join("\n");
    console.log("[export] CSV size:", (csv.length / 1024 / 1024).toFixed(2), "MB");

    // Subir a Spaces
    const s3 = getS3Client();
    const bucket = process.env.DO_SPACES_BUCKET || "agatrack";
    const key = "knowledge-base/despachos_replica.csv";

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: csv,
      ContentType: "text/csv",
      ACL: "public-read",
    }));

    const url = `https://${bucket}.${process.env.DO_SPACES_REGION || "sfo3"}.digitaloceanspaces.com/${key}`;
    console.log("[export] CSV uploaded to:", url);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[export] DONE in ${elapsed}s`);
  } catch (error) {
    console.error("[export] ERROR:", error.message || error);
    process.exit(1);
  } finally {
    await pgPool.end();
  }
}

exportAndUpload();
