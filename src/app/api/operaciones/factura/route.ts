import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aduananetLogin } from "@/lib/aduananet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * GET /api/operaciones/factura?nro_operacion=190420
 * 
 * Busca la factura DIN de la operación en AduanaNet y devuelve el PDF.
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
    const cookies = await aduananetLogin();

    // 1. Buscar factura en lista.php filtrando por lib_nid
    const filterBody = new URLSearchParams();
    filterBody.set("accion", "F");
    filterBody.set("fil_lib_nid", nroOperacion);

    const listaRes = await fetch(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: filterBody.toString(),
    });
    const listaHtml = await listaRes.text();

    // 2. Extraer el ID de la factura (buscar patrón reporte(ID) o similar)
    const reporteIds = [...listaHtml.matchAll(/reporte\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    // También buscar patrón imprimir(ID) o ver_pdf(ID)
    const imprimirIds = [...listaHtml.matchAll(/imprimir\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    const verPdfIds = [...listaHtml.matchAll(/ver_pdf\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    
    const allIds = [...reporteIds, ...imprimirIds, ...verPdfIds];
    const facturaId = allIds.length > 0 ? Math.max(...allIds) : 0;

    if (!facturaId) {
      // Intentar buscar cualquier link con ID numérico en la tabla
      const genericIds = [...listaHtml.matchAll(/(?:factura_id|fac_id|id)=(\d+)/gi)].map(m => Number(m[1]));
      const fallbackId = genericIds.length > 0 ? Math.max(...genericIds) : 0;
      
      if (!fallbackId) {
        return NextResponse.json({ error: "No se encontró factura para esta operación" }, { status: 404 });
      }
      
      // Intentar con el fallback ID
      const pdfRes = await fetch(`${BASE_URL}/modulos/contabilidad/facturacion/afecta/reporte_pdf.php?fac_id=${fallbackId}`, {
        headers: { Cookie: cookies },
      });
      
      if (pdfRes.ok && pdfRes.headers.get("content-type")?.includes("pdf")) {
        const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
        return new NextResponse(pdfBuffer, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="Factura_${nroOperacion}.pdf"`,
          },
        });
      }
      
      return NextResponse.json({ error: "No se encontró factura para esta operación" }, { status: 404 });
    }

    // 3. Descargar PDF de la factura
    // Probar diferentes endpoints de PDF
    const pdfUrls = [
      `${BASE_URL}/modulos/contabilidad/facturacion/afecta/reporte_pdf.php?fac_id=${facturaId}`,
      `${BASE_URL}/modulos/contabilidad/facturacion/afecta/reporte_pdf.php?accion=E&fac_id=${facturaId}`,
    ];

    for (const pdfUrl of pdfUrls) {
      const pdfRes = await fetch(pdfUrl, {
        headers: { Cookie: cookies },
      });

      if (pdfRes.ok) {
        const contentType = pdfRes.headers.get("content-type") || "";
        if (contentType.includes("pdf") || contentType.includes("octet")) {
          const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
          return new NextResponse(pdfBuffer, {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `inline; filename="Factura_${nroOperacion}.pdf"`,
            },
          });
        }
      }
    }

    // Si no encontró PDF, redirigir a la lista filtrada
    return NextResponse.redirect(
      `${BASE_URL}/modulos/contabilidad/facturacion/afecta/lista.php`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[factura] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
