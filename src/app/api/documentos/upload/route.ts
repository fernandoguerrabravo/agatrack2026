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
    console.log("[docs] PDF parsed, pages:", data.numpages, "text length:", data.text?.length ?? 0);
    return data.text ?? "";
  } catch (err) {
    console.error("[docs] PDF parse error:", err instanceof Error ? err.message : err);
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
      console.log("[docs] Extracted text preview:", documentText.substring(0, 200));
    }

    const prompt = `Eres un experto en documentos de comercio exterior. Analiza el siguiente texto extraído de un documento y extrae TODOS los datos relevantes.

INSTRUCCIONES:
1. Identifica el tipo de documento
2. Extrae TODOS los campos que puedas encontrar en el texto
3. Si encuentras números, fechas, nombres, montos, pesos, puertos, etc., inclúyelos

Responde SOLO con JSON válido (sin markdown, sin explicaciones) con este formato:
{
  "tipo_documento": "uno de: ${TIPOS_DOCUMENTO.join(", ")}",
  "resumen": "resumen de 1-2 líneas del documento",
  "datos_extraidos": {
    // TODOS los campos que encuentres. Ejemplos según tipo:
    // BL: numero_bl, shipper, consignee, notify_party, puerto_embarque, puerto_destino, nave, viaje, contenedores, descripcion_mercancia, peso_bruto, volumen, fecha_embarque
    // Invoice: numero_factura, proveedor, comprador, fecha, moneda, monto_total, items (array con descripcion, cantidad, precio_unitario, total), incoterm, pais_origen
    // Póliza: numero_poliza, aseguradora, asegurado, monto_asegurado, prima, cobertura, vigencia
    // Packing List: total_bultos, tipo_embalaje, peso_bruto_total, peso_neto_total, volumen_total, items (array)
    // Certificado de Origen: numero_certificado, pais_origen, exportador, importador, descripcion_mercancia, tratado_aplicable, partida_arancelaria
    // Ficha Técnica: producto, marca, modelo, especificaciones_tecnicas
  },
  "texto_completo": "el texto completo del documento tal como fue extraído"
}`;

    let analysisText: string = "";

    if (isImage) {
      // Para imágenes: usar GPT-4o vision
      const dataUrl = `data:${mimeType};base64,${base64}`;
      console.log("[docs] Analyzing image with GPT-4o vision...");
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
          { role: "user" as const, content: [{ type: "text" as const, text: prompt }, { type: "image" as const, image: dataUrl }] },
        ],
      });
      analysisText = result.text;
    } else if (isPdf && documentText.length > 20) {
      // Para PDFs con texto extraíble: enviar el texto al LLM
      console.log("[docs] Analyzing PDF text with GPT-4o-mini, text length:", documentText.length);
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
          { role: "user" as const, content: `${prompt}\n\n--- TEXTO DEL DOCUMENTO (${file.name}) ---\n\n${documentText.substring(0, 15000)}` },
        ],
      });
      analysisText = result.text;
    } else if (isPdf) {
      // PDF escaneado o con poco texto: convertir a imagen con pdf-to-img
      console.log("[docs] PDF scanned, converting to image for GPT-4o vision, file:", file.name);
      let converted = false;
      try {
        const { pdf: pdfToImg } = await import("pdf-to-img");
        const pages: string[] = [];
        const pdfDoc = await pdfToImg(buffer, { scale: 2 });
        for await (const page of pdfDoc) {
          const pageBase64 = Buffer.from(page).toString("base64");
          pages.push(`data:image/png;base64,${pageBase64}`);
          console.log("[docs] Converted page", pages.length, "size:", pageBase64.length);
          if (pages.length >= 3) break;
        }

        if (pages.length > 0) {
          console.log("[docs] Sending", pages.length, "page(s) to GPT-4o vision");
          const imageContent = pages.map(img => ({ type: "image" as const, image: img }));
          const result = await generateText({
            model: openai("gpt-4o"),
            messages: [
              { role: "user" as const, content: [{ type: "text" as const, text: prompt }, ...imageContent] },
            ],
          });
          analysisText = result.text;
          converted = true;
        }
      } catch (convErr) {
        console.error("[docs] PDF to image conversion error:", convErr instanceof Error ? convErr.message : convErr);
      }

      if (!converted) {
        // Último fallback
        console.log("[docs] Fallback: classify by filename only");
        const result = await generateText({
          model: openai("gpt-4o-mini"),
          messages: [
            { role: "user" as const, content: `${prompt}\n\nEl archivo es un PDF escaneado llamado "${file.name}". No se pudo procesar. Clasifica el tipo de documento por el nombre.` },
          ],
        });
        analysisText = result.text;
      }
    } else {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        messages: [
          { role: "user" as const, content: `${prompt}\n\n[Archivo: ${file.name}]` },
        ],
      });
      analysisText = result.text;
    }

    console.log("[docs] GPT response length:", analysisText.length, "first 200:", analysisText.substring(0, 200));

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
