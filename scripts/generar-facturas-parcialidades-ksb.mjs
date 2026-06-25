#!/usr/bin/env node
/**
 * Generar facturas KSB para grupos con parcialidades
 * - EM 260587: 190545 (1ra), 190590 (_2), 190591 (_3)
 * - EM 260601: 190369 (1ra), 190552 (_2)
 * 
 * Regla:
 * - Primera: Traer Honorarios → modificar honorarios = 0.22% × CIF_TOTAL (mín 50, máx 300 USD) × TC
 * - Parcialidades: Traer Honorarios → honorarios = 0
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

const GRUPOS = [
  {
    ref: "EM 260587",
    cifTotal: 37628.20 + 9656.99 + 7876.17, // 55161.36
    ops: [
      { nro: "190545", esPrimera: true },
      { nro: "190590", esPrimera: false },
      { nro: "190591", esPrimera: false },
    ],
  },
  {
    ref: "EM 260601",
    cifTotal: 93425.57 + 23688.73, // 117114.30
    ops: [
      { nro: "190369", esPrimera: true },
      { nro: "190552", esPrimera: false },
    ],
  },
];

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

  for (const grupo of GRUPOS) {
    console.log(`\n========== ${grupo.ref} (CIF total: ${grupo.cifTotal.toFixed(2)}) ==========`);

    for (const op of grupo.ops) {
      console.log(`\n--- ${op.nro} (${op.esPrimera ? "PRIMERA" : "PARCIALIDAD"}) ---`);

      // Crear factura
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

      if (!page.url().includes("formulario.php")) {
        const directUrl = `${BASE}/modulos/contabilidad/facturacion/afecta/formulario.php?opcion_clausula=&accion=N&tipo_fact=unitario&nid=${op.nro}&lib_base=1&opcion_facturar=iva&cli_id=96691060&txt_cli_id=KSB+CHILE+S.A.`;
        await page.goto(directUrl, { waitUntil: "networkidle0" });
        await new Promise(r => setTimeout(r, 2000));
      }

      if (!page.url().includes("formulario.php")) {
        console.log("  ❌ No llegó al formulario");
        continue;
      }

      // Orden de Compra
      await page.evaluate(() => { const link = document.querySelector('a[href*="addRef"]'); if (link) link.click(); });
      await new Promise(r => setTimeout(r, 2000));
      await page.evaluate((ref) => {
        const sel = document.querySelector('select[name="fare_tipo_doc0"]');
        if (sel) sel.value = "801";
      }, grupo.ref);
      const folioInput = await page.$('input[name="fare_folio_doc0"]');
      if (folioInput) await folioInput.type(grupo.ref);
      const fechaInput = await page.$('input[name="fare_fecha_doc0"]');
      if (fechaInput) {
        // Usar fecha del formulario
        const fecha = await page.evaluate(() => {
          const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
          return frm.fact_fecha_aceptacion?.value || "";
        });
        if (fecha) await fechaInput.type(fecha);
      }
      console.log("  OC: " + grupo.ref);

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
      }
      await new Promise(r => setTimeout(r, 2000));

      // Modificar honorarios
      if (op.esPrimera) {
        const tc = await page.evaluate(() => {
          const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
          return parseFloat((frm.valor_dolar_honorarios?.value || "0").replace(/\./g, "").replace(",", "."));
        });
        let honorariosUSD = grupo.cifTotal * 0.0022;
        if (honorariosUSD < 50) honorariosUSD = 50;
        if (honorariosUSD > 300) honorariosUSD = 300;
        const honorariosCLP = Math.round(honorariosUSD * tc);
        const formatted = honorariosCLP.toLocaleString("es-CL");
        await page.evaluate((val) => {
          const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
          frm.fact_honorarios.value = val;
        }, formatted);
        console.log(`  Honorarios: ${honorariosUSD.toFixed(2)} USD → ${formatted} CLP (TC=${tc})`);
      } else {
        await page.evaluate(() => {
          const frm = document.querySelector("form[name='frmEditar']") || document.forms[0];
          frm.fact_honorarios.value = "0";
        });
        console.log("  Honorarios: 0");
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

      // Grabar
      await page.evaluate(() => {
        const form = document.querySelector("form[name='frmEditar']");
        if (form) form.submit();
      });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      const finalUrl = page.url();
      if (finalUrl.includes("lista.php") || finalUrl.includes("mensaje.php") || finalUrl.includes("grabar.php")) {
        console.log("  ✅ Grabada");
      } else {
        console.log("  ⚠️ URL: " + finalUrl.substring(finalUrl.lastIndexOf("/") + 1, finalUrl.lastIndexOf("/") + 50));
      }
    }
  }

  console.log("\n✅ Proceso completo");
  await browser.close();
})();
