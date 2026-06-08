#!/usr/bin/env node
/**
 * Explorar formulario de creación de nueva operación y función agregar().
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

  // 1. Extraer JS de lista.php para ver funciones nuevo() y agregar()
  const listaHtml = await (await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } })).text();
  
  // Buscar función nuevo()
  const nuevoMatch = listaHtml.match(/function\s+nuevo\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  console.log("=== function nuevo() ===");
  console.log(nuevoMatch ? nuevoMatch[0] : "(no encontrada)");

  // Buscar función agregar()
  const agregarMatch = listaHtml.match(/function\s+agregar\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  console.log("\n=== function agregar() ===");
  console.log(agregarMatch ? agregarMatch[0] : "(no encontrada)");

  // 2. Cargar formulario.php para ver los campos de creación
  console.log("\n\n=== formulario.php (nueva operación) ===");
  const formHtml = await (await fetch(BASE + "/modulos/comex/orden_compra/formulario.php", { headers: { Cookie: ck } })).text();
  console.log("len:", formHtml.length);

  // Extraer campos del formulario
  const formInputs = [...formHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)];
  console.log("\nInputs:", formInputs.map(i => {
    const name = i[1];
    const value = (i[0].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const type = (i[0].match(/type\s*=\s*["']([^"']+)["']/i) || [])[1] || "text";
    return `${name} (${type}${value ? "=" + value : ""})`;
  }).join("\n  "));

  const formSelects = [...formHtml.matchAll(/<select[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)];
  console.log("\nSelects:");
  for (const s of formSelects) {
    const options = [...s[2].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)].slice(0, 5);
    console.log(`  ${s[1]}: ${options.map(o => `${o[1]}="${o[2].trim()}"`).join(", ")}${options.length >= 5 ? "..." : ""}`);
  }

  // Buscar la acción del form
  const formAction = formHtml.match(/<form[^>]*action\s*=\s*["']([^"']+)["']/i);
  console.log("\nForm action:", formAction ? formAction[1] : "(no encontrada)");
  
  // Buscar comando de guardar
  const comando = formHtml.match(/name\s*=\s*["']comando["'][^>]*value\s*=\s*["']([^"']+)["']/i);
  console.log("Comando:", comando ? comando[1] : "(no encontrado)");

  // Buscar JS del formulario
  const scriptBlocks = [...formHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(s => s[1]).join("\n");
  const grabarFn = scriptBlocks.match(/function\s+(?:grabar|guardar|aceptar)\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  console.log("\n=== function grabar/guardar ===");
  console.log(grabarFn ? grabarFn[0].substring(0, 500) : "(no encontrada)");

  // Buscar tabla con últimas operaciones en la lista
  // Extraer datos de la tabla: buscar pattern agregar(xxx) 
  const agregarCalls = [...listaHtml.matchAll(/agregar\(\s*['"]?(\d+)['"]?\s*\)/gi)].slice(0, 5);
  console.log("\n\n=== Últimas operaciones (agregar calls) ===");
  for (const call of agregarCalls) {
    console.log("  Op:", call[1]);
  }

  // Extraer una fila completa para ver la estructura
  const rowPattern = /agregar\(\s*['"]?(\d+)['"]?\s*\)[\s\S]*?<\/tr>/gi;
  const firstRow = listaHtml.match(/<tr[^>]*>[\s\S]*?agregar\(\s*['"]?\d+['"]?\s*\)[\s\S]*?<\/tr>/i);
  if (firstRow) {
    const cells = [...firstRow[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]*>/g, "").trim());
    console.log("\nEjemplo fila completa:", cells.join(" | "));
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
