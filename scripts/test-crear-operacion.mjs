#!/usr/bin/env node
/**
 * TEST: Crear una operación nueva en AduanaNet con los campos requeridos.
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

  // POST a grabar.php con todos los campos requeridos
  const grabarBody = new URLSearchParams();
  grabarBody.set("accion", "N");
  grabarBody.set("cli_id", "2710"); // PETROQUIMICA DOW S.A.
  grabarBody.set("orc_tio", "DIN"); // Importación
  grabarBody.set("tipo_doc", "IMPO");
  grabarBody.set("tio_id", "101"); // IMPORT. CTDO/NORMAL
  grabarBody.set("sel_tio_id", "101");
  grabarBody.set("emp_id", "C69"); // Fernando Guerra Godoy
  grabarBody.set("sel_emp_id", "C69");
  grabarBody.set("orc_referencia", "TEST-AGATRACK");
  grabarBody.set("orc_bodega", "");
  grabarBody.set("usua_id", "100");
  grabarBody.set("lineas", "0");
  grabarBody.set("ineditable", "false");
  grabarBody.set("sel_ejecutivo_id", ""); 
  grabarBody.set("sel_adu_id", "");
  grabarBody.set("sel_fpa_id", "");
  grabarBody.set("sel_mon_id", "");
  grabarBody.set("sel_cvt_id", "");
  grabarBody.set("sel_reg_id", "");
  grabarBody.set("nro_libro", "");

  console.log("POST grabar.php con campos completos...");
  const grabarRes = await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });
  console.log("Status:", grabarRes.status);
  console.log("Location:", grabarRes.headers.get("location"));
  
  const resText = await grabarRes.text();
  if (resText.length > 0) {
    console.log("Body preview:", resText.substring(0, 500));
  }

  // Seguir redirect
  const location = grabarRes.headers.get("location");
  if (location) {
    const followUrl = location.startsWith("http") ? location : location.startsWith("/") ? BASE + location : BASE + "/modulos/comex/orden_compra/" + location;
    console.log("\nSiguiendo:", followUrl);
    const followRes = await fetch(followUrl, { headers: { Cookie: ck }, redirect: "follow" });
    const followHtml = await followRes.text();
    console.log("Follow len:", followHtml.length);
    
    // Buscar lib_nid, orc_id en la respuesta
    const libNids = [...followHtml.matchAll(/lib_nid[=:]["']?(\d+)/gi)];
    const orcIds = [...followHtml.matchAll(/orc_id[=:]["']?(\d+)/gi)];
    console.log("lib_nid:", libNids.length ? libNids[0][1] : "(no)");
    console.log("orc_id:", orcIds.length ? orcIds[0][1] : "(no)");
    
    // Si es mensaje.php buscar el texto del mensaje
    if (location.includes("mensaje")) {
      const msg = followHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      const alertMatch = msg.match(/(?:alerta|error|mensaje|exito|grabado|guardado)[^.]*\./i);
      console.log("Mensaje:", alertMatch ? alertMatch[0] : msg.substring(0, 300));
    }
    
    // Si redirige al formulario, buscar el nro nuevo
    if (location.includes("formulario") || location.includes("lista")) {
      // Buscar en la tabla la última operación
      const lastOp = followHtml.match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
      if (lastOp) console.log("Última op (agregar):", lastOp[1]);
      
      // Buscar lib_nid en inputs hidden
      const libNidInput = followHtml.match(/name\s*=\s*["']lib_nid["'][^>]*value\s*=\s*["'](\d+)["']/i);
      if (libNidInput) console.log("lib_nid input:", libNidInput[1]);
    }
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
