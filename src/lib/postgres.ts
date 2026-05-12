import "server-only";
import { Pool } from "pg";

const globalForPg = globalThis as unknown as { __pg?: Pool };

function getPool(): Pool {
  if (globalForPg.__pg) return globalForPg.__pg;

  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 5,
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
      rut VARCHAR(12) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre VARCHAR(255) DEFAULT '',
      email VARCHAR(255) DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}
