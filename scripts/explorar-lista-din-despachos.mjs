#!/usr/bin/env node
/**
 * Explorar /modulos/din/dus_encabezado/lista.php para ver el estado de los despachos.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL");
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");

async function login() {
  const r1 = await fetch(BASE + "/modulos/usuarios/login.php?status=-1", { redirect: "manual" });
  const sc = r1.headers.getSetCookie() || [];
  let ck = sc.map(c => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ login: LOGIN, clave: CLAVE });
  const r2 = await fetch(BASE + "/modulos/usuarios/validar.php", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: body.toString(), redirect: "manual" });
  const sc2 = r2.headers.getSetCookie() || [];
  ck = [ck, ...sc2.map(c => c.split(";")[0])].join("; ");
  return ck;
}

(async () => {
  const ck = await login();
  console.log("Login OK\n");

  // Cargar lista de despachos DIN en curso
  const html = await (await fetch(BASE + "/modulos/din/dus_encabezado/lista.php", { headers: { Cookie: ck } })).text();
  console.log("lista.php len:", html.length);

  // Buscar la operación 190153
  const tiene190153 = html.includes("190153");
  console.log("Contiene 190153:", tiene190153);

  // Buscar filas de la tabla con bgcolor
  const rows = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("Total filas:", rows.length);

  // Mostrar primeras 5 filas
  console.log("\nPrimeras 5 filas:");
  for (const row of rows.slice(0, 5)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    console.log("  " + cells.filter(Boolean).slice(0, 8).join(" | "));
  }

  // Buscar la fila de 190153
  console.log("\n=== Buscando 190153 ===");
  for (const row of rows) {
    if (row[1].includes("190153")) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
        c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
      );
      console.log("ENCONTRADA:", cells.filter(Boolean).join(" | "));
      break;
    }
  }

  // Buscar filtros disponibles
  const inputs = [...html.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  console.log("\nInputs:", inputs.filter(i => /fil_|lib_nid|estado/i.test(i)).join(", "));

  // Intentar filtrar por lib_nid=190153
  console.log("\n=== Filtrando por lib_nid=190153 ===");
  const filterBody = new URLSearchParams();
  filterBody.set("accion", "F");
  filterBody.set("fil_lib_nid", "190153");
  const filteredHtml = await (await fetch(BASE + "/modulos/din/dus_encabezado/lista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: filterBody.toString()
  })).text();

  const filteredRows = [...filteredHtml.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("Filas filtradas:", filteredRows.length);
  for (const row of filteredRows.slice(0, 3)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    console.log("  " + cells.filter(Boolean).slice(0, 10).join(" | "));
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
