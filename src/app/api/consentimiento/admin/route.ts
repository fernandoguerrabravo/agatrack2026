import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { listarConsentimientos, listarArsop, responderArsop, verificarCadena, listarBloques, auditLog, obtenerConsentimiento, historialFolio } from "@/lib/consentimiento";
import { listarAnclajes, sellarCabeza, actualizarPendientes, verificarAnclaje } from "@/lib/consentimiento/notarizacion";
import { generarEvidencia } from "@/lib/consentimiento/evidencia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/consentimiento/admin?tipo=consentimientos|arsop|cadena|bloques|anclajes|audit|evidencia|detalle
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

  if (tipo === "anclajes") {
    const anclajes = await listarAnclajes();
    return NextResponse.json({ anclajes });
  }

  if (tipo === "audit") {
    const items = await pgQuery("SELECT * FROM audit_log ORDER BY id DESC LIMIT 100");
    return NextResponse.json({ items });
  }

  if (tipo === "evidencia") {
    const folio = searchParams.get("folio");
    if (!folio) return NextResponse.json({ error: "Folio requerido" }, { status: 400 });
    const paquete = await generarEvidencia(folio);
    if (!paquete) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json(paquete);
  }

  if (tipo === "evidencia_json") {
    const folio = searchParams.get("folio");
    if (!folio) return NextResponse.json({ error: "Folio requerido" }, { status: 400 });
    const paquete = await generarEvidencia(folio);
    if (!paquete) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return new NextResponse(JSON.stringify(paquete, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="evidencia-${folio}.json"`,
      },
    });
  }

  if (tipo === "detalle") {
    const folio = searchParams.get("folio");
    if (!folio) return NextResponse.json({ error: "Folio requerido" }, { status: 400 });
    const c = await obtenerConsentimiento(folio);
    if (!c) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    const cadena = await historialFolio(folio);
    return NextResponse.json({ consentimiento: c, cadena });
  }

  if (tipo === "verificar_anclaje") {
    const id = parseInt(searchParams.get("id") || "0");
    if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });
    const result = await verificarAnclaje(id);
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Tipo no reconocido" }, { status: 400 });
}

/**
 * POST /api/consentimiento/admin
 * Body: { accion: "responder_arsop" | "sellar_cadena" | "actualizar_ots", ... }
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

  if (accion === "sellar_cadena") {
    try {
      const result = await sellarCabeza(session.email);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
    }
  }

  if (accion === "actualizar_ots") {
    const resultados = await actualizarPendientes(session.email);
    return NextResponse.json({ ok: true, resultados });
  }

  return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
}
