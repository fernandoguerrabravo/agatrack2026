#!/usr/bin/env node
/**
 * Explorar pestaña Gastos y Honorarios de factura 190290
 * para identificar campos de honorarios y tipo de cambio
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

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], ...(execPath ? { executablePath: execPath } : {}) });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", async d => { console.log("[dialog]", d.message()); await d.accept(); });

  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
  console.log("Login OK");

  // Ir directo al formulario de factura 190290 (ya existe en curso)
  // Buscar la factura y entrar en modo edición
  await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
  
  // Buscar la factura de 190290
  const modId = await page.evaluate(() => {
    const html = document.body.innerHTML;
    // Buscar la fila que contiene 190290
    const rows = document.querySelectorAll("tr");
    for (const row of rows) {
      if (row.textContent.includes("190290")) {
        const m = row.innerHTML.match(/modificar\(\s*'(\d+)'\s*\)/);
        if (m) return m[1];
      }
    }
    return null;
  });

  if (modId) {
    console.log("Factura encontrada, modificar ID:", modId);
    await page.evaluate((id) => { window.modificar(id); }, modId);
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log("No se encontró factura en curso para 190290, creando nueva...");
    await page.evaluate(() => { window.nuevo(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    const nid = await page.$('input[name="lib_nid"]');
    if (nid) await nid.type("190290");
    await page.click('input[value="Aceptar"]');
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    const btn2 = await page.$('input[value="Aceptar"]');
    if (btn2) { await btn2.click(); await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}); await new Promise(r => setTimeout(r, 2000)); }
    if (!page.url().includes("formulario.php")) {
      const directUrl = `${BASE}/modulos/contabilidad/facturacion/afecta/formulario.php?opcion_clausula=&accion=N&tipo_fact=unitario&nid=190290&lib_base=1&opcion_facturar=iva&cli_id=96691060&txt_cli_id=KSB+CHILE+S.A.`;
      await page.goto(directUrl, { waitUntil: "networkidle0" });
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log("URL:", page.url());

  // Click en pestaña GASTOS Y HONORARIOS
  console.log("\nClickeando pestaña GASTOS Y HONORARIOS...");
  await page.evaluate(() => {
    const links = document.querySelectorAll("a");
    for (const a of links) {
      if (a.textContent && a.textContent.trim() === "GASTOS Y HONORARIOS") { a.click(); return; }
    }
  });
  await new Promise(r => setTimeout(r, 2000));

  // Click Traer Honorarios
  console.log("Clickeando Traer Honorarios...");
  const traerBtn = await page.evaluate(() => {
    const inputs = document.querySelectorAll("input[type='button']");
    for (const inp of inputs) { if (inp.value && inp.value.toLowerCase().includes("honorarios")) return inp.value; }
    return null;
  });

  if (traerBtn) {
    const popupPromise = new Promise(resolve => {
      browser.once("targetcreated", async target => { resolve(await target.page()); });
      setTimeout(() => resolve(null), 10000);
    });
    await page.evaluate((val) => {
      const inputs = document.querySelectorAll("input[type='button']");
      for (const inp of inputs) { if (inp.value === val) { inp.click(); return; } }
    }, traerBtn);
    const popup = await popupPromise;
    if (popup) {
      await new Promise(r => setTimeout(r, 3000));
      await popup.evaluate(() => {
        const rows = document.querySelectorAll("tr");
        for (const row of rows) { const cells = row.querySelectorAll("td"); if (cells.length > 0) { const link = row.querySelector("a"); if (link) { link.click(); return; } cells[0].click(); return; } }
      });
      await new Promise(r => setTimeout(r, 3000));
      await popup.close().catch(() => {});
      console.log("Honorarios traídos OK");
    }
  }

  await new Promise(r => setTimeout(r, 2000));

  // Ahora explorar TODOS los campos visibles en la pestaña
  console.log("\n=== CAMPOS EN GASTOS Y HONORARIOS ===");
  const fields = await page.evaluate(() => {
    const result = { inputs: [], selects: [] };
    const inputs = document.querySelectorAll("input[type='text'], input[type='number'], input[type='hidden']");
    for (const inp of inputs) {
      if (inp.offsetParent !== null || inp.type === "hidden") {
        const name = inp.name || "";
        if (name && (name.includes("honor") || name.includes("gasto") || name.includes("dolar") || name.includes("cambio") || name.includes("tc") || name.includes("tipo_cambio") || name.includes("total") || name.includes("monto") || name.includes("valor"))) {
          result.inputs.push({ name, value: inp.value, type: inp.type, visible: inp.offsetParent !== null });
        }
      }
    }
    // También buscar todos los inputs visibles con valor
    const allVisible = document.querySelectorAll("input[type='text']");
    for (const inp of allVisible) {
      if (inp.offsetParent !== null && inp.value && !result.inputs.find(x => x.name === inp.name)) {
        result.inputs.push({ name: inp.name, value: inp.value, type: "text", visible: true });
      }
    }
    return result;
  });

  console.log("\nInputs con valor:");
  fields.inputs.filter(f => f.value).forEach(f => console.log(`  ${f.name} = "${f.value}" (${f.visible ? "visible" : "hidden"})`));

  // Buscar específicamente el campo de tipo de cambio y honorarios en toda la página
  const allFields = await page.evaluate(() => {
    const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
    if (!frm) return {};
    const f = {};
    for (const el of frm.elements) {
      if (el.name && el.value && el.value !== "0" && el.value !== "") {
        f[el.name] = el.value;
      }
    }
    return f;
  });
  console.log("\nTodos los campos con valor del form:");
  Object.entries(allFields).filter(([k]) => !k.includes("modulo_seleccion")).forEach(([k, v]) => console.log(`  ${k} = "${v}"`));

  await browser.close();
})();
