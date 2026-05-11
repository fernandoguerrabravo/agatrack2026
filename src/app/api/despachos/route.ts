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

// Campos a excluir de la respuesta
const EXCLUDED_FIELDS = new Set([
  "lbac_nid",
  "resolucion",
  "dus_tipo_envio",
  "fecha_vencto",
  "aforo",
  "eta",
  "parcial",
  "nro_parcial",
  "total_parciales",
  "seguro_teorico",
  "valor_seguro",
  "flete_teorico",
  "total_cif",
  "identificacion_bultos",
  "observaciones_bco_central",
  "signo_ajuste",
  "total_ajuste",
  "valor_exfabrica",
  "gastos_hasta_fob",
  "paridad",
  "total_peso_neto",
  "estimacion_peso",
  "pais_adquisicion_mercancias",
  "pais_origen_mercancias",
  "fecha_manifiesto",
  "manifiesto_1",
  "manifiesto_2",
  "almacenista",
  "fecha_recepcion_almacenista",
  "fecha_retiro_almacenista",
  "transbordo",
  "documento_transporte",
  "fecha_docto_transporte_din",
  "certificado_isp",
  "certificado_sesma",
  "regla_vb_codigo",
  "regla_vb_numero",
  "regla_vb_agno",
  "registro_reconoc_parte1",
  "registro_reconoc_parte2",
  "tipo_rut",
  "direccion_cliente",
  "comuna",
  "representante_legal",
  "representante_legal_rut",
  "consignante_direccion",
  "pais_consignante",
  "nid_regimen_suspensivo",
  "fecha_nid_reg_susp",
  "aduana_reg_suspensivo",
  "plazo_vigencia_reg_sup",
  "direccion_almacenamiento_reg_susp",
  "comuna_almacen_reg_susp",
  "aduana_control_reg_susp",
  "moneda_export",
  "valor_clausula_venta",
  "modalidad_venta",
  "comisiones_exterior",
  "clausula_venta_incoterms",
  "otros_gtos_deducibles",
  "forma_pago_export",
  "valor_liquido_retorno",
  "forma_pago_gravamenes",
  "regimen",
  "valor_ex_fabrica",
  "gtos_hta_fob",
  "moneda_import",
  "gravamenes_codigo_1",
  "gravamenes_valor_1",
  "gravamenes_codigo_2",
  "gravamenes_valor_2",
  "gravamenes_codigo_3",
  "gravamenes_valor_3",
  "gravamenes_codigo_4",
  "gravamenes_valor_4",
  "gravamenes_codigo_5",
  "gravamenes_valor_5",
  "gravamenes_codigo_6",
  "gravamenes_valor_6",
  "gravamenes_codigo_7",
  "gravamenes_valor_7",
  "gravamenes_codigo_8",
  "gravamenes_valor_8",
  "iva",
  "total_gravamenes_uss",
  "tipo_cambio",
  "total_gravamenes_chs",
  "nro_item",
  "descripcion_item_1",
  "codigo_arancel_tratado_item_1",
  "codigo_arancel_item_2",
  "nro_secuencia",
  "nro_docto_transporte",
  "fecha_docto_transporte",
  "fecha_hora_ingreso_despacho",
  "estado",
  "anulado",
  "fecha_pago_gravamenes",
  "nro_apertura_carpeta",
  "guia_despacho",
  "bulto_cod_tipo",
  "fecha_carga_data",
  "url_dte",
  "factura_despacho",
  "url_factura",
  "bulto_cantidad",
  "bulto_glosa",
  "rut_cliente",
  "cliente",
  "total_itemes",
  "tipo_carga",
  "dus_observaciones",
  "nro_aceptacion",
  "region_origen",
  "via",
  "puerto_desembarque",
  "pais_cia_transportadora",
  "nave",
  "nro_viaje",
]);

function filterRow(row: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (!EXCLUDED_FIELDS.has(key)) {
      filtered[key] = row[key];
    }
  }
  return filtered;
}

export async function GET(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const rut = session.rut;

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  try {
    const placeholders = OPERACIONES.map(() => "?").join(",");
    let sql = `SELECT * FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ?`;
    const params: (string | number)[] = [...OPERACIONES, rut];

    if (desde) {
      sql += " AND fecha_aceptacion >= ?";
      params.push(desde);
    }

    if (hasta) {
      sql += " AND fecha_aceptacion <= ?";
      params.push(hasta);
    }

    sql += " ORDER BY fecha_aceptacion DESC";

    const rows = await query<Record<string, unknown>[]>(sql, params);
    const filtered = rows.map(filterRow);

    return NextResponse.json({ data: filtered });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Despachos query error:", message);
    return NextResponse.json(
      { error: "Error al consultar despachos." },
      { status: 500 }
    );
  }
}
