import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { openai } from "@ai-sdk/openai";
import { generateText, embed } from "ai";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

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

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text ?? "";
  } catch {
    return "";
  }
}

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

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");
    const mimeType = file.type || "application/pdf";
    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf";

    // Extraer texto del documento
    let documentText = "";
    if (isPdf) {
      documentText = await extractTextFromPdf(buffer);
    }

    const prompt = `Analiza este documento de comercio exterior. Responde en JSON con este formato exacto:
{
  "tipo_documento": "uno de: ${TIPOS_DOCUMENTO.join(", ")}",
  "resumen": "resumen breve del documento en español",
  "datos_extraidos": {
    // campos relevantes según el tipo de documento, por ejemplo:
    // Para BL: shipper, consignee, puerto_embarque, puerto_destino, contenedores, peso, descripcion_mercancia, numero_bl
    // Para Invoice: proveedor, monto_total, moneda, items, fecha, numero_factura
    // Para Póliza: aseguradora, monto_asegurado, cobertura, numero_poliza
    // Para Packing List: total_bultos, peso_bruto, peso_neto, dimensiones
    // Para Certificado de Origen: pais_origen, producto, tratado, numero_certificado
    // Para Ficha Técnica: producto, especificaciones
  },
  "texto_completo": "transcripción completa del texto del documento"
}
Solo responde con el JSON, sin markdown ni explicaciones.`;

    let analysisText: string;

    if (isImage) {
      // Para imágenes: usar GPT-4o vision
      const dataUrl = `data:${mimeType};base64,${base64}`;
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
          { role: "user" as const, content: [{ type: "text" as const, text: prompt }, { type: "image" as const, image: dataUrl }] },
        ],
      });
      analysisText = result.text;
    } else if (isPdf && documentText.length > 50) {
      // Para PDFs con texto extraíble: enviar el texto al LLM
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
          { role: "user" as const, content: `${prompt}\n\nContenido del documento (${file.name}):\n\n${documentText.substring(0, 15000)}` },
        ],
      });
      analysisText = result.text;
    } else if (isPdf) {
      // PDF sin texto (escaneado): convertir primera página a imagen no es posible sin dependencias pesadas
      // Enviar lo que tenemos
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
          { role: "user" as const, content: `${prompt}\n\nEl archivo es un PDF llamado "${file.name}" pero no se pudo extraer texto (posiblemente escaneado). Basándote en el nombre del archivo, indica el tipo probable de documento y deja datos_extraidos vacío.` },
        ],
      });
      analysisText = result.text;
    } else {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
          { role: "user" as const, content: `${prompt}\n\n[Archivo: ${file.name}]` },
        ],
      });
      analysisText = result.text;
    }

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
        texto_completo: documentText || analysisText,
      };
    }

    // Si el PDF tenía texto, usarlo como texto_completo
    if (isPdf && documentText.length > 50) {
      analysis.texto_completo = documentText;
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
