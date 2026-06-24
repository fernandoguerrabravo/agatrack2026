#!/usr/bin/env node
/**
 * Borrar factura duplicada "en curso" de 190533 en AduanaNet
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
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  page.on("dialog", async d => { console.log("DIALOG:", d.message()); await d.accept(); });

  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);

  await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });

  // Buscar facturas "en curso" de 190533
  const ids = await page.evaluate(() => {
    const rows = document.querySelectorAll("tr");
    const found = [];
    for (const row of rows) {
      if (row.textContent.includes("190533") && row.textContent.includes("en curso")) {
        const m = row.innerHTML.match(/borrar\(\s*'(\d+)'\s*\)/);
        if (m) found.push(m[1]);
      }
    }
    return found;
  });
  console.log("Facturas en curso de 190533:", ids);

  if (ids.length > 0) {
    console.log("Borrando factura ID:", ids[0]);
    await page.evaluate((id) => { window.borrar(id); }, ids[0]);
    await new Promise(r => setTimeout(r, 3000));
    console.log("✅ Borrada");
  } else {
    console.log("No se encontraron facturas en curso para borrar");
  }

  await browser.close();
})();
