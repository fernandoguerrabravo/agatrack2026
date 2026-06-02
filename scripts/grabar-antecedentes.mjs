#!/usr/bin/env node
/** Graba módulo ANTECEDENTES FINANCIEROS op 190248. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = "190248";

function pc(res){const raw=typeof res.headers.getSetCookie==="function"?res.headers.getSetCookie():[];const j={};for(const l of raw){const f=l.split(";")[0];const e=f.indexOf("=");if(e>0){const k=f.slice(0,e).trim();const v=f.slice(e+1).trim();if(v&&v!=="deleted")j[k]=v;}}return Object.entries(j).map(([k,v])=>k+"="+v).join("; ");}
async function login(){const lp=await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`,{redirect:"manual"});const bc=pc(lp);const b=new URLSearchParams();b.set("login",LOGIN);b.set("clave",CLAVE);const v=await fetch(`${BASE}/modulos/usuarios/validar.php`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Referer:`${BASE}/modulos/usuarios/login.php?status=-1`,Cookie:bc},body:b.toString(),redirect:"manual"});return [bc,pc(v)].filter(Boolean).join("; ");}
function extractFields(html){const f={};for(const m of html.matchAll(/<input\b[^>]*>/gi)){const tag=m[0];const name=(tag.match(/name\s*=\s*["']?([^"'\s>]+)/i)||[])[1];if(!name||name==="modulo_seleccion[]")continue;const type=((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i)||[])[1]||"text").toLowerCase();const value=(tag.match(/value\s*=\s*["']([^"']*)["']/i)||[])[1]||"";if(type==="checkbox"||type==="radio"){if(/checked/i.test(tag))f[name]=value||"1";}else f[name]=value;}for(const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)){const name=(m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i)||[])[1];if(!name||name==="modulo_seleccion[]")continue;f[name]=(m[2].match(/<option\s+value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i)||[])[1]||"";}return f;}

(async () => {
  console.log("=== GRABAR ANTECEDENTES FINANCIEROS — Op", OP, "===\n");
  const ck = await login();
  const url = `${BASE}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const f = extractFields(await (await fetch(url, { headers: { Cookie: ck } })).text());
  console.log("Campos form:", Object.keys(f).length);

  // Inyectar valores
  f.reg_id = "92";       // TLCCH-USA (del CO)
  f.fpa_id = "1";        // COB1
  f.din_dias = "60";     // días plazo
  f.mda_id = "13";       // USD
  f.div_id = "1";        // MERC.CAMB.FORMAL
  f.cvt_id = "2";        // CFR (incoterm)
  f.fpg_id = "1";        // COB1 (pago gravámenes)
  f.din_valor_ex_fabrica = "0.00";  // no EXW
  f.din_gastos_hasta_fob = "0.00";  // CFR no tiene gastos FOB separados
  f.comando = "U";       // Aceptar

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) body.set(k, v ?? "");
  const grabar = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: url }, body: body.toString(), redirect: "manual" });
  console.log("POST comando=U:", grabar.status);

  // Verificar
  const f2 = extractFields(await (await fetch(url, { headers: { Cookie: ck } })).text());
  console.log("\n=== VERIFICACIÓN ===");
  console.log("  reg_id:", f2.reg_id, "| fpa_id:", f2.fpa_id, "| din_dias:", f2.din_dias);
  console.log("  mda_id:", f2.mda_id, "| div_id:", f2.div_id, "| cvt_id:", f2.cvt_id);
  console.log("  fpg_id:", f2.fpg_id, "| din_valor_ex_fabrica:", f2.din_valor_ex_fabrica);
  const ok = f2.reg_id === "92" && f2.fpa_id === "1" && f2.fpg_id === "1" && f2.cvt_id === "2";
  console.log("\n" + (ok ? "✅ GUARDADO CORRECTO" : "⚠️ Revisar"));
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
