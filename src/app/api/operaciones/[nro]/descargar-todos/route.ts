import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/operaciones/[nro]/descargar-todos
 * Combina todos los PDFs de una operación en un solo archivo.
 */
export async function GET(request: Request, { params }: { params: Promise<{ nro: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { nro } = await params;
  if (!nro) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  try {
    // Obtener documentos de la operación
    const docs = await pgQuery<{ nombre_archivo: string; storage_url: string }>(
      "SELECT nombre_archivo, storage_url FROM documentos WHERE nro_operacion = $1 AND storage_url IS NOT NULL ORDER BY created_at",
      [nro]
    );

    if (docs.length === 0) {
      return NextResponse.json({ error: "No se encontraron documentos." }, { status: 404 });
    }

    // Crear PDF combinado
    const mergedPdf = await PDFDocument.create();

    // Agregar carátula al principio
    try {
      const { aduananetLogin } = await import("@/lib/aduananet");
      const cookies = await aduananetLogin();
      const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";
      const caratulaUrl = `${BASE_URL}/modulos/comex/orden_compra/antecedentes_pdf.php?lib_nid=${nro}&lib_base=1`;
      const caratulaRes = await fetch(caratulaUrl, { headers: { Cookie: cookies } });
      if (caratulaRes.ok) {
        const caratulaBuf = await caratulaRes.arrayBuffer();
        if (caratulaBuf.byteLength > 100) {
          const header = new Uint8Array(caratulaBuf.slice(0, 5));
          if (String.fromCharCode(...header) === "%PDF-") {
            const caratulaPdf = await PDFDocument.load(caratulaBuf, { ignoreEncryption: true });
            const pages = await mergedPdf.copyPages(caratulaPdf, caratulaPdf.getPageIndices());
            for (const page of pages) mergedPdf.addPage(page);
          }
        }
      }
    } catch (err) {
      console.error("[descargar-todos] Error con carátula:", err instanceof Error ? err.message : err);
    }

    for (const doc of docs) {
      if (!doc.storage_url) continue;
      try {
        const res = await fetch(doc.storage_url);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        // Verificar que sea un PDF válido
        if (buf.byteLength < 100) continue;
        const header = new Uint8Array(buf.slice(0, 5));
        if (String.fromCharCode(...header) !== "%PDF-") continue;
        
        const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
        for (const page of pages) {
          mergedPdf.addPage(page);
        }
      } catch (err) {
        console.error(`[descargar-todos] Error con ${doc.nombre_archivo}:`, err instanceof Error ? err.message : err);
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      return NextResponse.json({ error: "No se pudieron combinar los documentos." }, { status: 500 });
    }

    const pdfBytes = await mergedPdf.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nro}.pdf"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
