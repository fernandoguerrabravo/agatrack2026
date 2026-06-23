#!/usr/bin/env node
/**
 * Debug: intentar crear factura 190369 paso a paso con screenshots
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
const NRO_OP = "190369";

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  
  const dialogs = [];
  page.on("dialog", async d => {
    dialogs.push({ type: d.type(), message: d.message() });
    console.log(`  [DIALOG] ${d.type()}: ${d.message()}`);
    await d.accept();
  });

  try {
    // Login
    await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
    await page.type('input[name="login"]', LOGIN);
    await page.type('input[name="clave"]', CLAVE);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
    console.log("Login OK");

    // Lista
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });

    // Nuevo
    console.log("\n1. nuevo()...");
    await page.evaluate(() => { window.nuevo(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    console.log("   URL:", page.url());

    // NID
    console.log("2. NID = " + NRO_OP);
    const nidInput = await page.$('input[name="lib_nid"]');
    if (nidInput) await nidInput.type(NRO_OP);
    else {
      const inputs = await page.$$('input[type="text"]');
      for (const inp of inputs) {
        const vis = await inp.evaluate(el => el.offsetParent !== null);
        if (vis) { await inp.type(NRO_OP); break; }
      }
    }

    // Aceptar 1
    console.log("3. Aceptar 1...");
    dialogs.length = 0;
    await page.click('input[value="Aceptar"]');
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    console.log("   URL:", page.url());
    if (dialogs.length) console.log("   Dialogs:", JSON.stringify(dialogs));

    // Verificar estado
    const estado1 = await page.evaluate(() => {
      const body = document.body.innerText.substring(0, 300);
      const hasAceptar = !!document.querySelector('input[value="Aceptar"]');
      const hasError = body.includes("error") || body.includes("Error") || body.includes("existe");
      return { hasAceptar, hasError, bodyStart: body.substring(0, 200) };
    });
    console.log("   hasAceptar:", estado1.hasAceptar, "hasError:", estado1.hasError);
    if (estado1.hasError) console.log("   Body:", estado1.bodyStart);

    // Aceptar 2
    if (estado1.hasAceptar) {
      console.log("4. Aceptar 2...");
      dialogs.length = 0;
      await page.click('input[value="Aceptar"]');
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
      console.log("   URL:", page.url());
      if (dialogs.length) console.log("   Dialogs:", JSON.stringify(dialogs));
    }

    // Verificar si estamos en formulario
    const enFormulario = page.url().includes("formulario.php");
    console.log("\n   EN FORMULARIO:", enFormulario);
    
    if (!enFormulario) {
      // Ver qué hay en la página
      const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log("   Contenido:", pageContent);
      await page.screenshot({ path: "/tmp/debug-190369.png", fullPage: true });
      console.log("   Screenshot: /tmp/debug-190369.png");
    } else {
      console.log("   ✅ Formulario cargado correctamente");
      
      // Verificar que los tabs existen
      const tabs = await page.evaluate(() => {
        const links = document.querySelectorAll("a.ui-tabs-anchor");
        return Array.from(links).map(a => a.textContent?.trim());
      });
      console.log("   Tabs:", tabs.join(", "));

      // Hacer todo el flujo completo
      // 5.5 addRef - Orden de Compra
      console.log("\n5. Agregando Orden de Compra...");
      await page.evaluate(() => {
        const link = document.querySelector('a[href*="addRef"]');
        if (link) link.click();
      });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate(() => {
        const sel = document.querySelector('select[name="fare_tipo_doc0"]');
        if (sel) sel.value = "801";
      });
      const folioInput = await page.$('input[name="fare_folio_doc0"]');
      if (folioInput) await folioInput.type("EM 260601");
      const fechaInput = await page.$('input[name="fare_fecha_doc0"]');
      if (fechaInput) await fechaInput.type("19/06/2026");
      console.log("   OK");

      // 6. DATOS DESPACHOS → Actualizar Dolar
      console.log("6. DATOS DESPACHOS → Actualizar Dolar...");
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) { if ((a.textContent||"").trim().toUpperCase().includes("DATOS") && (a.textContent||"").trim().toUpperCase().includes("DESPACHO")) { a.click(); return; } }
      });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button']");
        for (const inp of inputs) { if ((inp.value||"").toLowerCase().includes("actualizar") && (inp.value||"").toLowerCase().includes("dolar")) { inp.click(); return; } }
      });
      await new Promise(r => setTimeout(r, 3000));
      console.log("   OK");

      // 7. GASTOS Y HONORARIOS → Traer Honorarios
      console.log("7. GASTOS Y HONORARIOS → Traer Honorarios...");
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) { if (a.textContent && a.textContent.trim() === "GASTOS Y HONORARIOS") { a.click(); return; } }
      });
      await new Promise(r => setTimeout(r, 2000));
      const traerHonBtn = await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button']");
        for (const inp of inputs) { if (inp.value && inp.value.toLowerCase().includes("honorarios")) return inp.value; }
        return null;
      });
      if (traerHonBtn) {
        const popupPromise = new Promise(resolve => {
          browser.once("targetcreated", async target => { resolve(await target.page()); });
          setTimeout(() => resolve(null), 10000);
        });
        await page.evaluate((val) => {
          const inputs = document.querySelectorAll("input[type='button']");
          for (const inp of inputs) { if (inp.value === val) { inp.click(); return; } }
        }, traerHonBtn);
        const popup = await popupPromise;
        if (popup) {
          await new Promise(r => setTimeout(r, 3000));
          await popup.evaluate(() => {
            const rows = document.querySelectorAll("tr");
            for (const row of rows) { const cells = row.querySelectorAll("td"); if (cells.length > 0) { const link = row.querySelector("a"); if (link) { link.click(); return; } cells[0].click(); return; } }
          });
          await new Promise(r => setTimeout(r, 3000));
          await popup.close().catch(() => {});
          console.log("   Honorarios OK (popup)");
        } else { console.log("   ⚠️ No popup"); }
      }

      // 8. RESUMEN → Traer Pago Directo
      console.log("8. RESUMEN → Traer Pago Directo...");
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) { if (a.textContent && a.textContent.trim() === "RESUMEN") { a.click(); return; } }
      });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button']");
        for (const inp of inputs) { if (inp.value && inp.value.toLowerCase().includes("pago directo")) { inp.click(); return; } }
        for (const inp of inputs) { if (inp.value && inp.value.toLowerCase().includes("pago")) { inp.click(); return; } }
      });
      await new Promise(r => setTimeout(r, 3000));
      console.log("   OK");

      // 9. GRABAR
      console.log("9. GRABAR...");
      dialogs.length = 0;

      // Interceptar console.log/alert para ver errores de validación
      const consoleMessages = [];
      page.on("console", msg => consoleMessages.push(msg.text()));
      
      // Verificar campos required vacíos antes de grabar
      const emptyRequired = await page.evaluate(() => {
        const form = document.querySelector("form[name='frmEditar']") || document.querySelector("form");
        if (!form) return ["NO FORM FOUND"];
        const empties = [];
        const inputs = form.querySelectorAll("input[required], select[required], input.required, select.required");
        for (const inp of inputs) {
          if (!inp.value) empties.push(inp.name || inp.id || "unknown");
        }
        // También verificar formcheck.js - buscar campos con class "validate"
        const validates = form.querySelectorAll(".validate, [validate]");
        for (const v of validates) {
          if (!v.value) empties.push("validate:" + (v.name || v.id));
        }
        return empties;
      });
      console.log("   Campos vacíos required:", emptyRequired.length ? emptyRequired.join(", ") : "NINGUNO");

      // Intentar submit del form directamente
      const submitResult = await page.evaluate(() => {
        const form = document.querySelector("form[name='frmEditar']");
        if (!form) return "NO FORM";
        // Ver la action del form
        const action = form.action || form.getAttribute("action") || "";
        // Intentar submit
        try {
          form.submit();
          return "form.submit() OK, action=" + action;
        } catch(e) {
          return "form.submit() error: " + e.message;
        }
      });
      console.log("   Submit:", submitResult);
      
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
      
      console.log("   URL post-submit:", page.url());
      if (dialogs.length) console.log("   Dialogs:", JSON.stringify(dialogs));
      if (consoleMessages.length) console.log("   Console:", consoleMessages.slice(0, 5).join(" | "));
      
      const postContent = await page.evaluate(() => {
        // Buscar si hay mensaje de éxito o error
        const body = document.body.innerText;
        if (body.includes("grabado") || body.includes("Grabado") || body.includes("éxito")) return "SUCCESS: " + body.substring(0, 200);
        if (body.includes("error") || body.includes("Error")) return "ERROR: " + body.substring(0, 200);
        return body.substring(0, 200);
      });
      console.log("   Resultado:", postContent);
    }

  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
