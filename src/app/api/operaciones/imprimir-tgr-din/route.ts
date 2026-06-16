import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { aduananetLogin } from "@/lib/aduananet";
import { PDFDocument } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * GET /api/operaciones/imprimir-tgr-din?nro_operacion=190420
 * 
 * Genera PDF combinado TGR + DIN Aprobada y lo muestra con auto-print.
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
    // 1. Obtener TGR del bucket
    const opRows = await pgQuery<{ notas: string }>(
      "SELECT notas FROM operaciones WHERE nro_operacion = $1",
      [nroOperacion]
    );
    const tgrUrlMatch = (opRows[0]?.notas || "").match(/tgr_url:(https?:\/\/[^\s\n]+)/);
    const tgrUrl = tgrUrlMatch ? tgrUrlMatch[1] : "";

    if (!tgrUrl) {
      return NextResponse.json({ error: "No se ha generado el TGR para esta operación" }, { status: 404 });
    }

    // 2. Descargar TGR PDF
    const tgrRes = await fetch(tgrUrl);
    if (!tgrRes.ok) {
      return NextResponse.json({ error: "Error descargando TGR" }, { status: 500 });
    }
    const tgrBuffer = await tgrRes.arrayBuffer();

    // 3. Descargar DIN aprobada PDF
    const cookies = await aduananetLogin();
    const dinPdfUrl = `${BASE_URL}/modulos/din/dus_encabezado/din.php?lbac_nid=0&lib_base=1&lib_nid=${nroOperacion}&dus_tipo_envio=2&copias=1&tipo=0&borrador=0&dolar=1&ref=1&pedidor=1&archivo=din.php-1&impresion=windows&pagina_inicial=1&cont_todas=1&rango=2-1`;
    const dinRes = await fetch(dinPdfUrl, { headers: { Cookie: cookies } });

    // 4. Combinar PDFs
    const mergedPdf = await PDFDocument.create();

    // TGR primero
    try {
      const tgrPdf = await PDFDocument.load(tgrBuffer);
      const pages = await mergedPdf.copyPages(tgrPdf, tgrPdf.getPageIndices());
      pages.forEach(page => mergedPdf.addPage(page));
    } catch {
      return NextResponse.json({ error: "Error procesando PDF del TGR" }, { status: 500 });
    }

    // DIN después
    if (dinRes.ok) {
      const dinBuffer = await dinRes.arrayBuffer();
      try {
        const dinPdf = await PDFDocument.load(dinBuffer);
        const pages = await mergedPdf.copyPages(dinPdf, dinPdf.getPageIndices());
        pages.forEach(page => mergedPdf.addPage(page));
      } catch {}
    }

    const pdfBytes = await mergedPdf.save();
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    // 5. Devolver HTML con auto-print
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>TGR + DIN - Despacho ${nroOperacion}</title>
  <style>body{margin:0;padding:0;overflow:hidden}iframe{width:100%;height:100vh;border:none}.loading{display:flex;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;font-size:18px;color:#333}</style>
</head>
<body>
  <div class="loading" id="loading">Cargando TGR + DIN para impresión...</div>
  <iframe id="pdf-frame" style="display:none"></iframe>
  <script>
    const frame = document.getElementById('pdf-frame');
    const loading = document.getElementById('loading');
    frame.src = 'data:application/pdf;base64,${pdfBase64}';
    frame.onload = function() {
      loading.style.display = 'none';
      frame.style.display = 'block';
      setTimeout(() => {
        try { frame.contentWindow.print(); } catch(e) { window.print(); }
      }, 500);
    };
  </script>
</body>
</html>`;

    return new NextResponse(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
