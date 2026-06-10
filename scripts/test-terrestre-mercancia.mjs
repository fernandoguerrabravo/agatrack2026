/**
 * Test: Graba Módulo Mercancía para operación terrestre 190321
 * Mismo flujo que marítimo:
 * - Buscar descriptor por código producto
 * - Consultar arancel con país 224 y régimen 72
 * - Calcular valores item
 * - Excluir item "FREIGHT" de la factura
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

// Datos del invoice — valor total CPT (incluye flete)
const item = {
  codigo_producto: "39012029900U",
  codigo_material: "0099097501",
  peso_neto: 27000,
  monto: 26420, // Valor total CPT (FOB 23220 + flete 3200)
};
const partidaCO = "3901.20.00";
const pais = "224";
const regimen = "72";

console.log("=== Test Mercancía Terrestre ===");
console.log("Operación:", nroOperacion);
console.log("Producto:", item.codigo_producto);
console.log("Partida CO:", partidaCO);
console.log("País:", pais, "Régimen:", regimen);
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

  // Buscar descriptor
  console.log("[2] Buscando descriptor...");
  const descUrl = `${BASE_URL}/inc/getXML/buscar_descriptores.php?partida=&codigo=${item.codigo_material}&descripcion=&cli_id=2710`;
  const descRes = await page.goto(descUrl, { waitUntil: "networkidle0" });
  const descXml = await descRes.text();
  const pickXml = (xml, tag) => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) || [])[1]?.trim() || "";
  const dscPartida = pickXml(descXml, "dsc_partida") || partidaCO;
  const dscCod = pickXml(descXml, "dsc_cod_producto") || item.codigo_producto;
  const merNombre = [dscCod.padEnd(15), pickXml(descXml, "dsc_descrip_corta"), pickXml(descXml, "dsc_otro1"), pickXml(descXml, "dsc_otro2"), pickXml(descXml, "dsc_obs")].join(";");
  console.log("  Partida:", dscPartida);
  console.log("  Código:", dscCod);
  console.log("  Nombre:", merNombre.substring(0, 80));

  // Consultar arancel
  console.log("[3] Consultando arancel...");
  const arancelUrl = `${BASE_URL}/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dscPartida}&pais=${pais}&regimen=${regimen}`;
  const arancelRes = await page.goto(arancelUrl, { waitUntil: "networkidle0" });
  const arancelHtml = await arancelRes.text();
  const sels = [...arancelHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
  const sel = sels.find(s => s[3] && s[3] !== "") || sels[0];
  const advalorem = sel ? sel[1] : "0";
  const codAranTratado = sel ? sel[2] : dscPartida;
  const nroAcuerdo = sel ? sel[3] : "";
  console.log("  Advalorem:", advalorem);
  console.log("  Cod arancel tratado:", codAranTratado);
  console.log("  Nro acuerdo:", nroAcuerdo);

  // Cargar mercancía y eliminar existentes
  const mercUrl = `${BASE_URL}/modulos/din/dus_encabezado/din_mercancia.php`;
  const mercFormUrl = `${mercUrl}?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  console.log("[4] Cargando mercancía...");
  await page.goto(mercFormUrl, { waitUntil: "networkidle0" });

  // Eliminar existentes
  const existingItems = await page.evaluate(() => {
    const sel = document.querySelector('select[name="linea"]');
    if (!sel) return [];
    return Array.from(sel.options).map(o => o.value).filter(v => v && v !== "");
  });
  console.log("  Items existentes:", existingItems.length);
  for (const n of existingItems.reverse()) {
    console.log("  Eliminando item", n);
    await page.evaluate((url, data) => {
      const form = document.createElement("form");
      form.method = "POST"; form.action = url;
      for (const [k, v] of Object.entries(data)) {
        const input = document.createElement("input");
        input.name = k; input.value = v; form.appendChild(input);
      }
      document.body.appendChild(form); form.submit();
    }, mercUrl, { lib_base: "1", lib_nid: nroOperacion, lbac_nid: "0", dus_tipo_envio: "2", mer_nro_item: n, comando: "E", pagno: "0" });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  }

  // Recargar formulario
  await page.goto(mercFormUrl, { waitUntil: "networkidle0" });

  // Leer valores precargados del form (FOB, CIF neto)
  const formValues = await page.evaluate(() => {
    const frm = document.frm;
    return {
      cif_neto: frm.cif_neto?.value || "1",
      fob_total: frm.dus_total_valor_fob?.value || "0",
    };
  });
  console.log("  CIF neto:", formValues.cif_neto, "FOB total:", formValues.fob_total);

  const cifNeto = parseFloat(formValues.cif_neto) || 1;
  const fobTotal = parseFloat(formValues.fob_total) || item.monto;
  const totalNetoItem = item.monto; // Valor total CPT (con flete incluido) = 26420
  const cantidad = item.peso_neto;
  const merCif = (totalNetoItem * cifNeto).toFixed(2);
  const merFob = cantidad > 0 ? (fobTotal / cantidad).toFixed(6) : "0";
  const ivaMonto = (parseFloat(merCif) * 19 / 100).toFixed(2);
  const cantStr = Math.round(cantidad).toString().padStart(8, "0");

  console.log("[5] Grabando item mercancía...");
  console.log("  Cantidad:", cantidad, "kg");
  console.log("  CIF item:", merCif);
  console.log("  FOB unitario:", merFob);
  console.log("  IVA:", ivaMonto);

  await page.evaluate((data) => {
    const frm = document.frm;
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
    frm.ume_id.value = "6";
    if (frm.lume_id) frm.lume_id.value = "6";
    frm.mer_cantidad.value = data.cantidad;
    frm.mer_cantidad_mercancia_um.value = "0.000000";
    frm.mer_fob_unitario.value = data.merFob;
    frm.mer_valor_cif_item.value = data.merCif;
    frm.mer_total_neto.value = data.totalNeto;
    // Deducción tramo nacional
    frm.mer_monto_ajuste_item.value = data.ajusteMonto;
    frm.mer_sig_ajuste.value = data.ajusteSigno;
    frm.mer_porc_advalorem.value = data.advalorem;
    frm.mer_cuenta_advalorem.value = "223";
    frm.mer_mto_cta_advalorem.value = "0.00";
    frm.mer_cod_obs1.value = "99";
    if (frm.lmer_cod_obs1) frm.lmer_cod_obs1.value = "99";
    frm.mer_obs1.value = data.obs1;
    // Obs2: DEDUCT. TRAMO NACIONAL
    frm.mer_cod_obs2.value = data.codObs2;
    if (frm.lmer_cod_obs2) frm.lmer_cod_obs2.value = data.codObs2;
    frm.mer_obs2.value = data.obs2;
    frm.mer_porc_otro1.value = "19.000";
    frm.mer_cod_otro1.value = "178";
    frm.mer_signo_otro1.value = "+";
    frm.mer_monto_impto_otro1.value = data.ivaMonto;
    frm.mer_porc_otro2.value = "0.000";
    frm.mer_cod_otro2.value = "";
    frm.mer_monto_impto_otro2.value = "0.00";
    frm.mer_cod_obs3.value = "";
    frm.mer_obs3.value = "";
    frm.mer_porc_otro3.value = "0.000";
    frm.mer_cod_otro3.value = "";
    frm.mer_monto_impto_otro3.value = "0.00";
    frm.mer_porc_otro4.value = "0.000";
    frm.mer_cod_otro4.value = "";
    frm.mer_monto_impto_otro4.value = "0.00";
    frm.mer_cod_obs4.value = "";
    frm.mer_nro_item.value = "";
    frm.comando.value = "U";
  }, {
    merProducto: `${dscCod}@#~2710`,
    codigoProd: item.codigo_material,
    dscPartida,
    codAranTratado,
    correlativo: sel ? (sel[4] || "") : "",
    nroAcuerdo,
    merNombre,
    cantidad: cantidad.toFixed(4),
    merFob,
    merCif,
    totalNeto: totalNetoItem.toFixed(6),
    advalorem,
    obs1: `${cantStr}.000000 KG`,
    ivaMonto,
    ajusteMonto: "416.00",
    ajusteSigno: "-",
    codObs2: "09",
    obs2: "DEDUCT. TRAMO NACIONAL",
  });

  // Click "Calculo de derechos" (TraeCuenta) — abre popup derechos.php
  console.log("[5.1] Clickeando Calculo de derechos (popup)...");
  
  // Esperar popup
  const popupPromise = new Promise((resolve) => {
    browser.once("targetcreated", async (target) => {
      const popupPage = await target.page();
      resolve(popupPage);
    });
    setTimeout(() => resolve(null), 10000);
  });

  await page.evaluate(() => {
    if (typeof TraeCuenta === "function") TraeCuenta();
  });

  const popupPage = await popupPromise;
  if (popupPage) {
    await popupPage.waitForSelector("body", { timeout: 5000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    
    // Click Aceptar en el popup
    const aceptarBtn = await popupPage.$('input[value="Aceptar"]') || await popupPage.$('input[type="button"]');
    if (aceptarBtn) {
      await aceptarBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    } else {
      // Intentar submit del form
      await popupPage.evaluate(() => {
        const form = document.querySelector("form");
        if (form) form.submit();
      });
    }
    await popupPage.close().catch(() => {});
    console.log("  ✅ Popup derechos cerrado");
  } else {
    console.log("  ⚠️ No se abrió popup");
  }
  
  // Leer IVA recalculado
  await new Promise(r => setTimeout(r, 1000));
  const ivaRecalc = await page.evaluate(() => document.frm.mer_monto_impto_otro1?.value || "");
  console.log("  IVA recalculado:", ivaRecalc);

  // Grabar
  console.log("[5.2] Grabando...");
  await page.evaluate(() => { document.frm.submit(); });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  console.log("[5] ✅ Mercancía grabada");

  await browser.close();
  console.log("\n✅ Módulo Mercancía grabado para operación", nroOperacion);
} catch (err) {
  console.error("❌ Error:", err.message || err);
  process.exit(1);
}
