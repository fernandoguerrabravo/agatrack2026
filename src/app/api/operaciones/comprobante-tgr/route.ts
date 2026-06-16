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
 * 1. Navega con Puppeteer a https://www.tesoreria.cl/portal/comprobantePago/
 * 2. Llena los 3 inputs visibles: RUT (sin DV), Formulario 15, Folio 3690{operacion}
 * 3. Submit → puede abrir en nueva pestaña o misma página
 * 4. Captura el resultado como PDF (page.pdf())
 * 5. Guarda en el bucket
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

    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    try {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1200, height: 900 });

      const url = "https://www.tesoreria.cl/portal/comprobantePago/?RUT=0&DV=0&EMAIL=";
      console.log(`[tgr] Abriendo ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // Buscar inputs visibles (como el script Python)
      const visibleInputs = await page.$$eval("input", (inputs) => {
        return inputs
          .filter(inp => {
            const style = window.getComputedStyle(inp);
            return style.display !== "none" && style.visibility !== "hidden" && inp.offsetParent !== null && inp.type !== "hidden";
          })
          .map((_, i) => i);
      });

      console.log(`[tgr] Inputs visibles encontrados: ${visibleInputs.length}`);

      if (visibleInputs.length < 3) {
        await browser.close();
        return NextResponse.json({ error: `Se esperaban al menos 3 inputs visibles, solo hay ${visibleInputs.length}` }, { status: 500 });
      }

      // Llenar los 3 primeros inputs visibles: RUT, Formulario, Folio
      const allInputs = await page.$$("input");
      let filled = 0;
      for (const input of allInputs) {
        const isVisible = await input.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null && (el as HTMLInputElement).type !== "hidden";
        });
        if (!isVisible) continue;

        if (filled === 0) {
          await input.evaluate(el => (el as HTMLInputElement).value = "");
          await input.type(rutSinDv);
          console.log(`[tgr] Input 0 (RUT): ${rutSinDv}`);
        } else if (filled === 1) {
          await input.evaluate(el => (el as HTMLInputElement).value = "");
          await input.type(formulario);
          console.log(`[tgr] Input 1 (Formulario): ${formulario}`);
        } else if (filled === 2) {
          await input.evaluate(el => (el as HTMLInputElement).value = "");
          await input.type(folio);
          console.log(`[tgr] Input 2 (Folio): ${folio}`);
          break;
        }
        filled++;
      }

      await new Promise(r => setTimeout(r, 1000));

      // Buscar y clickear botón submit
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (!submitBtn) {
        // Fallback: buscar cualquier botón visible
        const buttons = await page.$$("button");
        let clicked = false;
        for (const btn of buttons) {
          const isVisible = await btn.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null;
          });
          if (isVisible) {
            // Detectar si abre nueva pestaña
            const newPagePromise = new Promise<import("puppeteer").Page | null>(resolve => {
              const timer = setTimeout(() => resolve(null), 5000);
              context.once("targetcreated", async (target) => {
                clearTimeout(timer);
                const newPage = await target.page();
                resolve(newPage);
              });
            });

            await btn.click();
            clicked = true;
            console.log("[tgr] Botón clickeado");

            const newPage = await newPagePromise;
            if (newPage) {
              console.log("[tgr] Resultado en nueva pestaña");
              await newPage.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
              await newPage.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
              await new Promise(r => setTimeout(r, 5000));

              const pdfBuffer = await newPage.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
              });

              await browser.close();
              return await guardarYResponder(pdfBuffer, rutCliente, nro_operacion);
            }
            break;
          }
        }
        if (!clicked) {
          await browser.close();
          return NextResponse.json({ error: "No se encontró botón para enviar formulario" }, { status: 500 });
        }
      } else {
        // Detectar si abre nueva pestaña
        const newPagePromise = new Promise<import("puppeteer").Page | null>(resolve => {
          const timer = setTimeout(() => resolve(null), 5000);
          context.once("targetcreated", async (target) => {
            clearTimeout(timer);
            const newPage = await target.page();
            resolve(newPage);
          });
        });

        await submitBtn.click();
        console.log("[tgr] Submit clickeado");

        const newPage = await newPagePromise;
        if (newPage) {
          console.log("[tgr] Resultado en nueva pestaña");
          await newPage.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {});
          await newPage.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
          await new Promise(r => setTimeout(r, 5000));

          const pdfBuffer = await newPage.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
          });

          await browser.close();
          return await guardarYResponder(pdfBuffer, rutCliente, nro_operacion);
        }
      }

      // Resultado en misma página
      console.log("[tgr] Resultado en misma página");
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 5000));

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
      });

      await browser.close();
      return await guardarYResponder(pdfBuffer, rutCliente, nro_operacion);
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[tgr] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function guardarYResponder(pdfBuffer: Uint8Array, rutCliente: string, nroOperacion: string) {
  const fileKey = `documentos/${rutCliente}/${nroOperacion}/comprobante_tgr_${nroOperacion}.pdf`;
  const storageUrl = await uploadToSpaces(Buffer.from(pdfBuffer), fileKey, "application/pdf");
  console.log(`[tgr] ✅ Comprobante guardado: ${storageUrl}`);

  await pgQuery(
    "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
    [`\ntgr_url:${storageUrl}`, nroOperacion]
  );

  return NextResponse.json({ ok: true, url: storageUrl });
}
