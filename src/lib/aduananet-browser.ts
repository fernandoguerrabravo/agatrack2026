import "server-only";
import puppeteer, { Browser, Page } from "puppeteer";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";
const LOGIN = process.env.ADUANANET_LOGIN || "";
const CLAVE = process.env.ADUANANET_CLAVE || "";

/**
 * Crea una sesión de browser autenticada en AduanaNet.
 * Retorna { browser, page } — recuerda cerrar el browser al terminar.
 */
export async function aduananetBrowserLogin(): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  await page.goto(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('input[type="submit"], button[type="submit"]'),
  ]);

  // Manejar dialogs automáticamente
  page.on("dialog", async dialog => {
    await dialog.accept();
  });

  return { browser, page };
}

/**
 * Módulo Valores Factura: llena campos, clickea "Ejecute Cálculos" y "Aceptar"
 */
export async function browserValoresFactura(
  page: Page,
  nroOperacion: string,
  datos: {
    termCompra: string;
    moneda: string;
    pesoBruto: string;
    totalNetoFactura: string;
    fleteFac: string;
    fleteMon: string;
    fleteParidad: string;
    seguroFac: string;
    seguroMon: string;
    seguroParidad: string;
  }
): Promise<{ fob: string; flete: string; seguro: string; cif: string }> {
  const vgUrl = `${BASE_URL}/modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  await page.goto(vgUrl, { waitUntil: "networkidle0" });

  // Limpiar y llenar campos via document.frm (como lo hace el usuario)
  await page.evaluate((datos) => {
    const frm = (document as unknown as { frm: Record<string, HTMLInputElement> }).frm;
    // Incoterm
    frm.term_compra.value = datos.termCompra;
    if (frm.sel_term_compra) (frm.sel_term_compra as unknown as HTMLSelectElement).value = datos.termCompra;
    // Moneda
    frm.moneda_desc.value = datos.moneda;
    if (frm.sel_moneda_desc) (frm.sel_moneda_desc as unknown as HTMLSelectElement).value = datos.moneda;
    // Peso bruto
    frm.dus_peso_bruto_total.value = datos.pesoBruto;
    // Total neto factura
    frm.dus_total_neto_item.value = datos.totalNetoFactura;
    frm.dus_total_neto_factura.value = datos.totalNetoFactura;
    // Flete
    frm.dus_valor_flete_fac.value = datos.fleteFac;
    if (datos.fleteMon) frm.dus_valor_flete_mon.value = datos.fleteMon;
    frm.dus_valor_flete_paridad.value = datos.fleteParidad;
    // Seguro
    frm.dus_valor_seguro_fac.value = datos.seguroFac;
    if (datos.seguroMon) frm.dus_valor_seguro_mon.value = datos.seguroMon;
    frm.dus_valor_seguro_paridad.value = datos.seguroParidad;
  }, datos);

  // Click "Ejecute Cálculos"
  await page.evaluate(() => {
    if (typeof (window as unknown as Record<string, unknown>).calculos === "function") {
      (window as unknown as Record<string, () => void>).calculos();
    }
  });
  await new Promise(r => setTimeout(r, 1500));

  // Leer valores calculados
  const fob = await page.evaluate(() => (document as unknown as { frm: Record<string, HTMLInputElement> }).frm.dus_total_valor_fob.value).catch(() => "");
  const flete = await page.evaluate(() => (document as unknown as { frm: Record<string, HTMLInputElement> }).frm.dus_valor_flete.value).catch(() => "");
  const seguro = await page.evaluate(() => (document as unknown as { frm: Record<string, HTMLInputElement> }).frm.dus_valor_seguro.value).catch(() => "");
  const cif = await page.evaluate(() => (document as unknown as { frm: Record<string, HTMLInputElement> }).frm.dus_valor_cif.value).catch(() => "");

  // Click "Aceptar"
  await page.evaluate(() => {
    if (typeof (window as unknown as Record<string, unknown>).aceptar === "function") {
      (window as unknown as Record<string, () => void>).aceptar();
    }
  });
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});

  return { fob, flete, seguro, cif };
}

/**
 * Módulo Cuentas y Valores: clickea "Traer Cuentas" y "Aceptar"
 */
export async function browserCuentasValores(
  page: Page,
  nroOperacion: string
): Promise<{ iva: string; total: string; clp: string }> {
  const ctasUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_ctas_valores.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  await page.goto(ctasUrl, { waitUntil: "networkidle0" });

  // Click "Traer Cuentas" (función recupera_cuentas)
  await page.evaluate(() => {
    if (typeof (window as unknown as Record<string, unknown>).recupera_cuentas === "function") {
      (window as unknown as Record<string, () => void>).recupera_cuentas();
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  // Leer valores
  const iva = await page.$eval('input[name="dus_valor178"]', el => (el as HTMLInputElement).value).catch(() => "0");
  const total = await page.$eval('input[name="dus_valor191"]', el => (el as HTMLInputElement).value).catch(() => "0");
  const clp = await page.$eval('input[name="dus_valor91"]', el => (el as HTMLInputElement).value).catch(() => "");

  // Click "Aceptar"
  const aceptarBtn = await page.$('input[value="Aceptar"]');
  if (aceptarBtn) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
      aceptarBtn.click(),
    ]);
  } else {
    await page.evaluate(() => { if (typeof (window as unknown as Record<string, unknown>).aceptar === "function") (window as unknown as Record<string, () => void>).aceptar(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  }

  return { iva, total, clp };
}
