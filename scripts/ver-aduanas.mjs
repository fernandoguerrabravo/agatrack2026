#!/usr/bin/env node
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

  const formRes = await fetch(BASE + "/modulos/comex/orden_compra/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ accion: "N" }).toString()
  });
  const html = await formRes.text();

  // Extraer TODAS las opciones del select sel_adu_id
  const aduSelect = html.match(/<select[^>]*name\s*=\s*["']sel_adu_id["'][^>]*>([\s\S]*?)<\/select>/i);
  if (aduSelect) {
    const options = [...aduSelect[1].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)];
    console.log("=== Aduanas (sel_adu_id) ===");
    for (const o of options) {
      console.log(`  ${o[1]} = ${o[2].trim()}`);
    }
  }

  // También extraer sel_tio_id completo
  const tioSelect = html.match(/<select[^>]*name\s*=\s*["']sel_tio_id["'][^>]*>([\s\S]*?)<\/select>/i);
  if (tioSelect) {
    const options = [...tioSelect[1].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)];
    console.log("\n=== Tipos Operación (sel_tio_id) ===");
    for (const o of options) {
      console.log(`  ${o[1]} = ${o[2].trim()}`);
    }
  }

  // Extraer sel_emp_id
  const empSelect = html.match(/<select[^>]*name\s*=\s*["']sel_emp_id["'][^>]*>([\s\S]*?)<\/select>/i);
  if (empSelect) {
    const options = [...empSelect[1].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)];
    console.log("\n=== Agentes (sel_emp_id) ===");
    for (const o of options) {
      console.log(`  ${o[1]} = ${o[2].trim()}`);
    }
  }

  // Extraer sel_ejecutivo_id
  const ejeSelect = html.match(/<select[^>]*name\s*=\s*["']sel_ejecutivo_id["'][^>]*>([\s\S]*?)<\/select>/i);
  if (ejeSelect) {
    const options = [...ejeSelect[1].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([^<]*)/gi)];
    console.log("\n=== Ejecutivos (sel_ejecutivo_id) ===");
    for (const o of options) {
      console.log(`  ${o[1]} = ${o[2].trim()}`);
    }
  }
})().catch(e => { console.error("ERROR:", e); process.exit(1); });
