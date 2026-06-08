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
  const res = await pool.query(
    `SELECT tipo_documento, datos_extraidos FROM documentos WHERE nro_operacion = '190153' ORDER BY tipo_documento`
  );
  console.log("Docs 190153:", res.rows.map(r => r.tipo_documento).join(", "));
  
  // Buscar SEREMI
  const seremi = res.rows.find(r => r.tipo_documento === "Certificado Sanitario (SEREMI)");
  if (!seremi) {
    console.log("\nNo hay Certificado Sanitario (SEREMI)");
    // Buscar en todos los docs alguno que tenga CDA
    for (const r of res.rows) {
      const d = typeof r.datos_extraidos === "string" ? JSON.parse(r.datos_extraidos) : r.datos_extraidos;
      const txt = JSON.stringify(d);
      if (/CDA|destinacion|SEREMI/i.test(txt)) {
        console.log("\nEncontrado en:", r.tipo_documento);
        console.log(txt.slice(0, 500));
      }
    }
  } else {
    const d = typeof seremi.datos_extraidos === "string" ? JSON.parse(seremi.datos_extraidos) : seremi.datos_extraidos;
    console.log("\n=== Certificado Sanitario (SEREMI) ===");
    console.log(JSON.stringify(d, null, 2).slice(0, 1000));
  }
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
