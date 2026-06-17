import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { aduananetBrowserLogin } from "@/lib/aduananet-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * POST /api/operaciones/pago-directo
 * Body: { nro_operacion: string }
 * 
 * Crea el pago directo en AduanaNet usando Puppeteer:
 * 1. Navega a lista.php → click "Nuevo" → formulario
 * 2. Ingresa nro operación en campo despacho → click Ingresar
 * 3. Busca el comprobante en la lista filtrada → obtiene link PDF
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    const inboundSecret = request.headers.get("x-inbound-secret");
    if (!inboundSecret || inboundSecret !== process.env.INBOUND_SECRET) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  try {
    const { browser, page } = await aduananetBrowserLogin();

    try {
      // 1. Ir a la lista de pago directo
      await page.goto(`${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`, { waitUntil: "networkidle0" });

      // 2. Click en "Nuevo" — ejecutar función nuevo() de la página
      await page.evaluate(() => { (window as unknown as Record<string, () => void>).nuevo(); });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});

      // 3. Ingresar despacho
      // Interceptar alerts
      await page.evaluate(() => {
        (window as unknown as Record<string, string>).__lastAlert = "";
        window.alert = (msg: string) => { (window as unknown as Record<string, string>).__lastAlert = msg; };
      });

      const inputSelectors = ['input[name="lib_nid"]', 'input[name="despacho"]', 'input[name="nro_despacho"]'];
      let inputFound = false;
      for (const sel of inputSelectors) {
        const input = await page.$(sel);
        if (input) {
          await input.evaluate(el => (el as HTMLInputElement).value = "");
          await input.type(nro_operacion);
          inputFound = true;
          console.log(`[pago-directo] Campo encontrado: ${sel}`);
          break;
        }
      }
      if (!inputFound) {
        const inputs = await page.$$('input[type="text"]');
        for (const inp of inputs) {
          const visible = await inp.evaluate(el => el.offsetParent !== null);
          if (visible) {
            await inp.evaluate(el => (el as HTMLInputElement).value = "");
            await inp.type(nro_operacion);
            inputFound = true;
            console.log(`[pago-directo] Usando primer input visible`);
            break;
          }
        }
      }

      // 4. Click Ingresar
      const submitBtn = await page.$('input[value*="ngresar"], input[type="submit"], button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        await page.evaluate(() => { const f = document.querySelector("form") as HTMLFormElement; if (f) f.submit(); });
      }
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // 5. Verificar resultado
      const alertMsg = await page.evaluate(() => (window as unknown as Record<string, string>).__lastAlert || "");
      const bodyText = await page.evaluate(() => document.body.innerText?.substring(0, 500) || "");
      const yaExiste = (alertMsg + bodyText).toLowerCase().includes("ya fue") || 
                       (alertMsg + bodyText).toLowerCase().includes("ya existe") ||
                       (alertMsg + bodyText).toLowerCase().includes("ya se encuentra");

      if (yaExiste) {
        console.log(`[pago-directo] Ya existe para op ${nro_operacion}: "${alertMsg}"`);
      } else {
        console.log(`[pago-directo] Creado para op ${nro_operacion}${alertMsg ? " (alert: " + alertMsg + ")" : ""}`);
      }

      // 6. Ir a la lista y filtrar por despacho
      await page.goto(`${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`, { waitUntil: "networkidle0" });
      const filInput = await page.$('input[name="fil_lib_nid"]') || await page.$('input[name="fil_despacho"]');
      if (filInput) {
        await filInput.evaluate(el => (el as HTMLInputElement).value = "");
        await filInput.type(nro_operacion);
        const filtrarBtn = await page.$('input[type="submit"]');
        if (filtrarBtn) {
          await filtrarBtn.click();
          await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        }
      }

      // 7. Buscar ID del comprobante
      const pageHtml = await page.content();
      const reporteIds = [...pageHtml.matchAll(/reporte\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
      const pdfIds = [...pageHtml.matchAll(/reporte_pdf[^"']*[?&](?:id|padi_id)=(\d+)/gi)].map(m => Number(m[1]));
      const allIds = [...reporteIds, ...pdfIds];
      const comprobanteId = allIds.length > 0 ? Math.max(...allIds) : 0;

      let pdfUrl = "";
      if (comprobanteId) {
        pdfUrl = `${BASE_URL}/modulos/contabilidad/pago_directo/reporte_pdf.php?id=${comprobanteId}`;
        console.log(`[pago-directo] ✅ PDF: id=${comprobanteId}`);
      } else {
        console.log(`[pago-directo] No se encontró ID en lista para op ${nro_operacion}`);
      }

      await browser.close();

      // 8. Guardar
      if (pdfUrl) {
        const drRows = await pgQuery<{ rut_cliente: string }>(
          "SELECT rut_cliente FROM despachos_replica WHERE despacho = $1 LIMIT 1",
          [nro_operacion]
        );
        const rutCliente = drRows[0]?.rut_cliente || "";
        await pgQuery(
          "INSERT INTO operaciones (nro_operacion, rut_cliente, estado) VALUES ($1, $2, 'aprobada') ON CONFLICT (nro_operacion) DO NOTHING",
          [nro_operacion, rutCliente]
        );
        await pgQuery(
          "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
          [`\npago_directo_url:${pdfUrl}`, nro_operacion]
        );
      }

      return NextResponse.json({ ok: true, comprobante_id: comprobanteId, pdf_url: pdfUrl, ya_existia: yaExiste });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[pago-directo] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
