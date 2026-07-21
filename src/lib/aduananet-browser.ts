import "server-only";
import puppeteer, { Browser, Page } from "puppeteer";
import { execSync } from "child_process";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";
const LOGIN = process.env.ADUANANET_LOGIN || "";
const CLAVE = process.env.ADUANANET_CLAVE || "";

/**
 * Barre perfiles temporales de Puppeteer/Chromium y temporales viejos (> 15 min) que
 * no se limpiaron al cerrar navegadores previos (crashes/timeouts). Cada job de Puppeteer,
 * al cerrar su navegador, dispara este barrido → los perfiles no se acumulan y el disco no se llena.
 * El umbral de 15 min evita tocar perfiles de navegadores que estén corriendo en paralelo.
 */
export function sweepPuppeteerTmp(): void {
  try {
    execSync(
      "find /tmp/snap-private-tmp/snap.chromium/tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -type d -mmin +15 -exec rm -rf {} + 2>/dev/null; " +
      "find /tmp -maxdepth 1 \\( -name 'upload_*' -o -name 'cl_*' -o -name 'puppeteer_dev_chrome_profile-*' \\) -mmin +15 -exec rm -rf {} + 2>/dev/null",
      { timeout: 25000, shell: "/bin/bash" }
    );
  } catch { /* best-effort, nunca debe romper el flujo */ }
}

/** Envuelve browser.close() para que además barra perfiles temporales viejos. */
function conLimpieza(browser: Browser): Browser {
  const original = browser.close.bind(browser);
  browser.close = async () => {
    try { await original(); } finally { sweepPuppeteerTmp(); }
  };
  return browser;
}

/**
 * Crea una sesión de browser autenticada en AduanaNet.
 * Retorna { browser, page } — recuerda cerrar el browser al terminar.
 */
export async function aduananetBrowserLogin(): Promise<{ browser: Browser; page: Page }> {
  const browser = conLimpieza(await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }));
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);

  // Login
  await page.goto(`${BASE_URL}/modulos/usuarios/login.php?status=-1`);
  await page.type('input[name="login"]', LOGIN);
  await page.type('input[name="clave"]', CLAVE);
  // AduanaNet cambió el botón de login: ya no es <input type="submit"> sino
  // <button type="button" onclick="myFunction()">Entrar</button>. Se intenta el
  // submit clásico (compatibilidad) y si no, el botón "Entrar" / la función global.
  const submitLogin = async () => {
    const classic = await page.$('input[type="submit"], button[type="submit"]');
    if (classic) { await classic.click(); return; }
    const clicked = await page.evaluate(() => {
      const w = window as unknown as Record<string, () => void>;
      const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
      const entrar = btns.find(b =>
        /entrar/i.test(b.textContent || "") ||
        (b.getAttribute("onclick") || "").includes("myFunction")
      );
      if (entrar) { entrar.click(); return true; }
      if (typeof w.myFunction === "function") { w.myFunction(); return true; }
      return false;
    });
    if (!clicked) throw new Error("No se encontró el botón de login de AduanaNet");
  };
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}),
    submitLogin(),
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
    termCompraFinal?: string; // Si se indica, cambia la cláusula DESPUÉS de calcular y ANTES de grabar
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

  // Workaround: si hay termCompraFinal, cambiar la cláusula DESPUÉS de calcular y ANTES de grabar
  if (datos.termCompraFinal) {
    await page.evaluate((finalCode) => {
      const frm = (document as unknown as { frm: Record<string, HTMLInputElement | HTMLSelectElement> }).frm;
      frm.term_compra.value = finalCode;
      if (frm.sel_term_compra) (frm.sel_term_compra as HTMLSelectElement).value = finalCode;
    }, datos.termCompraFinal);
  }

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

/**
 * Provisión de Fondos: carga formulario, AduanaNet calcula los totales con JS,
 * selecciona forma de pago, marca imprimir, y hace click en Aceptar.
 * Retorna el PDF generado como Buffer.
 */
export async function browserProvisionFondos(
  nroOperacion: string
): Promise<{ ok: boolean; pdfUrl?: string; total?: string; error?: string }> {
  const { browser, page } = await aduananetBrowserLogin();

  try {
    // 1. Ir a nuevo.php para iniciar la creación
    await page.goto(`${BASE_URL}/modulos/contabilidad/solicitud_fondos/nuevo.php`, { waitUntil: "networkidle0" });

    // 2. Llenar lib_nid y submit al formulario
    await page.type('input[name="lib_nid"]', nroOperacion);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }),
      page.evaluate(() => {
        const form = document.querySelector('form') as HTMLFormElement;
        if (form) form.submit();
      }),
    ]);

    // 3. Esperar a que se cargue formulario.php con los datos precalculados
    await new Promise(r => setTimeout(r, 2000));

    // 4. Seleccionar cheque agencia (radio button cheque=1 ya viene checked)
    // Seleccionar leyenda: "CHEQUE A : TESORERIA GENERAL DE LA REPUBLICA"
    await page.select('select[name="sel_leyendaA"]', "CHEQUE A : TESORERIA GENERAL DE LA REPUBLICA");

    // 5. Marcar checkbox imprimir
    const imprimirChecked = await page.$eval('input[name="imprimir"]', el => (el as HTMLInputElement).checked).catch(() => false);
    if (!imprimirChecked) {
      await page.click('input[name="imprimir"]');
    }

    // 6. Desmarcar email (no enviar por email de aduananet)
    const emailChecked = await page.$eval('input[name="email"]', el => (el as HTMLInputElement).checked).catch(() => false);
    if (emailChecked) {
      await page.click('input[name="email"]');
    }

    // 7. Esperar a que JS calcule los totales
    await new Promise(r => setTimeout(r, 1000));

    // Leer el total para verificar
    const total = await page.$eval('input[name="total_solicitado"]', el => (el as HTMLInputElement).value).catch(() => "");

    // 8. Click en Aceptar/Grabar
    // Buscar el botón de grabar
    const btnGuardar = await page.$('input[name="btnGuardar"]') || await page.$('input[value="Aceptar"]') || await page.$('button[name="btnGuardar"]');
    
    if (btnGuardar) {
      // Capturar posible nueva página/PDF que se abra
      const newPagePromise = new Promise<Page | null>(resolve => {
        browser.once("targetcreated", async target => {
          const newPage = await target.page();
          resolve(newPage);
        });
        setTimeout(() => resolve(null), 10000);
      });

      await btnGuardar.click();
      await new Promise(r => setTimeout(r, 3000));

      // Verificar si se abrió una nueva ventana (PDF)
      const newPage = await newPagePromise;
      if (newPage) {
        const pdfUrl = newPage.url();
        await newPage.close();
        await browser.close();
        return { ok: true, pdfUrl, total };
      }

      // Si no se abrió nueva ventana, buscar el PDF en la página actual
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      const currentUrl = page.url();
      
      if (currentUrl.includes("mensaje.php")) {
        // Buscar link a PDF en el mensaje
        const pdfLink = await page.$eval('a[href*="pdf"], a[href*="imprimir"], a[href*="reporte"]', el => (el as HTMLAnchorElement).href).catch(() => "");
        await browser.close();
        return { ok: true, pdfUrl: pdfLink || undefined, total };
      }

      await browser.close();
      return { ok: true, total };
    } else {
      // Intentar con función JS
      await page.evaluate(() => {
        if (typeof (window as unknown as Record<string, unknown>).grabar === "function") {
          (window as unknown as Record<string, () => void>).grabar();
        } else if (typeof (window as unknown as Record<string, unknown>).aceptar === "function") {
          (window as unknown as Record<string, () => void>).aceptar();
        } else {
          const form = document.querySelector('form[action="grabar.php"]') as HTMLFormElement;
          if (form) form.submit();
        }
      });
      await new Promise(r => setTimeout(r, 3000));
      await browser.close();
      return { ok: true, total };
    }
  } catch (err) {
    await browser.close();
    return { ok: false, error: err instanceof Error ? err.message : "Error desconocido" };
  }
}
