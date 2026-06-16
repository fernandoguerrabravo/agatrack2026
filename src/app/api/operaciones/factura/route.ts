import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { aduananetLogin } from "@/lib/aduananet";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * GET /api/operaciones/factura?nro_operacion=190420
 * 
 * Genera un PDF combinado: Factura + DIN Aprobada
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
    // 1. Obtener URL factura desde despachos_replica
    const rows = await pgQuery<{ url_factura: string }>(
      `SELECT url_factura FROM despachos_replica WHERE despacho = $1 LIMIT 1`,
      [nroOperacion]
    );

    if (rows.length === 0 || !rows[0].url_factura) {
      return NextResponse.json({ error: "No se encontró factura para esta operación" }, { status: 404 });
    }

    // 2. Descargar factura PDF
    const facturaRes = await fetch(rows[0].url_factura);
    if (!facturaRes.ok) {
      return NextResponse.json({ error: "Error descargando factura" }, { status: 500 });
    }
    const facturaBuffer = await facturaRes.arrayBuffer();

    // 3. Descargar DIN aprobada PDF
    const cookies = await aduananetLogin();
    const dinPdfUrl = `${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${nroOperacion}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`;
    const dinRes = await fetch(dinPdfUrl, { headers: { Cookie: cookies } });

    // 4. Descargar comprobante TGR
    const tgrRes = await fetch(`${new URL(request.url).origin}/api/operaciones/comprobante-tgr?nro_operacion=${nroOperacion}`, {
      headers: { Cookie: request.headers.get("cookie") || "" },
    });

    // 5. Combinar PDFs
    const mergedPdf = await PDFDocument.create();

    // Agregar factura
    try {
      const facturaPdf = await PDFDocument.load(facturaBuffer);
      const facturaPages = await mergedPdf.copyPages(facturaPdf, facturaPdf.getPageIndices());
      facturaPages.forEach(page => mergedPdf.addPage(page));
    } catch {
      return NextResponse.json({ error: "Error procesando PDF de factura" }, { status: 500 });
    }

    // Agregar DIN aprobada (si está disponible)
    if (dinRes.ok) {
      const dinBuffer = await dinRes.arrayBuffer();
      try {
        const dinPdf = await PDFDocument.load(dinBuffer);
        const dinPages = await mergedPdf.copyPages(dinPdf, dinPdf.getPageIndices());
        dinPages.forEach(page => mergedPdf.addPage(page));
      } catch {
        // Si falla al cargar DIN, continuar sin ella
        console.error("[factura] Error cargando DIN PDF");
      }
    }

    // Agregar comprobante TGR (si está disponible)
    if (tgrRes.ok && tgrRes.headers.get("content-type")?.includes("pdf")) {
      const tgrBuffer = await tgrRes.arrayBuffer();
      try {
        const tgrPdf = await PDFDocument.load(tgrBuffer);
        const tgrPages = await mergedPdf.copyPages(tgrPdf, tgrPdf.getPageIndices());
        tgrPages.forEach(page => mergedPdf.addPage(page));
      } catch {
        console.error("[factura] Error cargando comprobante TGR PDF");
      }
    }

    const mergedBuffer = await mergedPdf.save();

    return new NextResponse(Buffer.from(mergedBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Factura_DIN_${nroOperacion}.pdf"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[factura] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
