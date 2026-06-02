import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { guardarEjemploBL } from "@/lib/bl-ejemplos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { docId, fleteTotal } = await req.json();
  if (!docId || fleteTotal === undefined) return NextResponse.json({ error: "docId y fleteTotal requeridos." }, { status: 400 });

  // Obtener documento
  const docs = await pgQuery<{ datos_extraidos: string; datos_extraidos_claude: string }>(
    "SELECT datos_extraidos, datos_extraidos_claude FROM documentos WHERE id = $1 AND rut_cliente = $2",
    [docId, session.rut]
  );

  if (!docs[0]) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });

  // Actualizar flete en datos_extraidos (GPT/combinado)
  const datosGpt = typeof docs[0].datos_extraidos === "string" ? JSON.parse(docs[0].datos_extraidos || "{}") : docs[0].datos_extraidos;
  datosGpt.flete_total_prepaid = fleteTotal;
  datosGpt.flete_aprobado = true;
  datosGpt.flete_aprobado_por = session.email;
  datosGpt.flete_aprobado_fecha = new Date().toISOString();

  // Actualizar flete en datos_extraidos_claude
  const datosClaude = typeof docs[0].datos_extraidos_claude === "string" ? JSON.parse(docs[0].datos_extraidos_claude || "{}") : docs[0].datos_extraidos_claude;
  datosClaude.flete_total_prepaid = fleteTotal;
  datosClaude.flete_aprobado = true;

  await pgQuery(
    "UPDATE documentos SET datos_extraidos = $1, datos_extraidos_claude = $2 WHERE id = $3",
    [JSON.stringify(datosGpt), JSON.stringify(datosClaude), docId]
  );

  // Guardar como ejemplo VERIFICADO (flete aprobado manualmente = alta confianza)
  try {
    await guardarEjemploBL(session.rut, datosGpt, "flete_aprobado", false);
  } catch (err) {
    console.error("[update-flete] Error guardando ejemplo:", err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true });
}
