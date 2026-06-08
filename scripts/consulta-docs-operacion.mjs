#!/usr/bin/env node
/** Consulta todos los documentos de una operación para ver qué datos tenemos para crear mercancías */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const OP = process.argv[2] || "190248";

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log(`\n=== Documentos Op ${OP} — Datos para mercancía ===\n`);

  const res = await pool.query(
    `SELECT id, tipo_documento, nombre_archivo, datos_extraidos 
     FROM documentos WHERE nro_operacion = $1 ORDER BY tipo_documento`,
    [OP]
  );

  console.log("Total documentos:", res.rows.length, "\n");

  for (const row of res.rows) {
    const datos = typeof row.datos_extraidos === "string" ? JSON.parse(row.datos_extraidos) : row.datos_extraidos;
    console.log("─".repeat(60));
    console.log(`[${row.tipo_documento}] ${row.nombre_archivo} (id: ${row.id})`);
    
    if (row.tipo_documento === "Invoice (Factura Comercial)") {
      console.log("  moneda:", datos.moneda);
      console.log("  incoterm:", datos.incoterm);
      console.log("  monto_total:", datos.monto_total);
      console.log("  items:");
      const items = datos.items || datos.lineas || datos.productos || [];
      if (Array.isArray(items)) {
        items.slice(0, 5).forEach((it, i) => {
          console.log(`    [${i}]`, JSON.stringify(it).slice(0, 200));
        });
        if (items.length > 5) console.log(`    ... (${items.length} total)`);
      } else {
        console.log("    (no array)", typeof items);
      }
      console.log("  [keys]:", Object.keys(datos).join(", "));
    }
    
    else if (row.tipo_documento === "Certificado de Origen") {
      console.log("  pais_origen:", datos.pais_origen);
      console.log("  tratado:", datos.tratado_aplicable);
      console.log("  mercancia:", JSON.stringify(datos.mercancia).slice(0, 200));
    }
    
    else if (row.tipo_documento === "Bill of Lading (BL)") {
      console.log("  peso_bruto_total:", datos.peso_bruto_total);
      console.log("  contenedores:", (datos.contenedores || []).length);
      console.log("  descripcion_mercancia:", (datos.descripcion_mercancia || "").slice(0, 150));
      console.log("  [keys]:", Object.keys(datos).slice(0, 20).join(", "));
    }
    
    else if (row.tipo_documento === "Lista de Empaque (Packing List)") {
      console.log("  total_bultos:", datos.total_bultos);
      console.log("  peso_bruto_total:", datos.peso_bruto_total);
      console.log("  peso_neto_total:", datos.peso_neto_total);
      console.log("  items:", (datos.items || []).length);
      (datos.items || []).slice(0, 3).forEach((it, i) => {
        console.log(`    [${i}]`, JSON.stringify(it).slice(0, 200));
      });
    }
    
    else {
      console.log("  [keys]:", Object.keys(datos || {}).join(", "));
    }
  }

  await pool.end();
  console.log("\n✅ Consulta completa.");
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
