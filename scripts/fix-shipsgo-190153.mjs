#!/usr/bin/env node
/** Corrige el mbl_shipsgo en la BD para op 190153 */
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
    `SELECT id, datos_extraidos, datos_extraidos_claude FROM documentos WHERE nro_operacion = '190153' AND tipo_documento = 'Bill of Lading (BL)' ORDER BY created_at DESC LIMIT 1`
  );
  if (!res.rows.length) { console.log("No BL"); process.exit(0); }
  const id = res.rows[0].id;

  // Actualizar datos_extraidos
  const d = typeof res.rows[0].datos_extraidos === "string" ? JSON.parse(res.rows[0].datos_extraidos) : res.rows[0].datos_extraidos;
  d.mbl_shipsgo = "MEDUO9744824";
  await pool.query(`UPDATE documentos SET datos_extraidos = $1 WHERE id = $2`, [JSON.stringify(d), id]);

  // Actualizar datos_extraidos_claude
  if (res.rows[0].datos_extraidos_claude) {
    const cl = typeof res.rows[0].datos_extraidos_claude === "string" ? JSON.parse(res.rows[0].datos_extraidos_claude) : res.rows[0].datos_extraidos_claude;
    cl.mbl_shipsgo = "MEDUO9744824";
    if (cl.numero_bl_master) cl.numero_bl_master = "MEDUO9744824";
    await pool.query(`UPDATE documentos SET datos_extraidos_claude = $1 WHERE id = $2`, [JSON.stringify(cl), id]);
  }

  // Reset shipsgo_id para que se pueda re-enviar
  await pool.query(`UPDATE documentos SET shipsgo_id = NULL, datos_shipsgo = NULL WHERE id = $1`, [id]);

  console.log("✅ Actualizado:");
  console.log("  mbl_shipsgo: MEDUO9744824");
  console.log("  shipsgo_id: NULL (listo para re-enviar)");
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
