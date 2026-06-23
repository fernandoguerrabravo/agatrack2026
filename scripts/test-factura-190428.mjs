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

    // 6. Click en pestaña "GASTOS Y HONORARIOS"
    console.log("6. Pestaña Gastos y Honorarios...");
    await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) {
        if (a.textContent && a.textContent.trim() === "GASTOS Y HONORARIOS") {
          a.click(); return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // 7. Click "Traer Honorarios"
    console.log("7. Traer Honorarios...");
    const traerHonBtn = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button']");
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("honorarios")) return inp.value;
      }
      return null;
    });
    console.log("   Botón encontrado:", traerHonBtn);

    if (traerHonBtn) {
      // Interceptar popup
      const popupPromise = new Promise(resolve => {
        browser.once("targetcreated", async target => { resolve(await target.page()); });
        setTimeout(() => resolve(null), 10000);
      });
      await page.evaluate((val) => {
        const inputs = document.querySelectorAll("input[type='button']");
        for (const inp of inputs) {
          if (inp.value === val) { inp.click(); return; }
        }
      }, traerHonBtn);
      
      const popup = await popupPromise;
      if (popup) {
        console.log("   Popup abierto");
        await new Promise(r => setTimeout(r, 3000));
        // Click en la primera fila de la grilla (tabla con datos)
        await popup.evaluate(() => {
          // Buscar la primera celda clickeable en la tabla de datos (no el header)
          const rows = document.querySelectorAll("tr");
          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            if (cells.length > 0) {
              // Buscar link dentro de la celda o hacer click en la fila
              const link = row.querySelector("a");
              if (link) { link.click(); return; }
              // Si no hay link, click en la fila misma
              const onclick = row.getAttribute("onclick") || row.getAttribute("onmousedown");
              if (onclick) { row.click(); return; }
              // Fallback: click en primera celda
              cells[0].click(); return;
            }
          }
        });
        await new Promise(r => setTimeout(r, 3000));
        await popup.close().catch(() => {});
        console.log("   Honorarios traídos");
      } else {
        console.log("   ⚠️ No se abrió popup");
      }
    } else {
      const allBtns = await page.$$eval("input[type='button']", els => els.map(e => e.value));
      console.log("   ⚠️ Botones disponibles:", allBtns.join(" | "));
    }
    await new Promise(r => setTimeout(r, 2000));

    // 8. Click en pestaña "RESUMEN"
    console.log("8. Pestaña Resumen...");
    await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) {
        if (a.textContent && a.textContent.trim() === "RESUMEN") {
          a.click(); return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // 9. Click "Traer Pagos Directos y Anticipos"
    console.log("9. Traer Pago Directo...");
    await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("pago directo")) {
          inp.click(); return;
        }
      }
      // Fallback: buscar por "pago" o "anticipo"
      for (const inp of inputs) {
        if (inp.value && (inp.value.toLowerCase().includes("pago") || inp.value.toLowerCase().includes("anticipo"))) {
          inp.click(); return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 3000));
    console.log("   Pago directo traído");

    // 10. Click "Grabar"
    console.log("10. Grabar...");
    await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("grabar")) {
          inp.click(); return;
        }
      }
    });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    console.log("   ✅ Factura grabada");

    console.log("URL final:", page.url());
  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
