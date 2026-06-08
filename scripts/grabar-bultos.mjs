#!/usr/bin/env node
/**
 * Graba módulo BULTOS (dus_desc_bulto.php) — Op 190248
 * 
 * Campos a llenar:
 * - din_id_bultos: contenedores + detalle de bultos
 * - din_obs_banco_sna: CO + Mandato FEA + M/N nave
 * - Los demás campos (peso, FOB, flete, seguro, CIF) vienen precargados
 * - Aceptar: comando=U
 */
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
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (name) f[name] = m[2].trim();
  }
  return f;
}

(async () => {
  console.log(`\n=== GRABAR BULTOS — Op ${OP} ===\n`);
  const ck = await login();
  console.log("✅ Login OK\n");

  // Cargar formulario
  const url = `${BASE}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(url, { headers: { Cookie: ck } })).text();
  const f = extractFields(html);
  console.log("Campos cargados:", Object.keys(f).length);
  console.log("  din_id_bultos actual:", JSON.stringify(f.din_id_bultos || "").slice(0, 100));
  console.log("  din_obs_banco_sna actual:", JSON.stringify(f.din_obs_banco_sna || "").slice(0, 150));

  // Datos de la operación 190248:
  // BL: 1 contenedor ZCSU7530471, 18 pallets, 18 octabins
  // Nave: MAERSK COLORADO (de ShipsGo/BL)
  // CO: S/N, fecha 22/04/2026

  // Llenar din_id_bultos
  f.din_id_bultos = `ZCSU7530471\nCONT llevan 18 Pallets (80) con 18 OCTABIN(93)`;

  // Llenar din_obs_banco_sna
  f.din_obs_banco_sna = `CERTIFICADO DE ORIGEN S/N FECHA 22/04/2026\nMandato FEA\nM/N MAERSK COLORADO`;

  // Comando aceptar
  f.comando = "U";

  console.log("\nValores a grabar:");
  console.log("  din_id_bultos:", JSON.stringify(f.din_id_bultos));
  console.log("  din_obs_banco_sna:", JSON.stringify(f.din_obs_banco_sna));
  console.log("  dus_peso_bruto_total:", f.dus_peso_bruto_total);
  console.log("  dus_valor_cif:", f.dus_valor_cif);

  // POST
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) body.set(k, v ?? "");

  const grabarRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: url },
    body: body.toString(),
    redirect: "manual",
  });
  console.log("\nPOST comando=U:", grabarRes.status);

  // Verificar
  const html2 = await (await fetch(url, { headers: { Cookie: ck } })).text();
  const f2 = extractFields(html2);

  console.log("\n=== VERIFICACIÓN ===");
  console.log("  din_id_bultos:", JSON.stringify(f2.din_id_bultos || ""));
  console.log("  din_obs_banco_sna:", JSON.stringify(f2.din_obs_banco_sna || ""));

  const okBultos = (f2.din_id_bultos || "").includes("ZCSU7530471");
  const okObs = (f2.din_obs_banco_sna || "").includes("M/N MAERSK COLORADO");
  console.log("\n" + (okBultos && okObs ? "✅ BULTOS GRABADOS CORRECTAMENTE" : "⚠️ Revisar"));

})().catch(e => { console.error("\n❌ ERROR:", e.message); process.exit(1); });
