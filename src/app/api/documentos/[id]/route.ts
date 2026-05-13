import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { deleteFromSpaces } from "@/lib/spaces";

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

  // Obtener URL del archivo antes de borrar
  const docs = await pgQuery<{ id: number; storage_url: string }>(
    "SELECT id, storage_url FROM documentos WHERE id = $1 AND rut_cliente = $2",
    [id, session.rut]
  );

  if (docs.length === 0) {
    return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
  }

  // Borrar del bucket
  if (docs[0].storage_url) {
    try {
      await deleteFromSpaces(docs[0].storage_url);
    } catch (err) {
      console.error("[docs] Error deleting from Spaces:", err);
    }
  }

  // Borrar de la base de datos
  await pgQuery(
    "DELETE FROM documentos WHERE id = $1 AND rut_cliente = $2",
    [id, session.rut]
  );

  return NextResponse.json({ ok: true });
}
