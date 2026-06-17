import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { aduananetLogin } from "@/lib/aduananet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

// Clientes para los que se crea pago directo automático
const CLIENTES_PAGO_DIRECTO = [
  "KSB", "WIKA", "MICROGEO", "BROTHER", "SOUTHERN TECHNOLOGY",
  "PETROQUIMICA", "CONINTER", "GLOBAL PARTNER", "EASY SUPPLY",
  "ANGLO AMERICAN", "ECOFOS",
];

/**
 * POST /api/operaciones/pago-directo
 * Body: { nro_operacion: string }
 * 
 * Crea el pago directo en AduanaNet para la operación.
 * 1. Ingresa nro operación en formulario.php campo "despacho" → click Ingresar
 * 2. Busca el comprobante en lista.php filtrado por lib_nid
 * 3. Obtiene el ID y guarda link al PDF
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    const inboundSecret = request.headers.get("x-inbound-secret");
    if (!inboundSecret || inboundSecret !== process.env.INBOUND_SECRET) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  try {
    const cookies = await aduananetLogin();

    // 1. Ingresar el despacho en el formulario de pago directo
    const formBody = new URLSearchParams();
    formBody.set("lib_nid", nro_operacion);
    formBody.set("accion", "I"); // Ingresar

    const formRes = await fetch(`${BASE_URL}/modulos/contabilidad/pago_directo/formulario.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: formBody.toString(),
      redirect: "follow",
    });
    const formHtml = await formRes.text();

    // Verificar si ya existe (AduanaNet muestra alert o mensaje)
    const yaExiste = formHtml.includes("ya fue") || formHtml.includes("ya existe") || formHtml.includes("alert(");
    if (yaExiste) {
      console.log(`[pago-directo] Comprobante ya existe para op ${nro_operacion}`);
    } else {
      console.log(`[pago-directo] Comprobante creado para op ${nro_operacion}`);
    }

    // 2. Buscar el comprobante en la lista filtrando por lib_nid
    const filterBody = new URLSearchParams();
    filterBody.set("accion", "F");
    filterBody.set("fil_lib_nid", nro_operacion);

    const listaRes = await fetch(`${BASE_URL}/modulos/contabilidad/pago_directo/lista.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
      body: filterBody.toString(),
    });
    const listaHtml = await listaRes.text();

    // 3. Extraer ID del comprobante (buscar patrón reporte(ID) o similar)
    const reporteIds = [...listaHtml.matchAll(/reporte\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    const verIds = [...listaHtml.matchAll(/ver\(\s*['"]?(\d+)['"]?\s*\)/gi)].map(m => Number(m[1]));
    const allIds = [...reporteIds, ...verIds];
    const comprobanteId = allIds.length > 0 ? Math.max(...allIds) : 0;

    let pdfUrl = "";
    if (comprobanteId) {
      pdfUrl = `${BASE_URL}/modulos/contabilidad/pago_directo/reporte_pdf.php?id=${comprobanteId}`;
      console.log(`[pago-directo] PDF: ${pdfUrl} (id=${comprobanteId})`);
    }

    // 4. Guardar en operaciones
    if (pdfUrl) {
      // Asegurar que la operación existe
      const drRows = await pgQuery<{ rut_cliente: string }>(
        "SELECT rut_cliente FROM despachos_replica WHERE despacho = $1 LIMIT 1",
        [nro_operacion]
      );
      const rutCliente = drRows[0]?.rut_cliente || "";
      await pgQuery(
        "INSERT INTO operaciones (nro_operacion, rut_cliente, estado) VALUES ($1, $2, 'aprobada') ON CONFLICT (nro_operacion) DO NOTHING",
        [nro_operacion, rutCliente]
      );
      await pgQuery(
        "UPDATE operaciones SET notas = COALESCE(notas, '') || $1, updated_at = NOW() WHERE nro_operacion = $2",
        [`\npago_directo_url:${pdfUrl}`, nro_operacion]
      );
    }

    return NextResponse.json({ ok: true, comprobante_id: comprobanteId, pdf_url: pdfUrl, ya_existia: yaExiste });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[pago-directo] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Verifica si un cliente está en la lista de pago directo automático.
 */
export function esClientePagoDirecto(clienteNombre: string): boolean {
  const upper = (clienteNombre || "").toUpperCase();
  return CLIENTES_PAGO_DIRECTO.some(c => upper.includes(c));
}
