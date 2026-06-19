#!/usr/bin/env node
/**
 * Cron: Actualiza pruebas OpenTimestamps pendientes.
 * Cuando Bitcoin confirma (~12h), la prueba pasa de "pending" a "confirmed".
 * 
 * Uso: node scripts/cron-ots-upgrade.mjs
 * Cron: cada 6 horas
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require2 = createRequire(import.meta.url);
const OpenTimestamps = require2("opentimestamps");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Buscar consentimientos con prueba OTS pendiente
  const { rows } = await pool.query(
    "SELECT folio, contenido_hash, ots_proof FROM consentimientos WHERE ots_status = 'pending' AND ots_proof IS NOT NULL"
  );

  if (rows.length === 0) {
    console.log(`[${new Date().toISOString()}] Sin pruebas OTS pendientes`);
    await pool.end();
    return;
  }

  console.log(`[${new Date().toISOString()}] ${rows.length} pruebas OTS pendientes`);
  let upgraded = 0;

  for (const row of rows) {
    try {
      const otsBytes = Buffer.from(row.ots_proof, "base64");
      const detached = OpenTimestamps.DetachedTimestampFile.deserialize(otsBytes);
      const cambiada = await OpenTimestamps.upgrade(detached);

      if (cambiada) {
        const newProof = Buffer.from(detached.serializeToBytes()).toString("base64");
        await pool.query(
          "UPDATE consentimientos SET ots_proof = $1, ots_status = 'confirmed' WHERE folio = $2",
          [newProof, row.folio]
        );
        upgraded++;
        console.log(`  ✅ ${row.folio}: confirmado en Bitcoin`);
      }
    } catch (err) {
      // Silenciar errores de timeout (normal si aún no hay confirmación)
      if (!err.message?.includes("timeout")) {
        console.log(`  ⚠️ ${row.folio}: ${err.message}`);
      }
    }
  }

  console.log(`[${new Date().toISOString()}] ${upgraded}/${rows.length} pruebas confirmadas en Bitcoin`);
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
