import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listarConsentimientos, listarArsop, responderArsop, verificarCadena, listarBloques, auditLog } from "@/lib/consentimiento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/consentimiento/admin?tipo=consentimientos|arsop|cadena|bloques
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tipo = searchParams.get("tipo") || "consentimientos";
  const page = parseInt(searchParams.get("page") || "1");

  if (tipo === "consentimientos") {
    const data = await listarConsentimientos(page);
    return NextResponse.json(data);
  }

  if (tipo === "arsop") {
    const data = await listarArsop(page);
    return NextResponse.json(data);
  }

  if (tipo === "cadena") {
    const result = await verificarCadena();
    return NextResponse.json(result);
  }

  if (tipo === "bloques") {
    const bloques = await listarBloques(50);
    return NextResponse.json({ bloques });
  }

  if (tipo === "audit") {
    const { pgQuery } = await import("@/lib/postgres");
    const items = await pgQuery("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100");
    return NextResponse.json({ items });
  }

  return NextResponse.json({ error: "Tipo no reconocido" }, { status: 400 });
}

/**
 * POST /api/consentimiento/admin
 * Body: { accion: "responder_arsop", folio, respuesta }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.rol !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { accion, folio, respuesta } = await request.json();

  if (accion === "responder_arsop") {
    if (!folio || !respuesta) return NextResponse.json({ error: "Folio y respuesta requeridos." }, { status: 400 });
    await responderArsop(folio, respuesta);
    await auditLog({ accion: "arsop.respondida", entidad: "arsop", entidadId: folio, actor: session.email, detalle: respuesta.substring(0, 100) });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
}
