#!/usr/bin/env node
/**
 * Generar mercancías para 189753 (aéreo EXW KSB)
 * 2 items: HS 84137090, país Brasil, régimen 72
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

const items = [
  { codigo: "02418525", total: 27947, cantidad: 1, desc: "PUMP KSB CPK 250-500", hs: "84137090" },
  { codigo: "02011210", total: 46439.20, cantidad: 5, desc: "MCPK125-100-315 DD EXNP1 15002A", hs: "84137090" },
];
const montoTotal = 74386.20;
const pesoVerificado = 1671; // kg papeleta

(async () => {
  const puppeteer = require2("puppeteer");
  const execPath = fs.existsSync("/usr/bin/chromium-browser") ? "/usr/bin/chromium-browser" : undefined;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(execPath ? { executablePath: execPath } : {}),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  page.on("dialog", async d => { console.log("[dialog]", d.message()); await d.accept(); });

  await page.goto(`${BASE}/modulos/usuarios/login.php?status=-1`, { waitUntil: "networkidle0" });
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click('input[type="submit"]')]);
  console.log("Login OK");

  const pick = (xml, tag) => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) || [])[1]?.trim() || "";

  // Buscar descriptor y arancel para cada item
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`\n--- Item ${i + 1}: ${item.codigo} (${item.desc}) ---`);

    // Buscar descriptor
    await page.goto(`${BASE}/inc/getXML/buscar_descriptores.php?partida=&codigo=${item.codigo}&descripcion=&cli_id=2710`, { waitUntil: "networkidle0" });
    let xml = await page.evaluate(() => document.body.innerText || document.documentElement.outerHTML);
    let dscPartida = pick(xml, "dsc_partida");
    let dscCod = pick(xml, "dsc_cod_producto") || item.codigo;
    let dscDescCorta = pick(xml, "dsc_descrip_corta");
    let dscOtro1 = pick(xml, "dsc_otro1");
    let dscOtro2 = pick(xml, "dsc_otro2");
    let dscObs = pick(xml, "dsc_obs");

    if (!dscPartida) {
      // Buscar por HS code
      console.log("  No hay descriptor por código, buscando por HS:", item.hs);
      await page.goto(`${BASE}/inc/getXML/buscar_descriptores.php?partida=${item.hs}&codigo=&descripcion=&cli_id=2710`, { waitUntil: "networkidle0" });
      xml = await page.evaluate(() => document.body.innerText || document.documentElement.outerHTML);
      dscPartida = pick(xml, "dsc_partida") || item.hs;
      dscCod = pick(xml, "dsc_cod_producto") || item.codigo;
      dscDescCorta = pick(xml, "dsc_descrip_corta");
    }

    const merNombre = [dscCod.padEnd(16), dscDescCorta, dscOtro1, dscOtro2, dscObs].join(";");
    console.log("  Partida:", dscPartida);
    console.log("  Nombre:", merNombre.substring(0, 60));

    // Consultar arancel con país Brasil (220), régimen 72
    await page.goto(`${BASE}/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dscPartida}&pais=220&regimen=72`, { waitUntil: "networkidle0" });
    const arHtml = await page.evaluate(() => document.body.innerHTML);
    const sels = [...arHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
    const sel = sels.find(s => s[3] && s[3] !== "") || sels[0];
    const advalorem = sel ? sel[1] : "0";
    const codAranTratado = sel ? sel[2] : dscPartida;
    const nroAcuerdo = sel ? sel[3] : "";
    console.log("  Ad-valorem:", advalorem + "%", "| Tratado:", codAranTratado, "| Acuerdo:", nroAcuerdo);

    // Ir al formulario mercancía
    const mercUrl = `${BASE}/modulos/din/dus_encabezado/din_mercancia.php?lib_base=1&lib_nid=${NRO_OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
    await page.goto(mercUrl, { waitUntil: "networkidle0" });
    await new Promise(r => setTimeout(r, 1500));

    // Leer CIF neto
    const cifNeto = await page.evaluate(() => parseFloat((document.frm || document.forms[0]).cif_neto?.value) || 1);

    // Calcular valores (EXW: peso prorrateado por monto)
    const totalNetoItem = item.total;
    const pesoItem = Math.round(pesoVerificado * (item.total / montoTotal));
    const merCif = (totalNetoItem * cifNeto).toFixed(2);
    const merFob = (item.total / pesoItem).toFixed(6);
    const ivaMonto = (parseFloat(merCif) * 19 / 100).toFixed(2);
    const cantStr = String(pesoItem).padStart(8, "0");

    console.log("  CIF neto factor:", cifNeto);
    console.log("  Peso item:", pesoItem, "kg");
    console.log("  CIF:", merCif, "| FOB unit:", merFob, "| IVA:", ivaMonto);

    // Llenar formulario
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
      frm.mer_monto_ajuste_item.value = "0.00";
      frm.mer_sig_ajuste.value = "+";
      frm.mer_porc_advalorem.value = data.advalorem;
      frm.mer_cuenta_advalorem.value = "223";
      frm.mer_mto_cta_advalorem.value = "0.00";
      frm.mer_cod_obs1.value = "99";
      if (frm.lmer_cod_obs1) frm.lmer_cod_obs1.value = "99";
      frm.mer_obs1.value = data.obs1;
      frm.mer_cod_obs2.value = ""; frm.mer_obs2.value = "";
      frm.mer_porc_otro1.value = "19.000";
      frm.mer_cod_otro1.value = "178";
      frm.mer_signo_otro1.value = "+";
      frm.mer_monto_impto_otro1.value = data.ivaMonto;
      frm.mer_porc_otro2.value = "0.000"; frm.mer_cod_otro2.value = ""; frm.mer_monto_impto_otro2.value = "0.00";
      frm.mer_cod_obs3.value = ""; frm.mer_obs3.value = "";
      frm.mer_porc_otro3.value = "0.000"; frm.mer_cod_otro3.value = ""; frm.mer_monto_impto_otro3.value = "0.00";
      frm.mer_porc_otro4.value = "0.000"; frm.mer_cod_otro4.value = ""; frm.mer_monto_impto_otro4.value = "0.00";
      frm.mer_cod_obs4.value = "";
      frm.mer_nro_item.value = "";
      frm.comando.value = "U";
    }, {
      merProducto: `${dscCod}@#~2710`,
      codigoProd: item.codigo,
      dscPartida,
      codAranTratado,
      correlativo: sel ? (sel[4] || "") : "",
      nroAcuerdo,
      merNombre,
      cantidad: pesoItem.toFixed(4),
      merFob,
      merCif,
      totalNeto: totalNetoItem.toFixed(6),
      advalorem,
      obs1: `${cantStr}.000000 KG`,
      ivaMonto,
    });

    // TraeCuenta popup (solo si hay advalorem > 0)
    if (parseFloat(advalorem) > 0) {
      const popupPromise = new Promise(resolve => {
        browser.once("targetcreated", async target => { resolve(await target.page()); });
        setTimeout(() => resolve(null), 10000);
      });
      await page.evaluate(() => { window.TraeCuenta(); });
      const popup = await popupPromise;
      if (popup) {
        await new Promise(r => setTimeout(r, 3000));
        const btn = await popup.$('input[value="Aceptar"]') || await popup.$('input[type="button"]');
        if (btn) await btn.click();
        await new Promise(r => setTimeout(r, 1000));
        await popup.close().catch(() => {});
      }
    }

    // Grabar
    await page.evaluate(() => { (document.frm || document.forms[0]).submit(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    console.log(`  ✅ Item ${i + 1} grabado`);
  }

  console.log("\n✅ Mercancías completas para op " + NRO_OP);
  await browser.close();
})();
