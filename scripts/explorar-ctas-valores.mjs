#!/usr/bin/env node
/** Explora dus_ctas_valores.php — Cuentas y Valores */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = process.argv[2] || "190248";

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

function extractFields(html) {
  const f = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "button") continue;
    if (type === "checkbox" || type === "radio") {
      if (/checked/i.test(tag)) f[name] = value || "1";
    } else {
      f[name] = value;
    }
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    f[name] = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
  }
  return f;
}

(async () => {
  const ck = await login();
  console.log("Login OK\n");

  // 1. Cargar página
  const url = `${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(url, { headers: { Cookie: ck } })).text();
  console.log(`dus_ctas_valores.php — status: 200 | len: ${html.length}\n`);

  // Inputs
  console.log("=== INPUTS ===");
  const seen = new Set();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || seen.has(name) || name === "modulo_seleccion[]") continue;
    seen.add(name);
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "button") {
      console.log(`  [BUTTON] ${name} = "${value}"`);
    } else {
      console.log(`  [${type}] ${name} = "${value.slice(0, 80)}"`);
    }
  }

  // JS functions
  console.log("\n=== JS FUNCTIONS ===");
  const fns = [...html.matchAll(/function\s+(\w+)\s*\([^)]*\)/gi)].map(m => m[1]);
  console.log(" ", fns.join(", "));

  // Buscar función traer_cuentas o similar
  console.log("\n=== FUNCIÓN traer_cuentas / traeCuentas ===");
  for (const fn of ["traer_cuentas", "traeCuentas", "trae_cuentas", "cargar_cuentas"]) {
    const idx = html.indexOf("function " + fn);
    if (idx >= 0) {
      console.log(html.slice(idx, idx + 1500).replace(/\t/g, " ").replace(/ {2,}/g, " "));
      break;
    }
  }

  // Buscar botón "Traer Cuentas"
  console.log("\n=== BOTONES ===");
  const btns = [...html.matchAll(/<input[^>]*type\s*=\s*["']button["'][^>]*/gi)];
  btns.forEach(m => console.log("  ", m[0].replace(/\s+/g, " ").trim().slice(0, 150)));

  // Buscar onclick con traer/cuentas
  const onclicks = [...html.matchAll(/onclick\s*=\s*["'][^"']*["']/gi)].filter(m => /cuentas|traer|cargar/i.test(m[0]));
  console.log("\n=== onclick con cuentas/traer ===");
  onclicks.forEach(m => console.log("  ", m[0].slice(0, 150)));

  // Buscar aceptar
  console.log("\n=== FUNCIÓN aceptar() ===");
  const aIdx = html.indexOf("function aceptar");
  if (aIdx >= 0) {
    console.log(html.slice(aIdx, aIdx + 800).replace(/\t/g, " ").replace(/ {2,}/g, " "));
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
