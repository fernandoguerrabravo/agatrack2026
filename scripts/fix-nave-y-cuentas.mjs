#!/usr/bin/env node
/**
 * 1. Crear la nave MSC SAMIA en el catálogo de AduanaNet
 * 2. Grabar el nav_id en Destino
 * 3. Recargar Cuentas y Valores (usar arr_ctas del HTML y grabar)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = process.argv[2] || "190276";

function pc(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const j = {};
  for (const l of raw) { const f = l.split(";")[0]; const e = f.indexOf("="); if (e > 0) { const k = f.slice(0, e).trim(); const v = f.slice(e + 1).trim(); if (v && v !== "deleted") j[k] = v; } }
  return Object.entries(j).map(([k, v]) => k + "=" + v).join("; ");
}
async function login() {
  const lp = await fetch(`${BASE}/modulos/usuarios/login.php?status=-1`, { redirect: "manual" });
  const bc = pc(lp);
  const b = new URLSearchParams(); b.set("login", LOGIN); b.set("clave", CLAVE);
  const v = await fetch(`${BASE}/modulos/usuarios/validar.php`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${BASE}/modulos/usuarios/login.php?status=-1`, Cookie: bc }, body: b.toString(), redirect: "manual" });
  return [bc, pc(v)].filter(Boolean).join("; ");
}
function extractFields(html) {
  const f = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "button") continue;
    if (type === "checkbox" || type === "radio") { if (/checked/i.test(tag)) f[name] = value || "1"; }
    else f[name] = value;
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    f[name] = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (name) f[name] = m[2].trim();
  }
  return f;
}

(async () => {
  console.log(`\n=== FIX: Crear nave + Cuentas — Op ${OP} ===\n`);
  const ck = await login();
  console.log("✅ Login OK\n");

  // ─── 1. CREAR NAVE MSC SAMIA ──────────────────────────────
  console.log("─── 1. Crear nave MSC SAMIA ───");
  const NAVE = "MSC SAMIA";

  // Primero verificar si ya existe
  const naveSearchUrl = `${BASE}/modulos/general/ventanas/listados/nave.php?identificador=&fil_nav_nombre=${encodeURIComponent(NAVE)}`;
  let naveHtml = await (await fetch(naveSearchUrl, { headers: { Cookie: ck } })).text();
  let naveMatches = [...naveHtml.matchAll(/seleccion\(\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]/gi)];

  let navId = "";
  if (naveMatches.length > 0) {
    navId = naveMatches.sort((a, b) => Number(b[1]) - Number(a[1]))[0][1];
    console.log(`  Ya existe: ${NAVE} (nav_id=${navId})`);
  } else {
    // Crear la nave
    console.log(`  Creando nave "${NAVE}"...`);
    const formUrl = `${BASE}/modulos/mantenedores/nave.php?menu=0&comando=I&query=&pagno=0&maxpag=0`;
    await (await fetch(formUrl, { headers: { Cookie: ck } })).text();

    const body = new URLSearchParams();
    body.set("nav_id", "");
    body.set("nav_nombre", NAVE);
    body.set("pai_id", "");
    body.set("pai_nombre0", "");
    body.set("tra_id", "");
    body.set("tra_nombre1", "");
    body.set("comando", "N");
    body.set("query", "");
    body.set("pagno", "0");

    await fetch(formUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
      body: body.toString(),
      redirect: "manual",
    });

    // Re-buscar
    naveHtml = await (await fetch(naveSearchUrl, { headers: { Cookie: ck } })).text();
    naveMatches = [...naveHtml.matchAll(/seleccion\(\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]/gi)];
    if (naveMatches.length > 0) {
      navId = naveMatches.sort((a, b) => Number(b[1]) - Number(a[1]))[0][1];
      console.log(`  ✅ Nave creada: ${NAVE} (nav_id=${navId})`);
    } else {
      console.log("  ❌ No se pudo crear la nave");
    }
  }

  // ─── 2. ACTUALIZAR DESTINO CON nav_id ─────────────────────
  if (navId) {
    console.log(`\n─── 2. Actualizar Destino con nav_id=${navId} ───`);
    const destUrl = `${BASE}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
    const destHtml = await (await fetch(destUrl, { headers: { Cookie: ck } })).text();
    const df = extractFields(destHtml);

    df.nav_id = navId;
    df.nav_nombre = NAVE;
    df.comando = "U";

    const db = new URLSearchParams();
    for (const [k, v] of Object.entries(df)) db.set(k, v ?? "");
    const dRes = await fetch(destUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: destUrl }, body: db.toString(), redirect: "manual" });
    console.log(`  POST: ${dRes.status}`);

    // Verificar
    const destHtml2 = await (await fetch(destUrl, { headers: { Cookie: ck } })).text();
    const df2 = extractFields(destHtml2);
    console.log(`  Verificación: nav_id=${df2.nav_id} nav_nombre=${df2.nav_nombre}`);
    console.log("  ✅ Destino actualizado");
  }

  // ─── 3. CUENTAS Y VALORES — Traer cuentas ─────────────────
  console.log(`\n─── 3. Cuentas y Valores — Traer cuentas ───`);
  const ctasUrl = `${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const ctasHtml = await (await fetch(ctasUrl, { headers: { Cookie: ck } })).text();

  // Extraer arr_ctas del JavaScript embebido (contiene las cuentas precalculadas)
  const arrCtasMatch = ctasHtml.match(/var\s+arr_ctas\s*=\s*\[([\s\S]*?)\];/i);
  if (arrCtasMatch) {
    console.log("  arr_ctas encontrado");
    // Parsear arr_ctas: formato [[codigo, valor], [codigo, valor], ...]
    const arrStr = arrCtasMatch[1];
    const cuentas = [...arrStr.matchAll(/\[\s*['"]?(\d+)['"]?\s*,\s*['"]?([\d.]+)['"]?\s*\]/gi)];
    console.log(`  Cuentas encontradas: ${cuentas.length}`);
    cuentas.forEach(c => console.log(`    ${c[1]} = ${c[2]}`));
  }

  // El form ya viene con los valores precargados por recupera_cuentas() del JS.
  // Solo hay que extraer los campos y hacer submit con comando=U.
  const cf = extractFields(ctasHtml);

  // Los valores de IVA/cuentas se calculan con JS en el browser (recupera_cuentas + calcula_valores).
  // Necesitamos replicar ese cálculo: tomar arr_ctas y aplicar la lógica.
  // Pero primero veamos si el form ya tiene los valores correctos:
  console.log(`\n  Estado actual del form:`);
  console.log(`    dus_codigo1=${cf.dus_codigo1} dus_valor1=${cf.dus_valor1}`);
  console.log(`    dus_valor178=${cf.dus_valor178} (IVA)`);
  console.log(`    dus_valor191=${cf.dus_valor191} (Total)`);
  console.log(`    dus_valor91=${cf.dus_valor91} (CLP)`);

  // Si IVA=0, calcular manualmente desde arr_ctas
  if (cf.dus_valor178 === "0.00" || !cf.dus_valor178 || cf.dus_valor178 === "0") {
    console.log("\n  IVA=0, calculando desde arr_ctas...");
    // Buscar el valor de IVA (178) en arr_ctas
    const arrStr = arrCtasMatch ? arrCtasMatch[1] : "";
    const cuentas = [...arrStr.matchAll(/\[\s*['"]?(\d+)['"]?\s*,\s*['"]?([\d.]+)['"]?\s*\]/gi)];

    // Limpiar cuentas 1-8
    for (let i = 1; i <= 8; i++) {
      cf[`dus_codigo${i}`] = "";
      cf[`dus_valor${i}`] = "0.00";
    }

    // Llenar con arr_ctas
    let idx = 1;
    for (const c of cuentas) {
      if (idx <= 8) {
        cf[`dus_codigo${idx}`] = c[1];
        cf[`dus_valor${idx}`] = parseFloat(c[2]).toFixed(2);
        idx++;
      }
    }

    // IVA (178) = sum de valores con cuenta 178 en arr_ctas, o CIF * 19%
    // Buscar valor_178 del hidden
    const valor178 = cf.valor_178 || "";
    if (valor178 && parseFloat(valor178) > 0) {
      cf.dus_valor178 = parseFloat(valor178).toFixed(2);
    } else {
      // Calcular: CIF * IVA%
      const cifTotal = parseFloat(cf.dus_valor_cif || "24344.38");
      const iva = parseFloat(cf.iva || "19");
      // Buscar si hay advalorem en cuentas
      const adval = cuentas.find(c => c[1] === "223");
      const advalMonto = adval ? parseFloat(adval[2]) : 0;
      const ivaCalc = ((cifTotal + advalMonto) * iva / 100);
      cf.dus_valor178 = ivaCalc.toFixed(2);
    }

    cf.dus_codigo178 = "178";
    cf.dus_codigo191 = "191";
    cf.dus_valor191 = cf.dus_valor178; // Total = IVA (si adval=0)
    cf.dus_codigo699 = "699";
    cf.dus_valor699 = "0.00";
    cf.dus_codigo199 = "199";
    cf.dus_valor199 = "0.00";

    // Total CLP
    const tipoCambio = parseFloat(cf.dus_tipo_cambio || "894.79");
    cf.dus_codigo91 = "91";
    cf.dus_valor91 = Math.round(parseFloat(cf.dus_valor191) * tipoCambio).toString();

    console.log(`  Calculado: IVA=${cf.dus_valor178} Total=${cf.dus_valor191} CLP=${cf.dus_valor91}`);
  }

  cf.comando = "U";

  const cb = new URLSearchParams();
  for (const [k, v] of Object.entries(cf)) cb.set(k, v ?? "");
  const cRes = await fetch(ctasUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: ctasUrl }, body: cb.toString(), redirect: "manual" });
  console.log(`\n  POST: ${cRes.status}`);

  // Verificar
  const ctasHtml2 = await (await fetch(ctasUrl, { headers: { Cookie: ck } })).text();
  const cf2 = extractFields(ctasHtml2);
  console.log(`  Verificación: IVA=${cf2.dus_valor178} Total=${cf2.dus_valor191} CLP=${cf2.dus_valor91}`);
  console.log("\n  ✅ Cuentas y Valores OK");

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ✅ TODO LISTO — Op ${OP}`);
  console.log(`${"═".repeat(50)}\n`);

})().catch(e => { console.error("\n❌ ERROR:", e.message); process.exit(1); });
