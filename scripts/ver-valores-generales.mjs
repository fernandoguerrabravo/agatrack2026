#!/usr/bin/env node
/** Ver estado actual de Valores Generales y Destino de una operación */
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

function extractFields(html) {
  const f = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "button") continue;
    f[name] = value;
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

  // VALORES GENERALES
  console.log("=== VALORES GENERALES (din_valores_generales.php) ===\n");
  const vgUrl = `${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const vgHtml = await (await fetch(vgUrl, { headers: { Cookie: ck } })).text();
  const vg = extractFields(vgHtml);
  const vgKeys = ["term_compra", "moneda_desc", "dus_peso_bruto_total", "dus_total_neto_item", "dus_total_neto_factura",
    "dus_total_valor_fob_fac", "dus_total_valor_fob", "dus_valor_flete_fac", "dus_valor_flete",
    "dus_valor_seguro_fac", "dus_valor_seguro", "dus_valor_cif_fac", "dus_valor_cif",
    "dus_valor_flete_mon", "dus_valor_flete_paridad", "dus_valor_seguro_mon", "dus_valor_seguro_paridad",
    "dus_cod_flete_teorico", "dus_cod_seguro_teorico", "recalcular"];
  vgKeys.forEach(k => { if (vg[k] !== undefined) console.log(`  ${k} = "${vg[k]}"`); });

  // DESTINO
  console.log("\n\n=== DESTINO (dus_destino.php) — campos clave ===\n");
  const destUrl = `${BASE}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const destHtml = await (await fetch(destUrl, { headers: { Cookie: ck } })).text();
  const dest = extractFields(destHtml);
  const destKeys = ["pai_id_origen", "pai_id_adquisicion", "via_id", "pue_id", "pue_nombre",
    "pue_id2", "pue_nombre2", "din_transbordo", "nav_id", "nav_nombre",
    "cia_id", "dus_nombre_cia_transp", "pai_idcia", "dus_rut_cia_transp",
    "tic_id", "din_manifiesto1", "din_fec_manifiesto",
    "cia_id_emisora", "dus_emisor_docto_transp", "cia_emisora_rut",
    "din_nro_docto_transp", "din_fec_docto_transp", "alm_id"];
  destKeys.forEach(k => { if (dest[k] !== undefined) console.log(`  ${k} = "${dest[k]}"`); });

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
