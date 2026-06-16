import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/operaciones/factura?nro_operacion=190420
 * 
 * Obtiene la URL de la factura desde despachos_replica y redirige al PDF.
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
    const rows = await pgQuery<{ url_factura: string }>(
      `SELECT url_factura FROM despachos_replica WHERE despacho = $1 LIMIT 1`,
      [nroOperacion]
    );

    if (rows.length === 0 || !rows[0].url_factura) {
      return NextResponse.json({ error: "No se encontró factura para esta operación" }, { status: 404 });
    }

    return NextResponse.redirect(rows[0].url_factura);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[factura] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
