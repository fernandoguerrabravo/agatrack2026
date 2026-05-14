#!/usr/bin/env node

/**
 * Script de sincronización INCREMENTAL: MySQL (aduananet) → PostgreSQL (DigitalOcean)
 * Replica TODAS las columnas. Solo agrega registros nuevos (por fecha_carga_data).
 * Usa lbac_nid como clave única para upsert.
 * 
 * Uso: node scripts/sync-mysql-to-pg.js
 * Cron: 0 2 * * * cd /opt/agatrack2026 && /usr/bin/node scripts/sync-mysql-to-pg.js >> /var/log/agatrack-sync.log 2>&1
 */

const mysql = require("mysql2/promise");
const { Pool } = require("pg");
const { createTunnel } = require("tunnel-ssh");
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

const isDirect = process.env.DB_DIRECT === "true";

async function getMysqlConnection() {
  if (isDirect) {
    console.log("[sync] Direct MySQL connection...");
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
  const localPort = 3309; // Puerto diferente al de la app (3307)
  const keyPath = path.isAbsolute(process.env.DB_TUNNEL_PRIVATE_KEY_PATH)
    ? process.env.DB_TUNNEL_PRIVATE_KEY_PATH
    : path.join(__dirname, "..", process.env.DB_TUNNEL_PRIVATE_KEY_PATH);
  const privateKey = fs.readFileSync(keyPath);

  await createTunnel(
    { autoClose: false, reconnectOnError: false },
    { host: "127.0.0.1", port: localPort },
    { host: process.env.DB_TUNNEL_HOST, port: Number(process.env.DB_TUNNEL_PORT), username: process.env.DB_TUNNEL_USER, privateKey, readyTimeout: 30000 },
    { srcAddr: "127.0.0.1", srcPort: localPort, dstAddr: process.env.DB_HOST, dstPort: Number(process.env.DB_PORT) }
  );

  console.log("[sync] Tunnel OK");
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
  return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3 });
}

async function sync() {
  const startTime = Date.now();
  console.log("\n[sync] ===== Incremental sync started at", new Date().toISOString(), "=====");

  let mysqlConn;
  let pgPool;

  try {
    pgPool = getPgPool();

    // Crear tabla replica con todas las columnas (TEXT para simplicidad)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS despachos_replica (
        sync_id SERIAL,
        lbac_nid TEXT,
        operacion TEXT, despacho TEXT, resolucion TEXT, dus_tipo_envio TEXT,
        aduana TEXT, referencia TEXT, nro_aceptacion TEXT PRIMARY KEY, fecha_aceptacion TEXT,
        fecha_vencto TEXT, aforo TEXT, autor_salida TEXT, eta TEXT, dus_observaciones TEXT,
        parcial TEXT, nro_parcial TEXT, total_parciales TEXT, total_itemes TEXT,
        total_bultos TEXT, total_peso_bruto TEXT, total_fob TEXT,
        seguro_teorico TEXT, valor_seguro TEXT, flete_teorico TEXT, valor_flete TEXT,
        total_cif TEXT, identificacion_bultos TEXT, observaciones_bco_central TEXT,
        signo_ajuste TEXT, total_ajuste TEXT, valor_exfabrica TEXT, gastos_hasta_fob TEXT,
        paridad TEXT, total_peso_neto TEXT, estimacion_peso TEXT,
        puerto_embarque TEXT, region_origen TEXT, tipo_carga TEXT, via TEXT,
        puerto_desembarque TEXT, pais_destino TEXT, cia_transportadora TEXT,
        pais_cia_transportadora TEXT, emisor_docto_transporte TEXT, nave TEXT, nro_viaje TEXT,
        pais_adquisicion_mercancias TEXT, pais_origen_mercancias TEXT,
        fecha_manifiesto TEXT, manifiesto_1 TEXT, manifiesto_2 TEXT,
        almacenista TEXT, fecha_recepcion_almacenista TEXT, fecha_retiro_almacenista TEXT,
        transbordo TEXT, documento_transporte TEXT, fecha_docto_transporte_din TEXT,
        certificado_isp TEXT, certificado_sesma TEXT,
        regla_vb_codigo TEXT, regla_vb_numero TEXT, regla_vb_agno TEXT,
        registro_reconoc_parte1 TEXT, registro_reconoc_parte2 TEXT,
        tipo_rut TEXT, rut_cliente TEXT, cliente TEXT, direccion_cliente TEXT, comuna TEXT,
        representante_legal TEXT, representante_legal_rut TEXT,
        consignante TEXT, consignante_direccion TEXT, pais_consignante TEXT,
        nid_regimen_suspensivo TEXT, fecha_nid_reg_susp TEXT, aduana_reg_suspensivo TEXT,
        plazo_vigencia_reg_sup TEXT, direccion_almacenamiento_reg_susp TEXT,
        comuna_almacen_reg_susp TEXT, aduana_control_reg_susp TEXT,
        moneda_export TEXT, valor_clausula_venta TEXT, modalidad_venta TEXT,
        comisiones_exterior TEXT, clausula_venta_incoterms TEXT, otros_gtos_deducibles TEXT,
        forma_pago_export TEXT, valor_liquido_retorno TEXT, forma_pago_gravamenes TEXT,
        regimen TEXT, valor_ex_fabrica TEXT, gtos_hta_fob TEXT, moneda_import TEXT,
        gravamenes_codigo_1 TEXT, gravamenes_valor_1 TEXT,
        gravamenes_codigo_2 TEXT, gravamenes_valor_2 TEXT,
        gravamenes_codigo_3 TEXT, gravamenes_valor_3 TEXT,
        gravamenes_codigo_4 TEXT, gravamenes_valor_4 TEXT,
        gravamenes_codigo_5 TEXT, gravamenes_valor_5 TEXT,
        gravamenes_codigo_6 TEXT, gravamenes_valor_6 TEXT,
        gravamenes_codigo_7 TEXT, gravamenes_valor_7 TEXT,
        gravamenes_codigo_8 TEXT, gravamenes_valor_8 TEXT,
        iva TEXT, total_gravamenes_uss TEXT, tipo_cambio TEXT, total_gravamenes_chs TEXT,
        nro_item TEXT, descripcion_item_1 TEXT, codigo_arancel_tratado_item_1 TEXT,
        codigo_arancel_item_2 TEXT, nro_secuencia TEXT,
        nro_docto_transporte TEXT, fecha_docto_transporte TEXT,
        fecha_hora_ingreso_despacho TEXT, estado TEXT, factura TEXT, anulado TEXT,
        fecha_pago_gravamenes TEXT, nro_apertura_carpeta TEXT, guia_despacho TEXT,
        factura_despacho TEXT, bulto_cod_tipo TEXT, bulto_cantidad TEXT, bulto_glosa TEXT,
        url_dte TEXT, url_factura TEXT, url_despacho TEXT, fecha_carga_data TEXT,
        synced_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("[sync] Table despachos_replica ready");

    // Obtener última fecha sincronizada
    const lastResult = await pgPool.query("SELECT MAX(fecha_carga_data) as last_date FROM despachos_replica");
    const lastDate = lastResult.rows[0]?.last_date || null;
    console.log("[sync] Last synced:", lastDate || "NONE (first sync)");

    // Conectar MySQL
    mysqlConn = await getMysqlConnection();
    console.log("[sync] MySQL connected");

    // Query incremental (con margen de 2 días para capturar modificaciones)
    let rows;
    if (lastDate) {
      // Restar 2 días al lastDate para capturar posibles actualizaciones
      const marginDate = new Date(lastDate);
      marginDate.setDate(marginDate.getDate() - 2);
      const fromDate = marginDate.toISOString().split("T")[0];
      console.log("[sync] Fetching from:", fromDate, "(2 days margin)");
      [rows] = await mysqlConn.query("SELECT * FROM out_despacho_fguerra WHERE fecha_carga_data >= ?", [fromDate]);
    } else {
      [rows] = await mysqlConn.query("SELECT * FROM out_despacho_fguerra");
    }
    console.log("[sync] Rows to process:", rows.length);

    if (rows.length === 0) {
      console.log("[sync] Nothing to sync. Done!");
      return;
    }

    // Insertar/actualizar
    const columns = Object.keys(rows[0]);
    let inserted = 0, updated = 0, errors = 0;

    for (const row of rows) {
      try {
        // Convertir fechas a formato ISO antes de guardar
        const values = columns.map(c => {
          const val = row[c];
          if (val == null) return null;
          // Si es un objeto Date, convertir a ISO string
          if (val instanceof Date) {
            if (isNaN(val.getTime())) return null; // Fecha inválida
            return val.toISOString().split("T")[0];
          }
          return String(val);
        });
        const colNames = columns.map(c => `"${c}"`).join(", ");
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

        const result = await pgPool.query(
          `INSERT INTO despachos_replica (${colNames})
           VALUES (${placeholders})
           ON CONFLICT (nro_aceptacion) DO UPDATE SET
             ${columns.filter(c => c !== "nro_aceptacion").map(c => `"${c}" = EXCLUDED."${c}"`).join(",\n             ")},
             synced_at = NOW()
           RETURNING (xmax = 0) as is_insert`,
          values
        );

        if (result.rows[0]?.is_insert) inserted++;
        else updated++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.error("[sync] Row error:", row.nro_aceptacion, err.message);
      }

      if ((inserted + updated) % 500 === 0) {
        console.log(`[sync] Progress: ${inserted + updated}/${rows.length}`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[sync] DONE! Inserted: ${inserted}, Updated: ${updated}, Errors: ${errors}, Time: ${elapsed}s`);
  } catch (error) {
    console.error("[sync] FATAL:", error.message || error);
    process.exit(1);
  } finally {
    if (mysqlConn) await mysqlConn.end().catch(() => {});
    if (pgPool) await pgPool.end().catch(() => {});
    setTimeout(() => process.exit(0), 1000);
  }
}

sync();
