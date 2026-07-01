import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { deleteFolderFromSpaces } from "@/lib/spaces";
import { clientesVisibles } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const nroOperacion = searchParams.get("nro_operacion");

  // Resolver clientes visibles según rol
  const visibles = await clientesVisibles(session);

  let rows;
  if (nroOperacion) {
    if (visibles === "all") {
      rows = await pgQuery(
        "SELECT id, nro_operacion, rut_cliente, nombre_archivo, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, storage_url, created_at FROM documentos WHERE nro_operacion = $1 ORDER BY created_at DESC",
        [nroOperacion]
      );
    } else {
      rows = await pgQuery(
        "SELECT id, nro_operacion, rut_cliente, nombre_archivo, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, storage_url, created_at FROM documentos WHERE rut_cliente = ANY($1) AND nro_operacion = $2 ORDER BY created_at DESC",
        [visibles, nroOperacion]
      );
    }
  } else {
    if (visibles === "all") {
      rows = await pgQuery(
        "SELECT id, nro_operacion, rut_cliente, nombre_archivo, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, storage_url, created_at FROM documentos ORDER BY created_at DESC LIMIT 2000",
        []
      );
    } else {
      rows = await pgQuery(
        "SELECT id, nro_operacion, rut_cliente, nombre_archivo, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, storage_url, created_at FROM documentos WHERE rut_cliente = ANY($1) ORDER BY created_at DESC LIMIT 2000",
        [visibles]
      );
    }
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

  // Verificar acceso
  const visibles = await clientesVisibles(session);
  if (visibles !== "all") {
    const check = await pgQuery(
      "SELECT 1 FROM documentos WHERE nro_operacion = $1 AND rut_cliente = ANY($2) LIMIT 1",
      [nroOperacion, visibles]
    );
    if (check.length === 0) {
      return NextResponse.json({ error: "Sin acceso a esta operación." }, { status: 403 });
    }
  }

  // Obtener rut_cliente del primer doc para la carpeta
  const docInfo = await pgQuery<{ rut_cliente: string }>(
    "SELECT rut_cliente FROM documentos WHERE nro_operacion = $1 LIMIT 1",
    [nroOperacion]
  );
  const rutCliente = docInfo[0]?.rut_cliente || session.rut;

  // Borrar carpeta completa del bucket
  try {
    const folderPrefix = `documentos/${rutCliente}/${nroOperacion}/`;
    await deleteFolderFromSpaces(folderPrefix);
  } catch (err) {
    console.error("[docs] Error deleting folder from Spaces:", err);
  }

  // Borrar de la base de datos (solo los docs de esta operación)
  if (visibles === "all") {
    await pgQuery("DELETE FROM documentos WHERE nro_operacion = $1", [nroOperacion]);
  } else {
    await pgQuery(
      "DELETE FROM documentos WHERE nro_operacion = $1 AND rut_cliente = ANY($2)",
      [nroOperacion, visibles]
    );
  }

  return NextResponse.json({ ok: true });
}
