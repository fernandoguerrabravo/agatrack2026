import { NextResponse } from "next/server";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tipos-documento
 * Retorna la lista de tipos de documento activos.
 */
export async function GET() {
  const tipos = await pgQuery<{ nombre: string }>(
    "SELECT nombre FROM tipos_documento WHERE activo = true ORDER BY orden, nombre"
  );
  return NextResponse.json({ tipos: tipos.map(t => t.nombre) });
}
