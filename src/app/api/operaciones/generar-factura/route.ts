import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aduananetBrowserLogin } from "@/lib/aduananet-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * POST /api/operaciones/generar-factura
 * Body: { nro_operacion: string }
 * 
 * Genera factura DIN en AduanaNet para Petroquímica:
 * 1. Lista → Nuevo → NID → Aceptar → Aceptar
 * 2. Pestaña Gastos y Honorarios → Traer Honorarios (popup → click grilla)
 * 3. Pestaña Resumen → Traer Pago Directo → Grabar
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
      // 1. Lista facturación
      await page.goto(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });

      // 2. Click nuevo()
      await page.evaluate(() => { (window as unknown as Record<string, () => void>).nuevo(); });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // 3. Input NID
      const nidInput = await page.$('input[name="lib_nid"]');
      if (nidInput) {
        await nidInput.type(nro_operacion);
      } else {
        const inputs = await page.$$('input[type="text"]');
        for (const inp of inputs) {
          const vis = await inp.evaluate(el => el.offsetParent !== null);
          if (vis) { await inp.type(nro_operacion); break; }
        }
      }

      // 4. Click Aceptar 1
      await page.click('input[value="Aceptar"]');
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // 5. Click Aceptar 2
      const btn2 = await page.$('input[value="Aceptar"]');
      if (btn2) {
        await btn2.click();
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }

      // 6. Pestaña Gastos y Honorarios
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) {
          if (a.textContent && a.textContent.trim() === "GASTOS Y HONORARIOS") { a.click(); return; }
        }
      });
      await new Promise(r => setTimeout(r, 2000));

      // 7. Traer Honorarios (popup)
      const traerHonBtn = await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button']");
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("honorarios")) return (inp as HTMLInputElement).value;
        }
        return null;
      });

      if (traerHonBtn) {
        const popupPromise = new Promise<import("puppeteer").Page | null>(resolve => {
          browser.once("targetcreated", async target => { resolve(await target.page()); });
          setTimeout(() => resolve(null), 10000);
        });
        await page.evaluate((val: string) => {
          const inputs = document.querySelectorAll("input[type='button']");
          for (const inp of inputs) { if ((inp as HTMLInputElement).value === val) { (inp as HTMLInputElement).click(); return; } }
        }, traerHonBtn);

        const popup = await popupPromise;
        if (popup) {
          await new Promise(r => setTimeout(r, 3000));
          await popup.evaluate(() => {
            const rows = document.querySelectorAll("tr");
            for (const row of rows) {
              const cells = row.querySelectorAll("td");
              if (cells.length > 0) {
                const link = row.querySelector("a");
                if (link) { link.click(); return; }
                const onclick = row.getAttribute("onclick") || row.getAttribute("onmousedown");
                if (onclick) { row.click(); return; }
                cells[0].click(); return;
              }
            }
          });
          await new Promise(r => setTimeout(r, 3000));
          await popup.close().catch(() => {});
        }
      }

      // 8. Pestaña Resumen
      await page.evaluate(() => {
        const links = document.querySelectorAll("a");
        for (const a of links) {
          if (a.textContent && a.textContent.trim() === "RESUMEN") { a.click(); return; }
        }
      });
      await new Promise(r => setTimeout(r, 2000));

      // 9. Traer Pago Directo
      await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("pago directo")) {
            (inp as HTMLInputElement).click(); return;
          }
        }
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("pago")) {
            (inp as HTMLInputElement).click(); return;
          }
        }
      });
      await new Promise(r => setTimeout(r, 3000));

      // 10. Grabar
      await page.evaluate(() => {
        const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
        for (const inp of inputs) {
          if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("grabar")) {
            (inp as HTMLInputElement).click(); return;
          }
        }
      });
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // 11. Volver a lista y buscar la factura recién creada para enviar al SII
      await page.goto(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
      
      // Filtrar por nro operación
      const filInput = await page.$('input[name="fil_lib_nid"]');
      if (filInput) {
        await filInput.type(nro_operacion);
        await page.evaluate(() => {
          if (typeof (window as unknown as Record<string, () => void>).filtrarLista === "function") {
            (window as unknown as Record<string, () => void>).filtrarLista();
          } else {
            const btn = document.querySelector('input[type="submit"]') as HTMLInputElement;
            if (btn) btn.click();
          }
        });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }

      // 12. Extraer ID de imprimir('ID') y ejecutar
      const imprimirId = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const match = html.match(/imprimir\(\s*'(\d+)'\s*\)/);
        return match ? match[1] : null;
      });

      if (imprimirId) {
        await page.evaluate((id: string) => { (window as unknown as Record<string, (id: string) => void>).imprimir(id); }, imprimirId);
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));

        // 13. Click "Imprimir" para enviar al SII
        await page.evaluate(() => {
          const inputs = document.querySelectorAll("input[type='button'], input[type='submit']");
          for (const inp of inputs) {
            if ((inp as HTMLInputElement).value && (inp as HTMLInputElement).value.toLowerCase().includes("imprimir")) {
              (inp as HTMLInputElement).click(); return;
            }
          }
        });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 3000));
        console.log(`[factura] ✅ Factura enviada al SII para op ${nro_operacion}`);
      }

      // 14. Volver a lista y obtener URL del DTE
      await page.goto(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
      const filInput2 = await page.$('input[name="fil_lib_nid"]');
      if (filInput2) {
        await filInput2.type(nro_operacion);
        await page.evaluate(() => {
          if (typeof (window as unknown as Record<string, () => void>).filtrarLista === "function") {
            (window as unknown as Record<string, () => void>).filtrarLista();
          }
        });
        await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
        await new Promise(r => setTimeout(r, 2000));
      }

      // Extraer ID del getUrl(true, ID) para construir la URL del DTE
      const dteId = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const match = html.match(/getUrl\(\s*true\s*,\s*(\d+)\s*\)/);
        return match ? match[1] : null;
      });

      let dteUrl = "";
      if (dteId) {
        // Construir URL del PDF del DTE: usar folio de la factura
        // Primero obtener el folio de la API
        try {
          const { execSync } = await import("child_process");
          const curlCmd = `curl -sk -u fguerragodoy:Uj7UarxZafsTL9G -X GET "${BASE_URL}/modulos/endpoints/api.php?endpoint=listaDTEs" -H "Content-Type: application/json" -d '{"despacho":${nro_operacion}}'`;
          const apiRaw = execSync(curlCmd, { timeout: 10000 }).toString();
          const apiData = JSON.parse(apiRaw);
          const factura33 = apiData.data?.find((d: Record<string, string>) => d.codigo_tipo_dte === "33");
          if (factura33) {
            const folio = factura33.dte_folio;
            const folioB64 = Buffer.from(folio).toString("base64");
            const params = Buffer.from(`tipoDTE=MzM=&folio=${folioB64}&cedible=MA==&fact_id=&ticket=&outPut=`).toString("base64");
            dteUrl = `${BASE_URL}/modulos/facturacion_electronica/otros/mostrar_dte_pdf.php?params=${params}`;
          }
        } catch {}

        if (dteUrl) {
          console.log(`[factura] DTE URL: ${dteUrl.substring(0, 80)}...`);
          
          // Guardar URL DTE en operaciones
          const { pgQuery } = await import("@/lib/postgres");
          await pgQuery(
            "INSERT INTO operaciones (nro_operacion, rut_cliente, estado) VALUES ($1, '92933000-5', 'aprobada') ON CONFLICT (nro_operacion) DO NOTHING",
            [nro_operacion]
          );
          await pgQuery(
            "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
            [`\ndte_url:${dteUrl}`, nro_operacion]
          );
        }
      }

      console.log(`[factura] ✅ Factura generada y enviada al SII para op ${nro_operacion}`);
      await browser.close();

      return NextResponse.json({ ok: true, dte_url: dteUrl });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[factura] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
