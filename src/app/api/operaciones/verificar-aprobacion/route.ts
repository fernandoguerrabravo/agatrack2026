import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ⛔ Correos automáticos de aprobación + auto-provisión deshabilitados (2026-07-21).
// Cambiar a true para reactivar el envío automático.
const ENVIAR_CORREOS_APROBACION = false;

/**
 * POST /api/operaciones/verificar-aprobacion
 * Body: { nro_operacion: string } o sin body para verificar todas las confeccionadas
 * 
 * Consulta AduanaNet lista de DIN terminadas para verificar si la operación fue aprobada.
 * Si fue aprobada, actualiza el estado a "aprobada" con el nro_aceptacion y fecha.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { nro_operacion } = body;

  // Obtener operaciones que necesitan verificación (no aprobadas ni cerradas)
  let operaciones: Array<{ nro_operacion: string }>;
  if (nro_operacion) {
    operaciones = [{ nro_operacion }];
  } else {
    operaciones = await pgQuery<{ nro_operacion: string }>(
      "SELECT nro_operacion FROM operaciones WHERE estado NOT IN ('aprobada', 'cerrada')"
    );
  }

  if (operaciones.length === 0) {
    return NextResponse.json({ ok: true, verificadas: 0, aprobadas: [] });
  }

  const aprobadas: Array<{ nro_operacion: string; nro_aceptacion: string; fecha_aceptacion: string }> = [];

  // Fuente ÚNICA de verdad: despachos_replica con estado 'C' (Cursada/legalizada) = APROBADO.
  // estado 'I' (Ingresada) = DIN presentada pero en trámite / no legalizada → NO aprobar.
  // Se ELIMINÓ el fallback contra la lista de DIN terminadas de AduanaNet porque su parseo
  // marcaba como aprobados despachos que no lo estaban (extraía cualquier número como
  // nro_aceptación) y enviaba correos de "Despacho Aprobado" a operaciones aún en trámite,
  // incluso a despachos que ni siquiera existen en la réplica.
  const nros = operaciones.map(o => o.nro_operacion);
  const replicaRows = await pgQuery<{ despacho: string; nro_aceptacion: string; fecha_aceptacion: string; estado: string }>(
    `SELECT despacho, nro_aceptacion, fecha_aceptacion, estado FROM despachos_replica WHERE despacho = ANY($1) AND estado = 'C'`,
    [nros]
  );
  const replicaAprobadas = replicaRows;
  for (const ap of replicaAprobadas) {
    aprobadas.push({
      nro_operacion: ap.despacho,
      nro_aceptacion: ap.nro_aceptacion || "",
      fecha_aceptacion: ap.fecha_aceptacion ? new Date(ap.fecha_aceptacion).toLocaleDateString("es-CL") : "",
    });
    const updated = await pgQuery<{ rut_cliente: string; notas: string }>(
      `UPDATE operaciones SET estado = 'aprobada', fecha_cierre = NOW(), updated_at = NOW(),
       notas = COALESCE(notas, '') || $1
       WHERE nro_operacion = $2 AND estado != 'aprobada' RETURNING rut_cliente, notas`,
      [`\nAprobada (replica): ${ap.nro_aceptacion}`, ap.despacho]
    );

    // Si se actualizó (no era ya aprobada), enviar correo + provisión.
    // ⛔ Correos automáticos + auto-provisión DESHABILITADOS (2026-07-21):
    // poner ENVIAR_CORREOS_APROBACION en true para reactivar.
    if (updated.length > 0 && ENVIAR_CORREOS_APROBACION) {
      const rutCliente = updated[0].rut_cliente || "";
      const notas = updated[0].notas || "";
      const refMatch = notas.match(/ref:\s*([^\s|\n]+)/i);
      const referencia = refMatch ? refMatch[1] : "";
      const fecha = ap.fecha_aceptacion ? new Date(ap.fecha_aceptacion).toLocaleDateString("es-CL") : "";

      // Enviar correo aprobación
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const { emailsEjecutivosCliente } = await import("@/lib/permisos");
        const ccEmails = await emailsEjecutivosCliente(rutCliente);

        await resend.emails.send({
          from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
          to: ["oscar@agenciaguerra.com", "pbalmaceda@agenciaguerra.com", "daviles@agenciaguerra.com", "transmision@agenciaguerra.com", "comercial@agenciaguerra.com", "fguerrab@agenciaguerra.com"],
          cc: ccEmails.length > 0 ? ccEmails : undefined,
          subject: `✅ Despacho Aprobado ${ap.despacho} - Aceptación: ${ap.nro_aceptacion} - ${fecha}${referencia ? " - REF: " + referencia : ""}`,
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;"><p>Estimados,</p><p>El despacho <b>${ap.despacho}</b> ha sido <span style="color:#16a34a;font-weight:bold;">APROBADO</span>.</p><table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;"><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${ap.despacho}</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Aceptación</td><td style="padding:8px 12px;border:1px solid #ddd;">${ap.nro_aceptacion}</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Fecha</td><td style="padding:8px 12px;border:1px solid #ddd;">${fecha}</td></tr>${referencia ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>` : ""}</table><p style="color:#666;font-size:12px;">Notificación automática de AgaTrack.</p></div>`,
        });
      } catch (emailErr) {
        console.error("[verificar] Error email aprobación:", emailErr instanceof Error ? emailErr.message : emailErr);
      }

      // Auto-provisión para Petroquímica
      if (rutCliente === "92933000-5") {
        fetch(`http://localhost:${process.env.PORT || 3000}/api/operaciones/provision-fondos`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-inbound-secret": process.env.INBOUND_SECRET || "" },
          body: JSON.stringify({ nro_operacion: ap.despacho }),
        }).catch(err => console.error("[verificar] Error auto-provisión:", err));
      }
    }
  }

  // NOTA: Se eliminó el fallback que consultaba la lista de DIN terminadas de AduanaNet.
  // Ese parseo marcaba como aprobados despachos en trámite (e incluso inexistentes en la
  // réplica), enviando correos de "Despacho Aprobado" y disparando provisiones indebidas.
  // La réplica (estado 'C') es ahora la única fuente de aprobación.

  return NextResponse.json({
    ok: true,
    verificadas: operaciones.length,
    aprobadas,
  });
}
