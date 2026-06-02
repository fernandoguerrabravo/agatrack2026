#!/usr/bin/env node
/** Inspecciona el popup de transportista (naviera) y su form de creación. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");

function pc(res){const raw=typeof res.headers.getSetCookie==="function"?res.headers.getSetCookie():[];const j={};for(const l of raw){const f=l.split(";")[0];const e=f.indexOf("=");if(e>0){const k=f.slice(0,e).trim();const v=f.slice(e+1).trim();if(v&&v!=="deleted")j[k]=v;}}return Object.entries(j).map(([k,v])=>k+"="+v).join("; ");}
async function login(){const lp=await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`,{redirect:"manual"});const bc=pc(lp);const b=new URLSearchParams();b.set("login",LOGIN);b.set("clave",CLAVE);const v=await fetch(`${BASE}/modulos/usuarios/validar.php`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Referer:`${BASE}/modulos/usuarios/login.php?status=-1`,Cookie:bc},body:b.toString(),redirect:"manual"});return [bc,pc(v)].filter(Boolean).join("; ");}

(async () => {
  const cookies = await login();
  const h = await (await fetch(`${BASE}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=190248&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { headers: { Cookie: cookies } })).text();

  // arrcia_id (muestra)
  const am = h.match(/arrcia_id\s*=\s*new Array\(\)[\s\S]{0,50}|arrcia_id\s*=\s*\[[\s\S]{0,300}/i);
  console.log("=== arrcia_id (definición) ===");
  console.log(am ? am[0].slice(0, 300) : "(no inline)");
  // ver como se llena arrcia_id
  const fills = [...h.matchAll(/arrcia_id\[[^\]]*\][^;\n]{0,80}/gi)].slice(0, 4);
  fills.forEach(m => console.log("  ", m[0].replace(/\s+/g, " ").slice(0, 120)));

  // función carga_datos_transportista ya vista. Probar transportista.php buscando ZIM
  console.log("\n=== Buscar transportista ZIM (popup mantenedores/transportista.php) ===");
  for (const q of ["transportista.php?menu=0&comando=I&query=ZIM&pagno=0&maxpag=0"]) {
    const r = await fetch(`${BASE}/modulos/mantenedores/${q}`, { headers: { Cookie: cookies } });
    const t = await r.text();
    const sels = [...t.matchAll(/seleccion\(([^)]*)\)/gi)].slice(0, 8);
    console.log("  status", r.status, "len", t.length, "| seleccion():", sels.length);
    sels.forEach(m => console.log("   ", m[0].slice(0, 130)));
    const rows = t.split(/<tr/i).filter(l => /ZIM/i.test(l)).slice(0, 3);
    rows.forEach(l => console.log("   ROW:", l.replace(/<[^>]+>/g, " | ").replace(/\s+/g, " ").trim().slice(0, 150)));
  }

  // Form de creación de transportista
  console.log("\n=== Form creación transportista (comando=I) ===");
  const r2 = await fetch(`${BASE}/modulos/mantenedores/transportista.php?menu=0&comando=I&query=&pagno=0&maxpag=0`, { headers: { Cookie: cookies } });
  const t2 = await r2.text();
  for (const m of t2.matchAll(/<input\b[^>]*>/gi)) { const tag = m[0]; const nm = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1]; if (!nm || nm === "modulo_seleccion[]") continue; const ty = (tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text"; console.log("   ", ty, nm); }
  for (const m of t2.matchAll(/<select\b([^>]*)>/gi)) { const nm = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1]; if (nm && nm !== "modulo_seleccion[]") console.log("    select", nm); }
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
