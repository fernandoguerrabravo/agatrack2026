#!/usr/bin/env node
/**
 * Verificar si las facturas 190369 y 190500 existen en AduanaNet
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
const OPS = ["190369", "190500"];

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  page.on("dialog", async d => await d.accept());

  // Login
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);

  // Lista
  await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });

  for (const op of OPS) {
    const filInput = await page.$('input[name="fil_lib_nid"]');
    if (filInput) {
      await filInput.evaluate(el => el.value = "");
      await filInput.type(op);
    }
    await page.evaluate(() => { if (typeof window.filtrarLista === "function") window.filtrarLista(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const found = await page.evaluate(() => {
      const html = document.body.innerHTML;
      const imp = html.match(/imprimir\(\s*'(\d+)'\s*\)/);
      const mod = html.match(/modificar\(\s*'(\d+)'\s*\)/);
      const borr = html.match(/borrar\(\s*'(\d+)'\s*\)/);
      return { imprimir: imp ? imp[1] : null, modificar: mod ? mod[1] : null, borrar: borr ? borr[1] : null };
    });
    console.log(`${op}: imprimir=${found.imprimir || "NO"} modificar=${found.modificar || "NO"} borrar=${found.borrar || "NO"}`);
  }

  await browser.close();
})();
