#!/usr/bin/env node
/**
 * Cron: Genera comprobantes TGR para operaciones aprobadas sin TGR.
 * Solo procesa las que tienen fecha_pago_gravamenes (impuestos pagados).
 * 
 * Uso: node scripts/cron-generar-tgr.mjs
 * Cron: 0 7 * * * (3:00 AM Chile = 7:00 UTC)
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
const PORT = get("PORT") || "3000";
const INBOUND_SECRET = get("INBOUND_SECRET");

(async () => {
  // Buscar operaciones aprobadas desde 15/06/2026 con impuestos pagados y sin TGR
  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.rut_cliente
    FROM despachos_replica dr
    LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE dr.fecha_aceptacion >= '2026-06-15'
      AND dr.fecha_pago_gravamenes IS NOT NULL
      AND dr.fecha_pago_gravamenes != ''
      AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
      AND (o.notas IS NULL OR o.notas NOT LIKE '%tgr_url:%')
    ORDER BY dr.fecha_aceptacion
  `);

  if (rows.length === 0) {
    console.log(`[${new Date().toISOString()}] Sin operaciones pendientes de TGR`);
    await pool.end();
    return;
  }

  console.log(`[${new Date().toISOString()}] Generando TGR para ${rows.length} operaciones...`);

  let ok = 0, errores = 0;
  for (const row of rows) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/operaciones/comprobante-tgr`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-inbound-secret": INBOUND_SECRET },
        body: JSON.stringify({ nro_operacion: row.despacho }),
      });
      const data = await res.json();
      if (res.ok) {
        ok++;
        console.log(`  ✅ ${row.despacho}`);
      } else {
        errores++;
        console.log(`  ⏳ ${row.despacho}: ${data.error || "sin datos"}`);
      }
      // Esperar entre cada consulta para no saturar TGR
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      errores++;
      console.log(`  ❌ ${row.despacho}: ${err.message}`);
    }
  }

  console.log(`[${new Date().toISOString()}] TGR finalizado: ${ok} generados, ${errores} pendientes/errores`);
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
