#!/usr/bin/env node
/**
 * Genera facturas pendientes de KSB (confección sin SII)
 * Para operaciones que tienen TGR pero no tienen DTE
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };

const BASE_URL = get("NEXT_PUBLIC_URL") || "http://localhost:3000";
const INBOUND_SECRET = get("INBOUND_SECRET");

async function main() {
  // Obtener operaciones KSB con TGR sin DTE
  const pg = await import("pg");
  const pool = new pg.Pool({
    connectionString: get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, ""),
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(`
    SELECT dr.despacho, dr.referencia, dr.fecha_aceptacion, dr.cliente, dr.url_dte, o.notas
    FROM despachos_replica dr
    LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE dr.cliente ILIKE '%KSB%'
      AND dr.fecha_aceptacion >= '2026-06-15'
      AND o.notas LIKE '%tgr_url:%'
    ORDER BY dr.fecha_aceptacion ASC
  `);

  const pendientes = rows.filter(r => {
    const hasDte = r.url_dte || (r.notas && r.notas.includes("dte_url:"));
    return !hasDte;
  });

  console.log(`\n📋 KSB: ${pendientes.length} operaciones con TGR sin factura\n`);
  pendientes.forEach(r => console.log(`   ${r.despacho} | ${r.referencia} | ${r.fecha_aceptacion?.toISOString().slice(0, 10)}`));

  if (pendientes.length === 0) {
    console.log("\n✅ Todas las facturas ya están generadas");
    await pool.end();
    return;
  }

  console.log(`\n🏭 Generando facturas (confección sin SII)...\n`);

  let ok = 0, errors = 0;
  for (const op of pendientes) {
    const despacho = op.despacho;
    console.log(`   [${despacho}] ${op.referencia}...`);
    try {
      const res = await fetch(`${BASE_URL}/api/operaciones/generar-factura`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-inbound-secret": INBOUND_SECRET,
        },
        body: JSON.stringify({ nro_operacion: despacho, skip_sii: true }),
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`   [${despacho}] ✅ OK`);
        ok++;
      } else {
        console.log(`   [${despacho}] ❌ ${data.error}`);
        errors++;
      }
    } catch (e) {
      console.log(`   [${despacho}] ❌ ${e.message}`);
      errors++;
    }
    // Esperar entre operaciones para no saturar
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`\n📊 Resultado: ${ok} OK, ${errors} errores de ${pendientes.length} total`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
