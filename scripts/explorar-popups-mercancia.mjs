#!/usr/bin/env node
/**
 * Explora los popups del módulo mercancía:
 * 1. buscar_descriptores.php (busca por código de producto)
 * 2. IngresoMercancia / descriptor popup
 * 3. calculo_valores_item.php
 * 4. TraeCuenta (cálculo de derechos)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = "190248";

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

  // 1. buscar_descriptores.php — busca producto por código
  console.log("=== 1. BUSCAR DESCRIPTORES (código 00099208248) ===\n");
  const descUrl = `/inc/getXML/buscar_descriptores.php?partida=&codigo=00099208248&descripcion=&cli_id=2710`;
  const r1 = await fetch(`${BASE}${descUrl}`, { headers: { Cookie: ck } });
  const t1 = await r1.text();
  console.log("status:", r1.status, "| len:", t1.length);
  console.log("Content-Type:", r1.headers.get("content-type"));
  console.log(t1.slice(0, 2000));

  // 2. IngresoMercancia popup
  console.log("\n\n=== 2. INGRESO MERCANCIA (popup descriptor) ===\n");
  // La función IngresoMercancia abre: ingreso_mercancia.php con varios params
  const imUrl = `/modulos/din/dus_encabezado/ingreso_mercancia.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&pagno=0&dus_tipo_envio=2&mer_producto=00099208248&mer_cod_arancel=39014000`;
  const r2 = await fetch(`${BASE}${imUrl}`, { headers: { Cookie: ck } });
  const t2 = await r2.text();
  console.log("status:", r2.status, "| len:", t2.length);
  if (t2.length > 100) {
    // Extraer inputs
    const inputs = [...t2.matchAll(/<input\b[^>]*>/gi)];
    const seen = new Set();
    for (const m of inputs) {
      const tag = m[0];
      const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
      const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
      if (value || type !== "hidden") console.log(`  [${type}] ${name} = "${value.slice(0, 100)}"`);
    }
    // Buscar botones
    const btns = [...t2.matchAll(/value\s*=\s*["']([^"']*(?:Despacho|Grabar|Aceptar|Solo)[^"']*)["']/gi)];
    console.log("\n  Botones:", btns.map(m => m[1]).join(", "));
    // Buscar funciones JS
    const fns = [...t2.matchAll(/function\s+(\w+)\s*\(/gi)].map(m => m[1]);
    console.log("  JS:", fns.join(", "));
    // Buscar form action
    const actions = [...t2.matchAll(/<form[^>]*action\s*=\s*["']([^"']*)["']/gi)];
    actions.forEach(m => console.log("  form action:", m[1]));
  }

  // 3. calculo_valores_item.php
  console.log("\n\n=== 3. CALCULO VALORES ITEM (popup) ===\n");
  const cvUrl = `/modulos/din/dus_encabezado/calculo_valores_item.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2`;
  const r3 = await fetch(`${BASE}${cvUrl}`, { headers: { Cookie: ck } });
  const t3 = await r3.text();
  console.log("status:", r3.status, "| len:", t3.length);
  console.log(t3.slice(0, 3000));

  // 4. TraeCuenta — el popup de cálculo de derechos
  console.log("\n\n=== 4. TRAE CUENTA (cálculo derechos) ===\n");
  // TraeCuenta abre: calcula_derechos.php o trae_cuenta.php
  const tcUrl = `/modulos/din/dus_encabezado/trae_cuenta.php?mer_cod_arancel=39014000&mer_porc_advalorem=0&ajuste=0&cif=24344.38&signo=1&cantidad=10800&lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&pai_id=225`;
  const r4 = await fetch(`${BASE}${tcUrl}`, { headers: { Cookie: ck } });
  const t4 = await r4.text();
  console.log("status:", r4.status, "| len:", t4.length);
  if (t4.length > 50) console.log(t4.slice(0, 2000));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
