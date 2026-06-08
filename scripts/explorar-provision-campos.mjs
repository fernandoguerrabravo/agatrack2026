#!/usr/bin/env node
/**
 * Explorar todos los campos que envía el formulario de provisión para entender por qué no se graban los montos.
 * Comparar con la provisión existente (04/06) que sí tiene montos.
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

  // Cargar formulario con datos precargados
  const formHtml = await (await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ lib_nid: "190153", lib_base: "1", accion: "N" }).toString()
  })).text();

  // Buscar la función grabar/aceptar en el JS
  const scripts = [...formHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(s => s[1]).join("\n");
  
  // Buscar función que hace submit
  const grabarFn = scripts.match(/function\s+grabar\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  const aceptarFn = scripts.match(/function\s+aceptar\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  const validarFn = scripts.match(/function\s+validar\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  
  console.log("=== function grabar ===");
  console.log(grabarFn ? grabarFn[0].substring(0, 800) : "(no)");
  console.log("\n=== function aceptar ===");
  console.log(aceptarFn ? aceptarFn[0].substring(0, 800) : "(no)");
  console.log("\n=== function validar ===");
  console.log(validarFn ? validarFn[0].substring(0, 800) : "(no)");

  // Buscar botón de aceptar/grabar
  const btnAceptar = formHtml.match(/onclick\s*=\s*["']([^"']*(?:grabar|aceptar|validar)[^"']*)["']/gi);
  console.log("\nBotones onclick:", btnAceptar ? btnAceptar.slice(0, 5) : "(no)");

  // Buscar campos hidden que pueden estar calculados por JS
  const hiddenFields = [...formHtml.matchAll(/<input[^>]*type\s*=\s*["']hidden["'][^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']*)["']/gi)];
  console.log("\nHidden fields con valor:");
  for (const h of hiddenFields) {
    if (h[2] && !h[1].startsWith("modulo_")) console.log(`  ${h[1]} = ${h[2]}`);
  }

  // Buscar MontoTotal y campos de suma
  const montoFields = [...formHtml.matchAll(/name\s*=\s*["'](.*(?:Monto|Total|suma|linea_suma)[^"']*)["']/gi)];
  console.log("\nCampos Monto/Total:");
  for (const m of montoFields) {
    const ctx = formHtml.substring(formHtml.indexOf(m[0]) - 10, formHtml.indexOf(m[0]) + 100);
    const val = (ctx.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    console.log(`  ${m[1]} = "${val}"`);
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
