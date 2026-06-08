#!/usr/bin/env node
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
  const html = await (await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } })).text();
  const rows = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("Primeras 8 filas:");
  for (const row of rows.slice(0, 8)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    const match = row[1].match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
    const orcId = match ? match[1] : "?";
    // Buscar el lib_nid en la fila (enlace a din.php?lib_nid=XXXXX)
    const libNidLink = row[1].match(/lib_nid=(\d+)/);
    const libNid = libNidLink ? libNidLink[1] : "";
    console.log(`  orc=${orcId} lib_nid=${libNid || "(no)"}: ${cells.filter(Boolean).slice(0, 7).join(" | ")}`);
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
