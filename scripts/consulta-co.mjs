#!/usr/bin/env node
/** Consulta los datos del Certificado de Origen de una operación en la BD */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL");
const OP = process.argv[2] || "190248";

const connStr = POSTGRES_URL.replace(/[?&]sslmode=[^&]*/g, "");
const pool = new pg.Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

(async () => {
  console.log(`\n=== Certificado de Origen — Op ${OP} ===\n`);

  const res = await pool.query(
    `SELECT id, nro_operacion, nombre_archivo, tipo_documento, datos_extraidos, datos_extraidos_claude 
     FROM documentos 
     WHERE nro_operacion = $1 AND tipo_documento = 'Certificado de Origen' 
     ORDER BY created_at DESC LIMIT 5`,
    [OP]
  );

  console.log("Documentos CO encontrados:", res.rows.length);

  for (const row of res.rows) {
    console.log("\n" + "=".repeat(50));
    console.log("Doc ID:", row.id);
    console.log("Archivo:", row.nombre_archivo);

    // datos_extraidos (GPT)
    const datos = typeof row.datos_extraidos === "string" ? JSON.parse(row.datos_extraidos) : row.datos_extraidos;
    if (datos) {
      console.log("\n  [datos_extraidos - GPT]:");
      console.log("    numero_certificado:", datos.numero_certificado);
      console.log("    fecha_emision:", datos.fecha_emision);
      console.log("    pais_origen:", datos.pais_origen);
      console.log("    tratado_aplicable:", datos.tratado_aplicable);
      console.log("    exportador:", datos.exportador);
      console.log("    importador:", datos.importador);
      console.log("    descripcion_mercancia:", (datos.descripcion_mercancia || "").slice(0, 150));
      console.log("    partida_arancelaria:", datos.partida_arancelaria);
      console.log("    [keys]:", Object.keys(datos).join(", "));
    }

    // datos_extraidos_claude
    const claude = typeof row.datos_extraidos_claude === "string" ? JSON.parse(row.datos_extraidos_claude || "{}") : (row.datos_extraidos_claude || {});
    if (claude && Object.keys(claude).length > 0) {
      console.log("\n  [datos_extraidos_claude]:");
      console.log("    numero_certificado:", claude.numero_certificado);
      console.log("    fecha_emision:", claude.fecha_emision);
      console.log("    pais_origen:", claude.pais_origen);
      console.log("    tratado_aplicable:", claude.tratado_aplicable);
      console.log("    exportador:", claude.exportador);
      console.log("    importador:", claude.importador);
      console.log("    descripcion_mercancia:", (claude.descripcion_mercancia || "").slice(0, 150));
      console.log("    partida_arancelaria:", claude.partida_arancelaria);
      console.log("    [keys]:", Object.keys(claude).join(", "));
    }
  }

  await pool.end();
  console.log("\n✅ Consulta completa.");
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
