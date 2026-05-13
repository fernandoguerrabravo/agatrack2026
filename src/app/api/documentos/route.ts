import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const nroOperacion = searchParams.get("nro_operacion");

  let rows;
  if (nroOperacion) {
    rows = await pgQuery(
      "SELECT id, nro_operacion, nombre_archivo, tipo_documento, datos_extraidos, storage_url, created_at FROM documentos WHERE rut_cliente = $1 AND nro_operacion = $2 ORDER BY created_at DESC",
      [session.rut, nroOperacion]
    );
  } else {
    rows = await pgQuery(
      "SELECT id, nro_operacion, nombre_archivo, tipo_documento, datos_extraidos, storage_url, created_at FROM documentos WHERE rut_cliente = $1 ORDER BY created_at DESC LIMIT 50",
      [session.rut]
    );
  }

  return NextResponse.json({ documentos: rows });
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const nroOperacion = searchParams.get("nro_operacion");

  if (!nroOperacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  await pgQuery(
    "DELETE FROM documentos WHERE rut_cliente = $1 AND nro_operacion = $2",
    [session.rut, nroOperacion]
  );

  return NextResponse.json({ ok: true });
}
