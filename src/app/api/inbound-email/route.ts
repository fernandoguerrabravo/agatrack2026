import { NextResponse } from "next/server";
import { pgQuery } from "@/lib/postgres";
import { uploadToSpaces } from "@/lib/spaces";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Mapeo de dirección de recepción → configuración del cliente
 */
const INBOUND_MAP: Record<string, { cli_id: string; rut_cliente: string; cliente_nombre: string }> = {
  "dow@agatrack.agenciaguerra.com": { cli_id: "2710", rut_cliente: "92933000-5", cliente_nombre: "PETROQUIMICA DOW S.A." },
};

/**
 * POST /api/inbound-email
 * 
 * Webhook receptor de Resend para emails inbound.
 * Cuando un cliente envía un email con documentos adjuntos a dow@agatrack.agenciaguerra.com,
 * este endpoint:
 * 1. Obtiene los attachments via Resend API
 * 2. Los procesa (clasifica + extrae datos) usando la misma lógica de upload
 * 3. Crea la operación en AduanaNet
 * 4. Guarda los documentos en bucket y BD
 */
export async function POST(request: Request) {
  try {
    // Verificar firma del webhook de Resend
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");
    
    const body = await request.text();
    const payload = JSON.parse(body);

    // Si tiene headers de Svix, verificar firma
    if (svixId && svixTimestamp && svixSignature && process.env.RESEND_WEBHOOK_SECRET) {
      const { Webhook } = await import("svix");
      const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
      try {
        wh.verify(body, { "svix-id": svixId, "svix-timestamp": svixTimestamp, "svix-signature": svixSignature });
      } catch (err) {
        console.error("[inbound] Webhook signature verification failed:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }
    
    // Resend webhook payload: { type: "email.received", data: { email_id, from, to, subject } }
    const eventType = payload.type;
    if (eventType !== "email.received") {
      return NextResponse.json({ ok: true, message: "Evento ignorado" });
    }

    const { email_id, from, to, subject } = payload.data;
    console.log(`[inbound] Email recibido: from=${from} to=${JSON.stringify(to)} subject=${subject} id=${email_id}`);

    // Determinar cliente por dirección de destino
    const toAddr = Array.isArray(to) ? to[0] : to;
    const config = INBOUND_MAP[toAddr?.toLowerCase()];
    if (!config) {
      console.log(`[inbound] Dirección no configurada: ${toAddr}`);
      return NextResponse.json({ ok: true, message: "Dirección no configurada" });
    }

    // Obtener attachments via Resend API
    const resend = new Resend(process.env.RESEND_API_KEY);
    const attachmentsRes = await fetch(`https://api.resend.com/emails/receiving/${email_id}/attachments`, {
      headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}` },
    });
    
    if (!attachmentsRes.ok) {
      console.error(`[inbound] Error obteniendo attachments: ${attachmentsRes.status}`);
      return NextResponse.json({ error: "Error obteniendo attachments" }, { status: 500 });
    }

    const attachmentsData = await attachmentsRes.json();
    const attachments = attachmentsData.data || [];
    
    if (attachments.length === 0) {
      console.log("[inbound] Email sin attachments, ignorando");
      return NextResponse.json({ ok: true, message: "Sin attachments" });
    }

    console.log(`[inbound] ${attachments.length} attachment(s) encontrados`);

    // Procesar cada attachment
    const processedDocs: Array<{ id: number; tipo: string; nombre: string }> = [];
    let referencia = "";
    let nroOperacion = "";

    for (const att of attachments) {
      const { filename, content_type, download_url } = att;
      
      // Solo procesar PDFs e imágenes
      if (!content_type?.match(/pdf|image/i)) {
        console.log(`[inbound] Ignorando ${filename} (${content_type})`);
        continue;
      }

      // Descargar el archivo
      const fileRes = await fetch(download_url);
      if (!fileRes.ok) {
        console.error(`[inbound] Error descargando ${filename}: ${fileRes.status}`);
        continue;
      }
      const fileBuffer = Buffer.from(await fileRes.arrayBuffer());
      console.log(`[inbound] Descargado: ${filename} (${fileBuffer.length} bytes)`);

      // Subir al bucket
      const storageKey = `documentos/${config.rut_cliente}/inbound_${email_id}/${filename}`;
      const storageUrl = await uploadToSpaces(fileBuffer, storageKey, content_type);

      // Procesar con IA — llamar directamente al endpoint de upload con bypass de auth
      const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.NEXTAUTH_URL || "https://agatrack.agenciaguerra.com";
      const formData = new FormData();
      const blob = new Blob([fileBuffer], { type: content_type });
      formData.append("file", blob, filename);
      formData.append("nro_operacion", nroOperacion || "INBOUND_" + email_id.substring(0, 8));
      formData.append("rut_cliente", config.rut_cliente);
      formData.append("inbound_secret", process.env.INBOUND_SECRET || "");

      const uploadRes = await fetch(`${baseUrl}/api/documentos/upload`, {
        method: "POST",
        body: formData,
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        const doc = uploadData.documento;
        if (doc) {
          processedDocs.push({ id: doc.id, tipo: doc.tipo_documento, nombre: filename });
          
          // Extraer referencia del invoice
          if (doc.tipo_documento === "Invoice (Factura Comercial)" && !referencia) {
            const datos = typeof doc.datos_extraidos === "string" ? JSON.parse(doc.datos_extraidos) : doc.datos_extraidos;
            referencia = datos?.customer_order_number || datos?.internal_document_number || datos?.orden || datos?.our_reference || datos?.numero_factura || "";
          }
        }
      } else {
        console.error(`[inbound] Error procesando ${filename}:`, await uploadRes.text().catch(() => ""));
      }
    }

    // Si tenemos referencia, crear operación en AduanaNet
    if (referencia && processedDocs.length > 0) {
      // Detectar si es terrestre
      const esTerrestreDoc = processedDocs.some(d => d.tipo === "Carta de Porte Internacional (CRT)" || d.tipo === "MIC/DTA");
      const puertoDesembarque = esTerrestreDoc ? "LOS ANDES" : "SAN ANTONIO";

      const baseUrl = process.env.NEXT_PUBLIC_URL || process.env.NEXTAUTH_URL || "https://agatrack.agenciaguerra.com";
      const crearRes = await fetch(`${baseUrl}/api/aduananet-operaciones`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-inbound-secret": process.env.INBOUND_SECRET || "",
        },
        body: JSON.stringify({
          cli_id: config.cli_id,
          rut_cliente: config.rut_cliente,
          referencia,
          puerto_desembarque: puertoDesembarque,
          tio_id: "101",
        }),
      });

      if (crearRes.ok) {
        const crearData = await crearRes.json();
        nroOperacion = crearData.nro_operacion || "";
        console.log(`[inbound] Operación creada: ${nroOperacion} (ref: ${referencia})`);

        // Actualizar nro_operacion en los documentos ya subidos
        if (nroOperacion) {
          const tempNro = "INBOUND_" + email_id.substring(0, 8);
          await pgQuery(
            "UPDATE documentos SET nro_operacion = $1 WHERE nro_operacion = $2",
            [nroOperacion, tempNro]
          );
        }
      }
    }

    console.log(`[inbound] Procesamiento completado: ${processedDocs.length} docs, op=${nroOperacion}, ref=${referencia}`);

    return NextResponse.json({
      ok: true,
      email_id,
      from,
      nro_operacion: nroOperacion,
      referencia,
      documentos: processedDocs.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("[inbound] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
