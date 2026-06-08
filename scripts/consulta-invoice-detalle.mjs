#!/usr/bin/env node
/** Muestra detalles de la factura y póliza para mapear a mercancías */
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
  // INVOICE
  console.log("=== INVOICE DETALLE ===\n");
  const inv = await pool.query(
    `SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Invoice (Factura Comercial)' ORDER BY created_at DESC LIMIT 1`,
    [OP]
  );
  if (inv.rows.length) {
    const d = typeof inv.rows[0].datos_extraidos === "string" ? JSON.parse(inv.rows[0].datos_extraidos) : inv.rows[0].datos_extraidos;
    console.log("moneda:", d.moneda);
    console.log("incoterm:", d.incoterm);
    console.log("monto_total:", d.monto_total);
    console.log("fob_value:", d.fob_value);
    console.log("freight_value:", d.freight_value);
    console.log("numero_factura:", d.numero_factura);
    console.log("pais_origen:", d.pais_origen);
    console.log("\nITEMS (" + (d.items || []).length + "):");
    (d.items || []).forEach((it, i) => {
      console.log(`\n  [Item ${i}]:`);
      console.log("   ", JSON.stringify(it, null, 2).replace(/\n/g, "\n    "));
    });
  }

  // CO - mercancia/arancel
  console.log("\n\n=== CERTIFICADO DE ORIGEN — mercancía ===\n");
  const co = await pool.query(
    `SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Certificado de Origen' ORDER BY created_at DESC LIMIT 1`,
    [OP]
  );
  if (co.rows.length) {
    const d = typeof co.rows[0].datos_extraidos === "string" ? JSON.parse(co.rows[0].datos_extraidos) : co.rows[0].datos_extraidos;
    console.log("mercancia:", JSON.stringify(d.mercancia, null, 2));
    console.log("factura:", JSON.stringify(d.factura, null, 2));
  }

  // POLIZA - prima
  console.log("\n\n=== PÓLIZA — prima ===\n");
  const pol = await pool.query(
    `SELECT datos_extraidos FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Póliza de Seguro' ORDER BY created_at DESC LIMIT 1`,
    [OP]
  );
  if (pol.rows.length) {
    const d = typeof pol.rows[0].datos_extraidos === "string" ? JSON.parse(pol.rows[0].datos_extraidos) : pol.rows[0].datos_extraidos;
    console.log("prima:", d.prima);
    console.log("monto_asegurado:", d.monto_asegurado);
    console.log("moneda:", d.moneda);
    console.log("marcas_y_numeros:", JSON.stringify(d.marcas_y_numeros, null, 2)?.slice(0, 300));
  }

  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
