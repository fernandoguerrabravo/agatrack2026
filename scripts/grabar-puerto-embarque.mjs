#!/usr/bin/env node
/** Graba solo el puerto de embarque en Destino — Op 190276 */
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
    if (type === "checkbox" || type === "radio") { if (/checked/i.test(tag)) f[name] = value || "1"; }
    else f[name] = value;
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    f[name] = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (name) f[name] = m[2].trim();
  }
  return f;
}

(async () => {
  console.log(`\n=== GRABAR PUERTO EMBARQUE — Op ${OP} ===\n`);
  const ck = await login();
  console.log("✅ Login OK\n");

  // 1. Cargar destino completo
  const destUrl = `${BASE}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const destHtml = await (await fetch(destUrl, { headers: { Cookie: ck } })).text();
  const df = extractFields(destHtml);

  console.log("Antes:");
  console.log("  pue_id:", df.pue_id);
  console.log("  pue_nombre:", df.pue_nombre);
  console.log("  dus_puerto_embarque_glosa:", df.dus_puerto_embarque_glosa);

  // 2. Setear puerto embarque = CALLAO (252)
  df.pue_id = "252";
  df.pue_nombre = "CALLAO";
  df.dus_puerto_embarque_glosa = "CALLAO";
  df.pue_adic = "0";
  df.comando = "U";

  console.log("\nGrabando: pue_id=252, pue_nombre=CALLAO, glosa=CALLAO");

  // 3. POST
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(df)) body.set(k, v ?? "");
  const r = await fetch(destUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: destUrl },
    body: body.toString(),
    redirect: "manual",
  });
  console.log("POST:", r.status);

  // 4. Verificar
  const destHtml2 = await (await fetch(destUrl, { headers: { Cookie: ck } })).text();
  const df2 = extractFields(destHtml2);
  console.log("\nDespués:");
  console.log("  pue_id:", df2.pue_id);
  console.log("  pue_nombre:", df2.pue_nombre);
  console.log("  dus_puerto_embarque_glosa:", df2.dus_puerto_embarque_glosa);

  const ok = df2.pue_id === "252" && df2.pue_nombre === "CALLAO";
  console.log("\n" + (ok ? "✅ Puerto embarque OK" : "⚠️ Revisar"));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
