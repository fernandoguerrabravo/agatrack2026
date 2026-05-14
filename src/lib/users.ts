import "server-only";
import { pgQuery, initUsersTable } from "./postgres";

export type UserRecord = {
  id: number;
  id_cliente: string;
  rut: string;
  password_hash: string;
  nombre: string;
  email: string;
  created_at: string;
};

let tableInitialized = false;

async function ensureTable() {
  if (!tableInitialized) {
    await initUsersTable();
    tableInitialized = true;
  }
}

/**
 * Busca un usuario por RUT y email.
 */
export async function findUserByRutAndEmail(rut: string, email: string): Promise<UserRecord | null> {
  await ensureTable();
  const rows = await pgQuery<UserRecord>(
    "SELECT * FROM usuarios WHERE rut = $1 AND email = $2 LIMIT 1",
    [rut, email.toLowerCase()]
  );
  return rows[0] ?? null;
}

/**
 * Busca un usuario por RUT (legacy, para compatibilidad).
 */
export async function findUserByRut(rut: string): Promise<UserRecord | null> {
  await ensureTable();
  const rows = await pgQuery<UserRecord>(
    "SELECT * FROM usuarios WHERE rut = $1 LIMIT 1",
    [rut]
  );
  return rows[0] ?? null;
}

/**
 * Crea un nuevo usuario.
 */
export async function createUser(fields: {
  rut: string;
  passwordHash: string;
  nombre?: string;
  email?: string;
}): Promise<UserRecord> {
  await ensureTable();
  const rows = await pgQuery<UserRecord>(
    `INSERT INTO usuarios (rut, password_hash, nombre, email)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [fields.rut, fields.passwordHash, fields.nombre ?? "", fields.email ?? ""]
  );
  return rows[0];
}
