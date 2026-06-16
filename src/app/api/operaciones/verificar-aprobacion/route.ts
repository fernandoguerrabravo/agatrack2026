import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { aduananetLogin } from "@/lib/aduananet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

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

  const cookies = await aduananetLogin();
  const aprobadas: Array<{ nro_operacion: string; nro_aceptacion: string; fecha_aceptacion: string }> = [];

  // Primero verificar en despachos_replica (más confiable)
  const nros = operaciones.map(o => o.nro_operacion);
  const replicaAprobadas = await pgQuery<{ despacho: string; nro_aceptacion: string; fecha_aceptacion: string }>(
    `SELECT despacho, nro_aceptacion, fecha_aceptacion FROM despachos_replica WHERE despacho = ANY($1)`,
    [nros]
  );
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

    // Si se actualizó (no era ya aprobada), enviar correo + provisión
    if (updated.length > 0) {
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

  // Luego verificar en AduanaNet las que no se encontraron en replica
  const yaAprobadas = new Set(aprobadas.map(a => a.nro_operacion));
  const pendientesAduananet = operaciones.filter(o => !yaAprobadas.has(o.nro_operacion));

  for (const op of pendientesAduananet) {
    try {
      // Filtrar en lista de DIN terminadas por lib_nid
      const filterBody = new URLSearchParams();
      filterBody.set("accion", "F");
      filterBody.set("fil_lib_nid", op.nro_operacion);

      const res = await fetch(`${BASE_URL}/modulos/din/dus_encabezado/lista.php?term=1`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
        body: filterBody.toString(),
      });
      const html = await res.text();

      // Buscar fila con datos
      const rows = [...html.matchAll(/<tr[^>]*>\s*<td[^>]*bgcolor[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const row of rows) {
        const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
          c[1].replace(/<[^>]*>/g, "").replace(/&nbsp;?/gi, "").trim()
        );
        // Estructura: tio_id | adu_id | referencia | nro_aceptacion | fecha | cliente | autor
        // El nro_aceptacion tiene formato XXXXXXXXXX (10 dígitos)
        const nroAceptacion = cells.find(c => /^\d{8,12}$/.test(c)) || "";
        const fechaAceptacion = cells.find(c => /^\d{2}\/\d{2}\/\d{4}$/.test(c)) || "";

        if (nroAceptacion) {
          aprobadas.push({
            nro_operacion: op.nro_operacion,
            nro_aceptacion: nroAceptacion,
            fecha_aceptacion: fechaAceptacion,
          });

          // Actualizar en BD
          const updatedAdu = await pgQuery<{ rut_cliente: string; notas: string }>(
            `UPDATE operaciones SET estado = 'aprobada', fecha_cierre = NOW(), updated_at = NOW(), 
             notas = COALESCE(notas, '') || $1 
             WHERE nro_operacion = $2 AND estado != 'aprobada' RETURNING rut_cliente, notas`,
            [`\nAprobada: ${nroAceptacion} (${fechaAceptacion})`, op.nro_operacion]
          );

          // Si se actualizó, enviar correo + provisión
          if (updatedAdu.length > 0) {
            const rutClienteAdu = updatedAdu[0].rut_cliente || "";
            const notasAdu = updatedAdu[0].notas || "";
            const refMatchAdu = notasAdu.match(/ref:\s*([^\s|\n]+)/i);
            const referenciaAdu = refMatchAdu ? refMatchAdu[1] : "";

            // Correo aprobación
            try {
              const { Resend: ResendAdu } = await import("resend");
              const resendAdu = new ResendAdu(process.env.RESEND_API_KEY);
              const { emailsEjecutivosCliente: ejAdu } = await import("@/lib/permisos");
              const ccAdu = await ejAdu(rutClienteAdu);
              await resendAdu.emails.send({
                from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
                to: ["oscar@agenciaguerra.com", "pbalmaceda@agenciaguerra.com", "daviles@agenciaguerra.com", "transmision@agenciaguerra.com", "comercial@agenciaguerra.com", "fguerrab@agenciaguerra.com"],
                cc: ccAdu.length > 0 ? ccAdu : undefined,
                subject: `✅ Despacho Aprobado ${op.nro_operacion} - Aceptación: ${nroAceptacion} - ${fechaAceptacion}${referenciaAdu ? " - REF: " + referenciaAdu : ""}`,
                html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;"><p>Estimados,</p><p>El despacho <b>${op.nro_operacion}</b> ha sido <span style="color:#16a34a;font-weight:bold;">APROBADO</span>.</p><table style="border-collapse:collapse;margin:16px 0;"><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${op.nro_operacion}</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">N° Aceptación</td><td style="padding:8px 12px;border:1px solid #ddd;">${nroAceptacion}</td></tr><tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Fecha</td><td style="padding:8px 12px;border:1px solid #ddd;">${fechaAceptacion}</td></tr></table><p style="color:#666;font-size:12px;">Notificación automática de AgaTrack.</p></div>`,
              });
            } catch {}

            // Auto-provisión para Petroquímica
            if (rutClienteAdu === "92933000-5") {
              fetch(`http://localhost:${process.env.PORT || 3000}/api/operaciones/provision-fondos`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-inbound-secret": process.env.INBOUND_SECRET || "" },
                body: JSON.stringify({ nro_operacion: op.nro_operacion }),
              }).catch(err => console.error("[verificar] Error auto-provisión:", err));
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[verificar] Error para ${op.nro_operacion}:`, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    ok: true,
    verificadas: operaciones.length,
    aprobadas,
  });
}
