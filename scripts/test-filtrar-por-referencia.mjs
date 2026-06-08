#!/usr/bin/env node
/**
 * Buscar una operación específica por referencia en el listado (filtro POST).
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
  const sc = r1.headers.getSetCookie() || [];
  let ck = sc.map(c => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ login: LOGIN, clave: CLAVE });
  const r2 = await fetch(BASE + "/modulos/usuarios/validar.php", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: body.toString(), redirect: "manual" });
  const sc2 = r2.headers.getSetCookie() || [];
  ck = [ck, ...sc2.map(c => c.split(";")[0])].join("; ");
  return ck;
}

(async () => {
  const ck = await login();
  console.log("Login OK\n");

  // Filtrar por referencia EXT-8880 (la que acabamos de crear)
  const filterBody = new URLSearchParams();
  filterBody.set("accion", "F"); // F = filtrar
  filterBody.set("fil_orc_referencia", "EXT-8880");

  const res = await fetch(BASE + "/modulos/comex/orden_compra/lista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: filterBody.toString()
  });
  const html = await res.text();

  const rows = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("Filas encontradas con filtro 'EXT-8880':", rows.length);
  for (const row of rows.slice(0, 3)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    const match = row[1].match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
    const libNidLink = row[1].match(/lib_nid=(\d+)/);
    console.log(`  orc=${match?.[1]} lib_nid=${libNidLink?.[1] || "(no)"}: ${cells.filter(Boolean).slice(0, 7).join(" | ")}`);
  }

  // También probar filtro por lib_nid directamente
  console.log("\n--- Filtro por lib_nid=190312 ---");
  const filter2 = new URLSearchParams();
  filter2.set("accion", "F");
  filter2.set("fil_lib_nid", "190312");
  const res2 = await fetch(BASE + "/modulos/comex/orden_compra/lista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: filter2.toString()
  });
  const html2 = await res2.text();
  const rows2 = [...html2.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("Filas:", rows2.length);
  for (const row of rows2.slice(0, 2)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    const libNidLink = row[1].match(/lib_nid=(\d+)/);
    console.log(`  lib_nid=${libNidLink?.[1]}: ${cells.filter(Boolean).slice(0, 7).join(" | ")}`);
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
