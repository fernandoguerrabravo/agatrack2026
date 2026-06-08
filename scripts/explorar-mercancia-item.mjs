#!/usr/bin/env node
/** Explora el ítem 1 del módulo din_mercancia — carga el item existente */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = process.argv[2] || "190248";
const ITEM = process.argv[3] || "1";

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

  // Cargar el item existente via ir_a(): POST con mer_nro_item=1, comando=M
  const url = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php`;
  const body = new URLSearchParams();
  body.set("lib_base", "1");
  body.set("lib_nid", OP);
  body.set("lbac_nid", "0");
  body.set("dus_tipo_envio", "2");
  body.set("mer_nro_item", ITEM);
  body.set("comando", "M");
  body.set("pagno", "0");

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: url },
    body: body.toString(),
  });
  const html = await r.text();
  console.log(`Item ${ITEM} — status: ${r.status} | len: ${html.length}\n`);

  // Extraer INPUTS con sus valores
  console.log("=== INPUTS ===");
  const seen = new Set();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || seen.has(name) || name === "modulo_seleccion[]") continue;
    seen.add(name);
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "hidden" && !value) continue; // skip empty hiddens for clarity
    console.log(`  [${type}] ${name} = "${value.slice(0, 100)}"`);
  }

  // SELECTS
  console.log("\n=== SELECTS ===");
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const selected = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
    const opts = [...m[2].matchAll(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*>([^<]*)/gi)];
    console.log(`  [select] ${name} = "${selected}" (${opts.length} opts)`);
  }

  // Datos del item existente?
  console.log("\n=== Datos clave del item ===");
  const extract = (n) => {
    const re = new RegExp('name\\s*=\\s*["\']' + n + '["\'][^>]*value\\s*=\\s*["\']([^"\']*)["\']', 'i');
    const re2 = new RegExp('value\\s*=\\s*["\']([^"\']*)["\'][^>]*name\\s*=\\s*["\']' + n + '["\']', 'i');
    return (html.match(re) || html.match(re2) || [])[1] || "(vacío)";
  };
  const fields = ["mer_cod_arancel", "mer_nombre", "mer_cantidad", "mer_fob_unitario", 
    "mer_valor_cif_item", "mer_porc_advalorem", "mer_monto_ajuste_item", "ume_id",
    "mer_nro_acuerdo_comercial", "mer_cod_arancel_tratado", "mer_producto",
    "mer_nro_correlativo_arancel", "mer_sujeto_cupo", "mer_nro_item",
    "mer_cod_obs1", "mer_obs1", "mer_porc_otro1", "mer_cod_otro1", "mer_monto_impto_otro1"];
  for (const f of fields) {
    console.log(`  ${f} = "${extract(f)}"`);
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
