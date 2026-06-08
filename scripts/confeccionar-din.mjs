#!/usr/bin/env node
/**
 * CONFECCIÓN COMPLETA DE DIN — Flujo automatizado
 * 
 * Ejecuta los módulos 5 al 8 de la DIN para una operación:
 *   5. Antecedentes Financieros
 *   6. Mercancía (ítems)
 *   7. Bultos
 *   8. Cuentas y Valores
 * 
 * Los módulos 1-4 (Encabezado, Valores Generales, Identificación, Destino)
 * se asumen ya grabados previamente.
 * 
 * USAGE: node scripts/confeccionar-din.mjs [OP_NUMBER]
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
const OP = process.argv[2] || "190248";
// Overrides opcionales: nave y viaje para manifiesto
const NAVE_OVERRIDE = process.argv[3] || "";  // ej: "MSC SAMIAN"
const VIAJE_OVERRIDE = process.argv[4] || ""; // ej: "X617A"

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

// --- AduanaNet auth helpers ---
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

// --- Régimen por tratado ---
const TRATADO_A_REGIMEN = [
  { re: /ESTADOS UNIDOS|UNITED STATES|USA|EE\.?UU/i, regId: "92" },
  { re: /UNION EUROPEA|EUROPEAN UNION|\bUE\b|\bEU\b/i, regId: "91" },
  { re: /CHINA(?!\s*TAI)/i, regId: "96" },
  { re: /COREA|KOREA/i, regId: "93" },
  { re: /JAPON|JAPAN/i, regId: "98" },
  { re: /INDIA/i, regId: "97" },
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

// ============================================================
// MAIN
// ============================================================
(async () => {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  CONFECCIÓN DIN — FLUJO COMPLETO — Op ${OP}`);
  console.log(`${"═".repeat(60)}\n`);

  const ck = await login();
  console.log("✅ Login AduanaNet OK\n");

  // ─── CARGAR DOCUMENTOS DESDE BD ────────────────────────────
  console.log("─── Cargando documentos de la operación ───\n");
  // Si no hay documentos para esta op, usar los de la op 190248 como datos de prueba
  let docs = await pool.query(
    `SELECT tipo_documento, datos_extraidos FROM documentos WHERE nro_operacion = $1`,
    [OP]
  );
  let docsSource = OP;
  if (docs.rows.length === 0) {
    console.log(`  ⚠️ Sin documentos para op ${OP}, usando datos de op 190248 como prueba`);
    docs = await pool.query(
      `SELECT tipo_documento, datos_extraidos FROM documentos WHERE nro_operacion = $1`,
      ["190248"]
    );
    docsSource = "190248";
  }
  const getDoc = (tipo) => {
    const row = docs.rows.find(r => r.tipo_documento === tipo);
    if (!row) return null;
    return typeof row.datos_extraidos === "string" ? JSON.parse(row.datos_extraidos) : row.datos_extraidos;
  };

  const invoice = getDoc("Invoice (Factura Comercial)");
  const co = getDoc("Certificado de Origen");
  const bl = getDoc("Bill of Lading (BL)");
  const poliza = getDoc("Póliza de Seguro");

  if (!invoice) throw new Error("No se encontró Invoice para op " + OP);
  console.log("  Invoice:", invoice.numero_factura, "| monto:", invoice.monto_total, invoice.moneda);
  console.log("  CO:", co ? co.pais_origen : "(sin CO)");
  console.log("  BL:", bl ? bl.contenedores?.length + " contenedores" : "(sin BL)");
  console.log("  Póliza:", poliza ? "prima=" + (poliza.prima || poliza.marcas_y_numeros?.prima) : "(sin póliza)");

  // Determinar incoterm y régimen
  const regId = co ? resolverRegimen(co.tratado_aplicable || co.pais_origen) : "1";
  const incoterm = (invoice.incoterm || "").split(/\s/)[0].toUpperCase(); // "CFR", "FOB", etc.
  const termCompraMap = { CIF: "1", CFR: "2", CPT: "11", CIP: "12", EXW: "3", FAS: "4", FOB: "5", FCA: "7", DDP: "9" };
  const cvtId = termCompraMap[incoterm] || "2";
  
  // Nave (override o del BL)
  const nave = NAVE_OVERRIDE || bl?.nave_corregida || bl?.nave || "";
  const viaje = VIAJE_OVERRIDE || bl?.viaje_corregido || bl?.viaje || "";

  // CO datos
  const certNumero = co?.numero_certificado || "S/N";
  const certFecha = co?.representante_legal_autorizado?.fecha_firma || co?.fecha_emision || "";
  const certTipo = (regId === "1") ? "" : ((regId === "91" && !co?.numero_certificado) ? "f" : "c");

  console.log(`\n  régimen: ${regId} | incoterm: ${incoterm} (cvt_id=${cvtId}) | nave: ${nave}`);
  console.log(`  cert: tipo=${certTipo} num=${certNumero} fecha=${certFecha}`);
  console.log(`  viaje: ${viaje}\n`);

  // ─── BUSCAR MANIFIESTO ─────────────────────────────────────
  let manifiesto = null;
  if (viaje) {
    console.log("─── Buscando manifiesto (comext.aduana.cl) ───");
    const puertoDesembarque = bl?.puerto_desembarque || "SAN ANTONIO";
    // Limpiar el nombre del puerto (quitar "PORT", "CHILE", etc.)
    const puertoLimpio = puertoDesembarque.toUpperCase().replace(/\s*(PORT|CHILE|TERMINAL|PUERTO)\s*/gi, " ").trim();
    // Consultar manifiesto via HTTP (replica aduana-manifiesto.ts)
    const MANIF_BASE = "http://comext.aduana.cl:7001/ManifestacionMaritima";
    const PUERTOS_M = { "SAN ANTONIO": "906", "VALPARAISO": "905", "ARICA": "901", "IQUIQUE": "902", "ANTOFAGASTA": "903" };
    // Buscar coincidencia parcial del puerto
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
          // Match exacto, o viaje del sistema termina con nuestro target (ej: NX617A termina en X617A)
          // o nuestro target termina con el viaje del sistema (pero solo si el viaje tiene 4+ chars)
          return v === viajeTarget || v.endsWith(viajeTarget) || (viajeTarget.endsWith(v) && v.length >= 4);
        });
        if (match) {
          manifiesto = { numero: match[0], nave: match[2], viaje: match[3], fecha: match[5] };
          console.log(`  ✅ Manifiesto encontrado: ${match[0]} (${match[2]} / ${match[3]}) fecha ${match[5]}`);
          break;
        }
      } catch (err) {
        console.log(`  ⚠️ Error consultando ${mes}/${anho}:`, err.message);
      }
    }
    if (!manifiesto) console.log(`  ⚠️ Manifiesto no encontrado para viaje ${viaje} en ${puertoDesembarque}`);
    console.log("");
  }

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
  af.div_id = "1"; af.ldiv_id = "1";
  af.cvt_id = cvtId; af.lcvt_id = cvtId;
  af.din_valor_ex_fabrica = (cvtId === "3") ? String(invoice.fob_value || invoice.monto_total) : "0.00";
  af.fpg_id = "4"; af.lfpg_id = "4";
  af.din_gastos_hasta_fob = "0.00";
  af.cert_orig_tipo = certTipo;
  af.cert_numero = (regId !== "1") ? certNumero : "";
  af.cert_fecha = (regId !== "1") ? certFecha : "";
  af.comando = "U";

  const antBody = new URLSearchParams();
  for (const [k, v] of Object.entries(af)) antBody.set(k, v ?? "");
  const antRes = await fetch(antUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: antUrl }, body: antBody.toString(), redirect: "manual" });
  console.log(`  POST: ${antRes.status} | reg_id=${regId} cvt_id=${cvtId} fpg_id=4 cert=${certTipo}/${certNumero}`);
  console.log("  ✅ Antecedentes OK\n");

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 6: MERCANCÍA (por cada ítem)                     ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 6: MERCANCÍA ══╗");
  const mercUrl = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php`;
  const items = invoice.items || [];
  console.log(`  Items en factura: ${items.length}\n`);

  // Primero eliminar todos los ítems existentes
  const mercCheck = await (await fetch(`${mercUrl}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { headers: { Cookie: ck } })).text();
  const existingItems = [...(mercCheck.match(/<select[^>]*name\s*=\s*['"]linea['"][^>]*>([\s\S]*?)<\/select>/i) || ["", ""])[1].matchAll(/<option[^>]*value\s*=\s*['"](\d+)['"]/gi)].map(m => m[1]);
  for (const itemNum of existingItems.reverse()) {
    const eb = new URLSearchParams();
    eb.set("lib_base", "1"); eb.set("lib_nid", OP); eb.set("lbac_nid", "0");
    eb.set("dus_tipo_envio", "2"); eb.set("mer_nro_item", itemNum); eb.set("comando", "E"); eb.set("pagno", "0");
    await fetch(mercUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck }, body: eb.toString() });
  }
  if (existingItems.length) console.log(`  Eliminados ${existingItems.length} ítems existentes`);

  // Crear cada ítem
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`\n  --- Ítem ${i + 1}/${items.length}: ${(item.descripcion || "").slice(0, 50)} ---`);

    // Cargar form vacío
    const fHtml = await (await fetch(`${mercUrl}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { headers: { Cookie: ck } })).text();
    const mf = extractFields(fHtml);

    // Código de producto
    const codigoProducto = item.codigo_material || "";
    const cliId = mf.empl_id !== "-99" ? mf.empl_id : "2710"; // fallback

    // Buscar descriptor
    const descXml = await (await fetch(`${BASE}/inc/getXML/buscar_descriptores.php?partida=&codigo=${codigoProducto}&descripcion=&cli_id=2710`, { headers: { Cookie: ck } })).text();
    const dsc_partida = pickXml(descXml, "dsc_partida") || (co?.mercancia?.clasificacion_arancelaria_hs || "");
    const dsc_cod = pickXml(descXml, "dsc_cod_producto") || codigoProducto;
    const dsc_desc = pickXml(descXml, "dsc_descrip_corta") || item.descripcion || "";
    const dsc_otro1 = pickXml(descXml, "dsc_otro1") || "";
    const dsc_otro2 = pickXml(descXml, "dsc_otro2") || "";
    const dsc_obs = pickXml(descXml, "dsc_obs") || "";
    const mer_nombre = [dsc_cod.padEnd(15), dsc_desc, dsc_otro1, dsc_otro2, dsc_obs].join(";");

    // Consultar arancel
    const arancelHtml = await (await fetch(`${BASE}/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dsc_partida}&pais=${mf.pai_id_origen || "225"}&regimen=${regId}`, { headers: { Cookie: ck } })).text();
    const allSels = [...arancelHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
    const selBest = allSels.find(s => s[3] && s[3] !== "") || allSels[0];
    const advalorem = selBest ? selBest[1] : "0";
    const codArancelTratado = selBest ? selBest[2] : dsc_partida;
    const nroAcuerdo = selBest ? selBest[3] : "";

    // Calcular valores
    // Para CFR/CPT: el total_neto_item es el monto_total de la factura prorrateado por ítem
    // (incluye flete). Para FOB: solo el FOB. Para CIF: incluye flete+seguro.
    const totalNetoItem = (invoice.monto_total / items.length);  // prorrateo igualitario si hay múltiples ítems
    const cantidad = item.peso_neto || item.cantidad_kg || item.cantidad || 0;
    const totalNetoItemes = invoice.monto_total;
    const fobTotal = parseFloat(mf.dus_total_valor_fob) || invoice.fob_value || 0;
    const cifNeto = parseFloat(mf.cif_neto) || 1;
    const ajusteNeto = parseFloat(mf.ajuste_neto) || 0;

    const merCantidad = cantidad.toFixed(4);
    const merFobUnitario = cantidad > 0 ? ((totalNetoItem / totalNetoItemes) * fobTotal / cantidad).toFixed(6) : "0.000000";
    const merCifItem = (totalNetoItem * cifNeto).toFixed(2);
    const merAjuste = (totalNetoItem * ajusteNeto).toFixed(2);
    const cifVal = parseFloat(merCifItem);
    const ivaBase = cifVal + cifVal * parseFloat(advalorem) / 100;
    const ivaMonto = (ivaBase * 19 / 100).toFixed(2);
    const cantStr = Math.round(cantidad).toString().padStart(8, "0");

    // Setear campos
    mf.linea = "";
    mf.mer_producto = `${dsc_cod}@#~2710`;
    mf.mer_producto1 = codigoProducto;
    mf.descripcion_corta = dsc_desc;
    mf.mer_cod_arancel = dsc_partida;
    mf.mer_cod_arancel_tratado = codArancelTratado;
    mf.mer_nro_correlativo_arancel = selBest ? (selBest[4] || "") : "";
    mf.mer_nro_acuerdo_comercial = nroAcuerdo;
    mf.lmer_nro_acuerdo_comercial = nroAcuerdo;
    mf.mer_sujeto_cupo = "0";
    mf.mer_nombre = mer_nombre;
    mf.ume_id = "6"; mf.lume_id = "6";
    mf.mer_cantidad = merCantidad;
    mf.mer_cantidad_mercancia_um = "0.000000";
    mf.mer_fob_unitario = merFobUnitario;
    mf.mer_valor_cif_item = merCifItem;
    mf.mer_total_neto = totalNetoItem.toString();
    mf.mer_monto_ajuste_item = merAjuste;
    mf.mer_sig_ajuste = "+";
    mf.mer_porc_advalorem = advalorem;
    mf.mer_cuenta_advalorem = "223";
    mf.mer_mto_cta_advalorem = (cifVal * parseFloat(advalorem) / 100).toFixed(2);
    mf.mer_cod_obs1 = "99"; mf.lmer_cod_obs1 = "99";
    mf.mer_obs1 = `${cantStr}.000000 KG`;
    mf.mer_porc_otro1 = "19.000"; mf.mer_cod_otro1 = "178"; mf.mer_signo_otro1 = "+";
    mf.mer_monto_impto_otro1 = ivaMonto;
    mf.mer_cod_obs2 = ""; mf.mer_obs2 = "";
    mf.mer_porc_otro2 = "0.000"; mf.mer_cod_otro2 = ""; mf.mer_monto_impto_otro2 = "0.00";
    mf.mer_cod_obs3 = ""; mf.mer_obs3 = "";
    mf.mer_porc_otro3 = "0.000"; mf.mer_cod_otro3 = ""; mf.mer_monto_impto_otro3 = "0.00";
    mf.mer_porc_otro4 = "0.000"; mf.mer_cod_otro4 = ""; mf.mer_monto_impto_otro4 = "0.00";
    mf.mer_cod_obs4 = "";
    mf.mer_nro_item = "";
    mf.comando = "U";

    const mb = new URLSearchParams();
    for (const [k, v] of Object.entries(mf)) mb.set(k, v ?? "");
    const mRes = await fetch(mercUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: `${mercUrl}?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0` }, body: mb.toString() });
    console.log(`    POST: ${mRes.status} | arancel=${dsc_partida} adval=${advalorem}% CIF=${merCifItem} IVA=${ivaMonto}`);
  }
  console.log("\n  ✅ Mercancía OK\n");

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 7: BULTOS                                        ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 7: BULTOS ══╗");
  const bultosUrl = `${BASE}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const bultosHtml = await (await fetch(bultosUrl, { headers: { Cookie: ck } })).text();
  const bf = extractFields(bultosHtml);

  // Armar din_id_bultos
  const contenedores = bl?.contenedores || [];
  const contNums = contenedores.map(c => c.numero_contenedor).filter(Boolean).join("\n");
  const pallets = contenedores.reduce((s, c) => s + (c.pallets || 0), 0);
  const bultos = contenedores.reduce((s, c) => s + (c.numero_bultos || c.octabins || 0), 0);
  const tipoBulto = (contenedores[0]?.tipo_bulto || "BULTO").replace(/S$/i, "").toUpperCase();
  const codBulto = /PALLET/i.test(tipoBulto) ? "80" : "93"; // BULTONOESP para otros
  bf.din_id_bultos = `${contNums}\nCONT llevan ${pallets} Pallets (80) con ${bultos} ${tipoBulto}(${codBulto})`;

  // Armar din_obs_banco_sna
  const obsLines = [];
  if (regId !== "1") obsLines.push(`CERTIFICADO DE ORIGEN ${certNumero} FECHA ${certFecha}`);
  obsLines.push("Mandato FEA");
  if (nave) obsLines.push(`M/N ${nave.toUpperCase()}`);
  bf.din_obs_banco_sna = obsLines.join("\n");

  bf.comando = "U";

  const bb = new URLSearchParams();
  for (const [k, v] of Object.entries(bf)) bb.set(k, v ?? "");
  const bRes = await fetch(bultosUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: bultosUrl }, body: bb.toString(), redirect: "manual" });
  console.log(`  POST: ${bRes.status}`);
  console.log(`  bultos: ${bf.din_id_bultos.replace(/\n/g, " | ")}`);
  console.log(`  obs: ${bf.din_obs_banco_sna.replace(/\n/g, " | ")}`);
  console.log("  ✅ Bultos OK\n");

  // ╔══════════════════════════════════════════════════════════╗
  // ║ MÓDULO 8: CUENTAS Y VALORES                             ║
  // ╚══════════════════════════════════════════════════════════╝
  console.log("╔══ MÓDULO 8: CUENTAS Y VALORES ══╗");
  const ctasUrl = `${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const ctasHtml = await (await fetch(ctasUrl, { headers: { Cookie: ck } })).text();
  const cf = extractFields(ctasHtml);
  cf.comando = "U";

  const cb = new URLSearchParams();
  for (const [k, v] of Object.entries(cf)) cb.set(k, v ?? "");
  const cRes = await fetch(ctasUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: ctasUrl }, body: cb.toString(), redirect: "manual" });
  console.log(`  POST: ${cRes.status} | IVA=${cf.dus_valor178} | Total=${cf.dus_valor191} | CLP=${cf.dus_valor91}`);
  console.log("  ✅ Cuentas y Valores OK\n");

  // ═══════════════════════════════════════════════════════════
  console.log("═".repeat(60));
  console.log("  🎉 CONFECCIÓN DIN COMPLETA — Op " + OP);
  console.log("═".repeat(60));

  await pool.end();
})().catch(e => { console.error("\n❌ ERROR:", e.message); pool.end(); process.exit(1); });
