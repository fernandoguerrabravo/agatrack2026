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
    `SELECT id, datos_extraidos FROM documentos WHERE nro_operacion = '190153' AND tipo_documento = 'Bill of Lading (BL)' ORDER BY created_at DESC LIMIT 1`
  );
  if (!res.rows.length) { console.log("No BL"); process.exit(0); }
  const d = typeof res.rows[0].datos_extraidos === "string" ? JSON.parse(res.rows[0].datos_extraidos) : res.rows[0].datos_extraidos;
  console.log("Antes:");
  console.log("  numero_bl_master:", d.numero_bl_master);
  console.log("  numero_bl:", d.numero_bl);

  // Corregir a MEDUO9744824
  d.numero_bl_master = "MEDUO9744824";
  if (d.numero_bl) d.numero_bl = "MEDUO9744824";

  await pool.query(
    `UPDATE documentos SET datos_extraidos = $1 WHERE id = $2`,
    [JSON.stringify(d), res.rows[0].id]
  );

  // También actualizar datos_extraidos_claude si existe
  const resCl = await pool.query(
    `SELECT datos_extraidos_claude FROM documentos WHERE id = $1`,
    [res.rows[0].id]
  );
  if (resCl.rows[0].datos_extraidos_claude) {
    const cl = typeof resCl.rows[0].datos_extraidos_claude === "string" ? JSON.parse(resCl.rows[0].datos_extraidos_claude) : resCl.rows[0].datos_extraidos_claude;
    if (cl.numero_bl_master) cl.numero_bl_master = "MEDUO9744824";
    if (cl.numero_bl) cl.numero_bl = "MEDUO9744824";
    await pool.query(`UPDATE documentos SET datos_extraidos_claude = $1 WHERE id = $2`, [JSON.stringify(cl), res.rows[0].id]);
  }

  console.log("\nDespués:");
  console.log("  numero_bl_master: MEDUO9744824");
  console.log("✅ Actualizado");
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
