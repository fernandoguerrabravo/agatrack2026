import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/operaciones/imprimir?nro_operacion=190420
 * 
 * Devuelve una página HTML que carga el PDF de Factura+DIN+TGR
 * y dispara window.print() automáticamente.
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

  const pdfUrl = `/api/operaciones/factura?nro_operacion=${nroOperacion}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Imprimiendo Despacho ${nroOperacion}</title>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    iframe { width: 100%; height: 100vh; border: none; }
    .loading { display: flex; align-items: center; justify-content: center; height: 100vh; font-family: Arial, sans-serif; font-size: 18px; color: #333; }
  </style>
</head>
<body>
  <div class="loading" id="loading">Cargando documento para impresión...</div>
  <iframe id="pdf-frame" style="display:none"></iframe>
  <script>
    const frame = document.getElementById('pdf-frame');
    const loading = document.getElementById('loading');
    frame.src = '${pdfUrl}';
    frame.onload = function() {
      loading.style.display = 'none';
      frame.style.display = 'block';
      setTimeout(() => {
        try {
          frame.contentWindow.print();
        } catch(e) {
          // Si falla por CORS, usar print de la ventana
          window.print();
        }
      }, 1000);
    };
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
