import "server-only";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { createTunnel, type ForwardOptions, type ServerOptions, type SshOptions, type TunnelOptions } from "tunnel-ssh";

/**
 * Modo de conexión:
 * - DB_DIRECT=true → conexión directa a MySQL (para el Droplet)
 * - DB_DIRECT=false o no definido → usa túnel SSH (para desarrollo local)
 */
const isDirectConnection = process.env.DB_DIRECT === "true";

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
  const required = ["DB_NAME", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD"] as const;

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  // Validar túnel solo si no es conexión directa
  if (!isDirectConnection) {
    if (!process.env.DB_TUNNEL_HOST || !process.env.DB_TUNNEL_PORT || !process.env.DB_TUNNEL_USER) {
      throw new Error("Missing tunnel environment variables (DB_TUNNEL_HOST, DB_TUNNEL_PORT, DB_TUNNEL_USER)");
    }
    if (!process.env.DB_TUNNEL_PRIVATE_KEY && !process.env.DB_TUNNEL_PRIVATE_KEY_PATH) {
      throw new Error("Missing required environment variable: DB_TUNNEL_PRIVATE_KEY or DB_TUNNEL_PRIVATE_KEY_PATH");
    }
  }

  return {
    DB_NAME: process.env.DB_NAME!,
    DB_HOST: process.env.DB_HOST!,
    DB_PORT: Number(process.env.DB_PORT),
    DB_USER: process.env.DB_USER!,
    DB_PASSWORD: process.env.DB_PASSWORD!,
    DB_TUNNEL_HOST: process.env.DB_TUNNEL_HOST ?? "",
    DB_TUNNEL_PORT: Number(process.env.DB_TUNNEL_PORT ?? "22"),
    DB_TUNNEL_USER: process.env.DB_TUNNEL_USER ?? "",
    DB_TUNNEL_PRIVATE_KEY_PATH: process.env.DB_TUNNEL_PRIVATE_KEY_PATH ?? "",
    DB_LOCAL_PORT: Number(process.env.DB_LOCAL_PORT ?? "3307"),
  };
}

// Reutilizamos el pool y el túnel entre invocaciones.
type Cached = {
  pool: mysql.Pool | null;
  tunnelReady: Promise<void> | null;
};

const globalForDb = globalThis as unknown as { __db?: Cached };
const cached: Cached = globalForDb.__db ?? { pool: null, tunnelReady: null };
if (!globalForDb.__db) globalForDb.__db = cached;

function parseKeyFromEnv(raw: string): string {
  let key = raw;
  if (!key.trimStart().startsWith("-----")) {
    key = Buffer.from(key, "base64").toString("utf-8");
  }
  key = key.replace(/\\n/g, "\n");
  if (!key.includes("\n") || key.split("\n").length < 3) {
    key = key
      .replace("-----BEGIN OPENSSH PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----\n")
      .replace("-----END OPENSSH PRIVATE KEY-----", "\n-----END OPENSSH PRIVATE KEY-----\n");
  }
  if (!key.endsWith("\n")) key += "\n";
  return key;
}

async function fetchKeyFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch private key from URL: ${res.status}`);
  let key = await res.text();
  if (!key.endsWith("\n")) key += "\n";
  return key;
}

async function openTunnel(env: DbEnv): Promise<void> {
  let privateKey: Buffer | string;

  if (env.DB_TUNNEL_PRIVATE_KEY_PATH) {
    const keyPath = path.isAbsolute(env.DB_TUNNEL_PRIVATE_KEY_PATH)
      ? env.DB_TUNNEL_PRIVATE_KEY_PATH
      : path.join(process.cwd(), env.DB_TUNNEL_PRIVATE_KEY_PATH);

    if (fs.existsSync(keyPath)) {
      privateKey = fs.readFileSync(keyPath);
    } else if (process.env.DB_TUNNEL_PRIVATE_KEY) {
      privateKey = parseKeyFromEnv(process.env.DB_TUNNEL_PRIVATE_KEY);
    } else if (process.env.DB_TUNNEL_PRIVATE_KEY_URL) {
      privateKey = await fetchKeyFromUrl(process.env.DB_TUNNEL_PRIVATE_KEY_URL);
    } else {
      throw new Error(`Private key file not found: ${keyPath}`);
    }
  } else if (process.env.DB_TUNNEL_PRIVATE_KEY) {
    privateKey = parseKeyFromEnv(process.env.DB_TUNNEL_PRIVATE_KEY);
  } else if (process.env.DB_TUNNEL_PRIVATE_KEY_URL) {
    privateKey = await fetchKeyFromUrl(process.env.DB_TUNNEL_PRIVATE_KEY_URL);
  } else {
    throw new Error("No private key source available");
  }

  const tunnelOptions: TunnelOptions = { autoClose: false, reconnectOnError: true };
  const serverOptions: ServerOptions = { host: "127.0.0.1", port: env.DB_LOCAL_PORT };
  console.log("[db] Connecting SSH tunnel to:", env.DB_TUNNEL_HOST, "port:", env.DB_TUNNEL_PORT);

  const sshOptions: SshOptions = {
    host: env.DB_TUNNEL_HOST,
    port: env.DB_TUNNEL_PORT,
    username: env.DB_TUNNEL_USER,
    privateKey,
    readyTimeout: 30000,
  };
  const forwardOptions: ForwardOptions = {
    srcAddr: "127.0.0.1",
    srcPort: env.DB_LOCAL_PORT,
    dstAddr: env.DB_HOST,
    dstPort: env.DB_PORT,
  };

  await createTunnel(tunnelOptions, serverOptions, sshOptions, forwardOptions);
  console.log("[db] SSH tunnel established successfully");
}

async function resetConnection(): Promise<void> {
  if (cached.pool) {
    try { await cached.pool.end(); } catch { /* ignore */ }
    cached.pool = null;
  }
  cached.tunnelReady = null;
}

async function getPool(): Promise<mysql.Pool> {
  if (cached.pool) return cached.pool;

  const env = readEnv();

  if (isDirectConnection) {
    // Conexión directa sin túnel (Droplet → MySQL)
    console.log("[db] Direct connection to:", env.DB_HOST, "port:", env.DB_PORT);
    cached.pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      connectTimeout: 20000,
    });
  } else {
    // Conexión vía túnel SSH (local → Droplet/Bastión → MySQL)
    if (!cached.tunnelReady) {
      cached.tunnelReady = openTunnel(env).catch((err) => {
        console.error("[db] SSH tunnel error:", err);
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
      connectTimeout: 20000,
    });
  }

  return cached.pool;
}

export async function query<T = mysql.RowDataPacket[]>(
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<T> {
  try {
    const pool = await getPool();
    const [rows] = await pool.query(sql, params as unknown[] | undefined);
    return rows as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ETIMEDOUT") || message.includes("ECONNREFUSED") || message.includes("Connection lost")) {
      console.log("[db] Connection lost, resetting and retrying...");
      await resetConnection();
      const pool = await getPool();
      const [rows] = await pool.query(sql, params as unknown[] | undefined);
      return rows as T;
    }
    throw err;
  }
}

export async function getConnection(): Promise<mysql.PoolConnection> {
  const pool = await getPool();
  return pool.getConnection();
}
