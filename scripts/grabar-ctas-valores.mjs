#!/usr/bin/env node
/**
 * Graba módulo CUENTAS Y VALORES (dus_ctas_valores.php) — Op 190248
 * Solo hay que aceptar — las cuentas ya vienen precargadas de mercancía.
 */
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

function extractFields(html) {
  const f = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "button") continue;
    if (type === "checkbox" || type === "radio") {
      if (/checked/i.test(tag)) f[name] = value || "1";
    } else {
      f[name] = value;
    }
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    f[name] = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
  }
  return f;
}

(async () => {
  console.log(`\n=== GRABAR CUENTAS Y VALORES — Op ${OP} ===\n`);
  const ck = await login();
  console.log("✅ Login OK\n");

  // Cargar formulario
  const url = `${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(url, { headers: { Cookie: ck } })).text();
  const f = extractFields(html);
  console.log("Campos cargados:", Object.keys(f).length);
  console.log("  dus_codigo1:", f.dus_codigo1, "| dus_valor1:", f.dus_valor1);
  console.log("  dus_codigo178:", f.dus_codigo178, "| dus_valor178:", f.dus_valor178);
  console.log("  dus_codigo191:", f.dus_codigo191, "| dus_valor191:", f.dus_valor191);
  console.log("  dus_codigo91:", f.dus_codigo91, "| dus_valor91:", f.dus_valor91);
  console.log("  dus_tipo_cambio:", f.dus_tipo_cambio);

  // Aceptar
  f.comando = "U";

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) body.set(k, v ?? "");

  const grabarRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: url },
    body: body.toString(),
    redirect: "manual",
  });
  console.log("\nPOST comando=U:", grabarRes.status);

  // Verificar
  const html2 = await (await fetch(url, { headers: { Cookie: ck } })).text();
  const f2 = extractFields(html2);

  console.log("\n=== VERIFICACIÓN ===");
  console.log("  dus_codigo1:", f2.dus_codigo1, "| dus_valor1:", f2.dus_valor1);
  console.log("  dus_codigo178:", f2.dus_codigo178, "| dus_valor178:", f2.dus_valor178);
  console.log("  dus_codigo191:", f2.dus_codigo191, "| dus_valor191:", f2.dus_valor191);
  console.log("  dus_codigo91:", f2.dus_codigo91, "| dus_valor91:", f2.dus_valor91);
  console.log("  dus_tipo_cambio:", f2.dus_tipo_cambio);

  const ok = f2.dus_valor178 === "4625.43" && f2.dus_valor191 === "4625.43";
  console.log("\n" + (ok ? "✅ CUENTAS Y VALORES GRABADOS CORRECTAMENTE" : "⚠️ Revisar"));

})().catch(e => { console.error("\n❌ ERROR:", e.message); process.exit(1); });
