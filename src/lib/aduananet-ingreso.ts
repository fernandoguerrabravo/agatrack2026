import "server-only";
import type { Page } from "puppeteer";
import type { LineaRemesa } from "./remesas/parse";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

// Valores de negocio (hardcodeados por ahora — KSB CHILE S.A.)
const CTAA_ID = "C-96691060";              // cuenta corriente analítica KSB CHILE S.A.
const CTAA_TXT = "KSB CHILE S.A.";
const TPAG_ID = "B";                        // Transferencia
const BCO_CODIGO = "1";                     // DERECHOS 05-71550-4
const GLOSA = "1";                          // PROVISION DE IMPORTACION

export type IngresoRemesaInput = {
  lineas: LineaRemesa[];
  total: number;
  fecha?: string;        // dd/mm/yyyy; por defecto hoy
  dryRun?: boolean;      // si true, llena el form y NO graba
};

export type IngresoRemesaResult = {
  ok: boolean;
  comprobanteUrl?: string;
  mensaje?: string;
  lineasSeteadas: number;
  totalSeteado: string;
  ctaaSeteada: string;
  dryRun: boolean;
};

function hoyDDMMYYYY(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * Crea un comprobante de Ingreso de Remesa (IR) en AduanaNet.
 * Flujo: formulario.php?accion=N&seleccion=IR → cabecera + líneas (addRow) → Ingresar.
 */
export async function crearIngresoRemesa(page: Page, input: IngresoRemesaInput): Promise<IngresoRemesaResult> {
  const fecha = input.fecha || hoyDDMMYYYY();
  const lineas = input.lineas;

  await page.goto(`${BASE_URL}/modulos/contabilidad/ingresos/formulario.php?accion=N&seleccion=IR`, { waitUntil: "networkidle0" });
  await new Promise(r => setTimeout(r, 800));

  // 1) Cabecera
  await page.evaluate((d) => {
    const w = window as unknown as Record<string, (...a: unknown[]) => void>;
    const frm = (document as unknown as { frmEditar: Record<string, HTMLInputElement | HTMLSelectElement> }).frmEditar;
    frm.txt_ctaa_id.value = d.ctaaTxt;
    frm.ctaa_id.value = d.ctaaId;
    if (frm.tpag_id) { (frm.tpag_id as HTMLSelectElement).value = d.tpag; if (typeof w.cambio_tipo_pago === "function") w.cambio_tipo_pago(); }
    if (frm.bco_codigo) (frm.bco_codigo as HTMLSelectElement).value = d.bco;
    if (frm.glosa) { (frm.glosa as HTMLSelectElement).value = d.glosa; if (typeof w.actualiza_glosa === "function") w.actualiza_glosa(); }
    if (frm.cmp_fecha) frm.cmp_fecha.value = d.fecha;
    if (frm.fecha_pago) frm.fecha_pago.value = d.fecha;
    if (frm.fecha_deposito) frm.fecha_deposito.value = d.fecha;
    if (frm.monto) frm.monto.value = d.total;
  }, { ctaaTxt: CTAA_TXT, ctaaId: CTAA_ID, tpag: TPAG_ID, bco: BCO_CODIGO, glosa: GLOSA, fecha, total: String(input.total) });

  // 2) Asegurar suficientes líneas (addRow hasta tener >= lineas.length)
  await page.evaluate((n) => {
    const w = window as unknown as Record<string, () => void>;
    const count = () => Array.from(document.querySelectorAll("input")).filter(i => /^nid\d+$/.test((i as HTMLInputElement).name)).length;
    let guard = 0;
    while (count() < n && guard < 200) { if (typeof w.addRow === "function") w.addRow(); else break; guard++; }
  }, lineas.length);
  await new Promise(r => setTimeout(r, 300));

  // 3) Llenar cada línea: nidN = despacho, montoN = monto (entero)
  await page.evaluate((ls) => {
    const w = window as unknown as Record<string, (...a: unknown[]) => void>;
    const frm = (document as unknown as { frmEditar: Record<string, HTMLInputElement> }).frmEditar;
    ls.forEach((l, i) => {
      if (frm["nid" + i]) frm["nid" + i].value = l.despacho;
      if (frm["monto" + i]) frm["monto" + i].value = String(l.monto);
    });
    if (typeof w.suma_valores === "function") w.suma_valores();
  }, lineas);
  await new Promise(r => setTimeout(r, 300));

  // Leer de vuelta lo seteado (para validar)
  const estado = await page.evaluate((n) => {
    const frm = (document as unknown as { frmEditar: Record<string, HTMLInputElement> }).frmEditar;
    const lineasSeteadas = Array.from({ length: n }).filter((_, i) => frm["nid" + i] && frm["nid" + i].value).length;
    return {
      ctaa: frm.ctaa_id?.value || "",
      total: frm.monto?.value || "",
      suma2: frm.suma_monto2?.value || "",
      lineasSeteadas,
    };
  }, lineas.length);

  if (input.dryRun) {
    return { ok: true, dryRun: true, lineasSeteadas: estado.lineasSeteadas, totalSeteado: estado.total, ctaaSeteada: estado.ctaa, mensaje: `DRY-RUN: ${estado.lineasSeteadas} líneas, total ${estado.total}, suma ${estado.suma2}` };
  }

  // 4) Grabar: botón Ingresar → validaForm(frmEditar)
  await page.evaluate(() => {
    const w = window as unknown as Record<string, (f: unknown) => boolean>;
    const frm = (document as unknown as { frmEditar: HTMLFormElement }).frmEditar;
    const ok = typeof w.validaForm === "function" ? w.validaForm(frm) : true;
    if (ok !== false) frm.submit();
  });
  await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));

  const urlPost = page.url();
  const ok = !/formulario\.php/.test(urlPost) || /mensaje|lista|exito|correct/i.test(await page.content());
  return { ok, dryRun: false, comprobanteUrl: urlPost, lineasSeteadas: estado.lineasSeteadas, totalSeteado: estado.total, ctaaSeteada: estado.ctaa, mensaje: ok ? "Comprobante grabado" : "Revisar: siguió en formulario" };
}
