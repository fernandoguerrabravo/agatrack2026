import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aduananetLogin } from "@/lib/aduananet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * GET /api/aduananet-proxy?path=/modulos/din/dus_encabezado/...
 * Proxy autenticado a AduanaNet. Permite embeber páginas en iframe.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const aduanaPath = searchParams.get("path");
  if (!aduanaPath) {
    return NextResponse.json({ error: "path requerido." }, { status: 400 });
  }

  try {
    const cookies = await aduananetLogin();
    const url = `${BASE_URL}${aduanaPath.startsWith("/") ? "" : "/"}${aduanaPath}`;

    const res = await fetch(url, {
      headers: {
        "Cookie": cookies,
        "User-Agent": "Mozilla/5.0 (AgaTrack DIN Bot)",
      },
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") || "text/html";
    let body = await res.text();

    // Reescribir URLs relativas para que pasen por el proxy
    body = body.replace(/(href|src|action)\s*=\s*["'](?!http|\/\/|javascript|#)([^"']+)["']/gi, (match, attr, path) => {
      // URLs relativas al directorio actual
      if (!path.startsWith("/")) {
        const dir = aduanaPath.substring(0, aduanaPath.lastIndexOf("/") + 1);
        path = dir + path;
      }
      return `${attr}="/api/aduananet-proxy?path=${encodeURIComponent(path)}"`;
    });

    // Reescribir URLs absolutas del mismo dominio
    body = body.replace(new RegExp(BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "/api/aduananet-proxy?path=");

    // Ocultar menús, headers y navegación — mostrar solo el formulario
    // También ocultar con JS lo que no se pueda con CSS
    body = body.replace("</head>", `<style>
      body { margin: 0 !important; padding: 5px !important; background: white !important; }
      .table_din { width: 100% !important; }
    </style>
    <script>
    document.addEventListener('DOMContentLoaded', function() {
      // Ocultar filas con info usuario/dólar/soporte
      var tds = document.querySelectorAll('td');
      for (var j = 0; j < tds.length; j++) {
        var txt = tds[j].textContent || '';
        if (/D.lar Observado|ADMINISTRADOR|Soporte Ticket|Soporte Si necesita/i.test(txt)) {
          var row = tds[j].closest('tr');
          if (row) row.style.display = 'none';
        }
      }
      // Ocultar Toggle Navigation / navbar-toggle y su menú
      var navToggles = document.querySelectorAll('.navbar-toggle, .navbar-header, [data-toggle="collapse"], .toggle-navigation, button.navbar-toggle');
      for (var k = 0; k < navToggles.length; k++) {
        navToggles[k].style.display = 'none';
      }
      // Ocultar el menú colapsable (navbar-collapse)
      var navMenus = document.querySelectorAll('.navbar-collapse, .collapse.navbar-collapse, .nav.navbar-nav, .navbar');
      for (var n = 0; n < navMenus.length; n++) {
        navMenus[n].style.display = 'none';
      }
      // Ocultar por texto "Toggle navigation"
      var btns = document.querySelectorAll('button, span');
      for (var b = 0; b < btns.length; b++) {
        if (/Toggle navigation/i.test(btns[b].textContent || '')) {
          var navbar = btns[b].closest('.navbar') || btns[b].closest('nav');
          if (navbar) navbar.style.display = 'none';
          else btns[b].closest('.navbar-header') ? btns[b].closest('.navbar-header').style.display = 'none' : btns[b].style.display = 'none';
        }
      }
    });
    </script></head>`);

    return new NextResponse(body, {
      status: res.status,
      headers: {
        "Content-Type": contentType,
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Error proxy: " + (err instanceof Error ? err.message : "desconocido") }, { status: 500 });
  }
}
