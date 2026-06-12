#!/usr/bin/env node
/**
 * Cron: Actualiza datos de ShipsGo para operaciones marítimas abiertas/confeccionadas.
 * Consulta la API de ShipsGo para obtener ETA actualizada y movimientos.
 * 
 * Uso: node scripts/cron-actualizar-shipsgo.mjs
 * Cron: 0 */6 * * * cd /opt/agatrack2026 && /usr/bin/node scripts/cron-actualizar-shipsgo.mjs >> /var/log/agatrack-shipsgo.log 2>&1
 * (cada 6 horas)
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });
const SHIPSGO_TOKEN = get("SHIPSGO_API_KEY");

(async () => {
  if (!SHIPSGO_TOKEN) {
    console.error("[shipsgo-cron] SHIPSGO_API_KEY no configurada");
    await pool.end();
    return;
  }

  const start = Date.now();

  // Obtener BLs con shipsgo_id de operaciones no aprobadas
  const { rows: docs } = await pool.query(`
    SELECT d.id, d.nro_operacion, d.shipsgo_id, d.datos_extraidos
    FROM documentos d
    INNER JOIN operaciones o ON d.nro_operacion = o.nro_operacion
    WHERE d.tipo_documento = 'Bill of Lading (BL)'
      AND d.shipsgo_id IS NOT NULL
      AND o.estado NOT IN ('aprobada', 'cerrada')
    ORDER BY d.created_at DESC
  `);

  if (docs.length === 0) {
    console.log(`[${new Date().toISOString()}] Sin operaciones marítimas pendientes con ShipsGo`);
    await pool.end();
    return;
  }

  console.log(`[${new Date().toISOString()}] Actualizando ShipsGo para ${docs.length} operaciones...`);

  let actualizadas = 0;
  for (const doc of docs) {
    try {
      const res = await fetch(`https://api.shipsgo.com/v2/ocean/shipments/${doc.shipsgo_id}`, {
        headers: { "X-Shipsgo-User-Token": SHIPSGO_TOKEN },
      });

      if (!res.ok) {
        console.log(`  ${doc.nro_operacion}: error ${res.status}`);
        continue;
      }

      const json = await res.json();
      const sgData = json.shipment || {};

      if (sgData.route) {
        await pool.query(
          "UPDATE documentos SET datos_shipsgo = $1 WHERE id = $2",
          [JSON.stringify(sgData), doc.id]
        );

        // Extraer ETA para log
        const eta = sgData.route?.port_of_discharge?.date_of_discharge;
        const etaStr = eta ? new Date(eta).toLocaleDateString("es-CL") : "N/D";
        console.log(`  ${doc.nro_operacion}: actualizado (ETA: ${etaStr})`);
        actualizadas++;
      }

      // Rate limiting: esperar 1s entre requests
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  ${doc.nro_operacion}: error - ${err.message || err}`);
    }
  }

  console.log(`[${new Date().toISOString()}] ${actualizadas}/${docs.length} actualizadas (${Date.now() - start}ms)`);
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
