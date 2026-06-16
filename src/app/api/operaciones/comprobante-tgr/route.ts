import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/operaciones/comprobante-tgr?nro_operacion=190420
 * 
 * Descarga el comprobante de pago de Tesorería (TGR) para la operación.
 * Usa Puppeteer para navegar el sitio de TGR y descargar el PDF.
 * 
 * Parámetros:
 * - RUT: sin guión ni dígito verificador (de la operación/cliente)
 * - Formulario: 15
 * - Folio: 3690{nro_operacion}
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const nroOperacion = searchParams.get("nro_operacion");
  if (!nroOperacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  try {
    // Obtener RUT del cliente
    const opRows = await pgQuery<{ rut_cliente: string }>(
      "SELECT rut_cliente FROM operaciones WHERE nro_operacion = $1",
      [nroOperacion]
    );
    
    let rutCliente = opRows[0]?.rut_cliente || "";
    if (!rutCliente) {
      // Fallback: buscar en despachos_replica
      const drRows = await pgQuery<{ rut_cliente: string }>(
        "SELECT rut_cliente FROM despachos_replica WHERE despacho = $1 LIMIT 1",
        [nroOperacion]
      );
      rutCliente = drRows[0]?.rut_cliente || "";
    }

    if (!rutCliente) {
      return NextResponse.json({ error: "No se encontró el RUT del cliente" }, { status: 404 });
    }

    // RUT sin guión ni dígito verificador: "92933000-5" → "92933000"
    const rutSinDv = rutCliente.split("-")[0].replace(/\./g, "");
    const folio = `3690${nroOperacion}`;
    const formulario = "15";

    console.log(`[tgr] Consultando comprobante: RUT=${rutSinDv}, Form=${formulario}, Folio=${folio}`);

    // Usar Puppeteer para navegar TGR
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const page = await browser.newPage();
      
      // Interceptar descargas de PDF
      const client = await page.createCDPSession();
      await client.send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: "/tmp",
      });

      await page.goto("https://tgr.cl/tramites-tgr/comprobantes-pagos-sitio/", {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Esperar que cargue el formulario
      await page.waitForSelector('input, iframe', { timeout: 15000 }).catch(() => {});

      // Verificar si hay un iframe (TGR suele cargar contenido en iframe)
      const iframes = await page.$$("iframe");
      let targetFrame = page;
      if (iframes.length > 0) {
        const frame = await iframes[0].contentFrame();
        if (frame) targetFrame = frame as unknown as typeof page;
      }

      // Buscar campos del formulario
      // Campo RUT
      const rutInput = await targetFrame.$('input[name*="rut" i], input[id*="rut" i], input[placeholder*="RUT" i], input[placeholder*="Rut" i]');
      if (rutInput) {
        await rutInput.click({ count: 3 });
        await rutInput.type(rutSinDv);
      }

      // Campo Formulario
      const formInput = await targetFrame.$('input[name*="formulario" i], input[id*="formulario" i], select[name*="formulario" i], input[placeholder*="ormulario" i]');
      if (formInput) {
        const tagName = await formInput.evaluate(el => el.tagName.toLowerCase());
        if (tagName === "select") {
          await formInput.select(formulario);
        } else {
          await formInput.click({ count: 3 });
          await formInput.type(formulario);
        }
      }

      // Campo Folio
      const folioInput = await targetFrame.$('input[name*="folio" i], input[id*="folio" i], input[placeholder*="olio" i]');
      if (folioInput) {
        await folioInput.click({ count: 3 });
        await folioInput.type(folio);
      }

      // Submit
      const submitBtn = await targetFrame.$('button[type="submit"], input[type="submit"], button:has-text("Buscar"), button:has-text("Consultar"), button:has-text("Obtener")');
      if (submitBtn) {
        await submitBtn.click();
        await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {});
      }

      // Esperar resultado y buscar link al PDF
      await new Promise(r => setTimeout(r, 3000));

      // Intentar capturar el PDF de la respuesta
      const pdfLink = await targetFrame.$('a[href*=".pdf"], a[href*="PDF"], a:has-text("Descargar"), a:has-text("Comprobante"), a:has-text("Ver")');
      if (pdfLink) {
        const href = await pdfLink.evaluate(el => (el as HTMLAnchorElement).href);
        if (href) {
          const pdfRes = await fetch(href);
          if (pdfRes.ok) {
            const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
            await browser.close();
            return new NextResponse(pdfBuffer, {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="Comprobante_TGR_${nroOperacion}.pdf"`,
              },
            });
          }
        }
      }

      // Si no encontró link, intentar imprimir la página como PDF
      const pdfBuffer = await page.pdf({ format: "Letter", printBackground: true });
      await browser.close();

      return new NextResponse(Buffer.from(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="Comprobante_TGR_${nroOperacion}.pdf"`,
        },
      });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[tgr] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
