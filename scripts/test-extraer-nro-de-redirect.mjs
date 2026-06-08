#!/usr/bin/env node
/**
 * Crear operación y extraer el nro_operacion de la respuesta directa (no del listado).
 * Explorar qué devuelve grabar.php — headers, body, redirect chain.
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

  const ref = "EXT-" + Date.now().toString().slice(-4);
  const grabarBody = new URLSearchParams();
  grabarBody.set("accion", "N");
  grabarBody.set("cli_id", "2710");
  grabarBody.set("txt_cli_id", "PETROQUIMICA DOW S.A.");
  grabarBody.set("orc_tio", "DIN");
  grabarBody.set("tipo_doc", "IMPO");
  grabarBody.set("tio_id", "101");
  grabarBody.set("sel_tio_id", "101");
  grabarBody.set("emp_id", "C69");
  grabarBody.set("sel_emp_id", "C69");
  grabarBody.set("ejecutivo_id", "");
  grabarBody.set("sel_ejecutivo_id", "");
  grabarBody.set("adu_id", "39");
  grabarBody.set("sel_adu_id", "39");
  grabarBody.set("fpa_id", "");
  grabarBody.set("sel_fpa_id", "");
  grabarBody.set("mon_id", "13");
  grabarBody.set("sel_mon_id", "13");
  grabarBody.set("cvt_id", "");
  grabarBody.set("sel_cvt_id", "");
  grabarBody.set("reg_id", "");
  grabarBody.set("sel_reg_id", "");
  grabarBody.set("sel_tna_id", "");
  grabarBody.set("nro_libro", "");
  grabarBody.set("orc_referencia", ref);
  grabarBody.set("orc_bodega", "");
  grabarBody.set("usua_id", "100");
  grabarBody.set("lineas", "0");
  grabarBody.set("ineditable", "false");
  grabarBody.set("generar_despacho", "1");
  grabarBody.set("email", "1");

  console.log("Creando ref:", ref);
  
  // 1. POST a grabar.php - NO seguir redirect
  const res1 = await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });
  console.log("\n1. grabar.php:");
  console.log("   status:", res1.status);
  console.log("   location:", res1.headers.get("location"));
  const body1 = await res1.text();
  if (body1) console.log("   body:", body1.substring(0, 300));

  // 2. Seguir el primer redirect (mensaje.php)
  const loc1 = res1.headers.get("location");
  if (loc1) {
    const url1 = loc1.startsWith("/") ? BASE + loc1 : loc1;
    console.log("\n2. Siguiendo:", url1);
    const res2 = await fetch(url1, { headers: { Cookie: ck }, redirect: "manual" });
    console.log("   status:", res2.status);
    console.log("   location:", res2.headers.get("location"));
    const html2 = await res2.text();
    
    // Buscar lib_nid, orc_id, nro_operacion en la respuesta
    const libNid = html2.match(/lib_nid[=:]["']?(\d{5,})/i);
    const orcId = html2.match(/orc_id[=:]["']?(\d+)/i);
    console.log("   lib_nid:", libNid ? libNid[1] : "(no)");
    console.log("   orc_id:", orcId ? orcId[1] : "(no)");

    // Buscar swal() o alert con mensaje
    const swal = html2.match(/swal\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/i);
    if (swal) console.log("   swal:", swal[1], "-", swal[2]);

    // Buscar cualquier 6-digit number
    const nums = [...new Set([...html2.matchAll(/\b(19\d{4})\b/g)].map(m => m[1]))];
    if (nums.length) console.log("   190xxx:", nums.join(", "));

    // Buscar "carpeta" + número
    const carpeta = html2.match(/carpeta[^0-9]*(\d{4,})/i);
    if (carpeta) console.log("   carpeta+num:", carpeta[1]);

    // Buscar texto relevante del mensaje
    const plainText = html2.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    // Buscar frases con "operaci", "despacho", "carpeta", "190"
    const relevant = plainText.match(/(?:operaci|despacho|carpeta|190\d{3}|grabado|creado|exito)[^\n.]{0,150}/gi);
    if (relevant) console.log("   texto relevante:", relevant.slice(0, 3));
    
    // Mostrar últimos 500 chars del texto plano (suele tener el mensaje)
    console.log("   últimos 300 chars:", plainText.slice(-300));
  }

  // 3. También probar: seguir con redirect: "follow" para ver dónde termina
  console.log("\n\n3. Creando otra vez con redirect:follow...");
  const ref2 = "FLW-" + Date.now().toString().slice(-4);
  grabarBody.set("orc_referencia", ref2);
  const resFollow = await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "follow"
  });
  console.log("   final URL:", resFollow.url);
  console.log("   status:", resFollow.status);
  const htmlFollow = await resFollow.text();
  const libNidFollow = htmlFollow.match(/lib_nid[=:]["']?(\d{5,})/i);
  const orcIdFollow = htmlFollow.match(/orc_id[=:]["']?(\d+)/i);
  console.log("   lib_nid:", libNidFollow ? libNidFollow[1] : "(no)");
  console.log("   orc_id:", orcIdFollow ? orcIdFollow[1] : "(no)");
  
  // Buscar en la URL final
  const urlParams = new URL(resFollow.url).searchParams;
  console.log("   URL params:", Object.fromEntries(urlParams));

  // Buscar inputs en la página final
  const finalInputs = [...htmlFollow.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']+)["']/gi)]
    .filter(m => /orc_id|lib_nid|accion/.test(m[1]));
  console.log("   inputs finales:", finalInputs.map(m => `${m[1]}=${m[2]}`));

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
