#!/usr/bin/env node
/**
 * Cron: Genera PREFACTURAS (confección sin transmitir al SII) para operaciones aprobadas de
 * CUALQUIER cliente que ya tienen su TGR y aún NO tienen factura terminada ni prefactura.
 *
 * - Requiere tgr_url en notas (impuestos pagados + comprobante TGR generado).
 * - Excluye las que ya tienen factura_confeccionada o dte_url en notas (prefactura/factura ya hecha).
 * - El endpoint generar-factura además verifica en AduanaNet (lista afecta + DTE 33) para NO duplicar
 *   aunque la prefactura/factura se haya creado fuera del sistema.
 *
 * Uso: node scripts/cron-generar-prefacturas.mjs
 * Cron: 0 8 * * * (4:00 AM Chile = 8:00 UTC), después del cron de TGR (3:00 AM).
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
  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.cliente
    FROM despachos_replica dr
    JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE dr.fecha_aceptacion >= '2026-06-15'
      AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
      AND o.notas LIKE '%tgr_url:%'
      AND o.notas NOT LIKE '%factura_confeccionada:%'
      AND o.notas NOT LIKE '%dte_url:%'
    ORDER BY dr.fecha_aceptacion
  `);

  if (rows.length === 0) {
    console.log(`[${new Date().toISOString()}] Sin operaciones pendientes de prefactura`);
    await pool.end();
    return;
  }

  console.log(`[${new Date().toISOString()}] Generando prefacturas para ${rows.length} operaciones...`);

  let ok = 0, skip = 0, errores = 0;
  for (const row of rows) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/operaciones/generar-factura`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-inbound-secret": INBOUND_SECRET },
        body: JSON.stringify({ nro_operacion: row.despacho, skip_sii: true }),
      });
      const data = await res.json();
      if (res.ok && data.skip) { skip++; console.log(`  ⏭️  ${row.despacho} (${row.cliente || ""}): ya tenía factura/prefactura`); }
      else if (res.ok) { ok++; console.log(`  ✅ ${row.despacho} (${row.cliente || ""}): prefactura creada`); }
      else { errores++; console.log(`  ❌ ${row.despacho}: ${data.error || "error"}`); }
    } catch (err) {
      errores++;
      console.log(`  ❌ ${row.despacho}: ${err.message}`);
    }
    // Espera entre operaciones (cada una abre Puppeteer en AduanaNet)
    await new Promise(r => setTimeout(r, 8000));
  }

  console.log(`[${new Date().toISOString()}] Prefacturas finalizado: ${ok} creadas, ${skip} ya existían, ${errores} errores`);
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
