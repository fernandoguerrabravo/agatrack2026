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
    // Totales
    const [totals] = await query<Record<string, unknown>[]>(
      `SELECT COUNT(*) as total_operaciones, COALESCE(SUM(total_cif), 0) as total_cif_sum, COALESCE(AVG(total_cif), 0) as promedio_cif, COALESCE(SUM(total_fob), 0) as total_fob_sum, COALESCE(SUM(total_peso_bruto), 0) as total_kilos, COALESCE(SUM(valor_flete), 0) as total_flete, COALESCE(SUM(valor_seguro), 0) as total_seguro FROM out_despacho_fguerra ${whereClause}`,
      params
    );

    // Por mes
    const porMes = await query<Record<string, unknown>[]>(
      `SELECT DATE_FORMAT(fecha_aceptacion, '%Y-%m') as mes, COUNT(*) as cantidad, COALESCE(SUM(total_cif), 0) as cif_mes, COALESCE(SUM(total_fob), 0) as fob_mes, COALESCE(SUM(total_peso_bruto), 0) as kilos_mes FROM out_despacho_fguerra ${whereClause} GROUP BY mes ORDER BY mes`,
      params
    );

    // Por tipo de operación: 3 dimensiones
    const porOperacion = await query<Record<string, unknown>[]>(
      `SELECT operacion, COUNT(*) as cantidad, COALESCE(SUM(total_cif), 0) as cif_total, COALESCE(SUM(total_peso_bruto), 0) as peso_total FROM out_despacho_fguerra ${whereClause} GROUP BY operacion ORDER BY cantidad DESC`,
      params
    );

    // Por país origen: 3 dimensiones
    const porPaisOrigen = await query<Record<string, unknown>[]>(
      `SELECT pais_origen_mercancias as pais, COUNT(*) as cantidad, COALESCE(SUM(total_cif), 0) as cif_total, COALESCE(SUM(total_peso_bruto), 0) as peso_total FROM out_despacho_fguerra ${whereClause} GROUP BY pais_origen_mercancias ORDER BY cif_total DESC LIMIT 10`,
      params
    );

    // Por aduana: 3 dimensiones
    const porAduana = await query<Record<string, unknown>[]>(
      `SELECT aduana, COUNT(*) as cantidad, COALESCE(SUM(total_cif), 0) as cif_total, COALESCE(SUM(total_peso_bruto), 0) as peso_total FROM out_despacho_fguerra ${whereClause} GROUP BY aduana ORDER BY cantidad DESC`,
      params
    );

    // Por incoterms: 3 dimensiones
    const porIncoterms = await query<Record<string, unknown>[]>(
      `SELECT clausula_venta_incoterms as incoterm, COUNT(*) as cantidad, COALESCE(SUM(total_cif), 0) as cif_total, COALESCE(SUM(total_peso_bruto), 0) as peso_total FROM out_despacho_fguerra ${whereClause} GROUP BY clausula_venta_incoterms ORDER BY cantidad DESC LIMIT 10`,
      params
    );

    // Por emisor documento transporte
    const porEmisor = await query<Record<string, unknown>[]>(
      `SELECT emisor_docto_transporte as emisor, COUNT(*) as cantidad, COALESCE(SUM(total_peso_bruto), 0) as kilos, COALESCE(SUM(valor_flete), 0) as flete FROM out_despacho_fguerra ${whereClause} GROUP BY emisor_docto_transporte ORDER BY cantidad DESC`,
      params
    );

    return NextResponse.json({
      totals: totals ?? {},
      porMes,
      porOperacion,
      porPaisOrigen,
      porAduana,
      porIncoterms,
      porEmisor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Import stats query error:", message);
    return NextResponse.json(
      { error: "Error al consultar estadísticas de importaciones." },
      { status: 500 }
    );
  }
}
