#!/usr/bin/env node
/**
 * Demonio/Cron: Verifica operaciones aprobadas comparando con despachos_replica.
 * Si el nro_operacion aparece en la columna "despacho" de despachos_replica, se marca como aprobada.
 * 
 * Uso: node scripts/cron-verificar-aprobadas.mjs
 * Cron: */5 * * * * cd /opt/agatrack2026 && /usr/bin/node scripts/cron-verificar-aprobadas.mjs >> /var/log/agatrack-aprobadas.log 2>&1
 */
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
  const start = Date.now();

  // Obtener operaciones no aprobadas
  const { rows: pendientes } = await pool.query(
    "SELECT nro_operacion FROM operaciones WHERE estado NOT IN ('aprobada', 'cerrada')"
  );

  if (pendientes.length === 0) {
    await pool.end();
    return;
  }

  const nros = pendientes.map(r => r.nro_operacion);

  // Buscar cuáles aparecen en despachos_replica
  const { rows: aprobadas } = await pool.query(
    `SELECT despacho, nro_aceptacion, fecha_aceptacion 
     FROM despachos_replica 
     WHERE despacho = ANY($1)`,
    [nros]
  );

  if (aprobadas.length === 0) {
    await pool.end();
    return;
  }

  // Actualizar estado
  let actualizadas = 0;
  for (const ap of aprobadas) {
    const fecha = ap.fecha_aceptacion ? new Date(ap.fecha_aceptacion).toLocaleDateString("es-CL") : "";
    await pool.query(
      `UPDATE operaciones SET estado = 'aprobada', fecha_cierre = NOW(), updated_at = NOW(),
       notas = COALESCE(notas, '') || $1
       WHERE nro_operacion = $2 AND estado != 'aprobada'`,
      [`\nAprobada (replica): ${ap.nro_aceptacion} (${fecha})`, ap.despacho]
    );
    actualizadas++;
  }

  if (actualizadas > 0) {
    console.log(`[${new Date().toISOString()}] ${actualizadas} operaciones aprobadas: ${aprobadas.map(a => a.despacho).join(", ")} (${Date.now() - start}ms)`);
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
