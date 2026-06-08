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
  console.log("Login OK");

  // Abrir carpeta 33624 creada
  const formRes = await fetch(BASE + "/modulos/comex/orden_compra/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ accion: "M", orc_id: "33624" }).toString()
  });
  const html = await formRes.text();

  // Buscar lib_nid en cualquier contexto
  const libNids = [...html.matchAll(/lib_nid\s*[=:"']\s*(\d+)/gi)];
  console.log("lib_nid encontrados:", libNids.map(m => m[1]).slice(0, 5));

  // Buscar inputs hidden y text relevantes
  const inputs = [...html.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']*)["']/gi)];
  console.log("\nInputs con valor:");
  for (const inp of inputs) {
    if (inp[2] && !inp[1].startsWith("tido_") && !inp[1].startsWith("guardado") && !inp[1].startsWith("docu_")) {
      console.log(`  ${inp[1]} = ${inp[2]}`);
    }
  }

  // Buscar nro operación en la tabla de despachos dentro del formulario
  const despachoSection = html.match(/[Dd]espacho[\s\S]{0,2000}/);
  if (despachoSection) {
    const nums = [...despachoSection[0].matchAll(/\b(19\d{4})\b/g)];
    console.log("\nNros despacho:", nums.map(n => n[1]));
  }

  // Buscar link a DIN dentro del formulario
  const dinLinks = [...html.matchAll(/href\s*=\s*["']([^"']*din[^"']*)["']/gi)];
  console.log("\nDIN links:", dinLinks.map(l => l[1]).slice(0, 5));

  // La carpeta nueva no tiene despacho — el lib_nid se crea cuando se genera el DIN
  // Buscar el campo o link "Crear DIN" o "Crear despacho"
  const crearDin = html.match(/(?:crear|generar|nuevo)[\s_-]*(?:din|despacho)/gi);
  console.log("\nCrear DIN:", crearDin);

  // Buscar texto sobre la operación (190310 es la anterior a nuestra test)
  console.log("\nBuscando 190310 o 190311:", html.includes("190310"), html.includes("190311"));
})().catch(e => { console.error("ERROR:", e); process.exit(1); });
