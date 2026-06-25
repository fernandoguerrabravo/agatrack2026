#!/usr/bin/env node
/**
 * Test: Módulo Valores Factura para operación 189753 (KSB aéreo EXW)
 * Campos: Total Neto Items, Total Neto Factura, Peso Bruto (papeleta verificado),
 *         Gastos Hasta FOB (otros cargos AWB), Flete (AWB), Seguro (póliza)
 *         → Ejecute Cálculos → Aceptar
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
const NRO_OP = "189753";

// Datos de la operación
const TOTAL_NETO = "74386.20";      // Factura EXW
const PESO_BRUTO = "1671";          // Peso verificado papeleta
const GASTOS_FOB = "664.74";        // Otros cargos AWB (storage+pickup+awb fee+handling)
const FLETE = "862.16";             // Flete aéreo AWB
const SEGURO = "13.68";             // Prima póliza

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  page.on("dialog", async d => { console.log("[dialog]", d.message()); await d.accept(); });

  // Login
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
  console.log("Login OK");

  // Ir a Valores Generales
  const vgUrl = `${BASE}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${NRO_OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("\n1. Navegando a Valores Generales...");
  await page.goto(vgUrl, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  // Listar campos disponibles para entender la estructura
  console.log("\n2. Explorando campos del formulario...");
  const campos = await page.evaluate(() => {
    const frm = document.frm || document.forms[0];
    if (!frm) return { error: "no form" };
    const fields = {};
    for (const el of frm.elements) {
      if (el.name && (
        el.name.includes("neto") || el.name.includes("peso") || el.name.includes("fob") ||
        el.name.includes("flete") || el.name.includes("seguro") || el.name.includes("cif") ||
        el.name.includes("term") || el.name.includes("moneda") || el.name.includes("gastos") ||
        el.name.includes("valor_ex")
      )) {
        fields[el.name] = el.value;
      }
    }
    return fields;
  });
  console.log("Campos relevantes:", JSON.stringify(campos, null, 2));

  // Llenar campos
  console.log("\n3. Llenando campos...");
  await page.evaluate((data) => {
    const frm = document.frm;
    // Cláusula: EXW = 3
    frm.term_compra.value = "3";
    if (frm.sel_term_compra) frm.sel_term_compra.value = "3";
    // Moneda: USD = 13
    frm.moneda_desc.value = "13";
    if (frm.sel_moneda_desc) frm.sel_moneda_desc.value = "13";
    // Total Neto Items
    frm.dus_total_neto_item.value = data.totalNeto;
    // Total Neto Factura
    frm.dus_total_neto_factura.value = data.totalNeto;
    // Peso Bruto Total (verificado papeleta)
    frm.dus_peso_bruto_total.value = data.pesoBruto;
    // Gastos Hasta FOB 1 (otros cargos AWB)
    if (frm.din_gastos_hasta_fob) frm.din_gastos_hasta_fob.value = data.gastosFob;
    if (frm.dus_valor_ex_fabrica) frm.dus_valor_ex_fabrica.value = data.gastosFob;
    // Flete
    frm.dus_valor_flete_fac.value = data.flete;
    frm.dus_valor_flete_mon.value = "13";
    frm.dus_valor_flete_paridad.value = "1";
    // Seguro
    frm.dus_valor_seguro_fac.value = data.seguro;
    frm.dus_valor_seguro_mon.value = "13";
    frm.dus_valor_seguro_paridad.value = "1";
  }, { totalNeto: TOTAL_NETO, pesoBruto: PESO_BRUTO, gastosFob: GASTOS_FOB, flete: FLETE, seguro: SEGURO });

  console.log(`   Cláusula: EXW (3)`);
  console.log(`   Total Neto: ${TOTAL_NETO}`);
  console.log(`   Peso Bruto: ${PESO_BRUTO} kg`);
  console.log(`   Gastos hasta FOB: ${GASTOS_FOB}`);
  console.log(`   Flete: ${FLETE}`);
  console.log(`   Seguro: ${SEGURO}`);

  // Ejecute Cálculos
  console.log("\n4. Ejecute Cálculos...");
  await page.evaluate(() => {
    if (typeof window.calculos === "function") window.calculos();
  });
  await new Promise(r => setTimeout(r, 2000));

  // Leer resultados
  const resultados = await page.evaluate(() => {
    const frm = document.frm;
    return {
      fob: frm.dus_total_valor_fob?.value || "",
      flete: frm.dus_valor_flete?.value || "",
      seguro: frm.dus_valor_seguro?.value || "",
      cif: frm.dus_valor_cif?.value || "",
      gastos_fob: frm.din_gastos_hasta_fob?.value || frm.dus_valor_ex_fabrica?.value || "",
    };
  });
  console.log("   FOB:", resultados.fob);
  console.log("   Flete:", resultados.flete);
  console.log("   Seguro:", resultados.seguro);
  console.log("   CIF:", resultados.cif);
  console.log("   Gastos FOB:", resultados.gastos_fob);

  // Aceptar
  console.log("\n5. Aceptar...");
  await page.evaluate(() => {
    if (typeof window.aceptar === "function") window.aceptar();
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  console.log(`\n✅ Valores Factura grabado para op ${NRO_OP}`);
  console.log(`   FOB=${resultados.fob} Flete=${resultados.flete} Seguro=${resultados.seguro} CIF=${resultados.cif}`);

  await browser.close();
})();
