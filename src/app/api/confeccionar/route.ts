import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { confeccionarDIN } from "@/lib/confeccionar-din";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/confeccionar
 * Body: { nro_operacion: string }
 * 
 * Valida que la operación tenga al menos BL corregido + Factura.
 * Si es válida, ejecuta la confección de DIN en AduanaNet.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  // Obtener documentos de la operación
  const docs = await pgQuery<{
    id: number;
    tipo_documento: string;
    datos_extraidos: string | Record<string, unknown>;
    datos_extraidos_claude?: string | Record<string, unknown>;
    datos_shipsgo?: string | Record<string, unknown>;
  }>(
    "SELECT id, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo FROM documentos WHERE nro_operacion = $1",
    [nro_operacion]
  );

  if (docs.length === 0) {
    return NextResponse.json({ error: "No se encontraron documentos para esta operación." }, { status: 400 });
  }

  // Verificar documentos mínimos: BL+Factura (marítimo) o CRT+Factura (terrestre)
  const tiposPresentes = docs.map(d => d.tipo_documento);
  const tieneBL = tiposPresentes.includes("Bill of Lading (BL)");
  const tieneCRT = tiposPresentes.includes("Carta de Porte Internacional (CRT)");
  const tieneMIC = tiposPresentes.includes("MIC/DTA");
  const tieneFactura = tiposPresentes.includes("Invoice (Factura Comercial)");
  const esTerrestre = (tieneCRT || tieneMIC) && !tieneBL;

  if (!tieneFactura) {
    return NextResponse.json({ error: "Falta la Factura Comercial para confeccionar." }, { status: 400 });
  }

  if (!tieneBL && !tieneCRT && !tieneMIC) {
    return NextResponse.json({ error: "Falta el documento de transporte (BL o CRT) para confeccionar." }, { status: 400 });
  }

  // Para marítimo: verificar que el BL esté corregido
  if (!esTerrestre) {
    const blDoc = docs.find(d => d.tipo_documento === "Bill of Lading (BL)");
    const blDatos = typeof blDoc!.datos_extraidos === "string"
      ? JSON.parse(blDoc!.datos_extraidos)
      : blDoc!.datos_extraidos;

    const blCorregido = blDatos._nave_corregida_shipsgo
      || blDatos.nave_corregida
      || blDatos.viaje_corregido
      || blDoc!.datos_shipsgo;

    if (!blCorregido) {
      return NextResponse.json({
        error: "El BL no está corregido. Debe tener datos de ShipsGo (nave/viaje corregido) antes de confeccionar.",
      }, { status: 400 });
    }
  }

  // Ejecutar confección
  try {
    const resultado = await confeccionarDIN(nro_operacion, docs);

    // Marcar operación como confeccionada
    await pgQuery(
      "UPDATE operaciones SET estado = 'confeccionada', fecha_confeccion = NOW(), updated_at = NOW() WHERE nro_operacion = $1",
      [nro_operacion]
    );

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[confeccionar] Error:", msg);
    return NextResponse.json({ error: `Error en confección: ${msg}` }, { status: 500 });
  }
}
