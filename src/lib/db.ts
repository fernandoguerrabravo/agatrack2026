import "server-only";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { createTunnel, type ForwardOptions, type ServerOptions, type SshOptions, type TunnelOptions } from "tunnel-ssh";

type DbEnv = {
  DB_NAME: string;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_TUNNEL_HOST: string;
  DB_TUNNEL_PORT: number;
  DB_TUNNEL_USER: string;
  DB_TUNNEL_PRIVATE_KEY_PATH: string;
  DB_LOCAL_PORT: number;
};

function readEnv(): DbEnv {
  const required = [
    "DB_NAME",
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_TUNNEL_HOST",
    "DB_TUNNEL_PORT",
    "DB_TUNNEL_USER",
    "DB_TUNNEL_PRIVATE_KEY_PATH",
  ] as const;

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  return {
    DB_NAME: process.env.DB_NAME!,
    DB_HOST: process.env.DB_HOST!,
    DB_PORT: Number(process.env.DB_PORT),
    DB_USER: process.env.DB_USER!,
    DB_PASSWORD: process.env.DB_PASSWORD!,
    DB_TUNNEL_HOST: process.env.DB_TUNNEL_HOST!,
    DB_TUNNEL_PORT: Number(process.env.DB_TUNNEL_PORT),
    DB_TUNNEL_USER: process.env.DB_TUNNEL_USER!,
    DB_TUNNEL_PRIVATE_KEY_PATH: process.env.DB_TUNNEL_PRIVATE_KEY_PATH!,
    DB_LOCAL_PORT: Number(process.env.DB_LOCAL_PORT ?? "3307"),
  };
}

// Reutilizamos el pool y el túnel entre invocaciones (evita abrir un túnel por request).
// Usamos globalThis para que sobreviva al HMR de `next dev`.
type Cached = {
  pool: mysql.Pool | null;
  tunnelReady: Promise<void> | null;
};

const globalForDb = globalThis as unknown as { __db?: Cached };
const cached: Cached = globalForDb.__db ?? { pool: null, tunnelReady: null };
if (!globalForDb.__db) globalForDb.__db = cached;

async function openTunnel(env: DbEnv): Promise<void> {
  let privateKey: Buffer | string;

  // Si existe DB_TUNNEL_PRIVATE_KEY como contenido directo, usarlo (para deploy en cloud)
  if (process.env.DB_TUNNEL_PRIVATE_KEY) {
    privateKey = process.env.DB_TUNNEL_PRIVATE_KEY;
  } else {
    const keyPath = path.isAbsolute(env.DB_TUNNEL_PRIVATE_KEY_PATH)
      ? env.DB_TUNNEL_PRIVATE_KEY_PATH
      : path.join(process.cwd(), env.DB_TUNNEL_PRIVATE_KEY_PATH);
    privateKey = fs.readFileSync(keyPath);
  }

  const tunnelOptions: TunnelOptions = { autoClose: false, reconnectOnError: true };
  const serverOptions: ServerOptions = { host: "127.0.0.1", port: env.DB_LOCAL_PORT };
  const sshOptions: SshOptions = {
    host: env.DB_TUNNEL_HOST,
    port: env.DB_TUNNEL_PORT,
    username: env.DB_TUNNEL_USER,
    privateKey,
  };
  const forwardOptions: ForwardOptions = {
    srcAddr: "127.0.0.1",
    srcPort: env.DB_LOCAL_PORT,
    dstAddr: env.DB_HOST,
    dstPort: env.DB_PORT,
  };

  await createTunnel(tunnelOptions, serverOptions, sshOptions, forwardOptions);
}

async function getPool(): Promise<mysql.Pool> {
  if (cached.pool) return cached.pool;

  const env = readEnv();

  if (!cached.tunnelReady) {
    cached.tunnelReady = openTunnel(env).catch((err) => {
      cached.tunnelReady = null;
      throw err;
    });
  }
  await cached.tunnelReady;

  cached.pool = mysql.createPool({
    host: "127.0.0.1",
    port: env.DB_LOCAL_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
  });

  return cached.pool;
}

export async function query<T = mysql.RowDataPacket[]>(
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<T> {
  const pool = await getPool();
  const [rows] = await pool.query(sql, params as unknown[] | undefined);
  return rows as T;
}

export async function getConnection(): Promise<mysql.PoolConnection> {
  const pool = await getPool();
  return pool.getConnection();
}
