#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");

function pc(res) { const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : []; const j = {}; for (const l of raw) { const f = l.split(";")[0]; const e = f.indexOf("="); if (e > 0) { const k = f.slice(0, e).trim(); const v = f.slice(e + 1).trim(); if (v && v !== "deleted") j[k] = v; } } return Object.entries(j).map(([k, v]) => k + "=" + v).join("; "); }
async function login() { const lp = await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`, { redirect: "manual" }); const bc = pc(lp); const b = new URLSearchParams(); b.set("login", LOGIN); b.set("clave", CLAVE); const v = await fetch(`${BASE}/modulos/usuarios/validar.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/modulos/usuarios/login.php?status=-1`, Cookie: bc }, body: b.toString(), redirect: "manual" }); return [bc, pc(v)].filter(Boolean).join("; "); }

(async () => {
  const ck = await login();
  const url = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php`;
  const body = new URLSearchParams();
  body.set("lib_base", "1"); body.set("lib_nid", "190240"); body.set("lbac_nid", "0");
  body.set("dus_tipo_envio", "2"); body.set("mer_nro_item", "1"); body.set("comando", "M"); body.set("pagno", "0");
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: body.toString() });
  const html = await r.text();
  
  const fields = ["mer_cod_arancel", "mer_cod_arancel_tratado", "mer_nro_acuerdo_comercial", "mer_nombre",
    "mer_cantidad", "mer_fob_unitario", "mer_valor_cif_item", "mer_porc_advalorem", "mer_monto_impto_otro1", "mer_obs1"];
  for (const f of fields) {
    const m = html.match(new RegExp('name\\s*=\\s*["\']' + f + '["\'][^>]*value\\s*=\\s*["\']([^"\']*)["\']', 'i'))
      || html.match(new RegExp('value\\s*=\\s*["\']([^"\']*)["\'][^>]*name\\s*=\\s*["\']' + f + '["\']', 'i'));
    console.log(f + " = " + (m ? m[1] : "(vacío)"));
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
