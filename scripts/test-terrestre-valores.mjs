/**
 * Test: Graba Módulo Valores Generales para operación terrestre 190321
 * 
 * Datos de entrada:
 * - Factura: monto_total = 26420 USD (CPT = FOB 23220 + flete 3200)
 * - CRT: flete = 3200 USD (gastos.flete.monto_remitente)
 * - Póliza: prima = 14.53 USD
 * - Peso bruto: 27540 kg (del CRT)
 * - Incoterm: CPT → código 11
 * 
 * Resultado esperado: FOB=23220, Flete=3200, Seguro=14.53, CIF=26434.53
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

console.log("=== Test Valores Generales Terrestre ===");
console.log("Operación:", nroOperacion);
console.log("Datos:");
console.log("  Factura total: 26420 USD (CPT)");
console.log("  Flete CRT: 3200 USD");
console.log("  Seguro póliza: 14.53 USD");
console.log("  Peso bruto: 27540 kg");
console.log("  Incoterm: CPT (código 11)");
console.log("");

const datos = {
  termCompra: "2",        // CFR para calcular (workaround bug AduanaNet)
  termCompraFinal: "8",   // Cambiar a OTRA antes de grabar
  moneda: "13",           // USD
  pesoBruto: "27540",
  totalNetoFactura: "26420",
  fleteFac: "3200",
  fleteMon: "13",
  fleteParidad: "1",
  seguroFac: "14.53",
  seguroMon: "13",
  seguroParidad: "1",
};

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

  // Auto-accept dialogs
  page.on("dialog", async dialog => { await dialog.accept(); });

  // Ir al módulo Valores Generales
  const vgUrl = `${BASE_URL}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("[2] Cargando Valores Generales...");
  await page.goto(vgUrl, { waitUntil: "networkidle0" });
  console.log("[2] ✅ Página cargada");

  // Llenar campos
  console.log("[3] Llenando campos...");
  await page.evaluate((datos) => {
    const frm = document.frm;
    frm.term_compra.value = datos.termCompra;
    if (frm.sel_term_compra) frm.sel_term_compra.value = datos.termCompra;
    frm.moneda_desc.value = datos.moneda;
    if (frm.sel_moneda_desc) frm.sel_moneda_desc.value = datos.moneda;
    frm.dus_peso_bruto_total.value = datos.pesoBruto;
    frm.dus_total_neto_item.value = datos.totalNetoFactura;
    frm.dus_total_neto_factura.value = datos.totalNetoFactura;
    frm.dus_valor_flete_fac.value = datos.fleteFac;
    if (datos.fleteMon) frm.dus_valor_flete_mon.value = datos.fleteMon;
    frm.dus_valor_flete_paridad.value = datos.fleteParidad;
    frm.dus_valor_seguro_fac.value = datos.seguroFac;
    if (datos.seguroMon) frm.dus_valor_seguro_mon.value = datos.seguroMon;
    frm.dus_valor_seguro_paridad.value = datos.seguroParidad;
  }, datos);
  console.log("[3] ✅ Campos llenados");

  // Ejecutar cálculos (con CFR para que calcule bien)
  console.log("[4] Ejecutando cálculos (como CFR)...");
  await page.evaluate(() => {
    if (typeof window.calculos === "function") window.calculos();
  });
  await new Promise(r => setTimeout(r, 1500));
  console.log("[4] ✅ Cálculos ejecutados");

  // Leer resultados
  const fob = await page.evaluate(() => document.frm.dus_total_valor_fob?.value || "");
  const flete = await page.evaluate(() => document.frm.dus_valor_flete?.value || "");
  const seguro = await page.evaluate(() => document.frm.dus_valor_seguro?.value || "");
  const cif = await page.evaluate(() => document.frm.dus_valor_cif?.value || "");

  console.log("\n📊 Valores calculados:");
  console.log("  FOB:", fob);
  console.log("  Flete:", flete);
  console.log("  Seguro:", seguro);
  console.log("  CIF:", cif);

  // Cambiar cláusula a OTRA (8) antes de grabar (workaround bug)
  if (datos.termCompraFinal) {
    console.log("\n[5] Cambiando cláusula a OTRA (8)...");
    await page.evaluate((code) => {
      document.frm.term_compra.value = code;
      if (document.frm.sel_term_compra) document.frm.sel_term_compra.value = code;
    }, datos.termCompraFinal);
    console.log("[5] ✅ Cláusula cambiada a 8");
  }

  // Aceptar (guardar)
  console.log("\n[6] Guardando (Aceptar)...");
  await page.evaluate(() => {
    if (typeof window.aceptar === "function") window.aceptar();
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  console.log("[6] ✅ Guardado exitosamente");

  await browser.close();
  console.log("\n✅ Módulo Valores Generales grabado para operación", nroOperacion);
} catch (err) {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
}
