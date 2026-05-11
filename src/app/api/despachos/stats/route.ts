import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPERACIONES = [
  "EXPORTACION NORMAL",
  "EXPORTACION S/CARACTER COMERC.",
  "EXPORTACION DE SERVICIOS",
  "EXPORTACION DE SERVICIOS SIMPLIFICADA",
  "EXPORTACION ABONA DAPEX DTO. 224",
  "EXPORTACION CANCELA DAPEX DTO. 135",
  "EXPORTACION ABONA DAPEX DTO. 473",
  "EXPORT. ABONA SALIDA TEMPORAL",
  "EXPORTACION VIA COURIER",
  "EXPORTACIÓN ABONA DATPA DTO. 28",
  "SALIDA TEMPORAL",
  "SALIDA TEMPORAL PARA PERFECCIONAMIENTO PASIVO",
  "SALIDA TEMP.EFECTOS DE TURISTA",
  "SALIDA ABONA RANCHO DE IMPORTACION",
];

export async function GET(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const rut = session.rut;
  const { searchParams } = new URL(request.url);
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  const placeholders = OPERACIONES.map(() => "?").join(",");
  let whereClause = `WHERE operacion IN (${placeholders}) AND rut_cliente = ?`;
  const params: (string | number)[] = [...OPERACIONES, rut];

  if (desde) {
    whereClause += " AND fecha_aceptacion >= ?";
    params.push(desde);
  }
  if (hasta) {
    whereClause += " AND fecha_aceptacion <= ?";
    params.push(hasta);
  }

  try {
    // Total operaciones y FOB total
    const [totals] = await query<Record<string, unknown>[]>(
      `SELECT COUNT(*) as total_operaciones, COALESCE(SUM(total_fob), 0) as total_fob_sum, COALESCE(AVG(total_fob), 0) as promedio_fob FROM out_despacho_fguerra ${whereClause}`,
      params
    );

    // Operaciones por mes
    const porMes = await query<Record<string, unknown>[]>(
      `SELECT DATE_FORMAT(fecha_aceptacion, '%Y-%m') as mes, COUNT(*) as cantidad, COALESCE(SUM(total_fob), 0) as fob_mes FROM out_despacho_fguerra ${whereClause} GROUP BY mes ORDER BY mes`,
      params
    );

    // Por tipo de operación
    const porOperacion = await query<Record<string, unknown>[]>(
      `SELECT operacion, COUNT(*) as cantidad, COALESCE(SUM(total_fob), 0) as fob_total FROM out_despacho_fguerra ${whereClause} GROUP BY operacion ORDER BY cantidad DESC`,
      params
    );

    // Por país destino
    const porPais = await query<Record<string, unknown>[]>(
      `SELECT pais_destino, COUNT(*) as cantidad, COALESCE(SUM(total_fob), 0) as fob_total FROM out_despacho_fguerra ${whereClause} GROUP BY pais_destino ORDER BY fob_total DESC LIMIT 10`,
      params
    );

    // Por aduana
    const porAduana = await query<Record<string, unknown>[]>(
      `SELECT aduana, COUNT(*) as cantidad, COALESCE(SUM(total_fob), 0) as fob_total FROM out_despacho_fguerra ${whereClause} GROUP BY aduana ORDER BY cantidad DESC`,
      params
    );

    return NextResponse.json({
      totals: totals ?? {},
      porMes,
      porOperacion,
      porPais,
      porAduana,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Stats query error:", message);
    return NextResponse.json(
      { error: "Error al consultar estadísticas." },
      { status: 500 }
    );
  }
}
