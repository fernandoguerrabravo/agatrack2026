#!/usr/bin/env node
/**
 * Explorar la fila creada por addRef('') - tipo documento, folio, fecha
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
  page.on("dialog", async dialog => {
    console.log(`   [dialog] ${dialog.type()}: ${dialog.message()}`);
    await dialog.accept();
  });

  try {
    await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
    await page.type('input[name="login"]', LOGIN);
    await page.type('input[name="clave"]', CLAVE);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);

    // Ir directo al formulario
    const formUrl = `${BASE}/modulos/contabilidad/facturacion/afecta/formulario.php?opcion_clausula=&accion=N&tipo_fact=unitario&nid=${NRO_OP}&lib_base=1&opcion_facturar=iva&cli_id=96691060&txt_cli_id=KSB+CHILE+S.A.`;
    await page.goto(formUrl, { waitUntil: "networkidle0" });
    await new Promise(r => setTimeout(r, 2000));
    console.log("En formulario OK");

    // Click addRef
    console.log("\n1. addRef('')...");
    await page.evaluate(() => {
      const link = document.querySelector('a[href*="addRef"]');
      if (link) link.click();
    });
    await new Promise(r => setTimeout(r, 2000));

    // Obtener el HTML completo de tblGrillaRef
    console.log("\n2. HTML de tblGrillaRef (tabla de referencias):");
    const grillaHtml = await page.evaluate(() => {
      const tbl = document.getElementById("tblGrillaRef");
      if (tbl) return tbl.outerHTML;
      return "NO ENCONTRADO";
    });
    console.log(grillaHtml);

    // Listar todos los selects e inputs dentro de la tabla
    console.log("\n3. Campos en tblGrillaRef:");
    const grillaFields = await page.evaluate(() => {
      const tbl = document.getElementById("tblGrillaRef");
      if (!tbl) return { selects: [], inputs: [] };
      const selects = tbl.querySelectorAll("select");
      const inputs = tbl.querySelectorAll("input");
      return {
        selects: Array.from(selects).map(s => ({
          name: s.name,
          options: Array.from(s.options).map(o => `${o.value}:${o.text}`)
        })),
        inputs: Array.from(inputs).map(i => ({
          name: i.name, type: i.type, value: i.value, size: i.size
        }))
      };
    });
    console.log("   SELECTS:");
    grillaFields.selects.forEach(s => {
      console.log(`     ${s.name}:`);
      s.options.forEach(o => console.log(`       ${o}`));
    });
    console.log("   INPUTS:");
    grillaFields.inputs.forEach(i => console.log(`     ${i.name} type=${i.type} value="${i.value}" size=${i.size}`));

    // Borrar
    await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
    const filInput = await page.$('input[name="fil_lib_nid"]');
    if (filInput) { await filInput.type(NRO_OP); await page.evaluate(() => { if (typeof window.filtrarLista === "function") window.filtrarLista(); }); await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}); await new Promise(r => setTimeout(r, 1000)); }
    const borrarId = await page.evaluate(() => { const m = document.body.innerHTML.match(/borrar\(\s*'(\d+)'\s*\)/); return m ? m[1] : null; });
    if (borrarId) { await page.evaluate((id) => { window.borrar(id); }, borrarId); await new Promise(r => setTimeout(r, 2000)); console.log(`Borrada ${borrarId}`); }

  } catch (e) {
    console.error("ERROR:", e.message);
  } finally {
    await browser.close();
  }
})();
