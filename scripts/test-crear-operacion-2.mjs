#!/usr/bin/env node
/**
 * TEST: Crear operación con los campos correctos (sin prefijo sel_)
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

  const grabarBody = new URLSearchParams();
  grabarBody.set("accion", "N");
  grabarBody.set("cli_id", "2710"); // PETROQUIMICA DOW
  grabarBody.set("orc_tio", "DIN");
  grabarBody.set("tipo_doc", "IMPO");
  grabarBody.set("tio_id", "101"); // IMPORT. CTDO/NORMAL
  grabarBody.set("emp_id", "C69"); // Fernando Guerra Godoy
  grabarBody.set("ejecutivo_id", "");
  grabarBody.set("adu_id", "");
  grabarBody.set("fpa_id", "");
  grabarBody.set("mon_id", "13"); // USD
  grabarBody.set("cvt_id", "");
  grabarBody.set("reg_id", "");
  grabarBody.set("orc_referencia", "TEST-AGATRACK");
  grabarBody.set("orc_bodega", "");
  grabarBody.set("usua_id", "100");
  grabarBody.set("lineas", "0");
  grabarBody.set("ineditable", "false");
  grabarBody.set("nro_libro", "");

  console.log("POST grabar.php...");
  const grabarRes = await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });
  console.log("Status:", grabarRes.status);
  const loc = grabarRes.headers.get("location");
  console.log("Location:", loc);
  const resBody = await grabarRes.text();
  if (resBody) console.log("Body:", resBody.substring(0, 300));

  // Seguir
  if (loc) {
    const url = loc.startsWith("/") ? BASE + loc : loc.startsWith("http") ? loc : BASE + "/modulos/comex/orden_compra/" + loc;
    console.log("\nFollow:", url);
    const r = await fetch(url, { headers: { Cookie: ck } });
    const html = await r.text();
    
    // Si es formulario, buscar el lib_nid
    if (loc.includes("formulario")) {
      const libNid = html.match(/name\s*=\s*["']lib_nid["'][^>]*value\s*=\s*["'](\d+)["']/i);
      const orcId = html.match(/name\s*=\s*["']orc_id["'][^>]*value\s*=\s*["'](\d+)["']/i);
      console.log("lib_nid:", libNid ? libNid[1] : "(no)");
      console.log("orc_id:", orcId ? orcId[1] : "(no)");
      // Buscar cualquier 6-digit number en context de operacion
      const nums = [...html.matchAll(/(?:190|191)\d{3}/g)];
      if (nums.length) console.log("Nros operación en respuesta:", [...new Set(nums.map(n => n[0]))].join(", "));
    }
    
    // Si es mensaje, extraer texto
    if (loc.includes("mensaje")) {
      // Buscar el contenido del mensaje en variable JS o div
      const msgMatch = html.match(/(?:var\s+mensaje|innerHTML|textContent)\s*=\s*["']([^"']+)["']/i);
      const divMsg = html.match(/<div[^>]*class\s*=\s*["'][^"']*mensaje[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      const swalMsg = html.match(/swal\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/i);
      console.log("swal msg:", swalMsg ? `${swalMsg[1]}: ${swalMsg[2]}` : "(no)");
      console.log("div msg:", divMsg ? divMsg[1].replace(/<[^>]*>/g, "").trim() : "(no)");
      console.log("var msg:", msgMatch ? msgMatch[1] : "(no)");
      // Buscar texto "grabado", "creado", "error"
      const plainText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      const resultMsg = plainText.match(/(?:grabado|creado|error|alerta|exito|carpeta|operaci)[^.]{0,100}/i);
      console.log("Result:", resultMsg ? resultMsg[0].trim() : plainText.substring(plainText.length - 300));
    }
  }

  // Verificar en lista si se creó algo nuevo
  console.log("\n\n=== Verificar en lista ===");
  const listaRes = await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } });
  const listaHtml = await listaRes.text();
  // Primera fila de la tabla
  const firstRow = listaHtml.match(/<tr[^>]*>\s*<td[^>]*bgcolor="#FFFFFF"[^>]*>([\s\S]*?)<\/tr>/i);
  if (firstRow) {
    const cells = [...firstRow[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim());
    console.log("Primera fila:", cells.filter(Boolean).slice(0, 7).join(" | "));
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
