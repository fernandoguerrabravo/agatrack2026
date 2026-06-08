#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");

function pc(res) { const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : []; const j = {}; for (const l of raw) { const f = l.split(";")[0]; const e = f.indexOf("="); if (e > 0) { const k = f.slice(0, e).trim(); const v = f.slice(e + 1).trim(); if (v && v !== "deleted") j[k] = v; } } return Object.entries(j).map(([k, v]) => k + "=" + v).join("; "); }
async function login() { const lp = await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`, { redirect: "manual" }); const bc = pc(lp); const b = new URLSearchParams(); b.set("login", LOGIN); b.set("clave", CLAVE); const v = await fetch(`${BASE}/modulos/usuarios/validar.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/modulos/usuarios/login.php?status=-1`, Cookie: bc }, body: b.toString(), redirect: "manual" }); return [bc, pc(v)].filter(Boolean).join("; "); }

(async () => {
  const ck = await login();
  // Cargar mercancia form para 190240
  const url = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php?lib_base=1&lib_nid=190240&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(url, { headers: { Cookie: ck } })).text();
  
  // Verificar select linea (ítems existentes)
  const lineaMatch = html.match(/<select[^>]*name\s*=\s*['"]linea['"][^>]*>([\s\S]*?)<\/select>/i);
  const items = lineaMatch ? [...lineaMatch[1].matchAll(/<option[^>]*value\s*=\s*['"](\d+)['"]/gi)] : [];
  console.log("Items existentes:", items.length);
  
  // Ver cli_id del hidden
  const cliId = (html.match(/name\s*=\s*["']empl_id["'][^>]*value\s*=\s*["']([^"']*)["']/i) || [])[1];
  console.log("empl_id:", cliId);
  
  // Ver mer_total_neto hidden
  const merTotalNeto = (html.match(/name\s*=\s*["']mer_total_neto["'][^>]*value\s*=\s*["']([^"']*)["']/i) || [])[1];
  console.log("mer_total_neto:", merTotalNeto);
  
  // Ver cif_neto y fob_neto
  const cifNeto = (html.match(/name\s*=\s*["']cif_neto["'][^>]*value\s*=\s*["']([^"']*)["']/i) || [])[1];
  const fobNeto = (html.match(/name\s*=\s*["']fob_neto["'][^>]*value\s*=\s*["']([^"']*)["']/i) || [])[1];
  console.log("cif_neto:", cifNeto);
  console.log("fob_neto:", fobNeto);
  console.log("dus_total_valor_fob:", (html.match(/name\s*=\s*["']dus_total_valor_fob["'][^>]*value\s*=\s*["']([^"']*)["']/i) || [])[1]);
  console.log("dus_valor_cif:", (html.match(/name\s*=\s*["']dus_valor_cif["'][^>]*value\s*=\s*["']([^"']*)["']/i) || [])[1]);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
