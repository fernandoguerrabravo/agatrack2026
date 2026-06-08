#!/usr/bin/env node
/**
 * Explorar nuevo.php del módulo provisión de fondos.
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

  // Cargar nuevo.php (sin parámetros primero para ver qué pide)
  console.log("=== nuevo.php (GET) ===");
  const nuevoHtml = await (await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/nuevo.php", { headers: { Cookie: ck } })).text();
  console.log("len:", nuevoHtml.length);

  // Buscar si pide lib_nid
  const libNidRef = nuevoHtml.match(/lib_nid/gi);
  console.log("Refs a lib_nid:", libNidRef ? libNidRef.length : 0);

  // Buscar formulario
  const formAction = nuevoHtml.match(/<form[^>]*action\s*=\s*["']([^"']+)["']/i);
  console.log("Form action:", formAction ? formAction[1] : "(no)");

  // Inputs
  const inputs = [...nuevoHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)];
  console.log("\nInputs:");
  for (const inp of inputs.slice(0, 20)) {
    const name = inp[1];
    const value = (inp[0].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (/lib_|cli_|accion|despacho|cheque|imprimir|email/i.test(name) || value) {
      console.log(`  ${name} = "${value}"`);
    }
  }

  // Ahora probar con lib_nid=190153 (Petroquímica aprobada)
  console.log("\n\n=== nuevo.php?lib_nid=190153 ===");
  const nuevoConOp = await (await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/nuevo.php?lib_nid=190153&lib_base=1", { headers: { Cookie: ck } })).text();
  console.log("len:", nuevoConOp.length);

  // Buscar campos precargados
  const precargados = [...nuevoConOp.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']+)["']/gi)];
  console.log("\nCampos precargados (con valor):");
  for (const inp of precargados) {
    const name = inp[1];
    const value = inp[2];
    if (!name.startsWith("modulo_") && value && value !== "0" && value !== "0,00" && value !== "0,0000") {
      console.log(`  ${name} = ${value}`);
    }
  }

  // Buscar selects relevantes
  const selects = [...nuevoConOp.matchAll(/<select[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)];
  for (const s of selects) {
    if (/cheque|leyenda|pago/i.test(s[1])) {
      const selected = s[2].match(/<option[^>]*selected[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/i);
      const options = [...s[2].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)].slice(0, 5);
      console.log(`\n${s[1]} [selected=${selected ? selected[1] : "none"}]:`);
      for (const o of options) console.log(`  ${o[1]} = ${o[2].trim()}`);
    }
  }

  // Buscar form action
  const formAction2 = nuevoConOp.match(/<form[^>]*action\s*=\s*["']([^"']+)["']/i);
  console.log("\nForm action:", formAction2 ? formAction2[1] : "(no)");

  // Buscar botón aceptar/grabar
  const submitBtns = [...nuevoConOp.matchAll(/onclick\s*=\s*["']([^"']*(?:submit|grabar|aceptar|guardar)[^"']*)["']/gi)];
  console.log("\nSubmit buttons:");
  for (const b of submitBtns.slice(0, 5)) console.log("  " + b[1].substring(0, 150));

  // Buscar función grabar en JS
  const scripts = [...nuevoConOp.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(s => s[1]).join("\n");
  const grabarFn = scripts.match(/function\s+(?:grabar|aceptar|guardar)\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/);
  if (grabarFn) console.log("\nfunction grabar:", grabarFn[0].substring(0, 500));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
