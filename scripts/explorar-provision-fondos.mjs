#!/usr/bin/env node
/**
 * Explorar el módulo de provisión/solicitud de fondos en AduanaNet.
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

  // 1. Cargar lista
  console.log("=== lista.php ===");
  const listaHtml = await (await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/lista.php", { headers: { Cookie: ck } })).text();
  console.log("len:", listaHtml.length);

  // Buscar inputs/filtros
  const inputs = [...listaHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  console.log("Inputs:", inputs.filter(i => /fil_|accion|lib_nid/i.test(i)).join(", "));

  // Buscar función nuevo()
  const scripts = [...listaHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(s => s[1]).join("\n");
  const nuevoFn = scripts.match(/function\s+nuevo\s*\(\s*\)\s*\{[\s\S]*?\n\s*\}/);
  console.log("\nfunction nuevo():", nuevoFn ? nuevoFn[0] : "(no encontrada)");

  // Buscar primeras filas
  const rows = [...listaHtml.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("\nPrimeras 3 filas:");
  for (const row of rows.slice(0, 3)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    console.log("  " + cells.filter(Boolean).slice(0, 8).join(" | "));
  }

  // 2. Cargar formulario (crear nuevo)
  console.log("\n\n=== formulario.php ===");
  const formHtml = await (await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ accion: "N" }).toString()
  })).text();
  console.log("len:", formHtml.length);

  // Inputs del formulario
  const formInputs = [...formHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)];
  console.log("\nInputs relevantes:");
  for (const inp of formInputs) {
    const name = inp[1];
    const value = (inp[0].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const type = (inp[0].match(/type\s*=\s*["']([^"']+)["']/i) || [])[1] || "text";
    if (!name.startsWith("guardado") && !name.startsWith("docu_") && value) {
      console.log(`  ${name} (${type}) = ${value}`);
    } else if (/cli_|lib_|accion|comando|sof_|monto|fecha|despacho/i.test(name)) {
      console.log(`  ${name} (${type}) = ${value || "(vacío)"}`);
    }
  }

  // Selects
  const selects = [...formHtml.matchAll(/<select[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)];
  console.log("\nSelects:");
  for (const s of selects.slice(0, 10)) {
    const options = [...s[2].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)].slice(0, 5);
    console.log(`  ${s[1]}: ${options.map(o => `${o[1]}="${o[2].trim()}"`).join(", ")}`);
  }

  // Form action
  const formAction = formHtml.match(/<form[^>]*action\s*=\s*["']([^"']+)["']/i);
  console.log("\nForm action:", formAction ? formAction[1] : "(no encontrada)");

  // Buscar links a PDF/imprimir
  const pdfLinks = [...formHtml.matchAll(/href\s*=\s*["']([^"']*(?:pdf|imprimir|print)[^"']*)["']/gi)];
  console.log("\nPDF links:", pdfLinks.map(l => l[1]).slice(0, 5));

  // Buscar en la lista links a PDF
  const listaPdfLinks = [...listaHtml.matchAll(/href\s*=\s*["']([^"']*(?:pdf|imprimir|print|reporte)[^"']*)["']/gi)];
  console.log("\nLista PDF links:", listaPdfLinks.map(l => l[1]).slice(0, 5));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
