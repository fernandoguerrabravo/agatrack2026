import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const url = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

const bl = await pool.query("SELECT datos_extraidos FROM documentos WHERE nro_operacion = '190235' AND tipo_documento = 'Bill of Lading (BL)'");
const d = typeof bl.rows[0].datos_extraidos === "string" ? JSON.parse(bl.rows[0].datos_extraidos) : bl.rows[0].datos_extraidos;

console.log("=== BL 190235 ===");
console.log("flete_total_prepaid:", d.flete_total_prepaid);
console.log("total_prepaid:", d.total_prepaid);
console.log("gastos_fob_total:", d.gastos_fob_total);
console.log("gastos_hasta_fob:", JSON.stringify(d.gastos_hasta_fob));
console.log("flete_detalle:", JSON.stringify(d.flete_detalle));
console.log("incoterm BL:", d.incoterm);
console.log("naviera:", d.naviera);

const inv = await pool.query("SELECT datos_extraidos FROM documentos WHERE nro_operacion = '190235' AND tipo_documento = 'Invoice (Factura Comercial)'");
const i = typeof inv.rows[0].datos_extraidos === "string" ? JSON.parse(inv.rows[0].datos_extraidos) : inv.rows[0].datos_extraidos;
console.log("\n=== Invoice 190235 ===");
console.log("incoterm:", i.incoterm);
console.log("monto_total:", i.monto_total);
console.log("fob_value:", i.fob_value);

// Simular cálculo
const fletePrepaid = Number(d.flete_total_prepaid || d.total_prepaid || 0);
const gastosHastaFob = (d.gastos_hasta_fob || []);
const gastosPrepaidExtra = gastosHastaFob
  .filter(g => !/\bTHC\b|\bDTHC\b|terminal\s*handling/i.test(String(g.concepto || "")))
  .reduce((sum, g) => sum + Number(g.monto || 0), 0);
const fleteValue = d.total_prepaid ? Number(d.total_prepaid) : fletePrepaid + gastosPrepaidExtra;

console.log("\n=== Cálculo ===");
console.log("fletePrepaid:", fletePrepaid);
console.log("gastosPrepaidExtra:", gastosPrepaidExtra);
console.log("usa total_prepaid directo?:", !!d.total_prepaid);
console.log("FLETE FINAL:", fleteValue);

await pool.end();
