import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { confeccionarDIN } from "@/lib/confeccionar-din";
import { emailsEjecutivosCliente } from "@/lib/permisos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/confeccionar
 * Body: { nro_operacion: string }
 * 
 * Valida que la operación tenga al menos BL corregido + Factura.
 * Si es válida, ejecuta la confección de DIN en AduanaNet.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const { nro_operacion } = await request.json();
  if (!nro_operacion) {
    return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
  }

  // Obtener documentos de la operación
  const docs = await pgQuery<{
    id: number;
    tipo_documento: string;
    datos_extraidos: string | Record<string, unknown>;
    datos_extraidos_claude?: string | Record<string, unknown>;
    datos_shipsgo?: string | Record<string, unknown>;
  }>(
    "SELECT id, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo FROM documentos WHERE nro_operacion = $1",
    [nro_operacion]
  );

  if (docs.length === 0) {
    return NextResponse.json({ error: "No se encontraron documentos para esta operación." }, { status: 400 });
  }

  // Verificar documentos mínimos: BL+Factura (marítimo) o CRT+Factura (terrestre)
  const tiposPresentes = docs.map(d => d.tipo_documento);
  const tieneBL = tiposPresentes.includes("Bill of Lading (BL)");
  const tieneCRT = tiposPresentes.includes("Carta de Porte Internacional (CRT)");
  const tieneMIC = tiposPresentes.includes("MIC/DTA");
  const tieneFactura = tiposPresentes.includes("Invoice (Factura Comercial)");
  const esTerrestre = (tieneCRT || tieneMIC) && !tieneBL;

  if (!tieneFactura) {
    return NextResponse.json({ error: "Falta la Factura Comercial para confeccionar." }, { status: 400 });
  }

  if (!tieneBL && !tieneCRT && !tieneMIC) {
    return NextResponse.json({ error: "Falta el documento de transporte (BL o CRT) para confeccionar." }, { status: 400 });
  }

  // Para marítimo: verificar que el BL esté corregido
  if (!esTerrestre) {
    const blDoc = docs.find(d => d.tipo_documento === "Bill of Lading (BL)");
    const blDatos = typeof blDoc!.datos_extraidos === "string"
      ? JSON.parse(blDoc!.datos_extraidos)
      : blDoc!.datos_extraidos;

    const blCorregido = blDatos._nave_corregida_shipsgo
      || blDatos.nave_corregida
      || blDatos.viaje_corregido
      || blDoc!.datos_shipsgo;

    if (!blCorregido) {
      return NextResponse.json({
        error: "El BL no está corregido. Debe tener datos de ShipsGo (nave/viaje corregido) antes de confeccionar.",
      }, { status: 400 });
    }
  }

  // Ejecutar confección
  try {
    const resultado = await confeccionarDIN(nro_operacion, docs);

    // Marcar operación como confeccionada
    await pgQuery(
      "UPDATE operaciones SET estado = 'confeccionada', fecha_confeccion = NOW(), updated_at = NOW() WHERE nro_operacion = $1",
      [nro_operacion]
    );

    // Enviar correo de instrucción de confección a documentos@agenciaguerra.com
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);

      // Obtener datos para el email
      const blDoc = docs.find(d => d.tipo_documento === "Bill of Lading (BL)");
      const invDoc = docs.find(d => d.tipo_documento === "Invoice (Factura Comercial)");
      const blDatos = blDoc ? (typeof blDoc.datos_extraidos === "string" ? JSON.parse(blDoc.datos_extraidos) : blDoc.datos_extraidos) : {};
      const invDatos = invDoc ? (typeof invDoc.datos_extraidos === "string" ? JSON.parse(invDoc.datos_extraidos) : invDoc.datos_extraidos) : {};
      const sgDatos = blDoc?.datos_shipsgo ? (typeof blDoc.datos_shipsgo === "string" ? JSON.parse(blDoc.datos_shipsgo as string) : blDoc.datos_shipsgo) as Record<string, unknown> : {};

      const blMaster = String(blDatos.numero_bl_master || blDatos.numero_bl || "");
      const nave = String(blDatos.nave_corregida || blDatos.nave || "");
      const viaje = String(blDatos.viaje_corregido || blDatos.viaje || "");
      const referencia = String(invDatos.customer_order_number || invDatos.internal_document_number || invDatos.numero_factura || "");
      const sgRoute = (sgDatos as Record<string, unknown>)?.route as Record<string, unknown> | undefined;
      const etaRaw = (sgRoute?.port_of_discharge as Record<string, unknown>)?.date_of_discharge || "";
      let eta = "";
      if (etaRaw) {
        const d = new Date(String(etaRaw));
        const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
        eta = `${String(d.getDate()).padStart(2, "0")}${meses[d.getMonth()]} ${d.getFullYear()}`;
      }

      // Descargar documentos del bucket para adjuntar
      const attachments: Array<{ filename: string; content: Buffer }> = [];
      const allDocs = await pgQuery<{ nombre_archivo: string; storage_url: string }>(
        "SELECT nombre_archivo, storage_url FROM documentos WHERE nro_operacion = $1 AND storage_url IS NOT NULL",
        [nro_operacion]
      );
      for (const doc of allDocs) {
        if (doc.storage_url) {
          try {
            const res = await fetch(doc.storage_url);
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              attachments.push({ filename: doc.nombre_archivo, content: buf });
            }
          } catch {}
        }
      }

      // Obtener ejecutivos asignados al cliente para CC
      const opInfo = await pgQuery<{ rut_cliente: string }>("SELECT rut_cliente FROM operaciones WHERE nro_operacion = $1", [nro_operacion]);
      const ejecutivosCC = opInfo[0]?.rut_cliente ? await emailsEjecutivosCliente(opInfo[0].rut_cliente) : [];

      await resend.emails.send({
        from: process.env.RESEND_FROM || "AgaTrack <reportes@agatrack.com>",
        to: ["documentos@agenciaguerra.com", "fguerrab@agenciaguerra.com"],
        cc: ejecutivosCC.length > 0 ? ejecutivosCC : undefined,
        subject: `Confección Despacho ${nro_operacion} - REF: ${referencia}${eta ? " - ETA: " + eta : ""}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;">
  <p>Estimados,</p>
  <p>Se instruye la confección del siguiente despacho:</p>
  <table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:600px;">
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;width:180px;">N° Despacho</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#2563eb;">${nro_operacion}</td></tr>
    <tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Referencia</td><td style="padding:8px 12px;border:1px solid #ddd;">${referencia}</td></tr>
    ${blMaster ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">BL</td><td style="padding:8px 12px;border:1px solid #ddd;">${blMaster}</td></tr>` : ""}
    ${nave ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">Nave</td><td style="padding:8px 12px;border:1px solid #ddd;">${nave} ${viaje}</td></tr>` : ""}
    ${eta ? `<tr><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;background:#f5f5f5;">ETA</td><td style="padding:8px 12px;border:1px solid #ddd;font-weight:bold;color:#16a34a;">${eta}</td></tr>` : ""}
  </table>
  <p>Adjuntos: ${attachments.length} documento(s)</p>
  <p style="color:#666;font-size:12px;margin-top:20px;">Generado automáticamente por AgaTrack.</p>
</div>`,
        attachments,
      });
      console.log(`[confeccionar] Email instrucción enviado para op ${nro_operacion}`);
    } catch (emailErr) {
      console.error("[confeccionar] Error enviando email:", emailErr instanceof Error ? emailErr.message : emailErr);
    }

    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[confeccionar] Error:", msg);
    return NextResponse.json({ error: `Error en confección: ${msg}` }, { status: 500 });
  }
}
