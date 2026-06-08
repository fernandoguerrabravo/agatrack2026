#!/usr/bin/env node
/** Consulta datos del BL — contenedores, pallets, bultos */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const OP = process.argv[2] || "190248";

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const res = await pool.query(
    `SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)' ORDER BY created_at DESC LIMIT 1`,
    [OP]
  );
  if (!res.rows.length) { console.log("No BL"); process.exit(0); }
  const d = typeof res.rows[0].datos_extraidos === "string" ? JSON.parse(res.rows[0].datos_extraidos) : res.rows[0].datos_extraidos;

  console.log("=== BL — Contenedores y bultos ===\n");
  console.log("total_bultos:", d.total_bultos);
  console.log("contenedores:", d.contenedores?.length);
  console.log("\nDetalle contenedores:");
  (d.contenedores || []).forEach((c, i) => {
    console.log(`\n  [${i}]`, JSON.stringify(c, null, 2).replace(/\n/g, "\n  "));
  });

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
