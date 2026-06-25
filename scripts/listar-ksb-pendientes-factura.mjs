#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require2 = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=[\"']?([^\"'\\n]+)", "m")); return m ? m[1] : ""; };

(async () => {
  const { Client } = require2("pg");
  const url = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  
  const { rows } = await c.query(`
    SELECT dr.despacho, dr.referencia, dr.total_cif, o.notas
    FROM despachos_replica dr
    LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
    WHERE dr.cliente ILIKE '%KSB%'
      AND dr.fecha_aceptacion >= '2026-06-15'
      AND o.notas LIKE '%tgr_url:%'
    ORDER BY dr.referencia, dr.despacho
  `);

  const sinDte = rows.filter(x => !x.url_dte && !(x.notas && x.notas.includes("dte_url:")));

  // Agrupar por referencia base
  const grupos = {};
  sinDte.forEach(x => {
    const refBase = x.referencia.replace(/_\d+$/, "");
    if (!grupos[refBase]) grupos[refBase] = [];
    grupos[refBase].push(x);
  });

  console.log("Operaciones KSB pendientes de factura (con TGR, sin DTE):\n");
  Object.entries(grupos).forEach(([ref, ops]) => {
    const cifTotal = ops.reduce((s, o) => s + parseFloat(o.total_cif || 0), 0);
    const esParcialidad = ops.length > 1;
    console.log(`${ref}${esParcialidad ? ` [PARCIALIDAD x${ops.length}]` : ""} CIF total: ${cifTotal.toFixed(2)}`);
    ops.forEach((o, i) => console.log(`  ${i === 0 ? "1ra" : "_" + (i + 1)} ${o.despacho} | ${o.referencia} | CIF:${o.total_cif}`));
  });
  console.log(`\nTotal: ${sinDte.length} operaciones en ${Object.keys(grupos).length} grupos`);
  await c.end();
})();
