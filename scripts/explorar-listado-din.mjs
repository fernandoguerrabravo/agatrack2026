#!/usr/bin/env node
/**
 * Explora cómo listar operaciones (DIN) en AduanaNet para un cliente.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL");
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");

async function login() {
  const r1 = await fetch(BASE + "/modulos/usuarios/login.php?status=-1", { redirect: "manual" });
  const sc = r1.headers.getSetCookie?.() || [r1.headers.get("set-cookie")].filter(Boolean);
  let ck = sc.map(c => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ login: LOGIN, clave: CLAVE });
  const r2 = await fetch(BASE + "/modulos/usuarios/validar.php", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: body.toString(), redirect: "manual"
  });
  const sc2 = r2.headers.getSetCookie?.() || [r2.headers.get("set-cookie")].filter(Boolean);
  ck = [ck, ...sc2.map(c => c.split(";")[0])].join("; ");
  return ck;
}

(async () => {
  const ck = await login();
  console.log("Login OK\n");

  // Probar diferentes URLs de listado
  const urls = [
    "/modulos/din/listado.php",
    "/modulos/din/listado.php?cli_id=2710",
    "/modulos/din/listado.php?cli_id=2710&estado=",
    "/modulos/operaciones/listado.php",
    "/modulos/din/din_listado.php",
    "/modulos/din/",
    "/modulos/din/dus_encabezado/listado.php",
    "/index.php",
  ];

  for (const url of urls) {
    try {
      const r = await fetch(BASE + url, { headers: { Cookie: ck }, redirect: "follow" });
      const html = await r.text();
      const hasOperaciones = html.includes("lib_nid") || html.includes("operacion") || html.includes("190");
      console.log(`${url} → status:${r.status} len:${html.length} hasOps:${hasOperaciones}`);
      if (hasOperaciones && html.length > 200) {
        // Buscar links con lib_nid (números de operación)
        const libNids = [...html.matchAll(/lib_nid[=:](\d+)/gi)].map(m => m[1]);
        if (libNids.length > 0) {
          console.log("  lib_nid encontrados:", [...new Set(libNids)].slice(0, 10).join(", "));
        }
        // Buscar select de clientes
        const clienteSelect = html.match(/<select[^>]*name\s*=\s*["']cli_id["'][^>]*>([\s\S]*?)<\/select>/i);
        if (clienteSelect) {
          const options = [...clienteSelect[1].matchAll(/<option[^>]*value\s*=\s*["'](\d+)["'][^>]*>([^<]*)/gi)];
          console.log("  Clientes en select:", options.slice(0, 5).map(o => `${o[1]}=${o[2]}`).join(", "));
        }
      }
    } catch (e) { console.log(`${url} → ERROR: ${e.message}`); }
  }

  // También buscar la página principal post-login para ver el menú
  const mainPage = await (await fetch(BASE + "/modulos/din/dus_encabezado/din_encabezado.php", { headers: { Cookie: ck }, redirect: "follow" })).text();
  console.log("\n=== din_encabezado.php ===");
  console.log("len:", mainPage.length);
  // Extraer links del menú
  const links = [...mainPage.matchAll(/href\s*=\s*["']([^"']*listado[^"']*|[^"']*operacion[^"']*)/gi)];
  if (links.length) console.log("Links encontrados:", links.map(l => l[1]).join("\n  "));
  
  // Buscar formulario con filtros
  const forms = [...mainPage.matchAll(/<form[^>]*action\s*=\s*["']([^"']+)["'][^>]*/gi)];
  if (forms.length) console.log("Forms:", forms.map(f => f[1]).join(", "));
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
