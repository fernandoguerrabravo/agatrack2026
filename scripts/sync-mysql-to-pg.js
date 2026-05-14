#!/usr/bin/env node

/**
 * Script de sincronización INCREMENTAL: MySQL (aduananet) → PostgreSQL (DigitalOcean)
 * Solo agrega registros nuevos basándose en fecha_carga_data o fecha_aceptacion.
 * 
 * Uso: node scripts/sync-mysql-to-pg.js
 * Cron: 0 2 * * * cd /opt/agatrack2026 && node scripts/sync-mysql-to-pg.js >> /var/log/agatrack-sync.log 2>&1
 */

const mysql = require("mysql2/promise");
const { Pool } = require("pg");
const { createTunnel } = require("tunnel-ssh");
const fs = require("fs");
const path = require("path");

// Cargar .env manualmente
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const isDirect = process.env.DB_DIRECT === "true";

async function getMysqlConnection() {
  if (isDirect) {
    console.log("[sync] Connecting directly to MySQL...");
    return mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 30000,
    });
  }

  console.log("[sync] Opening SSH tunnel...");
  const localPort = Number(process.env.DB_LOCAL_PORT || 3307);
  const keyPath = path.isAbsolute(process.env.DB_TUNNEL_PRIVATE_KEY_PATH)
    ? process.env.DB_TUNNEL_PRIVATE_KEY_PATH
    : path.join(__dirname, "..", process.env.DB_TUNNEL_PRIVATE_KEY_PATH);

  const privateKey = fs.readFileSync(keyPath);

  await createTunnel(
    { autoClose: false, reconnectOnError: false },
    { host: "127.0.0.1", port: localPort },
    {
      host: process.env.DB_TUNNEL_HOST,
      port: Number(process.env.DB_TUNNEL_PORT),
      username: process.env.DB_TUNNEL_USER,
      privateKey,
      readyTimeout: 30000,
    },
    {
      srcAddr: "127.0.0.1",
      srcPort: localPort,
      dstAddr: process.env.DB_HOST,
      dstPort: Number(process.env.DB_PORT),
    }
  );

  console.log("[sync] Tunnel established");
  return mysql.createConnection({
    host: "127.0.0.1",
    port: localPort,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 30000,
  });
}

function getPgPool() {
  const url = (process.env.POSTGRES_URL || "").replace(/[?&]sslmode=[^&]*/g, "");
  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
}

async function sync() {
  const startTime = Date.now();
  console.log("\n[sync] ===== Starting incremental sync at", new Date().toISOString(), "=====");

  let mysqlConn;
  let pgPool;

  try {
    // 1. Conectar a PostgreSQL
    pgPool = getPgPool();

    // 2. Crear tabla si no existe
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS despachos_replica (
        sync_id SERIAL PRIMARY KEY,
        lbac_nid TEXT,
        fecha_aceptacion TEXT,
        nro_aceptacion TEXT,
        operacion TEXT,
        aduana TEXT,
        rut_cliente TEXT,
        cliente TEXT,
        consignante TEXT,
        pais_destino TEXT,
        pais_origen_mercancias TEXT,
        pais_adquisicion_mercancias TEXT,
        puerto_embarque TEXT,
        puerto_desembarque TEXT,
        via TEXT,
        nave TEXT,
        emisor_docto_transporte TEXT,
        total_fob TEXT,
        valor_flete TEXT,
        valor_seguro TEXT,
        total_cif TEXT,
        total_peso_bruto TEXT,
        total_peso_neto TEXT,
        clausula_venta_incoterms TEXT,
        regimen TEXT,
        gravamenes_valor_1 TEXT,
        iva TEXT,
        referencias TEXT,
        fecha_carga_data TEXT,
        url_despacho TEXT,
        synced_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(lbac_nid)
      )
    `);

    // 3. Obtener la última fecha sincronizada
    const lastSyncResult = await pgPool.query(
      "SELECT MAX(fecha_carga_data) as last_date FROM despachos_replica"
    );
    const lastDate = lastSyncResult.rows[0]?.last_date || null;
    console.log("[sync] Last synced date:", lastDate || "NONE (first sync)");

    // 4. Conectar a MySQL
    mysqlConn = await getMysqlConnection();
    console.log("[sync] MySQL connected");

    // 5. Traer solo registros nuevos
    let query;
    let params;

    if (lastDate) {
      // Incremental: solo registros con fecha_carga_data posterior
      query = `SELECT * FROM out_despacho_fguerra WHERE fecha_carga_data > ? ORDER BY fecha_carga_data ASC`;
      params = [lastDate];
    } else {
      // Primera vez: traer todo
      query = `SELECT * FROM out_despacho_fguerra ORDER BY fecha_carga_data ASC`;
      params = [];
    }

    const [rows] = await mysqlConn.query(query, params);
    console.log("[sync] New rows from MySQL:", rows.length);

    if (rows.length === 0) {
      console.log("[sync] No new rows to sync. Done!");
      return;
    }

    // 6. Insertar en PostgreSQL (upsert por lbac_nid)
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      try {
        const result = await pgPool.query(
          `INSERT INTO despachos_replica (
            lbac_nid, fecha_aceptacion, nro_aceptacion, operacion, aduana,
            rut_cliente, cliente, consignante, pais_destino, pais_origen_mercancias,
            pais_adquisicion_mercancias, puerto_embarque, puerto_desembarque, via, nave,
            emisor_docto_transporte, total_fob, valor_flete, valor_seguro, total_cif,
            total_peso_bruto, total_peso_neto, clausula_venta_incoterms, regimen,
            gravamenes_valor_1, iva, referencias, fecha_carga_data, url_despacho
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
          )
          ON CONFLICT (lbac_nid) DO UPDATE SET
            fecha_aceptacion = EXCLUDED.fecha_aceptacion,
            operacion = EXCLUDED.operacion,
            total_fob = EXCLUDED.total_fob,
            total_cif = EXCLUDED.total_cif,
            total_peso_bruto = EXCLUDED.total_peso_bruto,
            fecha_carga_data = EXCLUDED.fecha_carga_data,
            synced_at = NOW()
          RETURNING (xmax = 0) as is_insert`,
          [
            row.lbac_nid, row.fecha_aceptacion, row.nro_aceptacion, row.operacion, row.aduana,
            row.rut_cliente, row.cliente, row.consignante, row.pais_destino, row.pais_origen_mercancias,
            row.pais_adquisicion_mercancias, row.puerto_embarque, row.puerto_desembarque, row.via, row.nave,
            row.emisor_docto_transporte, row.total_fob, row.valor_flete, row.valor_seguro, row.total_cif,
            row.total_peso_bruto, row.total_peso_neto, row.clausula_venta_incoterms, row.regimen,
            row.gravamenes_valor_1, row.iva, row.referencias, row.fecha_carga_data, row.url_despacho,
          ].map(v => v != null ? String(v) : null)
        );

        if (result.rows[0]?.is_insert) {
          inserted++;
        } else {
          updated++;
        }
      } catch (err) {
        console.error("[sync] Error inserting row lbac_nid:", row.lbac_nid, err.message);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[sync] Sync completed! Inserted: ${inserted}, Updated: ${updated}, Total: ${rows.length} in ${elapsed}s`);
  } catch (error) {
    console.error("[sync] FATAL Error:", error.message || error);
    process.exit(1);
  } finally {
    if (mysqlConn) await mysqlConn.end().catch(() => {});
    if (pgPool) await pgPool.end().catch(() => {});
    setTimeout(() => process.exit(0), 1000);
  }
}

sync();
