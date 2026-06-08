#!/usr/bin/env node
/**
 * Crear operación en AduanaNet y extraer el nro_operacion (lib_nid) resultante.
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

  // 1. Antes de crear, ver cuál es la última operación en la lista
  let listaHtml = await (await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } })).text();
  let rows = [...listaHtml.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  let primerOrcId = "";
  for (const row of rows.slice(0, 1)) {
    const match = row[1].match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
    if (match) primerOrcId = match[1];
  }
  console.log("Última orc_id ANTES de crear:", primerOrcId);

  // 2. Crear nueva operación
  const ref = "TEST-" + Date.now().toString().slice(-6);
  const grabarBody = new URLSearchParams();
  grabarBody.set("accion", "N");
  grabarBody.set("cli_id", "2710"); // PETROQUIMICA DOW
  grabarBody.set("orc_tio", "DIN");
  grabarBody.set("tipo_doc", "IMPO");
  grabarBody.set("tio_id", "101");
  grabarBody.set("emp_id", "C69");
  grabarBody.set("ejecutivo_id", "");
  grabarBody.set("adu_id", "39"); // SAN ANTONIO
  grabarBody.set("fpa_id", "");
  grabarBody.set("mon_id", "13");
  grabarBody.set("cvt_id", "");
  grabarBody.set("reg_id", "");
  grabarBody.set("orc_referencia", ref);
  grabarBody.set("orc_bodega", "");
  grabarBody.set("usua_id", "100");
  grabarBody.set("lineas", "0");
  grabarBody.set("ineditable", "false");
  grabarBody.set("nro_libro", "");

  console.log("Creando con referencia:", ref);
  const grabarRes = await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });
  console.log("grabar.php → status:", grabarRes.status, "location:", grabarRes.headers.get("location"));

  // 3. Recargar lista y buscar la nueva operación
  listaHtml = await (await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } })).text();
  rows = [...listaHtml.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  
  console.log("\n=== Primeras 5 filas del listado ===");
  for (const row of rows.slice(0, 5)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    const match = row[1].match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
    const orcId = match ? match[1] : "?";
    console.log(`  orc_id=${orcId}: ${cells.filter(Boolean).slice(0, 7).join(" | ")}`);
  }

  // 4. Buscar la fila recién creada (por referencia)
  let newOrcId = "";
  for (const row of rows) {
    if (row[1].includes(ref)) {
      const match = row[1].match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
      if (match) newOrcId = match[1];
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
        c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
      );
      console.log("\n✅ Operación creada encontrada:");
      console.log("  orc_id:", newOrcId);
      console.log("  Datos:", cells.filter(Boolean).join(" | "));
      break;
    }
  }

  if (!newOrcId) {
    console.log("\n❌ No se encontró la operación creada en el listado");
    process.exit(1);
  }

  // 5. Abrir la carpeta para buscar el lib_nid (nro_operacion)
  console.log("\n=== Abriendo carpeta orc_id=" + newOrcId + " ===");
  const formRes = await fetch(BASE + "/modulos/comex/orden_compra/formulario.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: new URLSearchParams({ accion: "M", orc_id: newOrcId }).toString()
  });
  const formHtml = await formRes.text();

  // Buscar lib_nid en la página
  const libNidPatterns = [
    ...formHtml.matchAll(/lib_nid\s*[=:"']\s*(\d{5,})/gi),
    ...formHtml.matchAll(/name\s*=\s*["']lib_nid["'][^>]*value\s*=\s*["'](\d+)["']/gi),
  ];
  console.log("lib_nid en formulario:", libNidPatterns.length ? libNidPatterns.map(m => m[1]) : "(no encontrado)");

  // Buscar cualquier número 190xxx+ en inputs del formulario
  const inputsConValor = [...formHtml.matchAll(/<input[^>]*name\s*=\s*["']([^"']+)["'][^>]*value\s*=\s*["']([^"']+)["']/gi)]
    .filter(m => /^\d{5,}$/.test(m[2]) && !m[1].startsWith("tido_") && !m[1].startsWith("guardado"));
  console.log("Inputs numéricos:", inputsConValor.map(m => `${m[1]}=${m[2]}`));

  // Buscar en el HTML la sección de "despacho" o "DIN"
  const dinSection = formHtml.match(/(?:lib_nid|despacho|DIN\s*N)[^\n]{0,200}/gi);
  if (dinSection) {
    console.log("Secciones DIN/despacho:", dinSection.slice(0, 3));
  }

  // El nro_operacion puede NO existir aún - se crea cuando se genera la DIN
  // Veamos si hay un botón "Crear DIN" o link
  const crearLinks = [...formHtml.matchAll(/(?:href|action|onclick)\s*=\s*["']([^"']*(?:din|despacho|encabezado|crear_din)[^"']*)["']/gi)];
  console.log("\nLinks a DIN/despacho:", crearLinks.map(l => l[1]).slice(0, 5));

  // Buscar en texto plano
  const plainText = formHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const opMatch = plainText.match(/(?:operaci[oó]n|despacho|lib_nid|N[°º])\s*[:=]?\s*(\d{5,7})/i);
  console.log("Nro en texto plano:", opMatch ? opMatch[1] : "(no)");

  // Buscar el campo orc_id para confirmar
  const orcIdField = formHtml.match(/name\s*=\s*["']orc_id["'][^>]*value\s*=\s*["']([^"']*)["']/i);
  console.log("orc_id confirmado:", orcIdField ? orcIdField[1] : "(no)");

  // Buscar campo lib_nid directo
  const libField = formHtml.match(/name\s*=\s*["']lib_nid["']/i);
  console.log("Campo lib_nid existe:", !!libField);
  if (libField) {
    const ctx = formHtml.substring(formHtml.indexOf(libField[0]) - 50, formHtml.indexOf(libField[0]) + 200);
    console.log("Contexto:", ctx.replace(/<[^>]*>/g, " ").trim());
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
