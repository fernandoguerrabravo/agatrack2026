#!/usr/bin/env node
/**
 * Test: Crear factura para operación 190428 en AduanaNet
 * Flujo: lista → nuevo → NID → Aceptar → Aceptar → Gastos/Honorarios → Traer Honorarios → Resumen → Traer Pagos → Grabar
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require2 = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); if (v.startsWith("'")) v = v.slice(1, -1); return v; };

const BASE = get("ADUANANET_URL") || "https://fguerragodoy.aduananet2.cl";
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");
const NRO_OP = "190428";

(async () => {
  const puppeteer = require2("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"], executablePath: "/usr/bin/chromium-browser" });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  try {
    // Login
    console.log("0. Login...");
    await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
    await page.type('input[name="login"]', LOGIN);
    await page.type('input[name="clave"]', CLAVE);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }),
      page.click('input[type="submit"]'),
    ]);

    // 1. Lista facturación
    console.log("1. Lista facturación...");
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });

    // 2. Click nuevo()
    console.log("2. Click nuevo()...");
    await page.evaluate(() => { window.nuevo(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    console.log("   URL:", page.url());

    // 3. Input NID
    console.log("3. Input NID = " + NRO_OP);
    const nidInput = await page.$('input[name="lib_nid"]');
    if (nidInput) {
      await nidInput.type(NRO_OP);
    } else {
      const inputs = await page.$$('input[type="text"]');
      for (const inp of inputs) {
        const vis = await inp.evaluate(el => el.offsetParent !== null);
        if (vis) { await inp.type(NRO_OP); break; }
      }
    }

    // 4. Click Aceptar 1
    console.log("4. Click Aceptar 1...");
    await page.click('input[value="Aceptar"]');
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    console.log("   URL:", page.url());

    // 5. Click Aceptar 2
    console.log("5. Click Aceptar 2...");
    const btn2 = await page.$('input[value="Aceptar"]');
    if (btn2) {
      await btn2.click();
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log("   URL:", page.url());

    // 6. Buscar pestaña "Gastos y Honorarios"
    console.log("6. Buscando pestaña Gastos y Honorarios...");
    const links = await page.$$eval("a", els => els.map(a => ({ text: a.textContent?.trim(), href: a.href })));
    console.log("   Links:", links.filter(l => l.text && l.text.length > 2).map(l => l.text).join(" | "));

    const gastosTab = links.find(l => l.text?.toLowerCase().includes("gasto") || l.text?.toLowerCase().includes("honorario"));
    if (gastosTab) {
      console.log("   Click:", gastosTab.text);
      await page.evaluate((href) => { window.location.href = href; }, gastosTab.href);
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    // 7. Click "Traer Honorarios"
    console.log("7. Traer Honorarios...");
    const traerBtn = await page.$('input[value*="Traer Honorarios"]') || await page.$('input[value*="raer"]');
    if (traerBtn) {
      // Interceptar popup
      const popupPromise = new Promise(resolve => {
        browser.once("targetcreated", async target => { resolve(await target.page()); });
        setTimeout(() => resolve(null), 10000);
      });
      await traerBtn.click();
      const popup = await popupPromise;
      if (popup) {
        console.log("   Popup abierto, buscando detalle...");
        await popup.waitForSelector("body", { timeout: 5000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
        // Click en el detalle/seleccionar
        const selBtn = await popup.$('a') || await popup.$('input[type="button"]');
        if (selBtn) {
          await selBtn.click();
          await new Promise(r => setTimeout(r, 2000));
        }
        await popup.close().catch(() => {});
        console.log("   Honorarios traídos");
      }
    } else {
      console.log("   ⚠️ No se encontró botón Traer Honorarios");
      // Listar botones
      const btns = await page.$$eval("input[type='button'], input[type='submit']", els => els.map(e => e.value));
      console.log("   Botones:", btns.join(" | "));
    }

    // 8. Pestaña Resumen
    console.log("8. Pestaña Resumen...");
    const resumenTab = links.find(l => l.text?.toLowerCase().includes("resumen"));
    if (resumenTab) {
      await page.evaluate((href) => { window.location.href = href; }, resumenTab.href);
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    // 9. Click "Traer Pagos Directos y Anticipos"
    console.log("9. Traer Pagos Directos...");
    const pagoBtn = await page.$('input[value*="Traer Pagos"]') || await page.$('input[value*="agos"]');
    if (pagoBtn) {
      await pagoBtn.click();
      await new Promise(r => setTimeout(r, 3000));
      console.log("   Pagos traídos");
    } else {
      const btns2 = await page.$$eval("input[type='button'], input[type='submit']", els => els.map(e => e.value));
      console.log("   ⚠️ Botones:", btns2.join(" | "));
    }

    // 10. Grabar
    console.log("10. Grabar...");
    const grabarBtn = await page.$('input[value*="Grabar"]') || await page.$('input[value*="rabar"]');
    if (grabarBtn) {
      await grabarBtn.click();
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      console.log("   ✅ Factura grabada");
    } else {
      console.log("   ⚠️ No se encontró botón Grabar");
    }

    console.log("URL final:", page.url());
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
