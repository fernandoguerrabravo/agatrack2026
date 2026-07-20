import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/contabilidad/despachos?tipo=impo|expo
 *
 * - tipo=impo (default): importaciones aprobadas desde el 15 de junio 2026.
 * - tipo=expo: exportaciones y operaciones de salida desde el 1 de enero 2026.
 * Incluye datos de despachos_replica + tgr_url de operaciones.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const tipo = new URL(request.url).searchParams.get("tipo") === "expo" ? "expo" : "impo";
  const filtroTipo = tipo === "expo"
    ? `dr.fecha_aceptacion >= '2026-01-01'
        AND (dr.dus_tipo_envio IN ('EXPO', 'SALIDA') OR dr.operacion ILIKE '%EXPORT%' OR dr.operacion ILIKE '%SALIDA%')`
    : `dr.fecha_aceptacion >= '2026-06-15'
        AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
        AND dr.operacion NOT ILIKE '%EXPORT%'
        AND dr.operacion NOT ILIKE '%SALIDA%'`;

  try {
    const rows = await pgQuery<Record<string, string>>(
      `SELECT 
        dr.despacho, dr.nro_aceptacion, dr.fecha_aceptacion,
        dr.cliente, dr.rut_cliente, dr.referencia,
        dr.total_cif, dr.total_fob, dr.valor_flete, dr.valor_seguro,
        dr.iva, dr.gravamenes_valor_1, dr.total_gravamenes_chs, dr.tipo_cambio,
        dr.puerto_desembarque, dr.aduana, dr.via, dr.regimen, dr.operacion, dr.dus_tipo_envio,
        dr.url_factura, dr.url_dte, dr.url_despacho, dr.factura_despacho, dr.estado,
        dr.fecha_pago_gravamenes,
        o.notas
      FROM despachos_replica dr
      LEFT JOIN operaciones o ON dr.despacho = o.nro_operacion
      WHERE ${filtroTipo}
      ORDER BY dr.fecha_aceptacion DESC NULLS LAST`,
      []
    );

    const CLIENTES_PAGO_DIRECTO = ["KSB", "WIKA", "MICROGEO", "BROTHER", "SOUTHERN", "PETROQUIMICA", "CONINTER", "GLOBAL PARTNER", "EASY SUPPLY", "ANGLO", "ECOFOS"];

    const despachos = rows.map(r => ({
      ...r,
      tgr_url: r.notas?.match(/tgr_url:(https?:\/\/[^\s\n]+)/)?.[1] || null,
      pago_directo_url: r.notas?.match(/pago_directo_url:(https?:\/\/[^\s\n]+)/)?.[1] || null,
      dte_url_notas: r.notas?.match(/dte_url:(https?:\/\/[^\s\n]+)/)?.[1] || null,
      // url_factura: primero de despachos_replica, si no de notas
      url_factura_final: r.url_factura || r.notas?.match(/dte_url:(https?:\/\/[^\s\n]+)/)?.[1] || null,
      // Factura confeccionada en AduanaNet pero aún NO enviada al SII (revisión previa Petroquímica)
      factura_confeccionada: !!(r.notas && r.notas.includes("factura_confeccionada:")),
      es_pago_directo: CLIENTES_PAGO_DIRECTO.some(c => (r.cliente || "").toUpperCase().includes(c)),
      notas: undefined,
    }));

    return NextResponse.json({ despachos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
