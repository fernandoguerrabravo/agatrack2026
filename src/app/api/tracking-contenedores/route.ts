import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHIPSGO_API_KEY = process.env.SHIPSGO_API_KEY || "";

/**
 * POST /api/tracking-contenedores
 * Body: { bl_number: string }
 * 
 * Busca el BL en ShipsGo. Si no existe lo crea y espera a que tenga datos.
 * Retorna la info del embarque.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { bl_number } = await request.json();
  if (!bl_number) {
    return NextResponse.json({ error: "Número de BL requerido." }, { status: 400 });
  }

  if (!SHIPSGO_API_KEY) {
    return NextResponse.json({ error: "API de tracking no configurada." }, { status: 500 });
  }

  try {
    // 1. Intentar crear/obtener el shipment
    const createRes = await fetch("https://api.shipsgo.com/v2/ocean/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shipsgo-User-Token": SHIPSGO_API_KEY },
      body: JSON.stringify({ booking_number: bl_number }),
    });
    const createJson = await createRes.json();

    let shipsgoId = createJson.shipment?.id;

    if (!shipsgoId) {
      return NextResponse.json({ error: createJson.message || "No se pudo registrar el BL." }, { status: 400 });
    }

    // 2. Consultar detalles (puede que tome unos segundos si es nuevo)
    let retries = 0;
    let shipsgoData = null;

    while (retries < 5) {
      const detailRes = await fetch(`https://api.shipsgo.com/v2/ocean/shipments/${shipsgoId}`, {
        headers: { "X-Shipsgo-User-Token": SHIPSGO_API_KEY },
      });

      if (detailRes.ok) {
        const detailJson = await detailRes.json();
        shipsgoData = detailJson.shipment || null;

        // Si tiene datos de ruta, ya está listo
        if (shipsgoData?.route?.port_of_loading || shipsgoData?.containers?.length > 0) {
          break;
        }
      }

      // Esperar 2 segundos antes de reintentar
      retries++;
      if (retries < 5) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!shipsgoData) {
      return NextResponse.json({ error: "BL registrado pero aún no hay datos disponibles. Intente de nuevo en unos minutos." }, { status: 202 });
    }

    return NextResponse.json({ ok: true, shipsgo: shipsgoData });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
