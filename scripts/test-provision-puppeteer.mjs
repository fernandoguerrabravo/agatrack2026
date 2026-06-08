#!/usr/bin/env node
/**
 * Test: Crear provisión de fondos con Puppeteer para op 190153
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

(async () => {
  const browser = await puppeteer.launch({ headless: false, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);
  console.log("Login OK");

  // Manejar dialogs
  page.on("dialog", async dialog => {
    console.log("Dialog:", dialog.message());
    await dialog.accept();
  });

  // 1. Ir a nuevo.php
  await page.goto(`${BASE}/modulos/contabilidad/solicitud_fondos/nuevo.php`, { waitUntil: "networkidle0" });
  console.log("En nuevo.php");

  // 2. Llenar lib_nid y submit
  await page.type('input[name="lib_nid"]', "190153");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.evaluate(() => document.querySelector("form").submit()),
  ]);
  console.log("Formulario cargado con datos");

  // 3. Esperar cálculos JS
  await new Promise(r => setTimeout(r, 2000));

  // 4. Seleccionar leyenda
  await page.select('select[name="sel_leyendaA"]', "CHEQUE A : TESORERIA GENERAL DE LA REPUBLICA");
  console.log("Leyenda seleccionada");

  // 5. Marcar imprimir
  const imprimirChecked = await page.$eval('input[name="imprimir"]', el => el.checked).catch(() => false);
  if (!imprimirChecked) await page.click('input[name="imprimir"]');
  console.log("Imprimir marcado");

  // 6. Desmarcar email
  const emailChecked = await page.$eval('input[name="email"]', el => el.checked).catch(() => false);
  if (emailChecked) await page.click('input[name="email"]');

  // 7. Leer totales calculados
  const total = await page.$eval('input[name="total_solicitado"]', el => el.value).catch(() => "(no encontrado)");
  const montoTotal = await page.$eval('input[name="MontoTotal"]', el => el.value).catch(() => "(no)");
  console.log("Total solicitado:", total);
  console.log("MontoTotal:", montoTotal);

  // 8. Click en Aceptar
  const btnGuardar = await page.$('input[name="btnGuardar"]');
  if (btnGuardar) {
    console.log("Haciendo click en Guardar...");
    
    // Escuchar nuevas páginas (PDF)
    const newPagePromise = new Promise(resolve => {
      browser.once("targetcreated", async target => {
        const p = await target.page();
        resolve(p);
      });
      setTimeout(() => resolve(null), 15000);
    });

    await btnGuardar.click();
    await new Promise(r => setTimeout(r, 5000));

    const newPage = await newPagePromise;
    if (newPage) {
      console.log("Nueva página abierta:", newPage.url());
      // Si es PDF, descargarlo
      if (newPage.url().includes("pdf") || newPage.url().includes("imprimir") || newPage.url().includes("reporte")) {
        console.log("PDF URL:", newPage.url());
      }
    } else {
      console.log("No se abrió nueva página");
      console.log("URL actual:", page.url());
    }
  } else {
    console.log("Botón no encontrado, intentando submit...");
    await page.evaluate(() => document.querySelector('form[action="grabar.php"]')?.submit());
  }

  // Esperar un poco y cerrar
  await new Promise(r => setTimeout(r, 5000));
  console.log("URL final:", page.url());
  
  // Ver las páginas abiertas
  const pages = await browser.pages();
  console.log("Páginas abiertas:", pages.length);
  for (const p of pages) console.log("  -", p.url());

  await browser.close();
  console.log("Done");
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
