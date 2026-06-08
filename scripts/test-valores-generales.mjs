#!/usr/bin/env node
/** Test: grabar Valores Generales con recalcular=1 y verificar */
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
    if (type === "checkbox" || type === "radio") { if (/checked/i.test(tag)) f[name] = value || "1"; }
    else f[name] = value;
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

  // 1. Cargar form
  const vgUrl = `${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(vgUrl, { headers: { Cookie: ck } })).text();
  const f = extractFields(html);

  console.log("Antes:");
  console.log("  FOB:", f.dus_total_valor_fob, "| Flete:", f.dus_valor_flete, "| CIF:", f.dus_valor_cif);

  // 2. Setear valores
  f.term_compra = "2"; // CFR
  f.moneda_desc = "13";
  f.dus_peso_bruto_total = "11610";
  f.dus_total_neto_item = "24331";
  f.dus_total_neto_factura = "24331";
  f.dus_total_valor_fob_fac = "20736";
  f.dus_total_valor_fob = "20736";
  f.dus_valor_flete_fac = "3595";
  f.dus_valor_flete = "3595";
  f.dus_valor_flete_mon = "13";
  f.dus_valor_flete_paridad = "1";
  f.dus_valor_seguro_fac = "13.38";
  f.dus_valor_seguro = "13.38";
  f.dus_valor_seguro_mon = "13";
  f.dus_valor_seguro_paridad = "1";
  f.dus_valor_cif_fac = "24344.38";
  f.dus_valor_cif = "24344.38";
  f.recalcular = "1";
  f.comando = "M";

  // 3. POST a grabar.php
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) body.set(k, v ?? "");

  console.log("\nPOST a grabar.php...");
  const grabarUrl = `${BASE}/modulos/din/dus_encabezado/grabar.php`;
  const r = await fetch(grabarUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: vgUrl },
    body: body.toString(),
    redirect: "manual",
  });
  console.log("  Status:", r.status);
  console.log("  Location:", r.headers.get("location") || "(none)");

  // 4. Verificar
  const html2 = await (await fetch(vgUrl, { headers: { Cookie: ck } })).text();
  const f2 = extractFields(html2);
  console.log("\nDespués:");
  console.log("  FOB:", f2.dus_total_valor_fob, "| Flete:", f2.dus_valor_flete, "| CIF:", f2.dus_valor_cif);
  console.log("  Peso:", f2.dus_peso_bruto_total, "| Neto factura:", f2.dus_total_neto_factura);

  const ok = f2.dus_total_valor_fob === "20736" && f2.dus_valor_flete === "3595" && f2.dus_valor_cif === "24344.38";
  console.log("\n" + (ok ? "✅ OK" : "⚠️ NO SE GRABÓ"));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
