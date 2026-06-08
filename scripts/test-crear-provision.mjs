#!/usr/bin/env node
/**
 * Test: Crear provisión de fondos para op 190153 y obtener PDF.
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

  // 1. Cargar formulario para obtener todos los campos precargados
  const formHtml = await (await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ lib_nid: "190153", lib_base: "1", accion: "N" }).toString()
  })).text();

  // Extraer todos los campos input con valor
  const allInputs = [...formHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*/gi)];
  const fields = {};
  for (const inp of allInputs) {
    const name = inp[1];
    const value = (inp[0].match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    const type = (inp[0].match(/type\s*=\s*["']([^"']+)["']/i) || [])[1] || "text";
    if (type === "button" || name === "btnVolver" || name.startsWith("modulo_")) continue;
    if (type === "radio") {
      if (/checked/i.test(inp[0])) fields[name] = value;
    } else if (type === "checkbox") {
      if (/checked/i.test(inp[0])) fields[name] = value || "1";
    } else {
      if (!fields[name]) fields[name] = value; // no sobrescribir
    }
  }

  // Setear los campos específicos para Petroquímica
  fields.cheque = "1"; // Cheque agencia
  fields.sel_leyendaA = "CHEQUE A : TESORERIA GENERAL DE LA REPUBLICA";
  fields.imprimir = "1"; // Generar PDF
  fields.email = ""; // No enviar email por ahora
  fields.det = "1";

  console.log("Campos clave:");
  console.log("  lib_nid:", fields.lib_nid);
  console.log("  cli_id:", fields.cli_id);
  console.log("  cheque:", fields.cheque);
  console.log("  sel_leyendaA:", fields.sel_leyendaA);
  console.log("  imprimir:", fields.imprimir);
  console.log("  d_sf_monto1 (IVA):", fields.d_sf_monto1);
  console.log("  paridad:", fields.paridad);

  // 2. POST a grabar.php
  console.log("\nPOST grabar.php...");
  const grabarBody = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) grabarBody.set(k, v);
  }

  const res = await fetch(BASE + "/modulos/contabilidad/solicitud_fondos/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/contabilidad/solicitud_fondos/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });
  console.log("Status:", res.status);
  console.log("Location:", res.headers.get("location"));

  // 3. Seguir redirect
  const loc = res.headers.get("location");
  if (loc) {
    const url = loc.startsWith("/") ? BASE + loc : loc.startsWith("http") ? loc : BASE + "/modulos/contabilidad/solicitud_fondos/" + loc;
    console.log("Siguiendo:", url);
    const followRes = await fetch(url, { headers: { Cookie: ck } });
    const contentType = followRes.headers.get("content-type");
    console.log("Content-Type:", contentType);
    
    if (contentType && contentType.includes("pdf")) {
      // Es un PDF!
      const pdfBuf = Buffer.from(await followRes.arrayBuffer());
      fs.writeFileSync(path.join(__dirname, "provision_190153.pdf"), pdfBuf);
      console.log("✅ PDF guardado: scripts/provision_190153.pdf (" + pdfBuf.length + " bytes)");
    } else {
      const html = await followRes.text();
      console.log("Response len:", html.length);
      // Buscar link a PDF
      const pdfLink = html.match(/href\s*=\s*["']([^"']*\.pdf[^"']*)["']/i) || html.match(/href\s*=\s*["']([^"']*imprimir[^"']*)["']/i);
      console.log("PDF link en respuesta:", pdfLink ? pdfLink[1] : "(no)");
      // Buscar mensaje
      const msg = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").match(/(?:exitosa|error|grabado|provision|solicitud)[^.]{0,100}/i);
      console.log("Mensaje:", msg ? msg[0].trim() : html.substring(html.length - 300));
    }
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
