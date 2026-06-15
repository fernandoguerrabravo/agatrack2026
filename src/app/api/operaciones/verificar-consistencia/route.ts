import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/operaciones/verificar-consistencia
 * Body: { nro_operacion: string }
 * 
 * Analiza la consistencia entre los documentos de una operación usando IA.
 * Retorna alertas de inconsistencias encontradas.
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

  // Obtener todos los documentos de la operación
  const docs = await pgQuery<{ tipo_documento: string; datos_extraidos: string }>(
    "SELECT tipo_documento, datos_extraidos FROM documentos WHERE nro_operacion = $1",
    [nro_operacion]
  );

  if (docs.length < 2) {
    return NextResponse.json({ ok: true, alertas: [], mensaje: "Se necesitan al menos 2 documentos para verificar consistencia." });
  }

  // Preparar resumen de datos por documento
  const resumenDocs: string[] = [];
  for (const doc of docs) {
    const datos = typeof doc.datos_extraidos === "string" ? JSON.parse(doc.datos_extraidos || "{}") : (doc.datos_extraidos || {});
    // Extraer campos relevantes (no enviar todo para no exceder tokens)
    const campos: Record<string, unknown> = {};
    const keysRelevantes = [
      "numero_factura", "monto_total", "moneda", "incoterm", "proveedor", "comprador", "comprador_sold_to", "ship_to",
      "peso_bruto_total", "peso_neto_total", "total_bultos", "contenedores", "numero_bl_master", "numero_bl",
      "nave", "viaje", "puerto_embarque", "puerto_desembarque", "puerto_transbordo", "naviera",
      "flete_total_prepaid", "total_prepaid", "prima",
      "numero_certificado", "pais_origen", "tratado_aplicable", "partida_arancelaria",
      "numero_crt", "numero_mic_dta", "porteador", "aduana_partida", "aduana_destino",
      "peso_bruto_kg", "peso_neto_kg", "cantidad_bultos", "flete_usd",
      "customer_order_number", "internal_document_number", "orden", "order_number",
      "items", "mercaderias",
    ];
    for (const key of keysRelevantes) {
      if (datos[key] !== undefined && datos[key] !== null && datos[key] !== "") {
        if (key === "items" || key === "mercaderias") {
          // Solo primer item resumido
          const arr = Array.isArray(datos[key]) ? datos[key] : [];
          if (arr.length > 0) campos[key] = `${arr.length} items. Primero: ${JSON.stringify(arr[0]).substring(0, 200)}`;
        } else if (key === "contenedores") {
          const arr = Array.isArray(datos[key]) ? datos[key] : [];
          campos[key] = `${arr.length} contenedores`;
          if (arr.length > 0) campos["contenedor_1"] = arr[0].numero_contenedor;
        } else {
          campos[key] = datos[key];
        }
      }
    }
    resumenDocs.push(`### ${doc.tipo_documento}\n${JSON.stringify(campos, null, 1)}`);
  }

  // Consultar IA para análisis de consistencia
  const prompt = `Eres un experto en comercio exterior chileno. Analiza la consistencia entre los siguientes documentos de una operación de importación.

DOCUMENTOS:
${resumenDocs.join("\n\n")}

INSTRUCCIONES:
1. Verifica que los datos sean consistentes ENTRE documentos (no dentro del mismo)
2. Revisa: pesos, montos, referencias/órdenes, puertos, contenedores, consignatarios, partidas arancelarias
3. Identifica SOLO inconsistencias reales (datos que se contradicen entre documentos)
4. NO reportes campos faltantes como inconsistencia
5. Si todo es consistente, indicar "Sin inconsistencias detectadas"

Responde en formato JSON:
{
  "consistente": true/false,
  "alertas": [
    { "tipo": "error|advertencia", "campo": "nombre del campo", "detalle": "explicación breve de la inconsistencia", "documentos": ["doc1", "doc2"] }
  ],
  "resumen": "resumen de 1 línea"
}`;

  try {
    const result = await generateText({
      model: openai("gpt-4o-mini"),
      maxOutputTokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    // Parsear respuesta
    const text = result.text.replace(/```json\n?|\n?```/g, "").trim();
    const analysis = JSON.parse(text);

    return NextResponse.json({ ok: true, ...analysis });
  } catch (err) {
    console.error("[verificar-consistencia] Error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error analizando consistencia" }, { status: 500 });
  }
}
