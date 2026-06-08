#!/usr/bin/env node
/**
 * Crea la tabla operaciones en PostgreSQL.
 * Las operaciones existen independientemente de los documentos.
 * Eliminar documentos no borra la operación.
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log("=== Crear tabla operaciones ===\n");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS operaciones (
      nro_operacion VARCHAR(20) PRIMARY KEY,
      rut_cliente VARCHAR(20) REFERENCES clientes(rut) ON DELETE SET NULL,
      estado VARCHAR(30) NOT NULL DEFAULT 'abierta',
      fecha_apertura TIMESTAMP DEFAULT NOW(),
      fecha_confeccion TIMESTAMP,
      fecha_cierre TIMESTAMP,
      notas TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log("✅ Tabla operaciones creada/verificada");

  // Crear índices útiles
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operaciones_rut ON operaciones(rut_cliente)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operaciones_estado ON operaciones(estado)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_operaciones_fecha ON operaciones(fecha_apertura DESC)`);
  console.log("✅ Índices creados");

  // Importar operaciones existentes desde documentos (para no perder las que ya están en uso)
  const { rows } = await pool.query(`
    SELECT DISTINCT nro_operacion, rut_cliente, MIN(created_at) as primera_fecha
    FROM documentos
    WHERE nro_operacion IS NOT NULL AND nro_operacion != ''
    GROUP BY nro_operacion, rut_cliente
  `);
  console.log(`Operaciones existentes en documentos: ${rows.length}`);

  let inserted = 0;
  for (const row of rows) {
    // Verificar si el rut_cliente existe en la tabla clientes
    let rutCliente = row.rut_cliente || null;
    if (rutCliente) {
      const check = await pool.query("SELECT 1 FROM clientes WHERE rut = $1", [rutCliente]);
      if (check.rows.length === 0) rutCliente = null;
    }
    const res = await pool.query(
      `INSERT INTO operaciones (nro_operacion, rut_cliente, estado, fecha_apertura)
       VALUES ($1, $2, 'abierta', $3)
       ON CONFLICT (nro_operacion) DO NOTHING`,
      [row.nro_operacion, rutCliente, row.primera_fecha || new Date()]
    );
    if (res.rowCount > 0) inserted++;
  }
  console.log(`✅ Insertadas: ${inserted} operaciones desde documentos existentes`);

  const count = await pool.query("SELECT COUNT(*) as total FROM operaciones");
  console.log(`Total operaciones: ${count.rows[0].total}`);

  await pool.end();
  console.log("\n✅ Listo.");
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
