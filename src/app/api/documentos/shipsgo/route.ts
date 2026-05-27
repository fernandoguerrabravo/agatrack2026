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
  const docs = await pgQuery<{ shipsgo_id: number; datos_extraidos: string }>(
    "SELECT shipsgo_id, datos_extraidos FROM documentos WHERE id = $1 AND rut_cliente = $2",
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

  return NextResponse.json({ ok: true, shipsgo: shipsgoData });
}
