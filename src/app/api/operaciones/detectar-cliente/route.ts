import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { detectarClientePorConsignatario } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/operaciones/detectar-cliente?nombre=PETROQUIMICA DOW SA
 * Detecta el cliente a partir del nombre del consignatario/comprador.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const nombre = searchParams.get("nombre");
  if (!nombre) {
    return NextResponse.json({ error: "nombre requerido." }, { status: 400 });
  }

  const cliente = await detectarClientePorConsignatario(nombre);
  if (!cliente) {
    return NextResponse.json({ error: "Cliente no encontrado", rut: null, cli_id: null });
  }

  return NextResponse.json({ rut: cliente.rut, razon: cliente.razon, cli_id: cliente.cli_id });
}
