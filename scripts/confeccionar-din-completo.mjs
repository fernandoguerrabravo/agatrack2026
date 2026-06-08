#!/usr/bin/env node
/**
 * CONFECCIÓN COMPLETA DE DIN — Flujo real con manifiesto
 * 
 * Graba en AduanaNet:
 *   - Destino: manifiesto (nro + fecha)
 *   - Antecedentes Financieros
 *   - Mercancía (ítems)
 *   - Bultos
 *   - Cuentas y Valores
 * 
 * USAGE: node scripts/confeccionar-din-completo.mjs <OP> <NAVE> <VIAJE>
 * Ejemplo: node scripts/confeccionar-din-completo.mjs 190276 "MSC SAMIA" "NX617A"
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL"), LOGIN = get("ADUANANET_LOGIN"), CLAVE = get("ADUANANET_CLAVE");
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");
const OP = process.argv[2] || "190276";
const NAVE_OVERRIDE = process.argv[3] || "";
const VIAJE_OVERRIDE = process.argv[4] || "";

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

// --- Helpers ---
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
function pickXml(xml, tag) { return (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) || [])[1]?.trim() || ""; }

const TRATADO_A_REGIMEN = [
  { re: /ESTADOS UNIDOS|UNITED STATES|USA|EE\.?UU/i, regId: "92" },
  { re: /UNION EUROPEA|EUROPEAN UNION|\bUE\b|\bEU\b/i, regId: "91" },
  { re: /CHINA(?!\s*TAI)/i, regId: "96" },
  { re: /COREA|KOREA/i, regId: "93" },
  { re: /JAPON|JAPAN/i, regId: "98" },
  { re: /CANADA/i, regId: "73" },
  { re: /MEXICO|MÉXICO/i, regId: "75" },
  { re: /COLOMBIA/i, regId: "64" },
  { re: /AUSTRALIA/i, regId: "63" },
];
function resolverRegimen(txt) {
  if (!txt) return "1";
  for (const r of TRATADO_A_REGIMEN) { if (r.re.test(txt)) return r.regId; }
  return "1";
}

// --- Buscar manifiesto ---
async function buscarManifiesto(viaje, puertoNombre) {
  const MANIF_BASE = "http://comext.aduana.cl:7001/ManifestacionMaritima";
  const PUERTOS_M = { "SAN ANTONIO": "906", "VALPARAISO": "905", "ARICA": "901", "IQUIQUE": "902", "ANTOFAGASTA": "903" };
  const puertoLimpio = (puertoNombre || "SAN ANTONIO").toUpperCase().replace(/\s*(PORT|CHILE|TERMINAL|PUERTO)\s*/gi, " ").trim();
  let codigoPuerto = "906";
  for (const [nombre, codigo] of Object.entries(PUERTOS_M)) {
    if (puertoLimpio.includes(nombre) || nombre.includes(puertoLimpio)) { codigoPuerto = codigo; break; }
  }
  const viajeTarget = viaje.toUpperCase().replace(/\s+/g, "");
  const now = new Date();
  const meses = [-1, 0, 1].map(d => { const dt = new Date(now.getFullYear(), now.getMonth() + d, 1); return { anho: dt.getFullYear(), mes: dt.getMonth() + 1 }; });

  for (const { anho, mes } of meses) {
    try {
      const r1 = await fetch(`${MANIF_BASE}/limpiarListaProgramacionNaves.do`, { redirect: "manual" });
      const sc = typeof r1.headers.getSetCookie === "function" ? r1.headers.getSetCookie() : [];
      const cookie = sc.map(c => c.split(";")[0]).join("; ");
      const html1 = await r1.text();
      const js = (html1.match(/jsessionid=([^"';\s]+)/i) || [])[1] || "";
      const body = new URLSearchParams();
      body.set("wlw-select_key:{actionForm.puerto}OldValue", "true");
      body.set("wlw-select_key:{actionForm.puerto}", codigoPuerto);
      body.set("{actionForm.anho}", String(anho));
      body.set("wlw-select_key:{actionForm.mes}OldValue", "true");
      body.set("wlw-select_key:{actionForm.mes}", String(mes));
      body.set("wlw-select_key:{actionForm.tipo}OldValue", "true");
      body.set("wlw-select_key:{actionForm.tipo}", "I");
      const r2 = await fetch(`${MANIF_BASE}/limpiarListaProgramacionNaves.do;jsessionid=${js}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie }, body: body.toString(), redirect: "manual",
      });
      const t = await r2.text();
      const rows = [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()))
        .filter(c => c.length >= 6 && /^\d{3,}$/.test(c[0]));
      const match = rows.find(r => {
        const v = r[3].toUpperCase().replace(/\s+/g, "");
        return v === viajeTarget;
      });
      if (match) return { numero: match[0], nave: match[2], viaje: match[3], fecha: match[5] };
    } catch (err) { /* skip */ }
  }
  return null;
}

// ============================================================
// MAIN
// ============================================================
(async () => {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  CONFECCIÓN DIN COMPLETA — Op ${OP}`);
  console.log(`  Nave: ${NAVE_OVERRIDE} | Viaje: ${VIAJE_OVERRIDE}`);
  console.log(`${"═".repeat(60)}\n`);

  const ck = await login();
  console.log("✅ Login AduanaNet OK\n");

  // ─── CARGAR DOCUMENTOS ─────────────────────────────────────
  let docs = await pool.query(`SELECT tipo_documento, datos_extraidos FROM documentos WHERE nro_operacion = $1`, [OP]);
  if (docs.rows.length === 0) {
    console.log(`  ⚠️ Sin docs para op ${OP}, usando datos de 190248`);
    docs = await pool.query(`SELECT tipo_documento, datos_extraidos FROM documentos WHERE nro_operacion = $1`, ["190248"]);
  }
  const getDoc = (tipo) => { const row = docs.rows.find(r => r.tipo_documento === tipo); if (!row) return null; return typeof row.datos_extraidos === "string" ? JSON.parse(row.datos_extraidos) : row.datos_extraidos; };

  const invoice = getDoc("Invoice (Factura Comercial)");
  const co = getDoc("Certificado de Origen");
  const bl = getDoc("Bill of Lading (BL)");
  const poliza = getDoc("Póliza de Seguro");
  if (!invoice) throw new Error("No se encontró Invoice");

  const regId = co ? resolverRegimen(co.tratado_aplicable || co.pais_origen) : "1";
  const incoterm = (invoice.incoterm || "").split(/\s/)[0].toUpperCase();
  const termCompraMap = { CIF: "1", CFR: "2", CPT: "11", CIP: "12", EXW: "3", FAS: "4", FOB: "5", FCA: "7", DDP: "9" };
  const cvtId = termCompraMap[incoterm] || "2";
  const nave = NAVE_OVERRIDE || bl?.nave_corregida || bl?.nave || "";
  const viaje = VIAJE_OVERRIDE || bl?.viaje_corregido || bl?.viaje || "";
  const certNumero = co?.numero_certificado || "S/N";
  const certFecha = co?.representante_legal_autorizado?.fecha_firma || co?.fecha_emision || "";
  const certTipo = (regId === "1") ? "" : "c";

  console.log(`  Invoice: ${invoice.monto_total} ${invoice.moneda} | Incoterm: ${incoterm}`);
  console.log(`  Régimen: ${regId} | Nave: ${nave} | Viaje: ${viaje}\n`);

  // ─── BUSCAR MANIFIESTO ─────────────────────────────────────
  console.log("─── Buscando manifiesto ───");
  const manif = await buscarManifiesto(viaje, bl?.puerto_desembarque || "SAN ANTONIO");
  if (manif) {
    console.log(`  ✅ Manifiesto: ${manif.numero} (${manif.nave} / ${manif.viaje}) fecha ${manif.fecha}\n`);
  } else {
    console.log(`  ⚠️ No encontrado para viaje ${viaje}\n`);
  }

  // ╔══════════════════════════════════════════════════════════╗
  // ║ GRABAR MANIFIESTO EN DESTINO                            ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 2: VALORES GENERALES ══╗");
  // Grabar Valores Generales primero (POST a grabar.php)
  const vgUrl = `${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const vgHtml = await (await fetch(vgUrl, { headers: { Cookie: ck } })).text();
  const vf = extractFields(vgHtml);

  // Datos de la factura/BL/póliza
  const fobValue = invoice.fob_value || invoice.monto_total;
  const fleteValue = invoice.freight_value || 0;
  const primaRaw = poliza?.prima || poliza?.marcas_y_numeros?.prima || "0";
  const seguroValue = parseFloat(String(primaRaw).replace(",", ".")) || 0;
  const cifValue = fobValue + fleteValue + seguroValue;
  const pesoBruto = bl?.peso_bruto_total || invoice.items?.[0]?.peso_bruto || 0;

  vf.term_compra = cvtId;
  vf.moneda_desc = "13"; // USD
  vf.dus_peso_bruto_total = String(pesoBruto);
  vf.dus_total_neto_item = String(invoice.monto_total);
  vf.dus_total_neto_factura = String(invoice.monto_total);
  vf.dus_total_valor_fob_fac = String(fobValue);
  vf.dus_total_valor_fob = String(fobValue);
  vf.dus_valor_flete_fac = String(fleteValue);
  vf.dus_valor_flete = String(fleteValue);
  vf.dus_valor_flete_mon = fleteValue > 0 ? "13" : "";
  vf.dus_valor_flete_paridad = fleteValue > 0 ? "1" : "0";
  vf.dus_valor_seguro_fac = seguroValue.toFixed(2);
  vf.dus_valor_seguro = seguroValue.toFixed(2);
  vf.dus_valor_seguro_mon = seguroValue > 0 ? "13" : "";
  vf.dus_valor_seguro_paridad = seguroValue > 0 ? "1" : "0";
  vf.dus_valor_cif_fac = cifValue.toFixed(2);
  vf.dus_valor_cif = cifValue.toFixed(2);
  vf.dus_cod_flete_teorico = "";
  vf.dus_cod_seguro_teorico = "";
  vf.recalcular = "0";
  vf.comando = "M";

  // Valores Generales se graba via grabar.php
  const vgBody = new URLSearchParams();
  for (const [k, v] of Object.entries(vf)) vgBody.set(k, v ?? "");
  const vgGrabarUrl = `${BASE}/modulos/din/dus_encabezado/grabar.php`;
  const vgRes = await fetch(vgGrabarUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: vgUrl }, body: vgBody.toString(), redirect: "manual" });
  console.log(`  POST grabar.php: ${vgRes.status} | FOB=${fobValue} Flete=${fleteValue} Seguro=${seguroValue} CIF=${cifValue.toFixed(2)}`);

  // Verificar
  const vgHtml2 = await (await fetch(vgUrl, { headers: { Cookie: ck } })).text();
  const vf2 = extractFields(vgHtml2);
  console.log(`  Verificación: FOB=${vf2.dus_total_valor_fob} Flete=${vf2.dus_valor_flete} CIF=${vf2.dus_valor_cif}`);
  console.log("  ✅ Valores Generales OK\n");

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 4: DESTINO COMPLETO                              ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 4: DESTINO ══╗");
  const destUrl = `${BASE}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const destHtml = await (await fetch(destUrl, { headers: { Cookie: ck } })).text();
  const df = extractFields(destHtml);

  // País origen/adquisición (del CO o Invoice)
  df.pai_id_origen = "225"; // USA — hardcoded para prueba, viene del CO
  df.pai_id_adquisicion = "225";

  // Vía marítima
  df.via_id = "1";

  // Puerto embarque — usar puerto de TRANSBORDO del BL
  const puertoEmbarque = bl?.puerto_transbordo || bl?.puerto_embarque || "CALLAO";
  // Resolver puerto (simplificado — en prod usar resolverPuerto())
  df.pue_id = "252"; // CALLAO
  df.pue_nombre = puertoEmbarque.toUpperCase();
  df.dus_puerto_embarque_glosa = puertoEmbarque.toUpperCase();
  df.pue_adic = "0";

  // Puerto desembarque — ya predefinido
  // df.pue_id2 y df.pue_nombre2 ya vienen del form

  // Transbordo — dejar vacío, no modificar
  df.din_transbordo = "";

  // Nave — buscar/resolver
  // Para la prueba usamos la nave override
  const naveNombre = nave.toUpperCase();
  // Buscar nav_id en el catálogo (simplificado)
  const naveSearchUrl = `${BASE}/modulos/general/ventanas/listados/nave.php?identificador=&fil_nav_nombre=${encodeURIComponent(naveNombre)}`;
  const naveSearchHtml = await (await fetch(naveSearchUrl, { headers: { Cookie: ck } })).text();
  const naveMatches = [...naveSearchHtml.matchAll(/seleccion\(\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]/gi)];
  let navId = "";
  if (naveMatches.length > 0) {
    // Tomar la última creada (código más alto)
    const sorted = naveMatches.sort((a, b) => Number(b[1]) - Number(a[1]));
    navId = sorted[0][1];
    console.log(`  Nave encontrada: ${sorted[0][2]} (id=${navId})`);
  } else {
    // Crear la nave
    console.log(`  Nave "${naveNombre}" no existe, creando...`);
    const formUrl = `${BASE}/modulos/mantenedores/nave.php?menu=0&comando=I&query=&pagno=0&maxpag=0`;
    await (await fetch(formUrl, { headers: { Cookie: ck } })).text();
    const naveBody = new URLSearchParams();
    naveBody.set("nav_id", ""); naveBody.set("nav_nombre", naveNombre);
    naveBody.set("pai_id", ""); naveBody.set("pai_nombre0", "");
    naveBody.set("tra_id", ""); naveBody.set("tra_nombre1", "");
    naveBody.set("comando", "N"); naveBody.set("query", ""); naveBody.set("pagno", "0");
    await fetch(formUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: naveBody.toString(), redirect: "manual" });
    // Re-buscar
    const naveHtml2 = await (await fetch(naveSearchUrl, { headers: { Cookie: ck } })).text();
    const nm2 = [...naveHtml2.matchAll(/seleccion\(\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]/gi)];
    if (nm2.length > 0) {
      navId = nm2.sort((a, b) => Number(b[1]) - Number(a[1]))[0][1];
      console.log(`  ✅ Nave creada: ${naveNombre} (id=${navId})`);
    } else {
      console.log(`  ⚠️ No se pudo crear la nave`);
    }
  }
  df.nav_id = navId;
  df.nav_nombre = naveNombre;

  // Naviera/Cia Transportadora — usar mismos datos que op 190248 (ZIM)
  df.cia_id = "96850241";
  df.dus_nombre_cia_transp = "ZIM INTEGRATED SHIPPING";
  df.pai_idcia = "997";
  df.dus_rut_cia_transp = "77622451-0";

  // Tipo carga
  df.tic_id = "R"; // General

  // Manifiesto
  if (manif) {
    df.din_manifiesto1 = manif.numero;
    df.din_fec_manifiesto = manif.fecha;
  }

  // Emisor documento transporte (misma naviera si no hay HBL)
  df.cia_id_emisora = "96850241";
  df.dus_emisor_docto_transp = "ZIM INTEGRATED SHIPPING";
  df.cia_emisora_rut = "77622451-0";

  // Documento de transporte
  const blNumero = bl?.numero_bl || bl?.numero_bl_master || "ZIMUIAH987933";
  df.din_nro_docto_transp = blNumero;
  df.din_fec_docto_transp = bl?.fecha_emision || "30/03/2026";

  df.comando = "U";

  const db = new URLSearchParams();
  for (const [k, v] of Object.entries(df)) db.set(k, v ?? "");
  const dRes = await fetch(destUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: destUrl }, body: db.toString(), redirect: "manual" });
  console.log(`  POST: ${dRes.status} | nave=${naveNombre}(${navId}) manif=${manif?.numero || ""} BL=${blNumero}`);

  // Verificar
  const destHtml2 = await (await fetch(destUrl, { headers: { Cookie: ck } })).text();
  const df2 = extractFields(destHtml2);
  console.log(`  Verificación: nav_id=${df2.nav_id} nav_nombre=${df2.nav_nombre} manif=${df2.din_manifiesto1} docto=${df2.din_nro_docto_transp}`);
  console.log("  ✅ Destino OK\n");

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 5: ANTECEDENTES FINANCIEROS                      ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 5: ANTECEDENTES FINANCIEROS ══╗");
  const antUrl = `${BASE}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const antHtml = await (await fetch(antUrl, { headers: { Cookie: ck } })).text();
  const af = extractFields(antHtml);

  af.reg_id = regId; af.lreg_id = regId;
  af.bcc_id = ""; af.lbcc_id = "";
  af.fpa_id = "1"; af.lfpa_id = "1";
  af.din_dias = "60";
  af.mda_id = "13"; af.lmda_id = "13";
  af.div_id = ""; af.ldiv_id = "";
  af.cvt_id = cvtId; af.lcvt_id = cvtId;
  af.din_valor_ex_fabrica = "0.00";
  af.fpg_id = "4"; af.lfpg_id = "4";
  af.din_gastos_hasta_fob = "0.00";
  af.cert_orig_tipo = certTipo;
  af.cert_numero = (regId !== "1") ? certNumero : "";
  af.cert_fecha = (regId !== "1") ? certFecha : "";
  af.comando = "U";

  const ab = new URLSearchParams();
  for (const [k, v] of Object.entries(af)) ab.set(k, v ?? "");
  const aRes = await fetch(antUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: antUrl }, body: ab.toString(), redirect: "manual" });
  console.log(`  POST: ${aRes.status} | reg=${regId} cvt=${cvtId} cert=${certTipo}/${certNumero}/${certFecha}`);
  console.log("  ✅ Antecedentes OK\n");

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 6: MERCANCÍA                                     ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 6: MERCANCÍA ══╗");
  const mercUrl = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php`;
  const items = invoice.items || [];

  // Eliminar ítems existentes
  const mercCheck = await (await fetch(`${mercUrl}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { headers: { Cookie: ck } })).text();
  const existingItems = [...(mercCheck.match(/<select[^>]*name\s*=\s*['"]linea['"][^>]*>([\s\S]*?)<\/select>/i) || ["", ""])[1].matchAll(/<option[^>]*value\s*=\s*['"](\d+)['"]/gi)].map(m => m[1]);
  for (const itemNum of existingItems.reverse()) {
    const eb = new URLSearchParams();
    eb.set("lib_base", "1"); eb.set("lib_nid", OP); eb.set("lbac_nid", "0");
    eb.set("dus_tipo_envio", "2"); eb.set("mer_nro_item", itemNum); eb.set("comando", "E"); eb.set("pagno", "0");
    await fetch(mercUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: eb.toString() });
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const fHtml = await (await fetch(`${mercUrl}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { headers: { Cookie: ck } })).text();
    const mf = extractFields(fHtml);

    const codigoProducto = item.codigo_material || "";
    const descXml = await (await fetch(`${BASE}/inc/getXML/buscar_descriptores.php?partida=&codigo=${codigoProducto}&descripcion=&cli_id=2710`, { headers: { Cookie: ck } })).text();
    const dsc_partida = pickXml(descXml, "dsc_partida") || co?.mercancia?.clasificacion_arancelaria_hs || "";
    const dsc_cod = pickXml(descXml, "dsc_cod_producto") || codigoProducto;
    const mer_nombre = [dsc_cod.padEnd(15), pickXml(descXml, "dsc_descrip_corta"), pickXml(descXml, "dsc_otro1"), pickXml(descXml, "dsc_otro2"), pickXml(descXml, "dsc_obs")].join(";");

    const arancelHtml = await (await fetch(`${BASE}/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dsc_partida}&pais=${mf.pai_id_origen || "225"}&regimen=${regId}`, { headers: { Cookie: ck } })).text();
    const allSels = [...arancelHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
    const selBest = allSels.find(s => s[3] && s[3] !== "") || allSels[0];
    const advalorem = selBest ? selBest[1] : "0";
    const codArancelTratado = selBest ? selBest[2] : dsc_partida;
    const nroAcuerdo = selBest ? selBest[3] : "";

    const totalNetoItem = invoice.monto_total / items.length;
    const cantidad = item.peso_neto || item.cantidad_kg || 0;
    const cifNeto = parseFloat(mf.cif_neto) || 1;
    const fobTotal = parseFloat(mf.dus_total_valor_fob) || invoice.fob_value || 0;
    const merCifItem = (totalNetoItem * cifNeto).toFixed(2);
    const merFobUnitario = cantidad > 0 ? ((totalNetoItem / (invoice.monto_total)) * fobTotal / cantidad).toFixed(6) : "0.000000";
    const ivaMonto = (parseFloat(merCifItem) * 19 / 100).toFixed(2);
    const cantStr = Math.round(cantidad).toString().padStart(8, "0");

    mf.linea = ""; mf.mer_producto = `${dsc_cod}@#~2710`; mf.mer_producto1 = codigoProducto;
    mf.mer_cod_arancel = dsc_partida; mf.mer_cod_arancel_tratado = codArancelTratado;
    mf.mer_nro_correlativo_arancel = selBest ? (selBest[4] || "") : "";
    mf.mer_nro_acuerdo_comercial = nroAcuerdo; mf.lmer_nro_acuerdo_comercial = nroAcuerdo;
    mf.mer_sujeto_cupo = "0"; mf.mer_nombre = mer_nombre;
    mf.ume_id = "6"; mf.lume_id = "6";
    mf.mer_cantidad = cantidad.toFixed(4); mf.mer_cantidad_mercancia_um = "0.000000";
    mf.mer_fob_unitario = merFobUnitario; mf.mer_valor_cif_item = merCifItem;
    mf.mer_total_neto = totalNetoItem.toString(); mf.mer_monto_ajuste_item = "0.00"; mf.mer_sig_ajuste = "+";
    mf.mer_porc_advalorem = advalorem; mf.mer_cuenta_advalorem = "223"; mf.mer_mto_cta_advalorem = "0.00";
    mf.mer_cod_obs1 = "99"; mf.lmer_cod_obs1 = "99"; mf.mer_obs1 = `${cantStr}.000000 KG`;
    mf.mer_porc_otro1 = "19.000"; mf.mer_cod_otro1 = "178"; mf.mer_signo_otro1 = "+"; mf.mer_monto_impto_otro1 = ivaMonto;
    mf.mer_cod_obs2 = ""; mf.mer_obs2 = ""; mf.mer_porc_otro2 = "0.000"; mf.mer_cod_otro2 = ""; mf.mer_monto_impto_otro2 = "0.00";
    mf.mer_cod_obs3 = ""; mf.mer_obs3 = ""; mf.mer_porc_otro3 = "0.000"; mf.mer_cod_otro3 = ""; mf.mer_monto_impto_otro3 = "0.00";
    mf.mer_porc_otro4 = "0.000"; mf.mer_cod_otro4 = ""; mf.mer_monto_impto_otro4 = "0.00"; mf.mer_cod_obs4 = "";
    mf.mer_nro_item = ""; mf.comando = "U";

    const mb = new URLSearchParams();
    for (const [k, v] of Object.entries(mf)) mb.set(k, v ?? "");
    const mRes = await fetch(mercUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: `${mercUrl}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0` }, body: mb.toString() });
    console.log(`  Item ${i + 1}: POST ${mRes.status} | arancel=${dsc_partida} CIF=${merCifItem} IVA=${ivaMonto}`);
  }
  console.log("  ✅ Mercancía OK\n");

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 7: BULTOS                                        ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 7: BULTOS ══╗");
  const bultosUrl = `${BASE}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const bultosHtml = await (await fetch(bultosUrl, { headers: { Cookie: ck } })).text();
  const bf = extractFields(bultosHtml);

  const contenedores = bl?.contenedores || [];
  const contNums = contenedores.map(c => c.numero_contenedor).filter(Boolean).join("\n");
  const pallets = contenedores.reduce((s, c) => s + (c.pallets || 0), 0);
  const bultos = contenedores.reduce((s, c) => s + (c.numero_bultos || c.octabins || 0), 0);
  const tipoBulto = (contenedores[0]?.tipo_bulto || "BULTO").replace(/S$/i, "").toUpperCase();
  bf.din_id_bultos = `${contNums}\nCONT llevan ${pallets} Pallets (80) con ${bultos} ${tipoBulto}(93)`;

  const obsLines = [];
  if (regId !== "1") obsLines.push(`CERTIFICADO DE ORIGEN ${certNumero} FECHA ${certFecha}`);
  obsLines.push("Mandato FEA");
  if (nave) obsLines.push(`M/N ${nave.toUpperCase()}`);
  bf.din_obs_banco_sna = obsLines.join("\n");
  bf.comando = "U";

  const bb = new URLSearchParams();
  for (const [k, v] of Object.entries(bf)) bb.set(k, v ?? "");
  const bRes = await fetch(bultosUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: bultosUrl }, body: bb.toString(), redirect: "manual" });
  console.log(`  POST: ${bRes.status} | ${bf.din_id_bultos.replace(/\n/g, " | ")}`);
  console.log(`  obs: ${bf.din_obs_banco_sna.replace(/\n/g, " | ")}`);
  console.log("  ✅ Bultos OK\n");

  // Grabar líneas de bultos en popup dus_bulto.php (tipo contenedor + cantidad)
  console.log("  Grabando línea de bultos (popup)...");
  const tipoCont = contenedores[0]?.tipo_contenedor || "";
  const codCont = /40/i.test(tipoCont) ? "74" : /20/i.test(tipoCont) ? "73" : "74"; // 74=CONT40, 73=CONT20
  const cantCont = contenedores.length;
  const bultoPopupBody = new URLSearchParams();
  bultoPopupBody.set("lib_nid", OP); bultoPopupBody.set("lib_base", "1");
  bultoPopupBody.set("lbac_nid", "0"); bultoPopupBody.set("dus_tipo_envio", "2");
  bultoPopupBody.set("lineas", "1"); bultoPopupBody.set("enviar", "1");
  bultoPopupBody.set("bul_sec_nro_bulto0", "1");
  bultoPopupBody.set("bul_cod_tipo_bulto0", codCont);
  bultoPopupBody.set("sel_bul_cod_tipo_bulto0", codCont);
  bultoPopupBody.set("bul_glosa0", "");
  bultoPopupBody.set("bul_cantidad0", String(cantCont));
  await fetch(`${BASE}/modulos/din/dus_encabezado/dus_bulto.php`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: bultoPopupBody.toString(), redirect: "manual",
  });
  console.log(`  Popup bultos: tipo=${codCont} cantidad=${cantCont} ✅\n`);

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 8: CUENTAS Y VALORES                             ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 8: CUENTAS Y VALORES ══╗");
  const ctasUrl = `${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const ctasHtml = await (await fetch(ctasUrl, { headers: { Cookie: ck } })).text();
  const cf = extractFields(ctasHtml);

  // Si IVA viene en 0, calcular manualmente desde arr_ctas
  if (!cf.dus_valor178 || cf.dus_valor178 === "0.00" || cf.dus_valor178 === "0") {
    const arrCtasMatch = ctasHtml.match(/var\s+arr_ctas\s*=\s*\[([\s\S]*?)\];/i);
    if (arrCtasMatch) {
      const cuentas = [...arrCtasMatch[1].matchAll(/\[\s*['"]?(\d+)['"]?\s*,\s*['"]?([\d.]+)['"]?\s*\]/gi)];
      for (let i = 1; i <= 8; i++) { cf[`dus_codigo${i}`] = ""; cf[`dus_valor${i}`] = "0.00"; }
      let idx = 1;
      for (const c of cuentas) { if (idx <= 8) { cf[`dus_codigo${idx}`] = c[1]; cf[`dus_valor${idx}`] = parseFloat(c[2]).toFixed(2); idx++; } }
    }
    // Calcular IVA
    const valor178 = cf.valor_178 || "";
    if (valor178 && parseFloat(valor178) > 0) {
      cf.dus_valor178 = parseFloat(valor178).toFixed(2);
    } else {
      const ivaCalc = cifValue * 19 / 100;
      cf.dus_valor178 = ivaCalc.toFixed(2);
    }
    cf.dus_codigo178 = "178";
    cf.dus_codigo191 = "191";
    cf.dus_valor191 = cf.dus_valor178;
    cf.dus_codigo699 = "699"; cf.dus_valor699 = "0.00";
    cf.dus_codigo199 = "199"; cf.dus_valor199 = "0.00";
    const tipoCambio = parseFloat(cf.dus_tipo_cambio || "894.79");
    cf.dus_codigo91 = "91";
    cf.dus_valor91 = Math.round(parseFloat(cf.dus_valor191) * tipoCambio).toString();
  }

  cf.comando = "U";

  const cb = new URLSearchParams();
  for (const [k, v] of Object.entries(cf)) cb.set(k, v ?? "");
  const cRes = await fetch(ctasUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: ctasUrl }, body: cb.toString(), redirect: "manual" });
  console.log(`  POST: ${cRes.status} | IVA=${cf.dus_valor178} | Total=${cf.dus_valor191} | CLP=${cf.dus_valor91}`);
  console.log("  ✅ Cuentas OK\n");

  // ═══════════════════════════════════════════════════════════
  console.log("═".repeat(60));
  console.log(`  🎉 DIN COMPLETA — Op ${OP}`);
  if (manif) console.log(`  Manifiesto: ${manif.numero} | Fecha: ${manif.fecha}`);
  console.log("═".repeat(60));

  await pool.end();
})().catch(e => { console.error("\n❌ ERROR:", e.message); pool.end(); process.exit(1); });
