import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { id } = await params;

  const rows = await pgQuery(
    "DELETE FROM documentos WHERE id = $1 AND rut_cliente = $2 RETURNING id",
    [id, session.rut]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
