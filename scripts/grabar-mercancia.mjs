#!/usr/bin/env node
/**
 * Elimina el ítem 1 y lo recrea en din_mercancia — Op 190248
 * 
 * Flujo completo:
 * 1. Eliminar ítem existente (comando=E)
 * 2. Buscar descriptor por código de producto
 * 3. Consultar arancel para obtener cod_arancel_tratado y advalorem
 * 4. Calcular valores del ítem (replica calculo_valores_item.php)
 * 5. Obtener derechos/impuestos (replica trae_cuenta.php)
 * 6. Grabar mercadería (comando=U)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const OP = process.argv[2] || "190248";

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
    if (type === "checkbox" || type === "radio") {
      if (/checked/i.test(tag)) f[name] = value || "1";
    } else {
      f[name] = value;
    }
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    f[name] = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
  }
  return f;
}

const MERC_URL = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php`;

(async () => {
  console.log(`\n=== GRABAR MERCANCÍA — Op ${OP} ===\n`);
  const ck = await login();
  console.log("✅ Login OK\n");

  // ============================================================
  // PASO 0: Eliminar ítem 1 si existe
  // ============================================================
  console.log("--- PASO 0: Eliminar ítem existente ---");
  const elimBody = new URLSearchParams();
  elimBody.set("lib_base", "1");
  elimBody.set("lib_nid", OP);
  elimBody.set("lbac_nid", "0");
  elimBody.set("dus_tipo_envio", "2");
  elimBody.set("mer_nro_item", "1");
  elimBody.set("comando", "E"); // E = eliminar
  elimBody.set("pagno", "0");

  const elimRes = await fetch(MERC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: elimBody.toString(),
  });
  console.log("  Eliminar ítem 1:", elimRes.status);

  // Verificar que no hay ítems
  const checkHtml = await (await fetch(`${MERC_URL}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { headers: { Cookie: ck } })).text();
  const lineaMatch = checkHtml.match(/<select[^>]*name\s*=\s*['"]linea['"][^>]*>([\s\S]*?)<\/select>/i);
  const itemOpts = lineaMatch ? [...lineaMatch[1].matchAll(/<option[^>]*value\s*=\s*['"](\d+)['"]/gi)] : [];
  console.log("  Ítems restantes:", itemOpts.length);

  // ============================================================
  // PASO 1: Cargar form vacío (Crear nuevo)
  // ============================================================
  console.log("\n--- PASO 1: Cargar formulario (Crear nuevo) ---");
  const formUrl = `${MERC_URL}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const formHtml = await (await fetch(formUrl, { headers: { Cookie: ck } })).text();
  const f = extractFields(formHtml);
  console.log("  Campos:", Object.keys(f).length);

  // Extraer los hiddens de contexto que necesitamos
  const valor_kn = f.valor_kn || "0";
  const fob_neto = f.fob_neto || "0";
  const cif_neto = f.cif_neto || "0";
  const ajuste_neto = f.ajuste_neto || "0";
  console.log("  valor_kn:", valor_kn, "| fob_neto:", fob_neto, "| cif_neto:", cif_neto);

  // ============================================================
  // PASO 2: Buscar descriptor por código de producto
  // ============================================================
  console.log("\n--- PASO 2: Buscar descriptor ---");
  const codigoProducto = "00099208248";
  const descUrl = `/inc/getXML/buscar_descriptores.php?partida=&codigo=${codigoProducto}&descripcion=&cli_id=2710`;
  const descRes = await fetch(`${BASE}${descUrl}`, { headers: { Cookie: ck } });
  const descXml = await descRes.text();
  
  // Parsear XML del descriptor
  const pick = (xml, tag) => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) || [])[1]?.trim() || "";
  const dsc_partida = pick(descXml, "dsc_partida");
  const dsc_cod_producto = pick(descXml, "dsc_cod_producto");
  const dsc_descrip_corta = pick(descXml, "dsc_descrip_corta");
  const dsc_otro1 = pick(descXml, "dsc_otro1"); // marca
  const dsc_otro2 = pick(descXml, "dsc_otro2"); // modelo
  const dsc_obs = pick(descXml, "dsc_obs");     // presentación
  
  console.log("  partida:", dsc_partida);
  console.log("  código:", dsc_cod_producto);
  console.log("  descripción:", dsc_descrip_corta);
  console.log("  marca:", dsc_otro1, "| modelo:", dsc_otro2);
  console.log("  obs:", dsc_obs);

  // Armar mer_nombre (formato: código;descripción;marca;modelo;obs)
  const mer_nombre = [
    dsc_cod_producto.padEnd(15),
    dsc_descrip_corta,
    dsc_otro1,
    dsc_otro2,
    dsc_obs
  ].join(";");
  console.log("  mer_nombre:", mer_nombre);

  // ============================================================
  // PASO 3: Consultar arancel
  // ============================================================
  console.log("\n--- PASO 3: Consultar arancel ---");
  const arancelUrl = `/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dsc_partida}&pais=225&regimen=92`;
  const arancelRes = await fetch(`${BASE}${arancelUrl}`, { headers: { Cookie: ck } });
  const arancelHtml = await arancelRes.text();
  
  // Buscar la fila VUESA2002 y extraer seleccionar(advalorem, cod_arancel, nro_acuerdo, correlativo)
  const vuesa2002 = arancelHtml.match(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)[^<]*VUESA2002/i)
    || arancelHtml.match(/VUESA2002[\s\S]{0,200}seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/i)
    || arancelHtml.match(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)[^<]*<\/a>/i);

  let advalorem = "0", cod_arancel_tratado = dsc_partida, nro_acuerdo = "650", correlativo = "";
  
  // Buscar todas las llamadas a seleccionar() con VUESA2002
  const allSels = [...arancelHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
  console.log("  seleccionar() encontrados:", allSels.length);
  for (const s of allSels) {
    console.log(`    adval=${s[1]}, cod=${s[2]}, acuerdo=${s[3]}, corr=${s[4]}`);
  }
  // Tomar el que tenga acuerdo 650 (TLCCH-USA)
  const sel650 = allSels.find(s => s[3] === "650");
  if (sel650) {
    advalorem = sel650[1];
    cod_arancel_tratado = sel650[2];
    nro_acuerdo = sel650[3];
    correlativo = sel650[4] || "";
  }
  console.log(`  → advalorem: ${advalorem}%, cod_arancel_tratado: ${cod_arancel_tratado}, acuerdo: ${nro_acuerdo}`);

  // ============================================================
  // PASO 4: Calcular valores del ítem (replica calculo_valores_item)
  // ============================================================
  console.log("\n--- PASO 4: Cálculo valores ítem ---");
  // Datos de la factura (op 190248 — 1 solo ítem, CFR):
  const total_neto_item = 24331;  // valor total según cláusula (CFR = FOB + flete)
  const mer_cantidad_input = 10800; // cantidad en KG (unidad de medida)

  // Replica la lógica de calcula() del popup:
  // ume_id=6 (KG), prorrat_peso="" (no prorrateo)
  // mer_fob_unitario = (neto_item / total_neto_itemes) * valor_fob_total_usd / cantidad
  // mer_cif_item = neto_item * cif_neto
  // mer_ajuste = neto_item * ajuste_neto
  const total_neto_itemes = parseFloat(f.mer_total_neto) || total_neto_item;
  const fob_total = parseFloat(f.dus_total_valor_fob) || 20736;
  
  const mer_cantidad = mer_cantidad_input.toFixed(4);
  const mer_fob_unitario_val = ((total_neto_item / total_neto_itemes) * fob_total) / mer_cantidad_input;
  const mer_fob_unitario = mer_fob_unitario_val.toFixed(6).slice(0, mer_fob_unitario_val.toFixed(6).indexOf('.') + 7);
  const mer_valor_cif_item = (total_neto_item * parseFloat(cif_neto)).toFixed(2);
  const mer_monto_ajuste = (total_neto_item * parseFloat(ajuste_neto)).toFixed(2);
  
  console.log("  total_neto_item:", total_neto_item);
  console.log("  mer_cantidad:", mer_cantidad);
  console.log("  mer_fob_unitario:", mer_fob_unitario);
  console.log("  mer_valor_cif_item:", mer_valor_cif_item);
  console.log("  mer_monto_ajuste:", mer_monto_ajuste);

  // ============================================================
  // PASO 5: Cálculo de derechos (replica trae_cuenta)
  // ============================================================
  console.log("\n--- PASO 5: Cálculo de derechos ---");
  // Para TLC Chile-USA con advalorem=0%, los derechos son:
  //   - Ad-valorem: 0% → monto 0
  //   - IVA: 19% sobre CIF → cod 178
  const mer_porc_advalorem = advalorem;
  const cif_val = parseFloat(mer_valor_cif_item);
  const mer_mto_cta_advalorem = (cif_val * parseFloat(advalorem) / 100).toFixed(2);
  
  // IVA 19%
  const iva_base = cif_val + parseFloat(mer_mto_cta_advalorem); // CIF + advalorem
  const mer_monto_impto_otro1 = (iva_base * 19 / 100).toFixed(2);
  
  console.log("  advalorem:", mer_porc_advalorem, "% → monto:", mer_mto_cta_advalorem);
  console.log("  IVA 19% sobre", iva_base.toFixed(2), "→", mer_monto_impto_otro1);

  // Obtener cuenta_advalorem real desde trae_cuenta.php
  const tcUrl = `${BASE}/modulos/din/dus_encabezado/trae_cuenta.php?mer_cod_arancel=${dsc_partida}&mer_porc_advalorem=${advalorem}&ajuste=${mer_monto_ajuste}&cif=${mer_valor_cif_item}&signo=1&cantidad=${mer_cantidad}&lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&pai_id=225`;
  const tcRes = await fetch(tcUrl, { headers: { Cookie: ck } });
  const tcHtml = await tcRes.text();
  
  // Extraer inputs de trae_cuenta que contienen los valores calculados
  const tcFields = extractFields(tcHtml);
  // Buscar el campo cuenta
  const mer_cuenta_advalorem = tcFields.mer_cuenta_advalorem || "223";
  console.log("  cuenta_advalorem:", mer_cuenta_advalorem);

  // Buscar los valores reales de obs1 (peso en formato AduanaNet)
  // formato: 000{cantidad}.000000 KG
  const cantStr = Math.round(mer_cantidad_input).toString().padStart(8, "0");
  const mer_obs1 = `${cantStr}.000000 KG`;
  console.log("  obs1 (peso):", mer_obs1);

  // ============================================================
  // PASO 6: Grabar mercadería
  // ============================================================
  console.log("\n--- PASO 6: Grabar mercadería ---");
  
  // Setear todos los campos necesarios
  f.linea = "";  // Crear nuevo
  f.mer_producto = `${dsc_cod_producto}@#~2710`;  // formato del select
  f.mer_producto1 = dsc_cod_producto;
  f.descripcion_corta = dsc_descrip_corta;
  f.mer_cod_arancel = dsc_partida;
  f.mer_cod_arancel_tratado = cod_arancel_tratado;
  f.mer_nro_correlativo_arancel = correlativo;
  f.mer_nro_acuerdo_comercial = nro_acuerdo;
  f.lmer_nro_acuerdo_comercial = nro_acuerdo;
  f.mer_sujeto_cupo = "0";
  f.mer_nombre = mer_nombre;
  f.ume_id = "6";  // K.NETO
  f.lume_id = "6";
  f.mer_cantidad = mer_cantidad;
  f.mer_cantidad_mercancia_um = "0.000000";
  f.mer_fob_unitario = mer_fob_unitario;
  f.mer_valor_cif_item = mer_valor_cif_item;
  f.mer_total_neto = total_neto_item.toString();
  f.mer_monto_ajuste_item = mer_monto_ajuste;
  f.mer_sig_ajuste = "+";
  f.mer_porc_advalorem = mer_porc_advalorem;
  f.mer_cuenta_advalorem = mer_cuenta_advalorem;
  f.mer_mto_cta_advalorem = mer_mto_cta_advalorem;
  // Obs 1: peso
  f.mer_cod_obs1 = "99";
  f.lmer_cod_obs1 = "99";
  f.mer_obs1 = mer_obs1;
  // IVA
  f.mer_porc_otro1 = "19.000";
  f.mer_cod_otro1 = "178";
  f.mer_signo_otro1 = "+";
  f.mer_monto_impto_otro1 = mer_monto_impto_otro1;
  // Limpiar otros
  f.mer_cod_obs2 = "";
  f.mer_obs2 = "";
  f.mer_porc_otro2 = "0.000";
  f.mer_cod_otro2 = "";
  f.mer_monto_impto_otro2 = "0.00";
  f.mer_cod_obs3 = "";
  f.mer_obs3 = "";
  f.mer_porc_otro3 = "0.000";
  f.mer_cod_otro3 = "";
  f.mer_monto_impto_otro3 = "0.00";
  f.mer_porc_otro4 = "0.000";
  f.mer_cod_otro4 = "";
  f.mer_monto_impto_otro4 = "0.00";
  f.mer_cod_obs4 = "";
  // Control
  f.mer_nro_item = "";
  f.comando = "U";

  console.log("  Campos a enviar:", Object.keys(f).length);
  console.log("  mer_cod_arancel:", f.mer_cod_arancel);
  console.log("  mer_nombre:", f.mer_nombre.slice(0, 80));
  console.log("  mer_cantidad:", f.mer_cantidad);
  console.log("  mer_fob_unitario:", f.mer_fob_unitario);
  console.log("  mer_valor_cif_item:", f.mer_valor_cif_item);
  console.log("  mer_porc_advalorem:", f.mer_porc_advalorem);
  console.log("  IVA:", f.mer_porc_otro1, "cod:", f.mer_cod_otro1, "monto:", f.mer_monto_impto_otro1);

  // POST
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) body.set(k, v ?? "");
  
  const grabarRes = await fetch(MERC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: formUrl },
    body: body.toString(),
  });
  console.log("\n  POST comando=U:", grabarRes.status);

  // ============================================================
  // VERIFICACIÓN
  // ============================================================
  console.log("\n--- VERIFICACIÓN ---");
  // Cargar ítem 1
  const verBody = new URLSearchParams();
  verBody.set("lib_base", "1");
  verBody.set("lib_nid", OP);
  verBody.set("lbac_nid", "0");
  verBody.set("dus_tipo_envio", "2");
  verBody.set("mer_nro_item", "1");
  verBody.set("comando", "M");
  verBody.set("pagno", "0");

  const verRes = await fetch(MERC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck },
    body: verBody.toString(),
  });
  const verHtml = await verRes.text();
  const v2 = extractFields(verHtml);

  console.log("  mer_cod_arancel:", v2.mer_cod_arancel);
  console.log("  mer_cod_arancel_tratado:", v2.mer_cod_arancel_tratado);
  console.log("  mer_nro_acuerdo_comercial:", v2.mer_nro_acuerdo_comercial);
  console.log("  mer_nombre:", (v2.mer_nombre || "").slice(0, 80));
  console.log("  mer_cantidad:", v2.mer_cantidad);
  console.log("  mer_fob_unitario:", v2.mer_fob_unitario);
  console.log("  mer_valor_cif_item:", v2.mer_valor_cif_item);
  console.log("  mer_porc_advalorem:", v2.mer_porc_advalorem);
  console.log("  mer_monto_impto_otro1 (IVA):", v2.mer_monto_impto_otro1);
  console.log("  mer_obs1:", v2.mer_obs1);

  const ok = v2.mer_cod_arancel === dsc_partida && 
             v2.mer_cantidad === mer_cantidad &&
             v2.mer_valor_cif_item === mer_valor_cif_item;
  console.log("\n" + (ok ? "✅ MERCANCÍA GRABADA CORRECTAMENTE" : "⚠️ Revisar — algunos valores difieren"));

})().catch(e => { console.error("\n❌ ERROR:", e.message); process.exit(1); });
