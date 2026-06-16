import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { uploadToSpaces } from "@/lib/spaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/operaciones/comprobante-tgr
 * Body: { nro_operacion: string }
 * 
 * Genera el comprobante de pago TGR:
 * 1. Navega con Puppeteer a tgr.cl/tramites-tgr/comprobantes-pagos-sitio/
 * 2. Llena RUT (sin DV), Formulario 15, Folio 3690{operacion}
 * 3. Captura el resultado HTML como PDF (page.pdf())
 * 4. Guarda en el bucket
 * 5. Retorna la URL del PDF
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  try {
    // Obtener RUT del cliente
    const opRows = await pgQuery<{ rut_cliente: string }>(
      "SELECT rut_cliente FROM operaciones WHERE nro_operacion = $1",
      [nro_operacion]
    );

    let rutCliente = opRows[0]?.rut_cliente || "";
    if (!rutCliente) {
      const drRows = await pgQuery<{ rut_cliente: string }>(
        "SELECT rut_cliente FROM despachos_replica WHERE despacho = $1 LIMIT 1",
        [nro_operacion]
      );
      rutCliente = drRows[0]?.rut_cliente || "";
    }

    if (!rutCliente) {
      return NextResponse.json({ error: "No se encontró el RUT del cliente" }, { status: 404 });
    }

    // RUT sin guión ni dígito verificador: "92933000-5" → "92933000"
    const rutSinDv = rutCliente.split("-")[0].replace(/\./g, "");
    const folio = `3690${nro_operacion}`;
    const formulario = "15";

    console.log(`[tgr] Generando comprobante: RUT=${rutSinDv}, Form=${formulario}, Folio=${folio}`);

    // Usar Puppeteer para navegar TGR
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 900 });

      await page.goto("https://tgr.cl/tramites-tgr/comprobantes-pagos-sitio/", {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Esperar que cargue el formulario (puede estar en iframe)
      await new Promise(r => setTimeout(r, 3000));

      // Verificar si hay un iframe
      const iframes = await page.$$("iframe");
      let frame = page.mainFrame();
      if (iframes.length > 0) {
        const contentFrame = await iframes[0].contentFrame();
        if (contentFrame) frame = contentFrame;
      }

      // Llenar formulario — buscar campos por diferentes selectores
      // Campo RUT
      const rutSelectors = ['input[name*="rut" i]', 'input[id*="rut" i]', 'input[placeholder*="RUT" i]', 'input[placeholder*="Rut" i]', '#rut', '[formcontrolname*="rut" i]'];
      for (const sel of rutSelectors) {
        const el = await frame.$(sel);
        if (el) {
          await el.evaluate(e => (e as HTMLInputElement).value = "");
          await el.type(rutSinDv);
          console.log(`[tgr] RUT llenado con selector: ${sel}`);
          break;
        }
      }

      // Campo Formulario
      const formSelectors = ['input[name*="formulario" i]', 'input[id*="formulario" i]', 'select[name*="formulario" i]', 'select[id*="formulario" i]', '#formulario', '[formcontrolname*="formulario" i]'];
      for (const sel of formSelectors) {
        const el = await frame.$(sel);
        if (el) {
          const tagName = await el.evaluate(e => e.tagName.toLowerCase());
          if (tagName === "select") {
            await el.select(formulario);
          } else {
            await el.evaluate(e => (e as HTMLInputElement).value = "");
            await el.type(formulario);
          }
          console.log(`[tgr] Formulario llenado con selector: ${sel}`);
          break;
        }
      }

      // Campo Folio
      const folioSelectors = ['input[name*="folio" i]', 'input[id*="folio" i]', '#folio', '[formcontrolname*="folio" i]', 'input[placeholder*="olio" i]'];
      for (const sel of folioSelectors) {
        const el = await frame.$(sel);
        if (el) {
          await el.evaluate(e => (e as HTMLInputElement).value = "");
          await el.type(folio);
          console.log(`[tgr] Folio llenado con selector: ${sel}`);
          break;
        }
      }

      // Click en buscar/consultar
      const btnSelectors = ['button[type="submit"]', 'input[type="submit"]', 'button:not([type="reset"])'];
      for (const sel of btnSelectors) {
        const btns = await frame.$$(sel);
        for (const btn of btns) {
          const text = await btn.evaluate(e => e.textContent?.toLowerCase() || "");
          if (text.includes("buscar") || text.includes("consultar") || text.includes("obtener") || text.includes("enviar")) {
            await btn.click();
            console.log(`[tgr] Botón clickeado: "${text.trim()}"`);
            break;
          }
        }
      }

      // Esperar resultado
      await new Promise(r => setTimeout(r, 5000));
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});

      // Generar PDF del resultado (la página con el comprobante)
      const pdfBuffer = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" },
      });

      await browser.close();

      // Guardar en bucket
      const fileKey = `documentos/${rutCliente}/${nro_operacion}/comprobante_tgr_${nro_operacion}.pdf`;
      const storageUrl = await uploadToSpaces(Buffer.from(pdfBuffer), fileKey, "application/pdf");
      console.log(`[tgr] Comprobante guardado: ${storageUrl}`);

      // Guardar URL en la operación
      await pgQuery(
        "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
        [`\ntgr_url:${storageUrl}`, nro_operacion]
      );

      return NextResponse.json({ ok: true, url: storageUrl });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[tgr] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
