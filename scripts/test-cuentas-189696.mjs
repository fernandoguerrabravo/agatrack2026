#!/usr/bin/env node
/**
 * Ejecutar módulo Cuentas y Valores para 189696
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
const NRO_OP = "189696";

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  page.on("dialog", async d => { console.log("[dialog]", d.message()); await d.accept(); });

  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
  console.log("Login OK");

  // 1. Ir a Cuentas y Valores
  const ctasUrl = `${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${NRO_OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("\n1. Navegando a Cuentas y Valores...");
  await page.goto(ctasUrl, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  // 2. Click "Traer Cuentas"
  console.log("2. Traer Cuentas...");
  await page.evaluate(() => {
    if (typeof window.recupera_cuentas === "function") window.recupera_cuentas();
  });
  await new Promise(r => setTimeout(r, 2000));

  // 3. Leer valores
  const valores = await page.evaluate(() => {
    const frm = document.frm || document.forms[0];
    return {
      iva: frm.dus_valor178?.value || "",
      total: frm.dus_valor191?.value || "",
      clp: frm.dus_valor91?.value || "",
    };
  });
  console.log("   IVA:", valores.iva);
  console.log("   Total:", valores.total);
  console.log("   CLP:", valores.clp);

  // 4. Click Aceptar
  console.log("3. Aceptar...");
  const aceptarBtn = await page.$('input[value="Aceptar"]');
  if (aceptarBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
      aceptarBtn.click(),
    ]);
  } else {
    await page.evaluate(() => { if (typeof window.aceptar === "function") window.aceptar(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  }
  await new Promise(r => setTimeout(r, 2000));

  console.log("\n✅ Cuentas y Valores grabado para op", NRO_OP);
  console.log("   IVA=" + valores.iva, "Total=" + valores.total, "CLP=" + valores.clp);

  await browser.close();
})();
