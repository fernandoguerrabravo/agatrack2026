/**
 * Test: Graba Módulo Antecedentes Financieros para operación terrestre 190321
 * 
 * - Régimen: 72 (ACEM - ACE35 MERCOSUR)
 * - Cláusula: 8 (OTRA) — debe coincidir con Valores Generales
 * - Días cobranza: 55 (08/06/2026 → 01/08/2026 inclusive)
 * - Certificado: tipo "c", número AR004A35260000635400, fecha 08/06/2026
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };

const BASE_URL = get("ADUANANET_URL") || "https://fguerragodoy.aduananet2.cl";
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");

const nroOperacion = "190321";

console.log("=== Test Antecedentes Terrestre ===");
console.log("Operación:", nroOperacion);
console.log("");

try {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  console.log("[1] Login AduanaNet...");
  await page.goto(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  console.log("[1] ✅ Login OK");
  page.on("dialog", async dialog => { await dialog.accept(); });

  // Cargar módulo Antecedentes
  const antUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("[2] Cargando módulo Antecedentes...");
  await page.goto(antUrl, { waitUntil: "networkidle0" });
  console.log("[2] ✅ Página cargada");

  // Llenar campos
  console.log("[3] Llenando campos...");
  await page.evaluate(() => {
    const frm = document.frm;
    // Régimen: 72 ACEM (ACE35 MERCOSUR)
    frm.reg_id.value = "72";
    if (frm.lreg_id) frm.lreg_id.value = "72";
    // Cláusula compra: 8 (OTRA) — debe coincidir con Valores
    frm.cvt_id.value = "8";
    if (frm.lcvt_id) frm.lcvt_id.value = "8";
    // Forma pago
    frm.fpa_id.value = "1";
    if (frm.lfpa_id) frm.lfpa_id.value = "1";
    // Forma pago tributaria
    frm.fpg_id.value = "4";
    if (frm.lfpg_id) frm.lfpg_id.value = "4";
    // Moneda
    frm.mda_id.value = "13";
    if (frm.lmda_id) frm.lmda_id.value = "13";
    // Divisas
    if (frm.div_id) frm.div_id.value = "";
    if (frm.ldiv_id) frm.ldiv_id.value = "";
    // BCC
    if (frm.bcc_id) frm.bcc_id.value = "";
    if (frm.lbcc_id) frm.lbcc_id.value = "";
    // Días cobranza: 55
    frm.din_dias.value = "55";
    // Valor ex-fábrica: 0
    frm.din_valor_ex_fabrica.value = "0.00";
    // Gastos hasta FOB: 0
    frm.din_gastos_hasta_fob.value = "0.00";
    // Certificado de Origen
    frm.cert_orig_tipo.value = "c"; // independiente
    frm.cert_numero.value = "AR004A35260000635400";
    frm.cert_fecha.value = "08/06/2026";
    // Comando
    frm.comando.value = "U";
  });
  console.log("[3] ✅ Campos llenados");

  // Guardar
  console.log("[4] Guardando...");
  await page.evaluate(() => { document.frm.submit(); });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  console.log("[4] ✅ Guardado");

  console.log("\n📊 Resumen:");
  console.log("  Régimen: 72 (ACEM - MERCOSUR)");
  console.log("  Cláusula: 8 (OTRA)");
  console.log("  Días: 55");
  console.log("  Cert. tipo: c (independiente)");
  console.log("  Cert. número: AR004A35260000635400");
  console.log("  Cert. fecha: 08/06/2026");

  await browser.close();
  console.log("\n✅ Módulo Antecedentes grabado para operación", nroOperacion);
} catch (err) {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
}
