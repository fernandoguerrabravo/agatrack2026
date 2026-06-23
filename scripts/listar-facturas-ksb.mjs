#!/usr/bin/env node
/**
 * Listar TODAS las facturas de KSB en AduanaNet (lista completa sin filtro)
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
  page.on("dialog", async d => await d.accept());

  // Login
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);

  // Lista facturas - filtrar por cliente KSB (cli_id=96691060)
  await page.goto(`${BASE}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });

  // Buscar si hay un filtro de cliente
  const filCliente = await page.$('input[name="fil_cli_id"]');
  if (filCliente) {
    await filCliente.type("96691060");
  }
  // Buscar filtro por NID  
  const filNid = await page.$('input[name="fil_lib_nid"]');

  // Submit filtro
  await page.evaluate(() => {
    if (typeof window.filtrarLista === "function") window.filtrarLista();
    else {
      const form = document.querySelector("form");
      if (form) form.submit();
    }
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  // Extraer todas las filas de la tabla
  const facturas = await page.evaluate(() => {
    const html = document.body.innerHTML;
    // Buscar todos los NID que aparecen en la tabla
    const nidMatches = html.matchAll(/(\d{6})\s*<\/td>/g);
    const imprimirMatches = [...html.matchAll(/imprimir\(\s*'(\d+)'\s*\)/g)];
    const borrarMatches = [...html.matchAll(/borrar\(\s*'(\d+)'\s*\)/g)];
    
    // Obtener texto de las filas de la tabla
    const rows = document.querySelectorAll("table tr");
    const data = [];
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 3) {
        const text = Array.from(cells).map(c => c.textContent?.trim() || "").join(" | ");
        if (text.match(/\d{6}/)) {
          data.push(text.substring(0, 150));
        }
      }
    }
    return { 
      rowCount: data.length, 
      rows: data.slice(0, 30),
      imprimirCount: imprimirMatches.length,
      borrarCount: borrarMatches.length,
    };
  });

  console.log(`Facturas encontradas: ${facturas.rowCount}`);
  console.log(`imprimir() count: ${facturas.imprimirCount}`);
  console.log(`borrar() count: ${facturas.borrarCount}`);
  console.log("\nFilas:");
  facturas.rows.forEach(r => console.log("  " + r));

  // Ahora intentar filtrar por NID específico 190369
  console.log("\n--- Filtrando por NID 190369 ---");
  if (filNid) {
    await filNid.evaluate(el => el.value = "");
    await filNid.type("190369");
  } else {
    const filNid2 = await page.$('input[name="fil_lib_nid"]');
    if (filNid2) {
      await filNid2.evaluate(el => el.value = "");
      await filNid2.type("190369");
    }
  }
  await page.evaluate(() => {
    if (typeof window.filtrarLista === "function") window.filtrarLista();
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  const filtered = await page.evaluate(() => {
    const rows = document.querySelectorAll("table tr");
    const data = [];
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (cells.length >= 3) {
        const text = Array.from(cells).map(c => c.textContent?.trim() || "").join(" | ");
        if (text.match(/\d{5,}/)) data.push(text.substring(0, 150));
      }
    }
    return data;
  });
  console.log(`Filas filtradas: ${filtered.length}`);
  filtered.forEach(r => console.log("  " + r));

  await browser.close();
})();
