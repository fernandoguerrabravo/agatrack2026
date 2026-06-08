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
  console.log("Login OK\n");

  const ref = "FUL-" + Date.now().toString().slice(-4);
  const grabarBody = new URLSearchParams();
  grabarBody.set("accion", "N");
  grabarBody.set("cli_id", "2710");
  grabarBody.set("txt_cli_id", "");
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

  // Usar redirect: "follow" para que las cookies de sesión persistan correctamente
  const res = await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "follow"
  });
  
  const html = await res.text();
  console.log("Final URL:", res.url);
  console.log("HTML length:", html.length);

  // Buscar OPERACIÓN EXITOSA y el número
  const exitosaIdx = html.indexOf("EXITOSA");
  if (exitosaIdx > -1) {
    // Extraer 1000 chars después de EXITOSA
    const after = html.substring(exitosaIdx, exitosaIdx + 1000);
    console.log("\nDespués de EXITOSA (HTML):");
    console.log(after.substring(0, 500));
    console.log("\nDespués de EXITOSA (texto):");
    console.log(after.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  }

  // Buscar despacho + número
  const despachoMatch = html.match(/despacho\s*n[°ºo]?\s*(\d+)/i);
  console.log("\ndespacho nº:", despachoMatch ? despachoMatch[1] : "(no encontrado)");
  
  // Buscar "creó despacho"
  const creoMatch = html.match(/cre[oó]\s+despacho[^0-9]*(\d+)/i);
  console.log("creó despacho:", creoMatch ? creoMatch[1] : "(no)");

  // Buscar cualquier 6-dígito 190xxx
  const nums = [...new Set([...html.matchAll(/\b(19\d{4})\b/g)].map(m => m[1]))];
  console.log("190xxx en toda la página:", nums);

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
