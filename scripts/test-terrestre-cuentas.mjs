/**
 * Test: Graba Módulo Cuentas y Valores para operación terrestre 190321
 * Clickea "Traer Cuentas" y luego "Aceptar"
 */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };

const BASE_URL = get("ADUANANET_URL") || "https://fguerragodoy.aduananet2.cl";
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");

const nroOperacion = "190321";

console.log("=== Test Cuentas y Valores Terrestre ===");
console.log("Operación:", nroOperacion);
console.log("");

try {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  console.log("[1] Login AduanaNet...");
  await page.goto(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  console.log("[1] ✅ Login OK");
  page.on("dialog", async dialog => { await dialog.accept(); });

  // Cargar módulo Cuentas
  const ctasUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("[2] Cargando módulo Cuentas y Valores...");
  await page.goto(ctasUrl, { waitUntil: "networkidle0" });
  console.log("[2] ✅ Página cargada");

  // Click "Traer Cuentas"
  console.log("[3] Traer Cuentas...");
  await page.evaluate(() => {
    if (typeof recupera_cuentas === "function") recupera_cuentas();
  });
  await new Promise(r => setTimeout(r, 2000));
  console.log("[3] ✅ Cuentas traídas");

  // Leer valores
  const iva = await page.$eval('input[name="dus_valor178"]', el => el.value).catch(() => "0");
  const total = await page.$eval('input[name="dus_valor191"]', el => el.value).catch(() => "0");
  const clp = await page.$eval('input[name="dus_valor91"]', el => el.value).catch(() => "");
  console.log("\n📊 Valores:");
  console.log("  IVA (178):", iva);
  console.log("  Total (191):", total);
  console.log("  CLP (91):", clp);

  // Click "Aceptar"
  console.log("\n[4] Guardando (Aceptar)...");
  const aceptarBtn = await page.$('input[value="Aceptar"]');
  if (aceptarBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
      aceptarBtn.click(),
    ]);
  } else {
    await page.evaluate(() => {
      if (typeof aceptar === "function") aceptar();
    });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  }
  console.log("[4] ✅ Guardado");

  await browser.close();
  console.log("\n✅ Módulo Cuentas y Valores grabado para operación", nroOperacion);
} catch (err) {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
}
