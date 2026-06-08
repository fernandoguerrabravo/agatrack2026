#!/usr/bin/env node
/** Muestra TODOS los datos del CO de una operación */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL");
const OP = process.argv[2] || "190248";

const connStr = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

(async () => {
  const res = await pool.query(
    `SELECT datos_extraidos, datos_extraidos_claude FROM documentos 
     WHERE nro_operacion = $1 AND tipo_documento = 'Certificado de Origen' 
     ORDER BY created_at DESC LIMIT 1`,
    [OP]
  );

  if (res.rows.length === 0) { console.log("No hay CO para op", OP); process.exit(0); }

  const datos = typeof res.rows[0].datos_extraidos === "string" 
    ? JSON.parse(res.rows[0].datos_extraidos) : res.rows[0].datos_extraidos;

  console.log("=== CO completo (datos_extraidos) — Op", OP, "===\n");
  console.log(JSON.stringify(datos, null, 2));

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
