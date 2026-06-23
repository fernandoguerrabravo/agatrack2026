#!/usr/bin/env node
/**
 * Test: Crear factura para operación 190470 en AduanaNet
 * SOLO CONFECCIÓN (sin enviar a SII)
 * Flujo: lista → nuevo → NID → Aceptar → Aceptar → DATOS DESPACHO → Actualizar Dolar → GASTOS Y HONORARIOS → Traer Honorarios → RESUMEN → Traer Pago Directo → Grabar
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
const NRO_OP = "190470";

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

  // Auto-accept dialogs
  page.on("dialog", async dialog => {
    console.log(`   [dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });

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
    console.log("   ✅ Login OK");

    // 1. Lista facturación
    console.log("1. Lista facturación...");
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
    console.log("   URL:", page.url());

    // 2. Click nuevo()
    console.log("2. Click nuevo()...");
    await page.evaluate(() => { window.nuevo(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    console.log("   URL:", page.url());

    // 3. Input NID
    console.log(`3. Input NID = ${NRO_OP}`);
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

    // 6. Pestaña DATOS DESPACHOS → Actualizar Dolar
    console.log("6. Pestaña DATOS DESPACHOS...");
    const tabClicked = await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) {
        const txt = (a.textContent || "").trim().toUpperCase();
        if (txt.includes("DATOS") && txt.includes("DESPACHO")) {
          a.click(); return a.textContent.trim();
        }
      }
      return null;
    });
    console.log(`   Tab clickeada: ${tabClicked}`);
    await new Promise(r => setTimeout(r, 2000));

    console.log("   Clickeando 'Actualizar Dolar'...");
    const actualizarResult = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
      for (const inp of inputs) {
        const val = (inp.value || "").toLowerCase();
        if (val.includes("actualizar") && val.includes("dolar")) {
          inp.click();
          return inp.value;
        }
      }
      // Fallback: buscar por "actualizar dólar" con acento
      for (const inp of inputs) {
        const val = (inp.value || "").toLowerCase();
        if (val.includes("actualizar") && val.includes("dólar")) {
          inp.click();
          return inp.value;
        }
      }
      // Listar todos los botones disponibles para debug
      return "NOT FOUND - buttons: " + Array.from(inputs).map(i => i.value).join(" | ");
    });
    console.log(`   Resultado: ${actualizarResult}`);
    await new Promise(r => setTimeout(r, 3000));

    // 7. Pestaña GASTOS Y HONORARIOS
    console.log("7. Pestaña GASTOS Y HONORARIOS...");
    await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) {
        if (a.textContent && a.textContent.trim() === "GASTOS Y HONORARIOS") {
          a.click(); return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // 8. Traer Honorarios (popup)
    console.log("8. Traer Honorarios...");
    const traerHonBtn = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button']");
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("honorarios")) return inp.value;
      }
      return null;
    });
    console.log(`   Botón encontrado: ${traerHonBtn}`);

    if (traerHonBtn) {
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
        console.log("   Popup abierto, esperando contenido...");
        await new Promise(r => setTimeout(r, 3000));
        
        // Obtener HTML del popup para debug
        const popupContent = await popup.evaluate(() => {
          const rows = document.querySelectorAll("tr");
          return `Filas encontradas: ${rows.length}`;
        });
        console.log(`   ${popupContent}`);

        // Click en la primera fila con datos
        await popup.evaluate(() => {
          const rows = document.querySelectorAll("tr");
          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            if (cells.length > 0) {
              const link = row.querySelector("a");
              if (link) { link.click(); return; }
              const onclick = row.getAttribute("onclick") || row.getAttribute("onmousedown");
              if (onclick) { row.click(); return; }
              cells[0].click(); return;
            }
          }
        });
        await new Promise(r => setTimeout(r, 3000));
        await popup.close().catch(() => {});
        console.log("   ✅ Honorarios traídos");
      } else {
        console.log("   ⚠️ No se abrió popup");
      }
    } else {
      const allBtns = await page.$$eval("input[type='button']", els => els.map(e => e.value));
      console.log("   ⚠️ Botones disponibles:", allBtns.join(" | "));
    }
    await new Promise(r => setTimeout(r, 2000));

    // 9. Pestaña RESUMEN
    console.log("9. Pestaña RESUMEN...");
    await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) {
        if (a.textContent && a.textContent.trim() === "RESUMEN") {
          a.click(); return;
        }
      }
    });
    await new Promise(r => setTimeout(r, 2000));

    // 10. Traer Pago Directo
    console.log("10. Traer Pago Directo...");
    const pagoResult = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("pago directo")) {
          inp.click(); return inp.value;
        }
      }
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("pago")) {
          inp.click(); return inp.value;
        }
      }
      return "NOT FOUND - buttons: " + Array.from(inputs).map(i => i.value).join(" | ");
    });
    console.log(`   Resultado: ${pagoResult}`);
    await new Promise(r => setTimeout(r, 3000));

    // 11. Grabar
    console.log("11. Grabar...");
    const grabarResult = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
      for (const inp of inputs) {
        if (inp.value && inp.value.toLowerCase().includes("grabar")) {
          inp.click(); return inp.value;
        }
      }
      return "NOT FOUND - buttons: " + Array.from(inputs).map(i => i.value).join(" | ");
    });
    console.log(`   Resultado: ${grabarResult}`);
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    console.log("\n✅ FACTURA CONFECCIONADA (sin enviar a SII)");
    console.log("   URL final:", page.url());

    // Verificar: volver a lista y buscar factura creada
    console.log("\n12. Verificación en lista...");
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
    const filInput = await page.$('input[name="fil_lib_nid"]');
    if (filInput) {
      await filInput.type(NRO_OP);
      await page.evaluate(() => {
        if (typeof window.filtrarLista === "function") window.filtrarLista();
        else {
          const btn = document.querySelector('input[type="submit"]');
          if (btn) btn.click();
        }
      });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }

    // Verificar si aparece imprimir('ID') (indica que se creó)
    const facturaInfo = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const matchImprimir = html.match(/imprimir\(\s*'(\d+)'\s*\)/);
      const matchGetUrl = html.match(/getUrl\(\s*true\s*,\s*(\d+)\s*\)/);
      return {
        imprimirId: matchImprimir ? matchImprimir[1] : null,
        getUrlId: matchGetUrl ? matchGetUrl[1] : null,
      };
    });
    
    if (facturaInfo.imprimirId) {
      console.log(`   ✅ Factura encontrada en lista. imprimir ID: ${facturaInfo.imprimirId}`);
    } else {
      console.log("   ⚠️ No se encontró factura en la lista");
    }
    if (facturaInfo.getUrlId) {
      console.log(`   getUrl ID: ${facturaInfo.getUrlId}`);
    }

  } catch (e) {
    console.error("❌ ERROR:", e.message);
    // Screenshot para debug
    try {
      await page.screenshot({ path: `/tmp/factura-190470-error.png`, fullPage: true });
      console.log("   Screenshot guardado en /tmp/factura-190470-error.png");
    } catch {}
  } finally {
    await browser.close();
  }
})();
