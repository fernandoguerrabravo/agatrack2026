import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import {
  crearConsentimiento, obtenerConsentimiento, revocarConsentimiento,
  consentimientoVigente, listarConsentimientosPorRut,
  crearArsop, TIPOS_ARSOP, auditLog,
} from "@/lib/consentimiento";
import { hashIp } from "@/lib/consentimiento/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/consentimiento
 * - Sin params: devuelve estado del consentimiento del usuario logueado
 * - ?finalidades=true: devuelve las finalidades activas
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { searchParams } = new URL(request.url);

  if (searchParams.get("finalidades") === "true") {
    const rows = await pgQuery<{ codigo: string; nombre: string; descripcion: string }>(
      "SELECT codigo, nombre, descripcion FROM finalidades WHERE activa = true ORDER BY id"
    );
    return NextResponse.json({ finalidades: rows });
  }

  // Estado del consentimiento del usuario
  const vigente = await consentimientoVigente(session.rut);
  const consentimientos = await listarConsentimientosPorRut(session.rut);
  return NextResponse.json({ vigente, consentimientos });
}

/**
 * POST /api/consentimiento
 * Body: { accion: "otorgar" | "revocar" | "arsop", ... }
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const body = await request.json();
  const { accion } = body;
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const ipH = hashIp(ip);

  if (accion === "otorgar") {
    const { finalidades } = body;
    if (!finalidades || !Array.isArray(finalidades) || finalidades.length === 0) {
      return NextResponse.json({ error: "Selecciona al menos una finalidad." }, { status: 400 });
    }
    const resultado = await crearConsentimiento({
      nombre: session.nombre,
      rut: session.rut,
      email: session.email,
      finalidades,
      ipHash: ipH,
      userAgent: request.headers.get("user-agent") || undefined,
    });
    await auditLog({ accion: "consentimiento.otorgado", entidad: "consentimiento", entidadId: resultado.folio, actor: session.email, detalle: `finalidades=${finalidades.join(",")}`, ipHash: ipH });
    return NextResponse.json({ ok: true, ...resultado });
  }

  if (accion === "revocar") {
    const { folio } = body;
    if (!folio) return NextResponse.json({ error: "Folio requerido." }, { status: 400 });
    const ok = await revocarConsentimiento(folio, session.rut);
    await auditLog({ accion: ok ? "consentimiento.revocado" : "consentimiento.revocar_fallido", entidad: "consentimiento", entidadId: folio, actor: session.email, ipHash: ipH });
    return NextResponse.json({ ok });
  }

  if (accion === "arsop") {
    const { tipo, detalle } = body;
    if (!tipo || !TIPOS_ARSOP[tipo]) return NextResponse.json({ error: "Tipo de derecho inválido." }, { status: 400 });
    const resultado = await crearArsop({ tipo, nombre: session.nombre, rut: session.rut, email: session.email, detalle, ipHash: ipH });
    await auditLog({ accion: "arsop.recibida", entidad: "arsop", entidadId: resultado.folio, actor: session.email, detalle: `tipo=${tipo}`, ipHash: ipH });
    return NextResponse.json({ ok: true, ...resultado });
  }

  return NextResponse.json({ error: "Acción no reconocida." }, { status: 400 });
}
