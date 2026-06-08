import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { deleteFromSpaces } from "@/lib/spaces";
import { clientesVisibles } from "@/lib/permisos";

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
  const visibles = await clientesVisibles(session);

  let docs;
  if (visibles === "all") {
    docs = await pgQuery<{ id: number; storage_url: string }>("SELECT id, storage_url FROM documentos WHERE id = $1", [id]);
  } else {
    docs = await pgQuery<{ id: number; storage_url: string }>("SELECT id, storage_url FROM documentos WHERE id = $1 AND rut_cliente = ANY($2)", [id, visibles]);
  }

  if (docs.length === 0) {
    return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
  }

  if (docs[0].storage_url) {
    try { await deleteFromSpaces(docs[0].storage_url); } catch (err) { console.error("[docs] Error deleting from Spaces:", err); }
  }

  await pgQuery("DELETE FROM documentos WHERE id = $1", [id]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { tipo_documento, nro_operacion } = body;

  const sets: string[] = [];
  const values: string[] = [];

  if (tipo_documento) {
    values.push(tipo_documento);
    sets.push(`tipo_documento = $${values.length}`);
  }
  if (nro_operacion) {
    values.push(nro_operacion);
    sets.push(`nro_operacion = $${values.length}`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
  }

  values.push(id);
  const result = await pgQuery(
    `UPDATE documentos SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id`,
    values
  );

  if (result.length === 0) {
    return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
