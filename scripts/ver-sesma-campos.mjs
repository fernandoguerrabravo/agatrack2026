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
  const url = `${BASE}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=190153&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(url, { headers: { Cookie: ck } })).text();

  console.log("=== Campos SESMA/ISP/CERTIF ===");
  const seen = new Set();
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = (m[0].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || seen.has(name)) continue;
    if (/sesma|isp|certif/i.test(name)) {
      seen.add(name);
      const val = (m[0].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
      console.log(`  ${name} = "${val}"`);
    }
  }

  console.log("\n=== Selects SESMA/ISP ===");
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (/sesma|isp|certif/i.test(name || "")) {
      const opts = [...m[2].matchAll(/<option[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*>([^<]*)/gi)];
      console.log(`  [select] ${name} (${opts.length} opts):`);
      opts.forEach(o => console.log(`    ${o[1]} = ${o[2].trim()}`));
    }
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
