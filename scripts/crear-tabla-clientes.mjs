#!/usr/bin/env node
/**
 * Crea la tabla clientes en PostgreSQL e importa los datos únicos desde despachos_replica.
 * Usa rut_cliente como PK y el nombre desde el campo "cliente".
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
  console.log("=== Crear tabla clientes (desde despachos_replica) ===\n");

  // Crear tabla
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      rut VARCHAR(20) PRIMARY KEY,
      razon VARCHAR(255) NOT NULL DEFAULT '',
      email VARCHAR(255) DEFAULT '',
      telefono VARCHAR(50) DEFAULT '',
      direccion VARCHAR(255) DEFAULT '',
      ciudad VARCHAR(100) DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log("✅ Tabla clientes creada/verificada");

  // Extraer clientes únicos de despachos_replica (tomar el último registro por rut)
  const { rows } = await pool.query(`
    SELECT DISTINCT ON (rut_cliente) 
      rut_cliente, cliente
    FROM despachos_replica 
    WHERE rut_cliente IS NOT NULL 
      AND rut_cliente != ''
      AND cliente IS NOT NULL
      AND cliente != ''
    ORDER BY rut_cliente, fecha_aceptacion DESC
  `);
  console.log(`Clientes únicos encontrados: ${rows.length}`);

  // Insertar con ON CONFLICT para no duplicar
  let inserted = 0;
  for (const row of rows) {
    const rut = row.rut_cliente?.trim();
    const razon = row.cliente?.trim();
    if (!rut || !razon) continue;
    
    const res = await pool.query(
      `INSERT INTO clientes (rut, razon) VALUES ($1, $2) ON CONFLICT (rut) DO NOTHING`,
      [rut, razon]
    );
    if (res.rowCount > 0) inserted++;
  }
  console.log(`✅ Insertados: ${inserted} clientes`);

  const count = await pool.query("SELECT COUNT(*) as total FROM clientes");
  console.log(`Total registros en tabla: ${count.rows[0].total}`);

  await pool.end();
  console.log("\n✅ Listo.");
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
