import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/contabilidad/despachos
 * 
 * Retorna los despachos aprobados desde el 15 de junio 2026 para la vista de contabilidad.
 * Incluye datos de despachos_replica + tgr_url de operaciones.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const rows = await pgQuery<Record<string, string>>(
      `SELECT 
        dr.despacho, dr.nro_aceptacion, dr.fecha_aceptacion,
        dr.cliente, dr.rut_cliente, dr.referencia,
        dr.total_cif, dr.total_fob, dr.valor_flete, dr.valor_seguro,
        dr.iva, dr.gravamenes_valor_1, dr.total_gravamenes_chs, dr.tipo_cambio,
        dr.puerto_desembarque, dr.aduana, dr.via, dr.regimen,
        dr.url_factura, dr.url_dte, dr.url_despacho, dr.factura_despacho, dr.estado,
        dr.fecha_pago_gravamenes,
        o.notas
      FROM despachos_replica dr
      LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
      WHERE dr.fecha_aceptacion >= '2026-06-15'
        AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
        AND dr.operacion NOT ILIKE '%EXPORT%'
        AND dr.operacion NOT ILIKE '%SALIDA%'
      ORDER BY dr.fecha_aceptacion DESC`,
      []
    );

    const despachos = rows.map(r => ({
      ...r,
      tgr_url: r.notas?.match(/tgr_url:(https?:\/\/[^\s\n]+)/)?.[1] || null,
      notas: undefined,
    }));

    return NextResponse.json({ despachos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
