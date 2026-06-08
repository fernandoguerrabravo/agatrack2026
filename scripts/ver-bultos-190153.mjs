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
  // BL
  const bl = await pool.query(`SELECT datos_extraidos FROM documentos WHERE nro_operacion = '190153' AND tipo_documento = 'Bill of Lading (BL)' ORDER BY created_at DESC LIMIT 1`);
  if (bl.rows.length) {
    const d = typeof bl.rows[0].datos_extraidos === "string" ? JSON.parse(bl.rows[0].datos_extraidos) : bl.rows[0].datos_extraidos;
    console.log("=== BL ===");
    console.log("  tipo_bulto:", d.contenedores?.[0]?.tipo_bulto);
    console.log("  numero_bultos:", d.contenedores?.[0]?.numero_bultos);
    console.log("  total_bultos:", d.total_bultos);
    console.log("  descripcion:", d.contenedores?.[0]?.descripcion_mercancia?.slice(0, 100));
  }

  // Invoice
  const inv = await pool.query(`SELECT datos_extraidos FROM documentos WHERE nro_operacion = '190153' AND tipo_documento = 'Invoice (Factura Comercial)' ORDER BY created_at DESC LIMIT 1`);
  if (inv.rows.length) {
    const d = typeof inv.rows[0].datos_extraidos === "string" ? JSON.parse(inv.rows[0].datos_extraidos) : inv.rows[0].datos_extraidos;
    console.log("\n=== Invoice ===");
    (d.items || []).forEach((it, i) => {
      console.log(`  [${i}] tipo_bulto:`, it.tipo_bulto, "| presentacion:", it.presentacion, "| unidad:", it.unidad, "| cantidad:", it.cantidad);
    });
  }

  // Packing
  const pk = await pool.query(`SELECT datos_extraidos FROM documentos WHERE nro_operacion = '190153' AND tipo_documento = 'Lista de Empaque (Packing List)' ORDER BY created_at DESC LIMIT 1`);
  if (pk.rows.length) {
    const d = typeof pk.rows[0].datos_extraidos === "string" ? JSON.parse(pk.rows[0].datos_extraidos) : pk.rows[0].datos_extraidos;
    console.log("\n=== Packing List ===");
    console.log("  tipo_embalaje:", d.tipo_embalaje);
    console.log("  total_bultos:", d.total_bultos);
    (d.items || []).forEach((it, i) => {
      console.log(`  [${i}] tipo_bulto:`, it.tipo_bulto, "| embalaje:", it.embalaje, "| cantidad:", it.cantidad);
    });
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
