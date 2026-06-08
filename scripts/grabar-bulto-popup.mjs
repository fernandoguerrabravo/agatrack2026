#!/usr/bin/env node
/**
 * Graba líneas de bultos en dus_bulto.php (popup)
 * Para esta op: 1 contenedor 40' → código 74, cantidad 1
 */
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
  console.log(`\n=== GRABAR BULTOS (popup) — Op ${OP} ===\n`);
  const ck = await login();
  console.log("✅ Login OK\n");

  // Datos para esta operación: 1 contenedor 40' HC
  // Código 74 = CONT40, cantidad 1
  const bultos = [
    { tipo: "74", cantidad: "1" }, // 1 contenedor de 40'
  ];

  // POST a dus_bulto.php con las líneas
  const url = `${BASE}/modulos/din/dus_encabezado/dus_bulto.php`;
  const body = new URLSearchParams();
  body.set("lib_nid", OP);
  body.set("lib_base", "1");
  body.set("lbac_nid", "0");
  body.set("dus_tipo_envio", "2");
  body.set("lineas", String(bultos.length));
  body.set("enviar", "1");

  for (let i = 0; i < bultos.length; i++) {
    body.set(`bul_sec_nro_bulto${i}`, String(i + 1));
    body.set(`bul_cod_tipo_bulto${i}`, bultos[i].tipo);
    body.set(`sel_bul_cod_tipo_bulto${i}`, bultos[i].tipo);
    body.set(`bul_glosa${i}`, "");
    body.set(`bul_cantidad${i}`, bultos[i].cantidad);
  }

  console.log("Enviando:", Object.fromEntries(body.entries()));

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: `${url}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2` },
    body: body.toString(),
    redirect: "manual",
  });
  console.log(`\nPOST: ${r.status}`);

  // Verificar — recargar el popup
  const vUrl = `${BASE}/modulos/din/dus_encabezado/dus_bulto.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2`;
  const vHtml = await (await fetch(vUrl, { headers: { Cookie: ck } })).text();

  // Buscar inputs bul_ con valores
  console.log("\n=== Verificación ===");
  let found = false;
  for (const m of vHtml.matchAll(/<input\b[^>]*name\s*=\s*["']?(bul_[^"'\s>]+)["']?[^>]*value\s*=\s*["']([^"']+)["']/gi)) {
    console.log(`  ${m[1]} = "${m[2]}"`);
    found = true;
  }
  // También buscar al revés (value antes de name)
  for (const m of vHtml.matchAll(/<input\b[^>]*value\s*=\s*["']([^"']+)["'][^>]*name\s*=\s*["']?(bul_[^"'\s>]+)/gi)) {
    console.log(`  ${m[2]} = "${m[1]}"`);
    found = true;
  }

  // Buscar hidden lineas
  const lineasM = vHtml.match(/name\s*=\s*["']lineas["'][^>]*value\s*=\s*["'](\d+)["']/i) || vHtml.match(/value\s*=\s*["'](\d+)["'][^>]*name\s*=\s*["']lineas["']/i);
  console.log("  lineas:", lineasM ? lineasM[1] : "0");

  // Buscar la tabla de bultos renderizada (filas TR con datos)
  const rows = [...vHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()))
    .filter(c => c.length >= 3 && /^\d+$/.test(c[0]));
  if (rows.length) {
    console.log("\n  Filas de bultos:");
    rows.forEach(r => console.log("   ", r.join(" | ")));
  }

  // Verificar también en dus_desc_bulto el campo total_bultos
  const descBultoHtml = await (await fetch(`${BASE}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { headers: { Cookie: ck } })).text();
  const totalBultos = (descBultoHtml.match(/name\s*=\s*["']dus_total_bultos["'][^>]*value\s*=\s*["']([^"']*)["']/i) || [])[1];
  console.log(`\n  dus_total_bultos en desc_bulto: "${totalBultos}"`);

  console.log(found || rows.length ? "\n✅ Bultos grabados" : "\n⚠️ No se encontraron bultos grabados — revisar formato");

})().catch(e => { console.error("\n❌ ERROR:", e.message); process.exit(1); });
