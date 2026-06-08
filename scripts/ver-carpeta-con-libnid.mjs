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
  console.log("Login OK\n");

  // Comparar carpeta 33624 (tiene lib_nid=190311) vs 33625 (no tiene)
  for (const orcId of ["33624", "33625"]) {
    console.log(`\n=== Carpeta orc_id=${orcId} ===`);
    const res = await fetch(BASE + "/modulos/comex/orden_compra/formulario.php", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
      body: new URLSearchParams({ accion: "M", orc_id: orcId }).toString()
    });
    const html = await res.text();

    // Buscar todos los inputs con valor no vacío (relevantes)
    const inputs = [...html.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']+)["']/gi)]
      .filter(m => m[2].length > 0 && !m[1].startsWith("tido_") && !m[1].startsWith("guardado") && !m[1].startsWith("docu_"));
    
    console.log("Inputs con valor:");
    for (const inp of inputs) {
      console.log("  " + inp[1] + " = " + inp[2]);
    }

    // Buscar lib_nid en cualquier forma
    const libNids = [...html.matchAll(/lib_nid[^0-9]*(\d{5,})/gi)];
    if (libNids.length) console.log("lib_nid:", libNids[0][1]);

    // Buscar 190xxx en el HTML
    const ops = [...new Set([...html.matchAll(/\b(19\d{4})\b/g)].map(m => m[1]))];
    if (ops.length) console.log("Nros 190xxx:", ops.join(", "));
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
