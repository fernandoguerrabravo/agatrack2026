import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/operaciones/[nro] — Actualizar estado, notas, rut_cliente
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ nro: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { nro } = await params;
  const body = await request.json();
  const { estado, notas, rut_cliente } = body;

  const sets: string[] = ["updated_at = NOW()"];
  const values: (string | null)[] = [];

  if (estado) {
    values.push(estado);
    sets.push(`estado = $${values.length}`);
    if (estado === "confeccionada") {
      sets.push("fecha_confeccion = NOW()");
    }
    if (estado === "cerrada") {
      sets.push("fecha_cierre = NOW()");
    }
  }
  if (notas !== undefined) {
    values.push(notas);
    sets.push(`notas = $${values.length}`);
  }
  if (rut_cliente !== undefined) {
    values.push(rut_cliente || null);
    sets.push(`rut_cliente = $${values.length}`);
  }

  values.push(nro);
  values.push(session.rut);

  await pgQuery(
    `UPDATE operaciones SET ${sets.join(", ")} WHERE nro_operacion = $${values.length - 1} AND rut_cliente = $${values.length}`,
    values
  );

  return NextResponse.json({ ok: true });
}
