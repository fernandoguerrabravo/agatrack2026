import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const url = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const bl = await pool.query("SELECT datos_extraidos FROM documentos WHERE nro_operacion='190248' AND tipo_documento='Bill of Lading (BL)'");
const d = typeof bl.rows[0].datos_extraidos === "string" ? JSON.parse(bl.rows[0].datos_extraidos) : bl.rows[0].datos_extraidos;

const fletePrepaid = Number(d.flete_total_prepaid || 0);
const gastosHastaFob = (d.gastos_hasta_fob || []);
const gastosPrepaidExtra = gastosHastaFob
  .filter(g => !/\bTHC\b|\bDTHC\b|terminal\s*handling/i.test(String(g.concepto || "")))
  .reduce((sum, g) => sum + Number(g.monto || 0), 0);
const fleteValue = fletePrepaid + gastosPrepaidExtra;

console.log("flete_total_prepaid:", fletePrepaid);
console.log("gastos_hasta_fob:", JSON.stringify(gastosHastaFob));
console.log("gastos prepaid extra (sin THC):", gastosPrepaidExtra);
console.log("FLETE TOTAL → AduanaNet:", fleteValue);

await pool.end();
