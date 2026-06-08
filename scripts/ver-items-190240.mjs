#!/usr/bin/env node
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const res = await pool.query(
    `SELECT datos_extraidos FROM documentos WHERE nro_operacion = '190239' AND tipo_documento = 'Invoice (Factura Comercial)' ORDER BY created_at DESC LIMIT 1`
  );
  if (!res.rows.length) { console.log("No Invoice para 190239"); process.exit(0); }
  const d = typeof res.rows[0].datos_extraidos === "string" ? JSON.parse(res.rows[0].datos_extraidos) : res.rows[0].datos_extraidos;
  console.log("items:", (d.items || []).length);
  (d.items || []).forEach((it, i) => {
    console.log(`\n[${i}]:`);
    console.log("  codigo_material:", it.codigo_material);
    console.log("  codigo_producto:", it.codigo_producto);
    console.log("  total:", it.total);
    console.log("  monto:", it.monto);
    console.log("  peso_neto:", it.peso_neto);
    console.log("  cantidad:", it.cantidad);
    console.log("  descripcion:", (it.descripcion || "").slice(0, 60));
  });
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
