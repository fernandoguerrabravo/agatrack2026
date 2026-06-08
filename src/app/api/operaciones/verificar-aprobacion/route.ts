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

  for (const op of operaciones) {
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
          await pgQuery(
            `UPDATE operaciones SET estado = 'aprobada', fecha_cierre = NOW(), updated_at = NOW(), 
             notas = COALESCE(notas, '') || $1 
             WHERE nro_operacion = $2 AND estado != 'aprobada'`,
            [`\nAprobada: ${nroAceptacion} (${fechaAceptacion})`, op.nro_operacion]
          );
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
