import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { docId } = await req.json();
  if (!docId) return NextResponse.json({ error: "docId requerido." }, { status: 400 });

  const shipsgoToken = process.env.SHIPSGO_API_KEY;
  if (!shipsgoToken) return NextResponse.json({ error: "SHIPSGO_API_KEY no configurada." }, { status: 500 });

  // Obtener shipsgo_id del documento
  const docs = await pgQuery<{ shipsgo_id: number; datos_extraidos: string; datos_extraidos_claude: string }>(
    "SELECT shipsgo_id, datos_extraidos, datos_extraidos_claude FROM documentos WHERE id = $1 AND rut_cliente = $2",
    [docId, session.rut]
  );

  if (!docs[0]) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });

  let shipsgoId = docs[0].shipsgo_id;

  // Si no tiene shipsgo_id, intentar crear
  if (!shipsgoId) {
    const datos = typeof docs[0].datos_extraidos === "string" ? JSON.parse(docs[0].datos_extraidos) : docs[0].datos_extraidos;
    const blNumber = datos?.numero_bl;
    if (!blNumber) return NextResponse.json({ error: "No se encontró número de BL." }, { status: 400 });

    const createRes = await fetch("https://api.shipsgo.com/v2/ocean/shipments", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shipsgo-User-Token": shipsgoToken },
      body: JSON.stringify({ booking_number: blNumber }),
    });
    const createJson = await createRes.json();
    if (createRes.status === 200 || createRes.status === 409) {
      shipsgoId = createJson.shipment?.id;
      await pgQuery("UPDATE documentos SET shipsgo_id = $1 WHERE id = $2", [shipsgoId, docId]);
    } else {
      return NextResponse.json({ error: createJson.message || "Error ShipsGo." }, { status: 400 });
    }
  }

  // Consultar detalles
  const detailRes = await fetch(`https://api.shipsgo.com/v2/ocean/shipments/${shipsgoId}`, {
    headers: { "X-Shipsgo-User-Token": shipsgoToken },
  });

  if (!detailRes.ok) {
    return NextResponse.json({ error: "Error al consultar ShipsGo." }, { status: 500 });
  }

  const detailJson = await detailRes.json();
  const shipsgoData = detailJson.shipment || {};

  // Guardar en BD
  await pgQuery("UPDATE documentos SET datos_shipsgo = $1 WHERE id = $2", [JSON.stringify(shipsgoData), docId]);

  // Corregir contenedores en GPT y Claude si difieren con ShipsGo
  const sgContainers = (shipsgoData.containers || []) as Array<{ number: string }>;
  if (sgContainers.length > 0) {
    const datos = typeof docs[0].datos_extraidos === "string" ? JSON.parse(docs[0].datos_extraidos) : docs[0].datos_extraidos;
    const datosClaude = typeof (docs[0] as Record<string, unknown>).datos_extraidos_claude === "string" 
      ? JSON.parse((docs[0] as Record<string, unknown>).datos_extraidos_claude as string || "{}") 
      : ((docs[0] as Record<string, unknown>).datos_extraidos_claude || {});

    // Función de similitud
    const similarity = (a: string, b: string) => {
      if (!a || !b) return 0;
      let match = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i++) { if (a[i] === b[i]) match++; }
      return match / Math.max(a.length, b.length);
    };

    // Corregir GPT
    if (Array.isArray(datos.contenedores)) {
      let changed = false;
      datos.contenedores = datos.contenedores.map((c: Record<string, unknown>) => {
        const nr = String(c.numero_contenedor || "");
        const sgMatch = sgContainers.find(sg => similarity(sg.number, nr) > 0.7);
        if (sgMatch && sgMatch.number !== nr) {
          changed = true;
          return { ...c, numero_contenedor: sgMatch.number, numero_contenedor_original_gpt: nr, _corregido_shipsgo: true };
        }
        return c;
      });
      if (changed) {
        await pgQuery("UPDATE documentos SET datos_extraidos = $1 WHERE id = $2", [JSON.stringify(datos), docId]);
      }
    }

    // Corregir Claude
    if (Array.isArray((datosClaude as Record<string, unknown>).contenedores)) {
      let changed = false;
      (datosClaude as Record<string, unknown>).contenedores = ((datosClaude as Record<string, unknown>).contenedores as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => {
        const nr = String(c.numero_contenedor || "");
        const sgMatch = sgContainers.find(sg => similarity(sg.number, nr) > 0.7);
        if (sgMatch && sgMatch.number !== nr) {
          changed = true;
          return { ...c, numero_contenedor: sgMatch.number, numero_contenedor_original_claude: nr, _corregido_shipsgo: true };
        }
        return c;
      });
      if (changed) {
        await pgQuery("UPDATE documentos SET datos_extraidos_claude = $1 WHERE id = $2", [JSON.stringify(datosClaude), docId]);
      }
    }

    // Corregir puerto de transbordo con ShipsGo
    const sgShipment = shipsgoData as Record<string, unknown>;
    const sgRoute = sgShipment.route as Record<string, unknown> | undefined;
    if (sgRoute && Number(sgRoute.ts_count) > 0) {
      const firstContainer = sgContainers[0] as unknown as Record<string, unknown>;
      const movements = ((firstContainer as Record<string, unknown>)?.movements || []) as Array<Record<string, unknown>>;
      const tsMovement = movements.find(m => m.event === "DSCH" || m.event === "LOAD");
      const tsLoc = tsMovement?.location as Record<string, unknown> | undefined;
      const sgTransbordoPort = tsLoc?.name ? String(tsLoc.name) : "";

      if (sgTransbordoPort) {
        // Corregir en GPT
        if (datos.puerto_transbordo && String(datos.puerto_transbordo).toUpperCase() !== sgTransbordoPort.toUpperCase()) {
          datos.puerto_transbordo_original = datos.puerto_transbordo;
          datos.puerto_transbordo = sgTransbordoPort;
          datos._transbordo_corregido_shipsgo = true;
          await pgQuery("UPDATE documentos SET datos_extraidos = $1 WHERE id = $2", [JSON.stringify(datos), docId]);
        }
        // Corregir en Claude
        if ((datosClaude as Record<string, unknown>).puerto_transbordo && String((datosClaude as Record<string, unknown>).puerto_transbordo).toUpperCase() !== sgTransbordoPort.toUpperCase()) {
          (datosClaude as Record<string, unknown>).puerto_transbordo_original = (datosClaude as Record<string, unknown>).puerto_transbordo;
          (datosClaude as Record<string, unknown>).puerto_transbordo = sgTransbordoPort;
          (datosClaude as Record<string, unknown>)._transbordo_corregido_shipsgo = true;
          await pgQuery("UPDATE documentos SET datos_extraidos_claude = $1 WHERE id = $2", [JSON.stringify(datosClaude), docId]);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, shipsgo: shipsgoData });
}
