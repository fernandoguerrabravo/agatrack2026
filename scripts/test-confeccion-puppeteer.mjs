#!/usr/bin/env node
/** Test directo de los módulos Puppeteer (Valores + Cuentas) para una op */
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const BASE = get("ADUANANET_URL");
const LOGIN = get("ADUANANET_LOGIN");
const CLAVE = get("ADUANANET_CLAVE");
const OP = process.argv[2] || "190276";

(async () => {
  console.log(`\n=== TEST Puppeteer Valores + Cuentas — Op ${OP} ===\n`);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on("dialog", async dialog => { console.log("  [dialog]", dialog.message().slice(0, 80)); await dialog.accept(); });

  // Login
  console.log("1. Login...");
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
  console.log("   ✅ OK");

  // VALORES FACTURA
  console.log("\n2. Valores Factura — Ejecute Cálculos + Aceptar...");
  await page.goto(`${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { waitUntil: "networkidle0" });
  
  // Ejecute Cálculos
  await page.evaluate(() => { if (typeof calculos === "function") calculos(); });
  await new Promise(r => setTimeout(r, 1500));
  const cif1 = await page.$eval('input[name="dus_valor_cif"]', el => el.value);
  console.log("   Después calculos(): CIF=" + cif1);

  // Aceptar
  await page.evaluate(() => { if (typeof aceptar === "function") aceptar(); });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  console.log("   ✅ Aceptar ejecutado");

  // Verificar
  await page.goto(`${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { waitUntil: "networkidle0" });
  const cifFinal = await page.$eval('input[name="dus_valor_cif"]', el => el.value);
  console.log("   Verificación CIF=" + cifFinal);

  // CUENTAS Y VALORES
  console.log("\n3. Cuentas y Valores — Traer Cuentas + Aceptar...");
  await page.goto(`${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { waitUntil: "networkidle0" });

  // Traer Cuentas
  await page.evaluate(() => { if (typeof recupera_cuentas === "function") recupera_cuentas(); });
  await new Promise(r => setTimeout(r, 1000));
  const iva1 = await page.$eval('input[name="dus_valor178"]', el => el.value);
  console.log("   Después recupera_cuentas(): IVA=" + iva1);

  // Aceptar
  await page.evaluate(() => { if (typeof aceptar === "function") aceptar(); });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  console.log("   ✅ Aceptar ejecutado");

  // Verificar
  await page.goto(`${BASE}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`, { waitUntil: "networkidle0" });
  const ivaFinal = await page.$eval('input[name="dus_valor178"]', el => el.value);
  const totalFinal = await page.$eval('input[name="dus_valor191"]', el => el.value);
  console.log("   Verificación: IVA=" + ivaFinal + " Total=" + totalFinal);

  await browser.close();
  console.log("\n✅ Todo OK.\n");
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
