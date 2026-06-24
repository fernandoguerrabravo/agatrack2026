#!/usr/bin/env node
/**
 * Ejecutar módulo Mercancías completo para 189696 (terrestre)
 * Crea el item con arancel, descriptor, valores, IVA y deducción tramo nacional
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

// Datos extraídos del documento
const codigoProd = "0000374271"; // codigo_material de la factura
const pesoNeto = 27000;
const flete = 3200;
const seguro = 19.58;
const montoTotalFactura = 35600;
const fobValue = 32400; // factura - flete
// Ruta ~1450 km → 13%
const deduccionTramoNacional = Math.round(flete * 13 / 100 * 100) / 100; // 416

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

  // Login
  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
  console.log("Login OK");

  // Obtener cookies para fetch HTTP
  const cookies = await page.evaluate(() => document.cookie);
  const cookieHeader = cookies;

  // 1. Buscar descriptor por código producto
  console.log("\n1. Buscando descriptor para código:", codigoProd);
  const descUrl = `${BASE}/inc/getXML/buscar_descriptores.php?partida=&codigo=${codigoProd}&descripcion=&cli_id=2710`;
  await page.goto(descUrl, { waitUntil: "networkidle0" });
  const descXml = await page.evaluate(() => document.body.innerText || document.documentElement.outerHTML);
  
  const pickXml = (xml, tag) => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) || [])[1]?.trim() || "";
  const dscPartida = pickXml(descXml, "dsc_partida");
  const dscCodProducto = pickXml(descXml, "dsc_cod_producto") || codigoProd;
  const dscDescripCorta = pickXml(descXml, "dsc_descrip_corta");
  const dscOtro1 = pickXml(descXml, "dsc_otro1");
  const dscOtro2 = pickXml(descXml, "dsc_otro2");
  const dscObs = pickXml(descXml, "dsc_obs");
  const merNombre = [dscCodProducto.padEnd(16), dscDescripCorta, dscOtro1, dscOtro2, dscObs].join(";");

  console.log("   Partida:", dscPartida);
  console.log("   Producto:", dscCodProducto);
  console.log("   Nombre:", merNombre.substring(0, 80));

  // 2. Consultar arancel con país Argentina (224), regimen 1
  console.log("\n2. Consultando arancel para partida:", dscPartida);
  const arancelUrl = `${BASE}/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dscPartida}&pais=224&regimen=1`;
  await page.goto(arancelUrl, { waitUntil: "networkidle0" });
  const arancelHtml = await page.evaluate(() => document.body.innerHTML);
  const sels = [...arancelHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
  const sel = sels.find(s => s[3] && s[3] !== "") || sels[0];
  const advalorem = sel ? sel[1] : "0";
  const codAranTratado = sel ? sel[2] : dscPartida;
  const nroAcuerdo = sel ? sel[3] : "";
  const correlativo = sel ? (sel[4] || "") : "";
  console.log("   Ad-valorem:", advalorem + "%");
  console.log("   Arancel tratado:", codAranTratado);
  console.log("   Acuerdo:", nroAcuerdo);

  // 3. Ir al formulario de mercancía
  console.log("\n3. Navegando a formulario mercancía...");
  const mercUrl = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php?lib_base=1&lib_nid=${NRO_OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  await page.goto(mercUrl, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 2000));

  // Leer CIF neto precargado
  const cifNeto = await page.evaluate(() => {
    const frm = document.frm || document.forms[0];
    return parseFloat(frm.cif_neto?.value) || 1;
  });
  console.log("   CIF neto (factor):", cifNeto);

  // Calcular valores
  const totalNetoItem = montoTotalFactura; // solo 1 item producto
  const cantidad = pesoNeto;
  const cantStr = Math.round(cantidad).toString().padStart(8, "0");
  const merCif = (totalNetoItem * cifNeto).toFixed(2);
  const merFob = (fobValue / cantidad).toFixed(6);
  const ivaMonto = (parseFloat(merCif) * 19 / 100).toFixed(2);

  console.log("   Total neto item:", totalNetoItem);
  console.log("   Cantidad (kg):", cantidad);
  console.log("   CIF item:", merCif);
  console.log("   FOB unitario:", merFob);
  console.log("   IVA (19%):", ivaMonto);
  console.log("   Deducción tramo nacional:", deduccionTramoNacional);

  // 4. Llenar formulario
  console.log("\n4. Llenando formulario...");
  await page.evaluate((data) => {
    const frm = document.frm || document.forms[0];
    frm.linea.value = "";
    frm.mer_producto.value = data.merProducto;
    frm.mer_producto1.value = data.codigoProd;
    if (frm.descripcion_corta) frm.descripcion_corta.value = "";
    frm.mer_cod_arancel.value = data.dscPartida;
    frm.mer_cod_arancel_tratado.value = data.codAranTratado;
    if (frm.mer_nro_correlativo_arancel) frm.mer_nro_correlativo_arancel.value = data.correlativo;
    frm.mer_nro_acuerdo_comercial.value = data.nroAcuerdo;
    if (frm.lmer_nro_acuerdo_comercial) frm.lmer_nro_acuerdo_comercial.value = data.nroAcuerdo;
    frm.mer_sujeto_cupo.value = "0";
    frm.mer_nombre.value = data.merNombre;
    frm.ume_id.value = "6"; // KG
    if (frm.lume_id) frm.lume_id.value = "6";
    frm.mer_cantidad.value = data.cantidad;
    frm.mer_cantidad_mercancia_um.value = data.cantidad;
    frm.mer_fob_unitario.value = data.merFob;
    frm.mer_valor_cif_item.value = data.merCif;
    frm.mer_total_neto.value = data.totalNeto;
    frm.mer_monto_ajuste_item.value = data.ajusteMonto;
    frm.mer_sig_ajuste.value = "-";
    frm.mer_porc_advalorem.value = data.advalorem;
    frm.mer_cuenta_advalorem.value = "223";
    frm.mer_mto_cta_advalorem.value = "0.00";
    // Obs1: peso
    frm.mer_cod_obs1.value = "99";
    if (frm.lmer_cod_obs1) frm.lmer_cod_obs1.value = "99";
    frm.mer_obs1.value = data.obs1;
    // Obs2: DEDUCT. TRAMO NACIONAL
    frm.mer_cod_obs2.value = "09";
    if (frm.lmer_cod_obs2) frm.lmer_cod_obs2.value = "09";
    frm.mer_obs2.value = "DEDUCT. TRAMO NACIONAL";
    // IVA 19%
    frm.mer_porc_otro1.value = "19.000";
    frm.mer_cod_otro1.value = "178";
    frm.mer_signo_otro1.value = "+";
    frm.mer_monto_impto_otro1.value = data.ivaMonto;
    // Limpiar otros
    frm.mer_porc_otro2.value = "0.000"; frm.mer_cod_otro2.value = ""; frm.mer_monto_impto_otro2.value = "0.00";
    frm.mer_cod_obs3.value = ""; frm.mer_obs3.value = "";
    frm.mer_porc_otro3.value = "0.000"; frm.mer_cod_otro3.value = ""; frm.mer_monto_impto_otro3.value = "0.00";
    frm.mer_porc_otro4.value = "0.000"; frm.mer_cod_otro4.value = ""; frm.mer_monto_impto_otro4.value = "0.00";
    frm.mer_cod_obs4.value = "";
    frm.mer_nro_item.value = "";
    frm.comando.value = "U";
  }, {
    merProducto: `${dscCodProducto}@#~2710`,
    codigoProd,
    dscPartida,
    codAranTratado,
    correlativo,
    nroAcuerdo,
    merNombre,
    cantidad: cantidad.toFixed(4),
    merFob,
    merCif,
    totalNeto: totalNetoItem.toFixed(6),
    advalorem,
    obs1: `${cantStr}.000000 KG`,
    ivaMonto,
    ajusteMonto: deduccionTramoNacional.toFixed(2),
  });

  // 5. Cálculo de Derechos (popup TraeCuenta)
  console.log("5. Cálculo de Derechos (TraeCuenta)...");
  const popupPromise = new Promise(resolve => {
    browser.once("targetcreated", async target => { resolve(await target.page()); });
    setTimeout(() => resolve(null), 10000);
  });
  await page.evaluate(() => { window.TraeCuenta(); });
  const popupPage = await popupPromise;
  if (popupPage) {
    await new Promise(r => setTimeout(r, 3000));
    const aceptarBtn = await popupPage.$('input[value="Aceptar"]') || await popupPage.$('input[type="button"]');
    if (aceptarBtn) await aceptarBtn.click();
    await new Promise(r => setTimeout(r, 1000));
    await popupPage.close().catch(() => {});
    console.log("   ✅ Popup cerrado");
  } else {
    console.log("   ⚠️ No se abrió popup");
  }

  // 6. Grabar
  console.log("6. Grabando...");
  await page.evaluate(() => {
    const frm = document.frm || document.forms[0];
    frm.submit();
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  console.log(`\n✅ Item mercancía grabado para op ${NRO_OP}`);
  console.log(`   Arancel: ${dscPartida} | Ad-valorem: ${advalorem}%`);
  console.log(`   CIF: ${merCif} | IVA: ${ivaMonto}`);
  console.log(`   Deducción tramo nacional: -${deduccionTramoNacional}`);

  await browser.close();
})();
