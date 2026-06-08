#!/usr/bin/env node
/**
 * Test: Confección Valores Factura con Puppeteer (browser real)
 * Clickea "Ejecute Cálculos" y "Aceptar" como un usuario real.
 */
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
  console.log(`\n=== PUPPETEER: Valores Factura — Op ${OP} ===\n`);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // 1. Login
  console.log("1. Login...");
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  console.log("   ✅ Login OK");

  // 2. Navegar a Valores Factura
  console.log("2. Navegando a Valores Factura...");
  const vgUrl = `${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  await page.goto(vgUrl, { waitUntil: "networkidle0" });
  console.log("   ✅ Página cargada");

  // 3. Verificar valores actuales
  const fobActual = await page.$eval('input[name="dus_total_valor_fob"]', el => el.value);
  const fleteActual = await page.$eval('input[name="dus_valor_flete"]', el => el.value);
  const cifActual = await page.$eval('input[name="dus_valor_cif"]', el => el.value);
  console.log(`   Antes: FOB=${fobActual} Flete=${fleteActual} CIF=${cifActual}`);

  // 4. Click "Ejecute Cálculos"
  console.log("3. Click 'Ejecute Cálculos'...");
  // El botón puede ser un input type=button con onclick="calculos()"
  const calcBtn = await page.$('input[value*="Ejecute"], input[onclick*="calculos"], button[onclick*="calculos"]');
  if (calcBtn) {
    await calcBtn.click();
    await new Promise(r => setTimeout(r, 1000)); // Esperar que JS calcule
    console.log("   ✅ Cálculos ejecutados");
  } else {
    // Intentar ejecutar la función directamente
    await page.evaluate(() => { if (typeof calculos === "function") calculos(); });
    await new Promise(r => setTimeout(r, 1000));
    console.log("   ✅ calculos() ejecutado via evaluate");
  }

  // 5. Verificar valores después de cálculos
  const fobDespues = await page.$eval('input[name="dus_total_valor_fob"]', el => el.value);
  const fleteDespues = await page.$eval('input[name="dus_valor_flete"]', el => el.value);
  const cifDespues = await page.$eval('input[name="dus_valor_cif"]', el => el.value);
  console.log(`   Después de cálculos: FOB=${fobDespues} Flete=${fleteDespues} CIF=${cifDespues}`);

  // 6. Click "Aceptar"
  console.log("4. Click 'Aceptar'...");
  // Manejar posibles alerts/confirms
  page.on("dialog", async dialog => {
    console.log(`   Dialog: ${dialog.type()} - ${dialog.message().slice(0, 100)}`);
    await dialog.accept();
  });

  const aceptarBtn = await page.$('input[value="Aceptar"][onclick*="aceptar"], input[value="Aceptar"]');
  if (aceptarBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
      aceptarBtn.click(),
    ]);
    console.log("   ✅ Aceptar clickeado");
  } else {
    await page.evaluate(() => { if (typeof aceptar === "function") aceptar(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    console.log("   ✅ aceptar() ejecutado");
  }

  // 7. Verificar — recargar y ver valores
  console.log("5. Verificando...");
  await page.goto(vgUrl, { waitUntil: "networkidle0" });
  const fobFinal = await page.$eval('input[name="dus_total_valor_fob"]', el => el.value);
  const fleteFinal = await page.$eval('input[name="dus_valor_flete"]', el => el.value);
  const cifFinal = await page.$eval('input[name="dus_valor_cif"]', el => el.value);
  console.log(`   Final: FOB=${fobFinal} Flete=${fleteFinal} CIF=${cifFinal}`);

  await browser.close();
  console.log("\n✅ Puppeteer completado.\n");
})().catch(async (e) => { console.error("ERROR:", e.message); process.exit(1); });
