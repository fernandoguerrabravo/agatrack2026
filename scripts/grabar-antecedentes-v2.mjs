#!/usr/bin/env node
/**
 * Graba módulo ANTECEDENTES FINANCIEROS — Op 190248
 * 
 * Reglas de llenado:
 * - bcc_id: vacío
 * - fpg_id: 4 (Sp/IVA C) siempre
 * - din_dias: 60 por defecto
 * - mda_id: 13 (DOLAR USA) siempre
 * - cvt_id: debe coincidir con term_compra de Valores Generales
 * - din_valor_ex_fabrica: valor factura USD solo si EXW, sino 0.00
 * - din_gastos_hasta_fob: solo si EXW con gastos, sino 0.00
 * - reg_id: según tratado del CO (92 = TLCCH-USA para esta op)
 * - cert_orig_tipo/cert_numero/cert_fecha: solo si reg_id ≠ 1
 *   - tipo: "Certificado de origen independiente" (normal) o "en factura" (solo Chile-UE)
 *   - numero: del documento CO, o "S/N" si no tiene
 *   - fecha: fecha emisión del CO
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

(async () => {
  console.log(`\n=== GRABAR ANTECEDENTES FINANCIEROS — Op ${OP} ===\n`);
  const ck = await login();
  console.log("✅ Login OK");

  // 1. Cargar formulario actual
  const url = `${BASE}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await (await fetch(url, { headers: { Cookie: ck } })).text();
  const f = extractFields(html);
  console.log("Campos cargados:", Object.keys(f).length);

  // 2. Aplicar reglas de llenado
  // Datos de la operación 190248:
  //   - Incoterm: CFR (código 2) — viene de Valores Generales
  //   - Tratado: TLC Chile-USA → reg_id = 92
  //   - No es EXW → ex_fabrica = 0, gastos_fob = 0
  //   - CO existe → llenar cert_orig

  f.reg_id = "92";                    // TLCCH-USA (del Certificado de Origen)
  f.lreg_id = "92";                   // select sincronizado
  f.bcc_id = "";                      // vacío siempre
  f.lbcc_id = "";                     // vacío siempre
  f.fpa_id = "1";                     // COB1 (forma de pago)
  f.lfpa_id = "1";
  f.din_dias = "60";                  // 60 días por defecto
  f.mda_id = "13";                    // DOLAR USA siempre
  f.lmda_id = "13";
  f.div_id = "1";                     // MERC.CAMB.FORMAL
  f.ldiv_id = "1";
  f.cvt_id = "2";                     // CFR — coincide con term_compra de Valores Generales
  f.lcvt_id = "2";
  f.din_valor_ex_fabrica = "0.00";    // No es EXW
  f.fpg_id = "4";                     // Sp/IVA C siempre
  f.lfpg_id = "4";
  f.din_gastos_hasta_fob = "0.00";    // No es EXW
  
  // Certificado de Origen (reg_id ≠ 1, hay tratado)
  // El popup cert_orig.php setea estos valores antes del submit:
  //   cert_orig_tipo: "c" = independiente, "f" = en factura (solo Chile-UE)
  // Datos reales del CO en BD (op 190248):
  //   - No tiene numero_certificado → "S/N"
  //   - Fecha: representante_legal_autorizado.fecha_firma = "22/04/2026"
  f.cert_orig_tipo = "c";             // Certificado de origen independiente
  f.cert_numero = "S/N";              // No tiene número
  f.cert_fecha = "22/04/2026";        // fecha_firma del representante legal

  f.comando = "U";                    // Aceptar

  console.log("\nValores a grabar:");
  console.log("  reg_id:", f.reg_id, "| bcc_id:", f.bcc_id, "| fpa_id:", f.fpa_id);
  console.log("  din_dias:", f.din_dias, "| mda_id:", f.mda_id, "| div_id:", f.div_id);
  console.log("  cvt_id:", f.cvt_id, "| fpg_id:", f.fpg_id);
  console.log("  din_valor_ex_fabrica:", f.din_valor_ex_fabrica, "| din_gastos_hasta_fob:", f.din_gastos_hasta_fob);
  console.log("  cert_orig_tipo:", f.cert_orig_tipo, "| cert_numero:", f.cert_numero, "| cert_fecha:", f.cert_fecha);

  // 3. POST (submit con comando=U)
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) body.set(k, v ?? "");
  
  const grabar = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ck, Referer: url },
    body: body.toString(),
    redirect: "manual",
  });
  console.log("\nPOST comando=U:", grabar.status);
  if (grabar.status === 302 || grabar.status === 301) {
    console.log("  Redirect:", grabar.headers.get("location"));
  }

  // 4. Verificar — recargar el form y comparar
  const html2 = await (await fetch(url, { headers: { Cookie: ck } })).text();
  const f2 = extractFields(html2);
  
  console.log("\n=== VERIFICACIÓN ===");
  console.log("  reg_id:", f2.reg_id, "| bcc_id:", f2.bcc_id, "| fpa_id:", f2.fpa_id);
  console.log("  din_dias:", f2.din_dias, "| mda_id:", f2.mda_id, "| div_id:", f2.div_id);
  console.log("  cvt_id:", f2.cvt_id, "| fpg_id:", f2.fpg_id);
  console.log("  din_valor_ex_fabrica:", f2.din_valor_ex_fabrica, "| din_gastos_hasta_fob:", f2.din_gastos_hasta_fob);
  console.log("  cert_orig_tipo:", f2.cert_orig_tipo, "| cert_numero:", f2.cert_numero, "| cert_fecha:", f2.cert_fecha);

  // Validar
  const checks = [
    ["reg_id", "92"], ["fpa_id", "1"], ["din_dias", "60"],
    ["mda_id", "13"], ["cvt_id", "2"], ["fpg_id", "4"],
    ["din_valor_ex_fabrica", "0.00"], ["din_gastos_hasta_fob", "0.00"],
    ["cert_orig_tipo", "c"], ["cert_numero", "S/N"], ["cert_fecha", "22/04/2026"],
  ];
  const failed = checks.filter(([k, expected]) => f2[k] !== expected);
  if (failed.length === 0) {
    console.log("\n✅ GUARDADO CORRECTO — todos los campos coinciden.");
  } else {
    console.log("\n⚠️ DIFERENCIAS:");
    failed.forEach(([k, expected]) => console.log(`  ${k}: esperado "${expected}", obtenido "${f2[k]}"`));
  }

})().catch(e => { console.error("\n❌ ERROR:", e.message); process.exit(1); });
