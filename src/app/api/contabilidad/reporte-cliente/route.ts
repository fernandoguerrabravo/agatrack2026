import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/contabilidad/reporte-cliente?cliente=ANGLO AMERICAN
 * 
 * Genera Excel con reporte mensual (mes actual) para un cliente.
 * Campos: Referencia, Proveedor, Nro Aceptación, Fecha Pago TGR,
 * CIF+Derechos CLP, Derechos CLP, Total Pagado CLP, Tipo Cambio,
 * CIF+Derechos USD, IVA USD, Derechos USD, Total Impuestos USD,
 * Valor FOB, País Origen, Mercadería
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const cliente = searchParams.get("cliente") || "ANGLO AMERICAN";

  // Mes actual
  const now = new Date();
  const mesInicio = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const mesFin = `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, "0")}-01`;

  try {
    const rows = await pgQuery<Record<string, string>>(
      `SELECT 
        dr.referencia,
        dr.consignante,
        dr.nro_aceptacion,
        dr.fecha_pago_gravamenes,
        dr.total_cif,
        dr.gravamenes_valor_1,
        dr.iva,
        dr.total_gravamenes_chs,
        dr.tipo_cambio,
        dr.total_fob,
        dr.pais_origen_mercancias,
        dr.descripcion_item_1
      FROM despachos_replica dr
      WHERE UPPER(dr.cliente) LIKE $1
        AND dr.fecha_aceptacion >= $2
        AND dr.fecha_aceptacion < $3
        AND dr.dus_tipo_envio NOT IN ('EXPO', 'SALIDA')
      ORDER BY dr.fecha_aceptacion`,
      [`%${cliente.toUpperCase()}%`, mesInicio, mesFin]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Sin datos para el período" }, { status: 404 });
    }

    // Construir datos del Excel
    const data = rows.map(r => {
      const cif = parseFloat(r.total_cif || "0");
      const derechosCLP = parseFloat(r.gravamenes_valor_1 || "0");
      const iva = parseFloat(r.iva || "0");
      const totalGravCLP = parseFloat(r.total_gravamenes_chs || "0");
      const tc = parseFloat(r.tipo_cambio || "1");
      const fob = parseFloat(r.total_fob || "0");

      // Calcular valores USD
      const cifDerechosCLP = cif * tc + derechosCLP;
      const derechosUSD = tc > 0 ? derechosCLP / tc : 0;
      const ivaUSD = tc > 0 ? iva / tc : 0;
      const cifDerechosUSD = cif + derechosUSD;
      const totalImpuestosUSD = ivaUSD + derechosUSD;

      return {
        "Referencia": r.referencia || "",
        "Proveedor": r.consignante || "",
        "Nro Aceptación": r.nro_aceptacion || "",
        "Fecha Pago TGR": r.fecha_pago_gravamenes || "",
        "CIF + Derechos CLP": Math.round(cifDerechosCLP),
        "Derechos CLP": Math.round(derechosCLP),
        "Total Pagado CLP": Math.round(totalGravCLP),
        "Tipo Cambio": tc,
        "CIF + Derechos USD": Math.round(cifDerechosUSD * 100) / 100,
        "IVA USD": Math.round(ivaUSD * 100) / 100,
        "Derechos USD": Math.round(derechosUSD * 100) / 100,
        "Total Impuestos USD": Math.round(totalImpuestosUSD * 100) / 100,
        "Valor FOB": fob,
        "País Origen": r.pais_origen_mercancias || "",
        "Mercadería": r.descripcion_item_1 || "",
      };
    });

    // Generar Excel
    const ws = XLSX.utils.json_to_sheet(data);

    // Ajustar ancho de columnas
    ws["!cols"] = [
      { wch: 15 }, // Referencia
      { wch: 30 }, // Proveedor
      { wch: 14 }, // Nro Aceptación
      { wch: 14 }, // Fecha Pago
      { wch: 18 }, // CIF+Derechos CLP
      { wch: 14 }, // Derechos CLP
      { wch: 16 }, // Total Pagado CLP
      { wch: 12 }, // T/C
      { wch: 18 }, // CIF+Derechos USD
      { wch: 12 }, // IVA USD
      { wch: 14 }, // Derechos USD
      { wch: 18 }, // Total Impuestos USD
      { wch: 12 }, // Valor FOB
      { wch: 15 }, // País Origen
      { wch: 40 }, // Mercadería
    ];

    const wb = XLSX.utils.book_new();
    const mesNombre = now.toLocaleDateString("es-CL", { month: "long", year: "numeric" });
    XLSX.utils.book_append_sheet(wb, ws, mesNombre);

    const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `Reporte_${cliente.replace(/\s+/g, "_")}_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}.xlsx`;

    return new NextResponse(excelBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
