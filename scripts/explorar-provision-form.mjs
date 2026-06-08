#!/usr/bin/env node
/**
 * Explorar formulario.php de provisión de fondos con lib_nid=190153
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

  // Simular: nuevo.php pide lib_nid y hace submit a formulario.php
  // POST formulario.php con lib_nid=190153 y accion=N
  const formHtml = await (await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ lib_nid: "190153", lib_base: "1", accion: "N" }).toString()
  })).text();
  console.log("formulario.php len:", formHtml.length);

  // Campos con valor (precargados desde la DIN)
  const inputs = [...formHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']*)["']/gi)];
  console.log("\nCampos precargados:");
  for (const inp of inputs) {
    const name = inp[1];
    const value = inp[2];
    if (value && value !== "0" && value !== "0,00" && value !== "0,0000" && !name.startsWith("modulo_") && !name.startsWith("soga_")) {
      console.log(`  ${name} = ${value}`);
    }
  }

  // Campos de derechos (IVA, advalorem)
  console.log("\nDerechos:");
  for (const inp of inputs) {
    if (/d_sf_|cfac_|Monto/i.test(inp[1]) && inp[2] && inp[2] !== "0" && inp[2] !== "0,00" && inp[2] !== "0,0000") {
      console.log(`  ${inp[1]} = ${inp[2]}`);
    }
  }

  // Selects de forma de pago
  const selects = [...formHtml.matchAll(/<select[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)];
  for (const s of selects) {
    if (/leyenda|cheque|pago/i.test(s[1])) {
      const options = [...s[2].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)];
      console.log(`\n${s[1]}:`);
      for (const o of options) console.log(`  "${o[1]}" = ${o[2].trim()}`);
    }
  }

  // Checkboxes (email, imprimir, det)
  const checkboxes = [...formHtml.matchAll(/<input[^>]*type\s*=\s*["']checkbox["'][^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)];
  console.log("\nCheckboxes:");
  for (const cb of checkboxes) {
    const checked = /checked/i.test(cb[0]);
    console.log(`  ${cb[1]} ${checked ? "(checked)" : ""}`);
  }

  // Radio buttons
  const radios = [...formHtml.matchAll(/<input[^>]*type\s*=\s*["']radio["'][^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']*)["'][^>]*/gi)];
  console.log("\nRadios:");
  for (const r of radios) {
    const checked = /checked/i.test(r[0]);
    console.log(`  ${r[1]} = ${r[2]} ${checked ? "(checked)" : ""}`);
  }

  // Form action
  const formAction = formHtml.match(/<form[^>]*action\s*=\s*["']([^"']+)["']/i);
  console.log("\nForm action:", formAction ? formAction[1] : "(no)");

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
