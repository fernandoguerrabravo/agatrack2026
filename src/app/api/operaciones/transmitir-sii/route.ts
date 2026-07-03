import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aduananetBrowserLogin } from "@/lib/aduananet-browser";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * POST /api/operaciones/transmitir-sii
 * Body: { nro_operacion: string }
 *
 * Transmite al SII una factura ya confeccionada (revisión previa completada).
 * NO confecciona: asume que la factura ya existe en AduanaNet (skip_sii en generar-factura).
 * Reutiliza el patrón conocido: filtrar por fil_fact_nid → imprimir(id) → Imprimir (envía SII) → DTE URL.
 *
 * Usado para el flujo de Petroquímica: las facturas se confeccionan sin enviar al SII
 * y se transmiten manualmente desde el panel tras la revisión.
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

  // Verificar estado en BD: debe estar confeccionada y sin DTE aún.
  const opRows = await pgQuery<{ notas: string; url_dte: string; rut_cliente: string }>(
    `SELECT o.notas, o.rut_cliente, dr.url_dte FROM operaciones o
     LEFT JOIN despachos_replica dr ON dr.despacho = o.nro_operacion
     WHERE o.nro_operacion = $1`,
    [nro_operacion]
  );
  const notas = opRows[0]?.notas || "";
  const rutCliente = opRows[0]?.rut_cliente || "";
  const yaTieneDte = opRows[0]?.url_dte || notas.includes("dte_url:");
  if (yaTieneDte) {
    console.log(`[transmitir-sii] ⏭️ Op ${nro_operacion} ya tiene DTE, saltando`);
    return NextResponse.json({ ok: true, dte_url: "ya_existe", skip: true });
  }

  // Verificar en AduanaNet si ya tiene DTE emitida (evita doble transmisión)
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
      const dteUrl = `${BASE_URL}/modulos/facturacion_electronica/otros/mostrar_dte_pdf.php?params=${params}`;
      await pgQuery(
        "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
        [`\ndte_url:${dteUrl}`, nro_operacion]
      );
      console.log(`[transmitir-sii] ⏭️ Op ${nro_operacion} ya tiene DTE en AduanaNet (folio ${folio}), guardada`);
      return NextResponse.json({ ok: true, dte_url: dteUrl, skip: true });
    }
  } catch {}

  try {
    const { browser, page } = await aduananetBrowserLogin();

    // Filtra la lista de facturación por nro de operación (campo correcto: fil_fact_nid)
    const filtrarPorNid = async (nid: string): Promise<boolean> => {
      await page.goto(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, { waitUntil: "networkidle0" });
      const inp = await page.$('input[name="fil_fact_nid"]');
      if (!inp) return false;
      await page.evaluate(() => { const i = document.querySelector('input[name="fil_fact_nid"]') as HTMLInputElement | null; if (i) i.value = ""; });
      await inp.type(nid);
      await inp.press("Enter");
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      return true;
    };

    try {
      // 1. Filtrar por la operación y ubicar imprimir('ID') de la fila filtrada
      const filtroOk = await filtrarPorNid(nro_operacion);

      const imprimirId = filtroOk ? await page.evaluate(() => {
        const html = document.body.innerHTML;
        const match = html.match(/imprimir\(\s*'?(\d+)'?\s*\)/);
        return match ? match[1] : null;
      }) : null;

      if (!imprimirId) {
        console.error(`[transmitir-sii] ⚠️ No se encontró factura confeccionada para op ${nro_operacion} (filtro=${filtroOk})`);
        await browser.close();
        return NextResponse.json({ error: "No se encontró factura confeccionada para transmitir. Verifica que la factura exista en AduanaNet." }, { status: 404 });
      }

      // 2. Abrir la factura
      await page.evaluate((id: string) => { (window as unknown as Record<string, (id: string) => void>).imprimir(id); }, imprimirId);
      await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // 3. Click "Imprimir" para enviar al SII
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
      console.log(`[transmitir-sii] ✅ Factura ${imprimirId} enviada al SII para op ${nro_operacion}`);

      // 4. Obtener URL del DTE desde la API (folio de la factura 33)
      let dteUrl = "";
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
        await pgQuery(
          "INSERT INTO operaciones (nro_operacion, rut_cliente, estado) VALUES ($1, $2, 'aprobada') ON CONFLICT (nro_operacion) DO NOTHING",
          [nro_operacion, rutCliente || "92933000-5"]
        );
        await pgQuery(
          "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
          [`\ndte_url:${dteUrl}`, nro_operacion]
        );
        console.log(`[transmitir-sii] ✅ DTE guardada para op ${nro_operacion}`);
      } else {
        console.error(`[transmitir-sii] ⚠️ No se pudo obtener DTE URL tras transmitir op ${nro_operacion} (puede requerir unos segundos en el SII)`);
      }

      await browser.close();
      return NextResponse.json({ ok: true, dte_url: dteUrl });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[transmitir-sii] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
