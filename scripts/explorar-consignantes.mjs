#!/usr/bin/env node
/** Explora el popup de consignantes y el mantenedor para crear */
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

  // 1. Ver la función open_consignantes en el HTML
  const idUrl = `${BASE}/modulos/din/dus_encabezado/dus_identificacion.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const idHtml = await (await fetch(idUrl, { headers: { Cookie: ck } })).text();
  
  const idx1 = idHtml.indexOf("function open_consignantes");
  if (idx1 > 0) {
    console.log("=== open_consignantes() ===");
    console.log(idHtml.slice(idx1, idx1 + 800).replace(/\t/g, " ").replace(/ {2,}/g, " "));
  }

  const idx2 = idHtml.indexOf("function post_open_csg");
  if (idx2 > 0) {
    console.log("\n=== post_open_csg() ===");
    console.log(idHtml.slice(idx2, idx2 + 1000).replace(/\t/g, " ").replace(/ {2,}/g, " "));
  }

  const idx3 = idHtml.indexOf("function open_matenedor_consignantes");
  if (idx3 > 0) {
    console.log("\n=== open_matenedor_consignantes() ===");
    console.log(idHtml.slice(idx3, idx3 + 800).replace(/\t/g, " ").replace(/ {2,}/g, " "));
  }

  // 2. Probar buscar consignante "DOW"
  console.log("\n\n=== Buscar consignante 'DOW' ===");
  const csgUrl = `${BASE}/modulos/general/ventanas/listados/consignante.php?cli_id=2710&query=DOW`;
  const csgRes = await fetch(csgUrl, { headers: { Cookie: ck } });
  const csgHtml = await csgRes.text();
  console.log("status:", csgRes.status, "| len:", csgHtml.length);
  
  // Buscar seleccion()
  const sels = [...csgHtml.matchAll(/seleccion\(([^)]*)\)/gi)].slice(0, 10);
  if (sels.length) {
    console.log("seleccion() encontrados:", sels.length);
    sels.forEach(m => console.log("  ", m[0].slice(0, 150)));
  } else {
    // Buscar filas
    const rows = [...csgHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()))
      .filter(c => c.length >= 2 && c.some(x => /DOW/i.test(x)));
    rows.slice(0, 5).forEach(r => console.log("  ROW:", r.join(" | ").slice(0, 150)));
    
    // Mostrar snippet
    if (!rows.length) console.log("  HTML:", csgHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500));
  }

  // 3. Probar mantenedor de consignantes
  console.log("\n\n=== Mantenedor consignantes ===");
  const mantUrl = `${BASE}/modulos/mantenedores/consignante.php?menu=0&comando=I&query=DOW&pagno=0&maxpag=0&cli_id=2710`;
  const mantRes = await fetch(mantUrl, { headers: { Cookie: ck } });
  const mantHtml = await mantRes.text();
  console.log("status:", mantRes.status, "| len:", mantHtml.length);
  
  const mantSels = [...mantHtml.matchAll(/seleccion\(([^)]*)\)/gi)].slice(0, 5);
  if (mantSels.length) {
    mantSels.forEach(m => console.log("  ", m[0].slice(0, 150)));
  }
  
  // Ver inputs del form de creación
  console.log("\n  Inputs del mantenedor:");
  for (const m of mantHtml.matchAll(/<input\b[^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)) {
    const val = (m[0].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    console.log("    ", m[1], "=", val.slice(0, 60));
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
