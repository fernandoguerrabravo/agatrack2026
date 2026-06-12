import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { clientesVisibles } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/operaciones/clientes
 * Retorna la lista de clientes asignados al usuario logueado.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const visibles = await clientesVisibles(session);
  
  let clientes: Array<{ rut: string; nombre: string }>;
  
  if (visibles === "all") {
    // Admin: obtener todos los clientes que tienen operaciones
    clientes = await pgQuery<{ rut: string; nombre: string }>(
      `SELECT DISTINCT o.rut_cliente as rut, COALESCE(c.razon, o.rut_cliente) as nombre 
       FROM operaciones o LEFT JOIN clientes c ON o.rut_cliente = c.rut 
       WHERE o.rut_cliente IS NOT NULL AND o.rut_cliente != ''
       ORDER BY nombre`
    );
  } else {
    // Ejecutivo/cliente: solo los asignados
    clientes = await pgQuery<{ rut: string; nombre: string }>(
      `SELECT DISTINCT a.rut_cliente as rut, COALESCE(c.razon, a.rut_cliente) as nombre 
       FROM asignaciones_ejecutivo a LEFT JOIN clientes c ON a.rut_cliente = c.rut 
       WHERE a.rut_ejecutivo = $1
       ORDER BY nombre`,
      [session.rut]
    );
  }

  return NextResponse.json({ clientes });
}
