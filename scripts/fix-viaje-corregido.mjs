import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const url = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

for (const op of ["190235", "190239", "190240"]) {
  const r = await pool.query("SELECT id, datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)'", [op]);
  if (r.rows.length === 0) { console.log(op + ": no BL"); continue; }
  const d = typeof r.rows[0].datos_extraidos === "string" ? JSON.parse(r.rows[0].datos_extraidos) : r.rows[0].datos_extraidos;
  d.viaje_corregido = "0LIE0N1MA";
  await pool.query("UPDATE documentos SET datos_extraidos = $1 WHERE id = $2", [JSON.stringify(d), r.rows[0].id]);
  console.log(op + ": viaje_corregido → 0LIE0N1MA");
}
await pool.end();
