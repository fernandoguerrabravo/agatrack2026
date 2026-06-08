#!/usr/bin/env node
/**
 * Explorar los selects del formulario y ver el mensaje de error de grabar.php
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

  // Ver mensaje de error
  const msgRes = await fetch(BASE + "/modulos/general/mensaje.php", { headers: { Cookie: ck } });
  const msgHtml = await msgRes.text();
  console.log("=== mensaje.php ===");
  console.log(msgHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 500));

  // Cargar formulario con accion=N y extraer los selects relevantes
  console.log("\n\n=== Formulario selects ===");
  const formRes = await fetch(BASE + "/modulos/comex/orden_compra/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ accion: "N" }).toString()
  });
  const formHtml = await formRes.text();

  // Extraer selects relevantes con sus opciones
  const selectNames = ["sel_tio_id", "orc_tio", "sel_emp_id", "sel_ejecutivo_id", "sel_adu_id", "sel_fpa_id", "sel_mon_id", "sel_cvt_id", "sel_reg_id", "sel_tna_id", "nro_libro"];
  for (const name of selectNames) {
    const regex = new RegExp(`<select[^>]*name\\s*=\\s*["']${name}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i");
    const match = formHtml.match(regex);
    if (match) {
      const options = [...match[1].matchAll(/<option[^>]*value\s*=\s*["']([^"']*)["'][^>]*(?:selected)?[^>]*>([^<]*)/gi)].slice(0, 8);
      const selected = match[1].match(/<option[^>]*selected[^>]*value\s*=\s*["']([^"']*)["']/i);
      console.log(`${name}: [selected=${selected?.[1] || "none"}] ${options.map(o => `${o[1]}="${o[2].trim()}"`).join(", ")}`);
    }
  }

  // Buscar campos obligatorios (required, class=obligatorio, etc.)
  const required = [...formHtml.matchAll(/(?:class\s*=\s*["'][^"']*obligatorio[^"']*["']|required)[^>]*name\s*=\s*["']([^"']+)["']/gi)];
  const required2 = [...formHtml.matchAll(/name\s*=\s*["']([^"']+)["'][^>]*(?:class\s*=\s*["'][^"']*obligatorio[^"']*["']|required)/gi)];
  console.log("\nCampos obligatorios:", [...new Set([...required.map(r => r[1]), ...required2.map(r => r[1])])].join(", "));

  // Buscar validación JS antes del submit
  const formScripts = [...formHtml.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(s => s[1]).join("\n");
  // Buscar validaciones con if/alert
  const validations = formScripts.match(/if\s*\([^)]*(?:cli_id|sel_tio|orc_tio|emp_id)[^)]*\)[^{]*\{[^}]*\}/gi);
  console.log("\nValidaciones JS:", validations ? validations.slice(0, 5).join("\n  ") : "(no encontradas)");

  // Buscar el onclick del botón guardar/aceptar
  const guardarBtn = formHtml.match(/(?:grabar|guardar|aceptar|Grabar|Guardar|Aceptar)[^<]*<\/(?:button|a|input)/gi);
  console.log("\nBotones guardar:", guardarBtn ? guardarBtn.slice(0, 3) : "(buscando...)");
  
  // Buscar img/a con onclick que tenga submit
  const submitActions = [...formHtml.matchAll(/onclick\s*=\s*["']([^"']*(?:submit|grabar|frmEditar)[^"']*)["']/gi)];
  console.log("\nonclick con submit/grabar:");
  for (const a of submitActions.slice(0, 10)) console.log("  ", a[1].substring(0, 200));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
