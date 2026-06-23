import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { clientesVisibles } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/operaciones — Lista operaciones según rol del usuario
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const estado = searchParams.get("estado") || "";
  const nroOperacion = searchParams.get("nro_operacion") || "";

  const visibles = await clientesVisibles(session);

  let baseQuery = `
    SELECT o.nro_operacion, o.rut_cliente, o.estado, o.fecha_apertura, o.fecha_confeccion, o.notas,
           c.razon as cliente_nombre,
           COUNT(d.id) as total_docs
    FROM operaciones o
    LEFT JOIN clientes c ON o.rut_cliente = c.rut
    LEFT JOIN documentos d ON d.nro_operacion = o.nro_operacion
  `;

  const conditions: string[] = [];
  const params: (string | string[])[] = [];

  // Filtro por visibilidad según rol
  if (visibles !== "all") {
    params.push(visibles);
    conditions.push(`o.rut_cliente = ANY($${params.length})`);
  }

  if (estado) {
    params.push(estado);
    conditions.push(`o.estado = $${params.length}`);
  }
  if (nroOperacion) {
    params.push(nroOperacion);
    conditions.push(`o.nro_operacion = $${params.length}`);
  }

  if (conditions.length > 0) {
    baseQuery += " WHERE " + conditions.join(" AND ");
  }

  baseQuery += ` GROUP BY o.nro_operacion, o.rut_cliente, o.estado, o.fecha_apertura, o.fecha_confeccion, o.notas, c.razon
                 ORDER BY o.nro_operacion DESC LIMIT 200`;

  const rows = await pgQuery(baseQuery, params);
  return NextResponse.json({ operaciones: rows });
}

/**
 * POST /api/operaciones — Crear nueva operación
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // Solo ejecutivo/admin pueden crear operaciones
  if (session.rol === "cliente") {
    return NextResponse.json({ error: "Sin permisos para crear operaciones." }, { status: 403 });
  }

  const body = await request.json();
  const { nro_operacion, rut_cliente, notas } = body;

  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  // Verificar si ya existe
  const existing = await pgQuery("SELECT 1 FROM operaciones WHERE nro_operacion = $1", [nro_operacion]);
  if (existing.length > 0) {
    return NextResponse.json({ error: "La operación ya existe." }, { status: 409 });
  }

  await pgQuery(
    `INSERT INTO operaciones (nro_operacion, rut_cliente, estado, notas) VALUES ($1, $2, 'abierta', $3)`,
    [nro_operacion, rut_cliente || null, notas || ""]
  );

  return NextResponse.json({ ok: true, nro_operacion });
}

/**
 * DELETE /api/operaciones?nro_operacion=XXXXX — Cerrar operación
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // Solo ejecutivo/admin
  if (session.rol === "cliente") {
    return NextResponse.json({ error: "Sin permisos." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const nroOperacion = searchParams.get("nro_operacion");

  if (!nroOperacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  // Verificar acceso (ejecutivo solo puede cerrar sus asignados)
  if (session.rol === "ejecutivo") {
    const visibles = await clientesVisibles(session);
    if (visibles !== "all") {
      const check = await pgQuery(
        "SELECT 1 FROM operaciones WHERE nro_operacion = $1 AND rut_cliente = ANY($2)",
        [nroOperacion, visibles]
      );
      if (check.length === 0) {
        return NextResponse.json({ error: "Sin acceso a esta operación." }, { status: 403 });
      }
    }
  }

  await pgQuery(
    "UPDATE operaciones SET estado = 'cerrada', fecha_cierre = NOW(), updated_at = NOW() WHERE nro_operacion = $1",
    [nroOperacion]
  );

  return NextResponse.json({ ok: true });
}
