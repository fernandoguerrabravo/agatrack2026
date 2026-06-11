import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { aduananetLogin } from "@/lib/aduananet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

/**
 * GET /api/operaciones/caratula?nro_operacion=190418
 * 
 * Descarga el PDF de la carátula (antecedentes) de la operación desde AduanaNet.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const nroOperacion = searchParams.get("nro_operacion");
  if (!nroOperacion) {
    return NextResponse.json({ error: "nro_operacion requerido." }, { status: 400 });
  }

  try {
    const cookies = await aduananetLogin();
    const pdfUrl = `${BASE_URL}/modulos/comex/orden_compra/antecedentes_pdf.php?lib_nid=${nroOperacion}&lib_base=1`;

    const res = await fetch(pdfUrl, {
      headers: { Cookie: cookies },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Error descargando carátula" }, { status: 500 });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Caratula_${nroOperacion}.pdf"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
