import "server-only";
import { Pool, types } from "pg";

// Forzar que DATE (OID 1082) se devuelva como string YYYY-MM-DD, sin convertir a Date
types.setTypeParser(1082, (val: string) => val);

const globalForPg = globalThis as unknown as { __pg?: Pool };

function getPool(): Pool {
  if (globalForPg.__pg) return globalForPg.__pg;

  // Quitar sslmode de la URL para manejarlo por código
  const url = (process.env.POSTGRES_URL ?? "").replace(/[?&]sslmode=[^&]*/g, "");

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  globalForPg.__pg = pool;
  return pool;
}

export async function pgQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

/**
 * Inicializa la tabla de usuarios si no existe.
 */
export async function initUsersTable(): Promise<void> {
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      id_cliente VARCHAR(50) DEFAULT '',
      rut VARCHAR(12) NOT NULL,
      password_hash TEXT NOT NULL,
      nombre VARCHAR(255) DEFAULT '',
      email VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(rut, email)
    )
  `);
}

/**
 * Inicializa la tabla de ejemplos verificados de BL (gold standard para "entrenamiento").
 * Esta tabla NO se borra cuando se eliminan documentos — acumula conocimiento permanente.
 */
export async function initBlEjemplosTable(): Promise<void> {
  await pgQuery(`
    CREATE TABLE IF NOT EXISTS bl_ejemplos_verificados (
      id SERIAL PRIMARY KEY,
      rut_cliente VARCHAR(12) DEFAULT '',
      naviera VARCHAR(150) DEFAULT '',
      numero_bl_master VARCHAR(50) DEFAULT '',
      numero_bl_house VARCHAR(60) DEFAULT '',
      tipo_bl_house VARCHAR(20) DEFAULT '',
      flete_total_prepaid NUMERIC DEFAULT 0,
      gastos_fob_total NUMERIC DEFAULT 0,
      moneda VARCHAR(10) DEFAULT '',
      incoterm VARCHAR(15) DEFAULT '',
      contenedores TEXT DEFAULT '',
      nave VARCHAR(150) DEFAULT '',
      viaje VARCHAR(40) DEFAULT '',
      puerto_transbordo VARCHAR(120) DEFAULT '',
      puerto_desembarque VARCHAR(120) DEFAULT '',
      fuente VARCHAR(30) DEFAULT '',
      verificado_shipsgo BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Índice para búsqueda rápida por naviera + cliente
  await pgQuery(`CREATE INDEX IF NOT EXISTS idx_bl_ejemplos_naviera ON bl_ejemplos_verificados (rut_cliente, naviera)`);
  // Evitar duplicados del mismo MBL por cliente
  await pgQuery(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bl_ejemplos_mbl ON bl_ejemplos_verificados (rut_cliente, numero_bl_master) WHERE numero_bl_master <> ''`);
}

