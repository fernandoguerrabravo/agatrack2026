#!/usr/bin/env node
/**
 * Test final: simula el flujo completo del API — crear operación y obtener nro_operacion.
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

  const cli_id = "2710";
  const referencia = "PRUEBA-FINAL-" + Date.now().toString().slice(-4);
  const aduId = "39"; // SAN ANTONIO

  // PASO 1: Crear operación
  console.log("1. Creando operación...");
  console.log("   cli_id:", cli_id, "| adu_id:", aduId, "| ref:", referencia);

  const grabarBody = new URLSearchParams();
  grabarBody.set("accion", "N");
  grabarBody.set("cli_id", cli_id);
  grabarBody.set("txt_cli_id", "");
  grabarBody.set("orc_tio", "DIN");
  grabarBody.set("tipo_doc", "IMPO");
  grabarBody.set("tio_id", "101");
  grabarBody.set("sel_tio_id", "101");
  grabarBody.set("emp_id", "C69");
  grabarBody.set("sel_emp_id", "C69");
  grabarBody.set("ejecutivo_id", "");
  grabarBody.set("sel_ejecutivo_id", "");
  grabarBody.set("adu_id", aduId);
  grabarBody.set("sel_adu_id", aduId);
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
  grabarBody.set("orc_referencia", referencia);
  grabarBody.set("orc_bodega", "");
  grabarBody.set("usua_id", "100");
  grabarBody.set("lineas", "0");
  grabarBody.set("ineditable", "false");
  grabarBody.set("generar_despacho", "1");
  grabarBody.set("email", "1");

  await fetch(BASE + "/modulos/comex/orden_compra/grabar.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: BASE + "/modulos/comex/orden_compra/formulario.php" },
    body: grabarBody.toString(),
    redirect: "manual"
  });
  console.log("   ✅ POST enviado");

  // PASO 2: Filtrar por cli_id para obtener el orc_id más alto
  console.log("\n2. Buscando orc_id más alto para cli_id=" + cli_id + "...");
  const filterBody = new URLSearchParams();
  filterBody.set("accion", "F");
  filterBody.set("fil_cli_id", cli_id);

  const listaRes = await fetch(BASE + "/modulos/comex/orden_compra/lista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: filterBody.toString()
  });
  const listaHtml = await listaRes.text();

  const allOrcIds = [...listaHtml.matchAll(/agregar\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
  const maxOrcId = allOrcIds.length > 0 ? Math.max(...allOrcIds) : 0;
  console.log("   orc_id más alto:", maxOrcId);

  // PASO 3: Filtrar por ese orc_id para obtener el lib_nid
  console.log("\n3. Buscando lib_nid para orc_id=" + maxOrcId + "...");
  const filter2 = new URLSearchParams();
  filter2.set("accion", "F");
  filter2.set("fil_orc_id", String(maxOrcId));

  const res2 = await fetch(BASE + "/modulos/comex/orden_compra/lista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: filter2.toString()
  });
  const html2 = await res2.text();
  const libNidLink = html2.match(/lib_nid=(\d+)/);
  const nroOperacion = libNidLink ? libNidLink[1] : "";

  console.log("   lib_nid (nro_operacion):", nroOperacion || "(NO ENCONTRADO)");

  // Resultado final
  console.log("\n" + "=".repeat(50));
  console.log("RESULTADO:");
  console.log("  nro_operacion:", nroOperacion);
  console.log("  orc_id:", maxOrcId);
  console.log("  referencia:", referencia);
  console.log("  aduana: SAN ANTONIO (39)");
  console.log("=".repeat(50));

  if (nroOperacion) {
    console.log("\n✅ ÉXITO — Operación " + nroOperacion + " creada correctamente");
  } else {
    console.log("\n❌ ERROR — No se pudo obtener el nro_operacion");
  }

})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
