#!/usr/bin/env node
/**
 * Probar filtro por orc_id (fil_orc_id) para obtener el lib_nid de forma segura.
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

  // Filtrar por orc_id=33627 (la que tiene lib_nid=190313)
  const filterBody = new URLSearchParams();
  filterBody.set("accion", "F");
  filterBody.set("fil_orc_id", "33627");

  const res = await fetch(BASE + "/modulos/comex/orden_compra/lista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: filterBody.toString()
  });
  const html = await res.text();

  const rows = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("Filas con fil_orc_id=33627:", rows.length);
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    const match = row[1].match(/agregar\(\s*['"]?(\d+)['"]?\s*\)/);
    const libNidLink = row[1].match(/lib_nid=(\d+)/);
    console.log(`  orc=${match?.[1]} lib_nid=${libNidLink?.[1] || "(no)"}: ${cells.filter(Boolean).slice(0, 7).join(" | ")}`);
  }

  // Ahora probar el flujo completo: crear + buscar por orc_id
  // Para obtener el orc_id necesito saber cuál es el último ANTES de crear
  console.log("\n\n=== Flujo: obtener último orc_id, crear, buscar por orc_id+1 ===");
  
  // Obtener último orc_id actual
  const listaHtml = await (await fetch(BASE + "/modulos/comex/orden_compra/lista.php", { headers: { Cookie: ck } })).text();
  const allOrcIds = [...listaHtml.matchAll(/agregar\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
  const maxOrcId = Math.max(...allOrcIds);
  console.log("Último orc_id actual:", maxOrcId);

  // Crear operación
  const ref = "ID-" + Date.now().toString().slice(-4);
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

  console.log("Creando ref:", ref, "esperado orc_id:", maxOrcId + 1);
  await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });

  // Buscar por el orc_id esperado (maxOrcId + 1)
  const expectedOrcId = String(maxOrcId + 1);
  console.log("Buscando fil_orc_id=" + expectedOrcId);
  
  const filter2 = new URLSearchParams();
  filter2.set("accion", "F");
  filter2.set("fil_orc_id", expectedOrcId);
  const res2 = await fetch(BASE + "/modulos/comex/orden_compra/lista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: filter2.toString()
  });
  const html2 = await res2.text();
  const rows2 = [...html2.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
  console.log("Resultado:");
  for (const row of rows2) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
    );
    const libNidLink = row[1].match(/lib_nid=(\d+)/);
    console.log(`  lib_nid=${libNidLink?.[1] || "(no)"}: ${cells.filter(Boolean).slice(0, 7).join(" | ")}`);
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
