#!/usr/bin/env node
/**
 * Generar factura con honorarios para 190290 (primera) y 190434 (parcialidad)
 * Primera: 0.22% × CIF total × TC (mín 50, máx 300 USD)
 * Parcialidad: honorarios = 0
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

// Parcialidades EM 260380:
// 190290: CIF 9847.67
// 190434: CIF 1108.29
// CIF total = 10955.96
const OPS = [
  { nro: "190290", esPrimera: true },
  { nro: "190434", esPrimera: false },
];
const CIF_TOTAL = 9847.67 + 1108.29; // 10955.96

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
  console.log("Login OK\n");

  for (const op of OPS) {
    console.log(`=== Operación ${op.nro} (${op.esPrimera ? "PRIMERA" : "PARCIALIDAD"}) ===`);

    // Ir a lista y crear factura
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
    await page.evaluate(() => { window.nuevo(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const nidInput = await page.$('input[name="lib_nid"]');
    if (nidInput) await nidInput.type(op.nro);
    await page.click('input[value="Aceptar"]');
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    const btn2 = await page.$('input[value="Aceptar"]');
    if (btn2) { await btn2.click(); await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}); await new Promise(r => setTimeout(r, 2000)); }

    // Fallback URL directa
    if (!page.url().includes("formulario.php")) {
      const directUrl = `${BASE}/modulos/contabilidad/facturacion/afecta/formulario.php?opcion_clausula=&accion=N&tipo_fact=unitario&nid=${op.nro}&lib_base=1&opcion_facturar=iva&cli_id=96691060&txt_cli_id=KSB+CHILE+S.A.`;
      await page.goto(directUrl, { waitUntil: "networkidle0" });
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log("  En formulario:", page.url().includes("formulario.php"));

    // Orden de Compra
    await page.evaluate(() => {
      const link = document.querySelector('a[href*="addRef"]');
      if (link) link.click();
    });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate((nro) => {
      const sel = document.querySelector('select[name="fare_tipo_doc0"]');
      if (sel) sel.value = "801";
      // Referencia sin _X
    }, op.nro);
    const folioInput = await page.$('input[name="fare_folio_doc0"]');
    if (folioInput) await folioInput.type("EM 260380");
    const fechaInput = await page.$('input[name="fare_fecha_doc0"]');
    if (fechaInput) await fechaInput.type("12/06/2026");
    console.log("  Orden de Compra: EM 260380");

    // DATOS DESPACHOS → Actualizar Dolar
    await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) { if ((a.textContent || "").trim().toUpperCase().includes("DATOS") && (a.textContent || "").trim().toUpperCase().includes("DESPACHO")) { a.click(); return; } }
    });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type='button']");
      for (const inp of inputs) { if ((inp.value || "").toLowerCase().includes("actualizar") && (inp.value || "").toLowerCase().includes("dolar")) { inp.click(); return; } }
    });
    await new Promise(r => setTimeout(r, 3000));
    console.log("  Actualizar Dolar OK");

    // GASTOS Y HONORARIOS → Traer Honorarios
    await page.evaluate(() => {
      const links = document.querySelectorAll("a");
      for (const a of links) { if (a.textContent && a.textContent.trim() === "GASTOS Y HONORARIOS") { a.click(); return; } }
    });
    await new Promise(r => setTimeout(r, 2000));

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
      }
      console.log("  Traer Honorarios OK");
    }

    await new Promise(r => setTimeout(r, 2000));

    // Modificar honorarios según regla
    if (op.esPrimera) {
      // Leer TC del formulario
      const tc = await page.evaluate(() => {
        const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
        const val = frm.valor_dolar_honorarios?.value || "0";
        return parseFloat(val.replace(/\./g, "").replace(",", "."));
      });
      // Calcular: 0.22% × CIF_TOTAL en USD → en USD, luego × TC → CLP
      let honorariosUSD = CIF_TOTAL * 0.0022;
      if (honorariosUSD < 50) honorariosUSD = 50;
      if (honorariosUSD > 300) honorariosUSD = 300;
      const honorariosCLP = Math.round(honorariosUSD * tc);
      // Formato: con punto de miles
      const formatted = honorariosCLP.toLocaleString("es-CL");
      await page.evaluate((val) => {
        const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
        frm.fact_honorarios.value = val;
      }, formatted);
      console.log(`  Honorarios PRIMERA: 0.22% × ${CIF_TOTAL.toFixed(2)} = ${honorariosUSD.toFixed(2)} USD → ${formatted} CLP (TC=${tc})`);
    } else {
      // Parcialidad: honorarios = 0
      await page.evaluate(() => {
        const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
        frm.fact_honorarios.value = "0";
      });
      console.log("  Honorarios PARCIALIDAD: 0");
    }

    // RESUMEN → Traer Pago Directo
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
    console.log("  Traer Pago Directo OK");

    // Grabar
    await page.evaluate(() => {
      const form = document.querySelector("form[name='frmEditar']");
      if (form) form.submit();
    });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    const finalUrl = page.url();
    if (finalUrl.includes("lista.php") || finalUrl.includes("mensaje.php") || finalUrl.includes("grabar.php")) {
      console.log(`  ✅ Factura ${op.nro} grabada\n`);
    } else {
      console.log(`  ⚠️ URL post-grabar: ${finalUrl}\n`);
    }
  }

  console.log("✅ Proceso completo");
  await browser.close();
})();
