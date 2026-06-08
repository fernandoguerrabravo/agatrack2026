#!/usr/bin/env node
/**
 * Explora el módulo de Orden de Compra en AduanaNet para entender cómo crear operaciones.
 * URL: /modulos/comex/orden_compra/lista.php
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

  // 1. Cargar lista.php
  console.log("=== /modulos/comex/orden_compra/lista.php ===");
  const listaHtml = await (await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } })).text();
  console.log("len:", listaHtml.length);
  
  // Buscar formularios
  const forms = [...listaHtml.matchAll(/<form[^>]*(?:action|id|name)\s*=\s*["']([^"']*)/gi)];
  console.log("\nForms:", forms.map(f => f[0]).join("\n  "));

  // Buscar selects (cliente, estado, etc.)
  const selects = [...listaHtml.matchAll(/<select[^>]*name\s*=\s*["']([^"']+)["'][^>]*>/gi)];
  console.log("\nSelects:", selects.map(s => s[1]).join(", "));

  // Buscar inputs
  const inputs = [...listaHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)];
  console.log("\nInputs:", inputs.map(i => i[1]).join(", "));

  // Buscar links con "crear" o "nuevo" o "agregar"
  const crearLinks = [...listaHtml.matchAll(/href\s*=\s*["']([^"']*(?:crear|nuevo|agregar|new|add|formulario)[^"']*)["']/gi)];
  console.log("\nLinks crear/nuevo:", crearLinks.map(l => l[1]).join("\n  "));

  // Buscar botones
  const buttons = [...listaHtml.matchAll(/<(?:button|input[^>]*type\s*=\s*["'](?:submit|button)["'])[^>]*(?:value|>)\s*=?\s*["']?([^"'<>]+)/gi)];
  console.log("\nButtons:", buttons.map(b => b[0].substring(0, 100)).join("\n  "));

  // Buscar tabla de datos (operaciones listadas)
  const tableRows = [...listaHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("\nTabla rows:", tableRows.length);
  
  // Mostrar las primeras filas para entender estructura
  if (tableRows.length > 0) {
    console.log("\nPrimeras 3 filas:");
    for (const row of tableRows.slice(0, 5)) {
      const cells = [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => c[1].replace(/<[^>]*>/g, "").trim());
      if (cells.length > 0) console.log("  ", cells.join(" | "));
    }
  }

  // Buscar JS con funciones de crear
  const jsFunctions = [...listaHtml.matchAll(/function\s+(\w*(?:crear|nuevo|agregar|add|abrir)\w*)/gi)];
  console.log("\nJS functions (crear/nuevo):", jsFunctions.map(f => f[1]).join(", "));

  // Buscar referencias a otros PHP
  const phpLinks = [...new Set([...listaHtml.matchAll(/["']([^"']*\.php[^"']*)/gi)].map(m => m[1]))];
  console.log("\nPHP links:", phpLinks.filter(l => l.includes("orden") || l.includes("comex") || l.includes("crear") || l.includes("formulario")).join("\n  "));

  // Buscar lib_nid o nro_operacion en la página
  const operaciones = [...listaHtml.matchAll(/(?:lib_nid|nro_operacion|operacion)\s*[=:]\s*["']?(\d{5,})/gi)];
  if (operaciones.length) console.log("\nOperaciones encontradas:", [...new Set(operaciones.map(o => o[1]))].slice(0, 10).join(", "));

  // Mostrar primeros 2000 chars para análisis
  console.log("\n=== HTML PREVIEW (primeros 3000 chars) ===");
  console.log(listaHtml.substring(0, 3000));
  
  console.log("\n=== HTML FINAL (últimos 2000 chars) ===");
  console.log(listaHtml.substring(listaHtml.length - 2000));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
