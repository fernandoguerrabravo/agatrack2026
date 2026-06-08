#!/usr/bin/env node
/**
 * Explora cómo crear una nueva operación en AduanaNet.
 * Flujo: nuevo() → formulario.php → grabar.php → lib_nid generado
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
  const sc = r1.headers.getSetCookie?.() || [r1.headers.get("set-cookie")].filter(Boolean);
  let ck = sc.map(c => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ login: LOGIN, clave: CLAVE });
  const r2 = await fetch(BASE + "/modulos/usuarios/validar.php", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: body.toString(), redirect: "manual"
  });
  const sc2 = r2.headers.getSetCookie?.() || [r2.headers.get("set-cookie")].filter(Boolean);
  ck = [ck, ...sc2.map(c => c.split(";")[0])].join("; ");
  return ck;
}

(async () => {
  const ck = await login();
  console.log("Login OK\n");

  // 1. Extraer function nuevo() del listado
  const listaHtml = await (await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } })).text();
  
  // Buscar JS completo entre <script> tags
  const scripts = [...listaHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(s => s[1]).join("\n");
  
  // Buscar function nuevo
  const nuevoFn = scripts.match(/function\s+nuevo\s*\(\s*\)\s*\{[\s\S]*?\n\s*\}/);
  console.log("=== function nuevo() ===");
  console.log(nuevoFn ? nuevoFn[0] : "(buscando de otra forma...)");
  
  // Si no encuentra, buscar onclick con nuevo
  if (!nuevoFn) {
    const nuevoRef = listaHtml.match(/nuevo[^"']*["'][^"']*formulario[^"']*/i);
    console.log("Ref nuevo:", nuevoRef ? nuevoRef[0] : "(no encontrado)");
  }

  // 2. Cargar formulario.php directamente (sin parámetros = crear nuevo)
  console.log("\n\n=== formulario.php (crear nuevo) ===");
  const formUrl = BASE + "/modulos/comex/orden_compra/formulario.php";
  const formHtml = await (await fetch(formUrl, { headers: { Cookie: ck } })).text();
  console.log("len:", formHtml.length);

  // Extraer el form action
  const formAction = formHtml.match(/<form[^>]*action\s*=\s*["']([^"']+)["']/i);
  console.log("Form action:", formAction ? formAction[1] : "(inline)");
  
  // Extraer el name del form
  const formName = formHtml.match(/<form[^>]*name\s*=\s*["']([^"']+)["']/i);
  console.log("Form name:", formName ? formName[1] : "(no name)");

  // Inputs con sus valores por defecto
  const inputs = [...formHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)];
  console.log("\nInputs relevantes:");
  for (const inp of inputs) {
    const name = inp[1];
    const value = (inp[0].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const type = (inp[0].match(/type\s*=\s*["']([^"']+)["']/i) || [])[1] || "text";
    if (type === "hidden" || name.startsWith("orc_") || name.startsWith("cli_") || name.startsWith("lib_") || name === "comando" || name === "accion") {
      console.log(`  ${name} = "${value}" (${type})`);
    }
  }

  // Selects clave: cli_id (cliente)
  const cliSelect = formHtml.match(/<select[^>]*name\s*=\s*["']cli_id["'][^>]*>([\s\S]*?)<\/select>/i);
  if (cliSelect) {
    const options = [...cliSelect[1].matchAll(/<option[^>]*value\s*=\s*["'](\d+)["'][^>]*>([^<]*)/gi)].slice(0, 10);
    console.log("\ncli_id options (primeros 10):");
    for (const o of options) console.log(`  ${o[1]} = ${o[2].trim()}`);
  }

  // Buscar campo tipo_operacion o tio_id
  const tioSelect = formHtml.match(/<select[^>]*name\s*=\s*["'](?:tio_id|tipo_operacion|orc_tipo)["'][^>]*>([\s\S]*?)<\/select>/i);
  if (tioSelect) {
    const options = [...tioSelect[1].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)].slice(0, 10);
    console.log("\ntipo operacion options:");
    for (const o of options) console.log(`  ${o[1]} = ${o[2].trim()}`);
  }

  // Buscar JS con grabar/aceptar  
  const formScripts = [...formHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(s => s[1]).join("\n");
  const grabarFn = formScripts.match(/function\s+(?:grabar|aceptar|guardar)\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  console.log("\n=== function grabar/aceptar ===");
  console.log(grabarFn ? grabarFn[0].substring(0, 800) : "(no encontrada directamente)");

  // Buscar submits
  const submitBtns = [...formHtml.matchAll(/(?:onclick|href)\s*=\s*["']([^"']*(?:grabar|aceptar|guardar|submit)[^"']*)["']/gi)];
  console.log("\nSubmit references:");
  for (const s of submitBtns) console.log("  ", s[1].substring(0, 100));

  // Buscar qué pasa al guardar — ¿redirecciona con lib_nid?
  const redirectPattern = formScripts.match(/(?:location|href|url)\s*[=+]\s*[^;]*(?:lib_nid|orc_id|formulario|lista)/gi);
  console.log("\nRedirect patterns:", redirectPattern ? redirectPattern.slice(0, 5) : "(none)");

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
