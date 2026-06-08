#!/usr/bin/env node
/**
 * Explorar formulario.php más a fondo - buscar el submit y probar crear una operación de prueba.
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

  // Primero: acceder lista con accion=N (simular click en nuevo())
  const listaRes = await fetch(BASE + "/modulos/comex/orden_compra/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/lista.php" },
    body: new URLSearchParams({ accion: "N" }).toString(),
    redirect: "manual"
  });
  console.log("POST formulario.php accion=N → status:", listaRes.status);
  const formHtml = await listaRes.text();
  console.log("len:", formHtml.length);

  // Ver si hay un orc_id generado o campo hidden nuevo
  const orcIdField = formHtml.match(/name\s*=\s*["']orc_id["'][^>]*value\s*=\s*["']([^"']*)["']/i);
  console.log("orc_id:", orcIdField ? orcIdField[1] : "(no encontrado)");

  // Buscar botones de submit en la sección relevante
  const botones = [...formHtml.matchAll(/(?:onclick|href)\s*=\s*["']([^"']*(?:submit|grabar|aceptar|document\.frm)[^"']*)["']/gi)];
  console.log("\nBotones/submit:");
  for (const b of botones.slice(0, 10)) console.log("  ", b[1].substring(0, 150));

  // Buscar todos los campos tipo select con nombre relevante  
  const selects = [...formHtml.matchAll(/<select[^>]*name\s*=\s*["']([^"']+)["']/gi)].map(s => s[1]);
  console.log("\nSelects (filtrados):", selects.filter(s => !s.startsWith("tido_id") && !s.startsWith("modulo")).join(", "));

  // Buscar campo lib_nid o lib_base en el form
  const libFields = [...formHtml.matchAll(/name\s*=\s*["'](lib_[^"']+)["'][^>]*(?:value\s*=\s*["']([^"']*)["'])?/gi)];
  console.log("\nlib_* fields:");
  for (const f of libFields.slice(0, 10)) console.log(`  ${f[1]} = "${f[2] || ""}"`);

  // Intentar hacer POST a grabar.php con datos mínimos para ver la respuesta
  // cli_id 2710 = PETROQUIMICA DOW S.A.
  console.log("\n\n=== INTENTAR CREAR OPERACIÓN (POST a grabar.php) ===");
  const grabarBody = new URLSearchParams();
  grabarBody.set("accion", "N"); // N = nueva
  grabarBody.set("cli_id", "2710"); // PETROQUIMICA DOW S.A.
  grabarBody.set("orc_referencia", "TEST-AGATRACK-" + Date.now());
  grabarBody.set("orc_bodega", "");
  grabarBody.set("usua_id", "100");
  grabarBody.set("lineas", "0");
  grabarBody.set("ineditable", "false");
  grabarBody.set("tipo_doc", "");

  const grabarRes = await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });
  console.log("POST grabar.php → status:", grabarRes.status);
  console.log("Location:", grabarRes.headers.get("location"));
  const grabarHtml = await grabarRes.text();
  console.log("Response len:", grabarHtml.length);
  console.log("Preview:", grabarHtml.substring(0, 500));

  // Si redirecciona, seguir
  const location = grabarRes.headers.get("location");
  if (location) {
    const followUrl = location.startsWith("http") ? location : BASE + "/modulos/comex/orden_compra/" + location;
    console.log("\nSiguiendo redirect:", followUrl);
    const followRes = await fetch(followUrl, { headers: { Cookie: ck } });
    const followHtml = await followRes.text();
    // Buscar el lib_nid en la respuesta
    const libNid = followHtml.match(/lib_nid\s*[=:]\s*["']?(\d+)/i);
    const orcId = followHtml.match(/orc_id\s*[=:]\s*["']?(\d+)/i);
    console.log("lib_nid encontrado:", libNid ? libNid[1] : "(no)");
    console.log("orc_id encontrado:", orcId ? orcId[1] : "(no)");
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
