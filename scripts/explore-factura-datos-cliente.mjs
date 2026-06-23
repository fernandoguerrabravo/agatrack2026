#!/usr/bin/env node
/**
 * Explorar la pestaña "DATOS CLIENTE" en formulario factura AduanaNet
 * Para entender la estructura de la orden de compra
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
const NRO_OP = "190470"; // KSB

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

    // 1. Lista → Nuevo → NID → Aceptar × 2
    console.log("1. Lista → Nuevo → NID → Aceptar × 2...");
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
    await page.evaluate(() => { window.nuevo(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const nidInput = await page.$('input[name="lib_nid"]');
    if (nidInput) await nidInput.type(NRO_OP);
    else {
      const inputs = await page.$$('input[type="text"]');
      for (const inp of inputs) {
        const vis = await inp.evaluate(el => el.offsetParent !== null);
        if (vis) { await inp.type(NRO_OP); break; }
      }
    }

    await page.click('input[value="Aceptar"]');
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const btn2 = await page.$('input[value="Aceptar"]');
    if (btn2) {
      await btn2.click();
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log("   URL formulario:", page.url());

    // 2. Explorar pestaña DATOS CLIENTE - buscar el link exacto del tab
    console.log("\n2. Buscando tab DATOS CLIENTE en el formulario...");
    const tabInfo = await page.evaluate(() => {
      // Buscar enlaces que sean tabs del formulario (no del menú principal)
      const links = document.querySelectorAll("a");
      const tabs = [];
      for (const a of links) {
        const txt = (a.textContent || "").trim();
        const href = a.getAttribute("href") || "";
        const onclick = a.getAttribute("onclick") || "";
        // Las pestañas del formulario suelen tener onclick o href con #
        if (txt === "DATOS CLIENTE" || txt === "DATOS DESPACHOS" || txt === "GASTOS Y HONORARIOS" || txt === "RESUMEN" || txt === "DESEMBOLSOS") {
          tabs.push({ text: txt, href, onclick: onclick.substring(0, 150), id: a.id, className: a.className });
        }
      }
      return tabs;
    });
    console.log("   Tabs encontrados:");
    tabInfo.forEach(t => console.log(`     "${t.text}" href=${t.href} onclick=${t.onclick} class=${t.className}`));

    // Click en DATOS CLIENTE
    const clicked = await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) {
        const txt = (a.textContent || "").trim();
        if (txt === "DATOS CLIENTE") {
          a.click();
          return true;
        }
      }
      return false;
    });
    console.log(`   Clickeada DATOS CLIENTE: ${clicked}`);
    await new Promise(r => setTimeout(r, 2000));

    // 3. Explorar contenido visible después del click
    console.log("\n3. Contenido visible después del click:");
    const content = await page.evaluate(() => {
      const result = {};

      // Todo el innerHTML del body para buscar "orden" patterns
      const bodyHtml = document.body.innerHTML;
      
      // Buscar botones visibles
      const buttons = document.querySelectorAll("input[type='button'], input[type='submit'], button");
      result.buttons = Array.from(buttons)
        .filter(b => b.offsetParent !== null)
        .map(b => ({ value: (b.value || b.textContent || "").trim(), name: b.name || "", onclick: (b.getAttribute("onclick") || "").substring(0, 150) }))
        .filter(b => b.value && b.value.length > 1);

      // Selects visibles
      const selects = document.querySelectorAll("select");
      result.selects = Array.from(selects)
        .filter(s => s.offsetParent !== null && s.options.length < 20)
        .map(s => ({ name: s.name, id: s.id, options: Array.from(s.options).map(o => `${o.value}:${o.text.substring(0, 50)}`) }));

      // Inputs text visibles
      const inputs = document.querySelectorAll("input[type='text'], input[type='number'], input[type='date']");
      result.inputs = Array.from(inputs)
        .filter(i => i.offsetParent !== null)
        .map(i => ({ name: i.name, id: i.id, value: i.value }));

      // Buscar en el HTML patterns de "orden", "nuevo registro", "compra"
      const ordenMatch = bodyHtml.match(/[^<>]{0,50}orden[^<>]{0,50}/gi);
      result.ordenHtml = (ordenMatch || []).slice(0, 10);
      
      const nuevoMatch = bodyHtml.match(/[^<>]{0,80}nuevo.?registro[^<>]{0,80}/gi);
      result.nuevoRegistroHtml = (nuevoMatch || []).slice(0, 5);

      // Buscar divs/fieldsets con texto sobre orden de compra
      const fieldsets = document.querySelectorAll("fieldset, div, td");
      result.ordenTexts = [];
      for (const el of fieldsets) {
        const txt = (el.textContent || "").toLowerCase();
        if ((txt.includes("orden") && txt.includes("compra")) || txt.includes("nuevo registro")) {
          if (el.textContent.trim().length < 200) {
            result.ordenTexts.push(el.textContent.trim());
          }
        }
      }
      result.ordenTexts = [...new Set(result.ordenTexts)].slice(0, 5);

      return result;
    });

    console.log("\n   BOTONES VISIBLES:");
    content.buttons.forEach(b => console.log(`     [${b.value}] name=${b.name} onclick=${b.onclick}`));
    
    console.log("\n   SELECTS VISIBLES:");
    content.selects.forEach(s => console.log(`     ${s.name || s.id}: ${s.options.join(", ")}`));
    
    console.log("\n   INPUTS VISIBLES:");
    content.inputs.forEach(i => console.log(`     ${i.name || i.id} = "${i.value}"`));

    console.log("\n   HTML con 'orden':");
    content.ordenHtml.forEach(h => console.log(`     ${h}`));

    console.log("\n   HTML con 'nuevo registro':");
    content.nuevoRegistroHtml.forEach(h => console.log(`     ${h}`));

    console.log("\n   Textos con 'orden compra' o 'nuevo registro':");
    content.ordenTexts.forEach(t => console.log(`     ${t}`));

    // Borrar la factura creada para no dejarla pendiente
    console.log("\n4. Volviendo a lista para borrar factura de prueba...");
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
    const filInput = await page.$('input[name="fil_lib_nid"]');
    if (filInput) {
      await filInput.type(NRO_OP);
      await page.evaluate(() => { if (typeof window.filtrarLista === "function") window.filtrarLista(); });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));
    }
    // Borrar
    const borrarId = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const match = html.match(/borrar\(\s*'(\d+)'\s*\)/);
      return match ? match[1] : null;
    });
    if (borrarId) {
      await page.evaluate((id) => { window.borrar(id); }, borrarId);
      await new Promise(r => setTimeout(r, 2000));
      console.log(`   Factura ${borrarId} borrada`);
    }

  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
