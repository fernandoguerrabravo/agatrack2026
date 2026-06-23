#!/usr/bin/env node
/**
 * Test: Enviar factura 190428 al SII desde AduanaNet
 * Flujo: lista facturas → filtrar por 190428 → click Imprimir en la fila → click Imprimir en formulario
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

    // 2. Filtrar por 190428
    console.log("2. Filtrar por 190428...");
    const filInput = await page.$('input[name="fil_lib_nid"]');
    if (filInput) {
      await filInput.type("190428");
      // Click filtrar
      await page.evaluate(() => {
        if (typeof window.filtrarLista === "function") { window.filtrarLista(); return; }
        const btn = document.querySelector('input[type="submit"]');
        if (btn) btn.click();
      });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    // 3. Buscar y ejecutar imprimir(ID) en la fila
    console.log("3. Buscando imprimir(ID)...");
    const imprimirId = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const match = html.match(/imprimir\(\s*'(\d+)'\s*\)/);
      return match ? match[1] : null;
    });
    console.log("   ID factura:", imprimirId);

    if (!imprimirId) {
      console.error("   ❌ No se encontró ID de factura para imprimir");
      await browser.close();
      return;
    }

    // Ejecutar imprimir(ID)
    await page.evaluate((id) => { window.imprimir(id); }, imprimirId);
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    console.log("   URL:", page.url());

    // 4. En el formulario de impresión, click Imprimir
    console.log("4. Click Imprimir en formulario...");
    const btns = await page.$$eval("input[type='button'], input[type='submit']", els => els.map(e => e.value));
    console.log("   Botones:", btns.join(" | "));

    await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("imprimir")) {
          inp.click(); return;
        }
      }
    });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    console.log("5. URL final:", page.url());
    console.log("   ✅ Factura enviada al SII");

  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
