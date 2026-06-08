import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { enviarEmailSolicitudTTE } from "@/lib/email-solicitud-tte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/operaciones/enviar-tte
 * Body: { nro_operacion: string }
 * 
 * Envía email de solicitud de transporte terrestre y cambia estado a "tte_enviado"
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (session.rol === "cliente") {
    return NextResponse.json({ error: "Sin permisos." }, { status: 403 });
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  // Enviar email
  const result = await enviarEmailSolicitudTTE(nro_operacion);

  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Error al enviar email" }, { status: 500 });
  }

  // Actualizar estado
  await pgQuery(
    "UPDATE operaciones SET estado = 'tte_enviado', updated_at = NOW() WHERE nro_operacion = $1",
    [nro_operacion]
  );

  return NextResponse.json({ ok: true });
}
