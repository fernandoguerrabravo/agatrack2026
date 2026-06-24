#!/usr/bin/env node
/**
 * Test: Solo módulo Valores Factura para operación 189696 (terrestre)
 * CPT → calcular como CFR (2) luego cambiar a OTRA (8)
 * Factura: 35600 USD, Flete: 3200 USD, Seguro: 19.58 USD, Peso: 27540 kg
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require2 = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=[\"']?([^\"'\\n]+)", "m")); return m ? m[1] : ""; };

const BASE = get("ADUANANET_URL");
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");
const NRO_OP = "189696";

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  page.on("dialog", async d => { console.log("[dialog]", d.message()); await d.accept(); });

  try {
    // Login
    await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
    await page.type('input[name="login"]', LOGIN);
    await page.type('input[name="clave"]', CLAVE);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
    console.log("Login OK");

    // Ir a módulo Valores Generales
    const vgUrl = `${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${NRO_OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
    console.log("\n1. Navegando a Valores Generales...");
    await page.goto(vgUrl, { waitUntil: "networkidle0" });
    await new Promise(r => setTimeout(r, 2000));
    console.log("   URL:", page.url());

    // Llenar campos
    console.log("\n2. Llenando campos...");
    await page.evaluate(() => {
      const frm = document.frm;
      // Incoterm: CFR (código 2) para calcular, luego se cambia a OTRA (8)
      frm.term_compra.value = "2";
      if (frm.sel_term_compra) frm.sel_term_compra.value = "2";
      // Moneda: USD (13)
      frm.moneda_desc.value = "13";
      if (frm.sel_moneda_desc) frm.sel_moneda_desc.value = "13";
      // Peso bruto
      frm.dus_peso_bruto_total.value = "27540";
      // Total neto factura
      frm.dus_total_neto_item.value = "35600";
      frm.dus_total_neto_factura.value = "35600";
      // Flete
      frm.dus_valor_flete_fac.value = "3200";
      frm.dus_valor_flete_mon.value = "13";
      frm.dus_valor_flete_paridad.value = "1";
      // Seguro
      frm.dus_valor_seguro_fac.value = "19.58";
      frm.dus_valor_seguro_mon.value = "13";
      frm.dus_valor_seguro_paridad.value = "1";
    });
    console.log("   term_compra=2 (CFR), moneda=13 (USD), factura=35600, flete=3200, seguro=19.58, peso=27540");

    // Click "Ejecute Cálculos"
    console.log("\n3. Ejecute Cálculos...");
    await page.evaluate(() => {
      if (typeof window.calculos === "function") window.calculos();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Leer valores calculados
    const valores = await page.evaluate(() => {
      const frm = document.frm;
      return {
        fob: frm.dus_total_valor_fob?.value || "",
        flete: frm.dus_valor_flete?.value || "",
        seguro: frm.dus_valor_seguro?.value || "",
        cif: frm.dus_valor_cif?.value || "",
      };
    });
    console.log("   FOB:", valores.fob);
    console.log("   Flete:", valores.flete);
    console.log("   Seguro:", valores.seguro);
    console.log("   CIF:", valores.cif);

    // Cambiar a OTRA (código 8) antes de grabar
    console.log("\n4. Cambiando cláusula a OTRA (8)...");
    await page.evaluate(() => {
      const frm = document.frm;
      frm.term_compra.value = "8";
      if (frm.sel_term_compra) frm.sel_term_compra.value = "8";
    });

    // Click "Aceptar" para grabar
    console.log("5. Aceptar (grabar)...");
    await page.evaluate(() => {
      if (typeof window.aceptar === "function") window.aceptar();
    });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    console.log("\n✅ Módulo Valores Factura grabado para op", NRO_OP);
    console.log("   FOB=" + valores.fob, "Flete=" + valores.flete, "Seguro=" + valores.seguro, "CIF=" + valores.cif);

  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
