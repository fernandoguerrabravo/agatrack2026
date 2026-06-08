#!/usr/bin/env node
/** Explora el popup dus_bulto.php para entender cómo se graban las líneas de bultos */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = process.argv[2] || "190276";

function pc(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const j = {};
  for (const l of raw) { const f = l.split(";")[0]; const e = f.indexOf("="); if (e > 0) { const k = f.slice(0, e).trim(); const v = f.slice(e + 1).trim(); if (v && v !== "deleted") j[k] = v; } }
  return Object.entries(j).map(([k, v]) => k + "=" + v).join("; ");
}
async function login() {
  const lp = await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`, { redirect: "manual" });
  const bc = pc(lp);
  const b = new URLSearchParams(); b.set("login", LOGIN); b.set("clave", CLAVE);
  const v = await fetch(`${BASE}/modulos/usuarios/validar.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/modulos/usuarios/login.php?status=-1`, Cookie: bc }, body: b.toString(), redirect: "manual" });
  return [bc, pc(v)].filter(Boolean).join("; ");
}

(async () => {
  const ck = await login();
  console.log("Login OK\n");

  // GET dus_bulto.php
  const url = `${BASE}/modulos/din/dus_encabezado/dus_bulto.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2`;
  const r = await fetch(url, { headers: { Cookie: ck } });
  const html = await r.text();
  console.log(`dus_bulto.php — status: ${r.status} | len: ${html.length}\n`);

  // Buscar función enviar/grabar
  console.log("=== Funciones JS ===");
  const fns = [...html.matchAll(/function\s+(\w+)\s*\([^)]*\)/gi)].map(m => m[1]);
  console.log(" ", fns.join(", "));

  // Buscar función enviar
  for (const fn of ["enviar", "grabar", "aceptar", "guardar"]) {
    const idx = html.indexOf("function " + fn);
    if (idx >= 0) {
      console.log(`\n=== function ${fn}() ===`);
      console.log(html.slice(idx, idx + 2000).replace(/\t/g, " ").replace(/ {2,}/g, " "));
    }
  }

  // Buscar form action
  console.log("\n=== FORM ===");
  const formMatch = html.match(/<form[^>]*>/i);
  if (formMatch) console.log(formMatch[0]);

  // Buscar inputs existentes (lineas ya grabadas)
  console.log("\n=== Inputs con bul_ ===");
  for (const m of html.matchAll(/<input\b[^>]*name\s*=\s*["']?(bul_[^"'\s>]+)/gi)) {
    const tag = m[0];
    const name = m[1];
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (value) console.log(`  ${name} = "${value}"`);
  }

  // Ver la op 190248 para comparar (tiene datos)
  console.log("\n\n=== Op 190248 (referencia) ===");
  const url2 = `${BASE}/modulos/din/dus_encabezado/dus_bulto.php?lib_base=1&lib_nid=190248&lbac_nid=0&dus_tipo_envio=2`;
  const r2 = await fetch(url2, { headers: { Cookie: ck } });
  const html2 = await r2.text();
  console.log(`dus_bulto.php 190248 — len: ${html2.length}`);
  for (const m of html2.matchAll(/<input\b[^>]*name\s*=\s*["']?(bul_[^"'\s>]+)/gi)) {
    const tag = m[0];
    const name = m[1];
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (value) console.log(`  ${name} = "${value}"`);
  }
  // hidden lineas
  const lineasMatch = html2.match(/name\s*=\s*["']lineas["'][^>]*value\s*=\s*["'](\d+)["']/i);
  console.log("  lineas:", lineasMatch ? lineasMatch[1] : "(no encontrado)");

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
