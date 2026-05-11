import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPERACIONES_EXPORT = [
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

  const placeholders = OPERACIONES_EXPORT.map(() => "?").join(",");
  let whereClause = `WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ?`;
  const params: (string | number)[] = [...OPERACIONES_EXPORT, rut];

  if (desde) {
    whereClause += " AND fecha_aceptacion >= ?";
    params.push(desde);
  }
  if (hasta) {
    whereClause += " AND fecha_aceptacion <= ?";
    params.push(hasta);
  }

  try {
    // Totales IVA y Derechos de Aduana (gravamenes_valor_1)
    const [totals] = await query<Record<string, unknown>[]>(
      `SELECT 
        COUNT(*) as total_operaciones,
        COALESCE(SUM(iva), 0) as total_iva,
        COALESCE(SUM(gravamenes_valor_1), 0) as total_derechos_aduana,
        COALESCE(SUM(iva) + SUM(gravamenes_valor_1), 0) as total_impuestos,
        COALESCE(SUM(total_cif), 0) as total_cif
      FROM out_despacho_fguerra ${whereClause}`,
      params
    );

    // Bien de Capital: regimen GENERAL y gravamenes_valor_1 = 0
    const [bienCapital] = await query<Record<string, unknown>[]>(
      `SELECT COUNT(*) as cantidad, COALESCE(SUM(total_cif), 0) as total_cif_bk
      FROM out_despacho_fguerra ${whereClause} AND regimen = 'GENERAL' AND gravamenes_valor_1 = 0`,
      params
    );

    // Tendencia Bien de Capital por año desde 2024 (independiente del filtro de fechas)
    const placeholdersTrend = OPERACIONES_EXPORT.map(() => "?").join(",");
    const bienCapitalAnual = await query<Record<string, unknown>[]>(
      `SELECT YEAR(fecha_aceptacion) as anio, COUNT(*) as cantidad, COALESCE(SUM(total_cif), 0) as total_cif_bk
      FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholdersTrend}) AND rut_cliente = ? AND regimen = 'GENERAL' AND gravamenes_valor_1 = 0 AND fecha_aceptacion >= '2024-01-01'
      GROUP BY anio ORDER BY anio`,
      [...OPERACIONES_EXPORT, rut]
    );

    // IVA y Derechos por mes
    const porMes = await query<Record<string, unknown>[]>(
      `SELECT 
        DATE_FORMAT(fecha_aceptacion, '%Y-%m') as mes,
        COUNT(*) as cantidad,
        COALESCE(SUM(iva), 0) as iva_mes,
        COALESCE(SUM(gravamenes_valor_1), 0) as derechos_mes,
        COALESCE(SUM(iva) + SUM(gravamenes_valor_1), 0) as total_impuestos_mes
      FROM out_despacho_fguerra ${whereClause} GROUP BY mes ORDER BY mes`,
      params
    );

    // Por tipo de operación
    const porOperacion = await query<Record<string, unknown>[]>(
      `SELECT 
        operacion,
        COUNT(*) as cantidad,
        COALESCE(SUM(iva), 0) as iva_total,
        COALESCE(SUM(gravamenes_valor_1), 0) as derechos_total
      FROM out_despacho_fguerra ${whereClause} GROUP BY operacion ORDER BY iva_total DESC`,
      params
    );

    return NextResponse.json({
      totals: totals ?? {},
      bienCapital: bienCapital ?? { cantidad: 0, total_cif_bk: 0 },
      bienCapitalAnual,
      porMes,
      porOperacion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Impuestos query error:", message);
    return NextResponse.json(
      { error: "Error al consultar impuestos." },
      { status: 500 }
    );
  }
}
