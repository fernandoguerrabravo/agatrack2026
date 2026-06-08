#!/usr/bin/env node
/** Explora dus_antecedentes.php — módulo Antecedentes Financieros */
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

(async () => {
  const ck = await login();
  console.log("Login OK\n");

  const url = `${BASE}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const r = await fetch(url, { headers: { Cookie: ck } });
  const html = await r.text();
  console.log(`dus_antecedentes.php — status: ${r.status} | len: ${html.length}`);
  fs.writeFileSync(path.join(__dirname, "dus_antecedentes_dump.html"), html);
  console.log("HTML guardado.\n");

  // INPUTS
  console.log("=== INPUTS ===");
  const seen = new Set();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || seen.has(name) || name === "modulo_seleccion[]") continue;
    seen.add(name);
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const ro = /readonly|disabled/i.test(tag) ? " [RO]" : "";
    console.log(`  [${type}] ${name} = "${value.slice(0, 80)}"${ro}`);
  }

  // SELECTS con todas sus opciones
  console.log("\n=== SELECTS ===");
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const selected = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
    const opts = [...m[2].matchAll(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*>([^<]*)/gi)];
    console.log(`  [select] ${name} = "${selected}" (${opts.length} opciones)`);
    opts.forEach(o => console.log(`    ${o[1]} = ${o[2].trim()}`));
  }

  // TEXTAREAS
  console.log("\n=== TEXTAREAS ===");
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (name) console.log(`  [textarea] ${name} = "${m[2].trim().slice(0, 200)}"`);
  }

  // JS FUNCTIONS
  console.log("\n=== JS FUNCTIONS ===");
  const fns = [...html.matchAll(/function\s+(\w+)\s*\([^)]*\)/gi)].map(m => m[1]);
  console.log(" ", fns.join(", "));

  // FORM ACTION
  console.log("\n=== FORM ACTION ===");
  const formActions = [...html.matchAll(/<form\b[^>]*action\s*=\s*["']([^"']*)["'][^>]*/gi)];
  formActions.forEach(m => console.log(`  action="${m[1]}"`));

  // Buscar la función aceptar
  console.log("\n=== FUNCIÓN aceptar() ===");
  const idx = html.indexOf("function aceptar");
  if (idx >= 0) {
    console.log(html.slice(idx, idx + 1500).replace(/\t/g, " ").replace(/ {2,}/g, " "));
  } else {
    console.log("  (no encontrada)");
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
