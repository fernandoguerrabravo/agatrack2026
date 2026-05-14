import "server-only";
import { Pool } from "pg";

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
