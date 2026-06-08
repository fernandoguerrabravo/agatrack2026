#!/usr/bin/env node
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const OP = process.argv[2] || "190275";

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const res = await pool.query(
    `SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)' ORDER BY created_at DESC LIMIT 1`,
    [OP]
  );
  if (!res.rows.length) { console.log("No BL para op", OP); process.exit(0); }
  const d = typeof res.rows[0].datos_extraidos === "string" ? JSON.parse(res.rows[0].datos_extraidos) : res.rows[0].datos_extraidos;
  
  console.log("=== BL", OP, "— datos flete ===\n");
  console.log("flete_total_prepaid:", d.flete_total_prepaid);
  console.log("flete_total:", d.flete_total);
  console.log("flete:", d.flete);
  console.log("flete_detalle:", JSON.stringify(d.flete_detalle, null, 2));
  console.log("freight_value:", d.freight_value);
  console.log("moneda:", d.moneda);
  console.log("incoterm:", d.incoterm);
  console.log("\n[todas las keys]:", Object.keys(d).join(", "));
  
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
