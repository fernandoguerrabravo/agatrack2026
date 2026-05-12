import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { openai } from "@ai-sdk/openai";
import { generateText, embed } from "ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TIPOS_DOCUMENTO = [
  "Bill of Lading (BL)",
  "Invoice (Factura Comercial)",
  "Póliza de Seguro",
  "Lista de Empaque (Packing List)",
  "Ficha Técnica",
  "Certificado de Origen",
  "Certificado Fitosanitario",
  "Certificado de Calidad",
  "Documento de Transporte",
  "Otro",
];

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const nroOperacion = formData.get("nro_operacion") as string;

    if (!file) {
      return NextResponse.json({ error: "No se recibió archivo." }, { status: 400 });
    }
    if (!nroOperacion) {
      return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
    }

    // Convertir archivo a base64 para enviar a GPT-4o
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "application/pdf";

    // Usar GPT-4o para identificar tipo de documento y extraer datos
    const isImage = mimeType.startsWith("image/");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const prompt = `Analiza este documento de comercio exterior. Responde en JSON con este formato exacto:
{
  "tipo_documento": "uno de: ${TIPOS_DOCUMENTO.join(", ")}",
  "resumen": "resumen breve del documento en español",
  "datos_extraidos": {
    // campos relevantes según el tipo de documento, por ejemplo:
    // Para BL: shipper, consignee, puerto_embarque, puerto_destino, contenedores, peso, descripcion_mercancia
    // Para Invoice: proveedor, monto_total, moneda, items, fecha
    // Para Póliza: aseguradora, monto_asegurado, cobertura
    // Para Packing List: total_bultos, peso_bruto, peso_neto, dimensiones
    // Para Certificado de Origen: pais_origen, producto, tratado
    // Para Ficha Técnica: producto, especificaciones
  },
  "texto_completo": "transcripción del texto visible en el documento"
}
Solo responde con el JSON, sin markdown ni explicaciones.`;

    const { text: analysisText } = await generateText({
      model: openai("gpt-4o-mini"),
      messages: isImage
        ? [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }, { type: "image" as const, image: dataUrl }] }]
        : [{ role: "user" as const, content: prompt + "\n\n[Archivo: " + file.name + "]" }],
    });

    // Parsear respuesta
    let analysis;
    try {
      const cleaned = analysisText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      analysis = JSON.parse(cleaned);
    } catch {
      analysis = {
        tipo_documento: "Otro",
        resumen: "No se pudo analizar el documento",
        datos_extraidos: {},
        texto_completo: analysisText,
      };
    }

    // Generar embedding del texto para búsqueda semántica
    const textoParaEmbedding = `${analysis.tipo_documento} ${analysis.resumen} ${analysis.texto_completo ?? ""}`.substring(0, 8000);

    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: textoParaEmbedding,
    });

    // Guardar en PostgreSQL
    const embeddingStr = `[${embedding.join(",")}]`;

    const rows = await pgQuery(
      `INSERT INTO documentos (rut_cliente, nro_operacion, nombre_archivo, tipo_documento, datos_extraidos, texto_completo, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
       RETURNING id, tipo_documento, datos_extraidos, created_at`,
      [
        session.rut,
        nroOperacion,
        file.name,
        analysis.tipo_documento,
        JSON.stringify(analysis.datos_extraidos),
        analysis.texto_completo ?? "",
        embeddingStr,
      ]
    );

    return NextResponse.json({
      ok: true,
      documento: rows[0],
      resumen: analysis.resumen,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload error:", message);
    return NextResponse.json(
      { error: "Error al procesar el documento." },
      { status: 500 }
    );
  }
}
