import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `Eres un asistente experto en comercio exterior chileno. Tu trabajo es responder preguntas sobre las operaciones de importación y exportación del usuario basándote ÚNICAMENTE en datos reales de la base de datos.

REGLAS ESTRICTAS:
1. NUNCA inventes datos. Si no puedes obtener la información, dilo claramente.
2. Siempre responde en español.
3. Cuando necesites datos, genera una query SQL válida para MySQL.
4. La tabla se llama "out_despacho_fguerra".
5. SIEMPRE filtra por rut_cliente = '{RUT}' (se reemplazará con el RUT del usuario).
6. Solo puedes hacer SELECT, nunca INSERT, UPDATE, DELETE, DROP, ALTER.
7. Campos principales disponibles: fecha_aceptacion, operacion, aduana, pais_destino, pais_origen_mercancias, total_fob, valor_flete, valor_seguro, total_cif, total_peso_bruto, referencias, consignante, emisor_docto_transporte, clausula_venta_incoterms, regimen, gravamenes_valor_1, iva, puerto_embarque.
8. Exportaciones son operaciones IN ('EXPORTACION NORMAL','EXPORTACION S/CARACTER COMERC.','EXPORTACION DE SERVICIOS','EXPORTACION DE SERVICIOS SIMPLIFICADA','EXPORTACION ABONA DAPEX DTO. 224','EXPORTACION CANCELA DAPEX DTO. 135','EXPORTACION ABONA DAPEX DTO. 473','EXPORT. ABONA SALIDA TEMPORAL','EXPORTACION VIA COURIER','EXPORTACIÓN ABONA DATPA DTO. 28','SALIDA TEMPORAL','SALIDA TEMPORAL PARA PERFECCIONAMIENTO PASIVO','SALIDA TEMP.EFECTOS DE TURISTA','SALIDA ABONA RANCHO DE IMPORTACION').
9. Importaciones son todas las demás operaciones (NOT IN las anteriores).
10. Formatea valores monetarios en USD y pesos en kg cuando corresponda.
11. Si el usuario pregunta algo que no tiene relación con comercio exterior o sus datos, indica amablemente que solo puedes ayudar con consultas sobre sus operaciones.

Cuando generes una query SQL, envuélvela en un bloque así:
\`\`\`sql
SELECT ...
\`\`\`

Yo ejecutaré la query y te daré los resultados para que formules tu respuesta.`;

function extractSQL(text: string): string | null {
  const match = text.match(/```sql\s*([\s\S]*?)```/);
  if (!match) return null;
  const sql = match[1].trim();
  // Validación de seguridad: solo SELECT
  if (!/^SELECT\s/i.test(sql)) return null;
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(sql)) return null;
  return sql;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "No autorizado." }), { status: 401 });
  }

  const { messages } = await request.json();
  const rut = session.rut;

  // Reemplazar {RUT} en el system prompt
  const systemPrompt = SYSTEM_PROMPT.replace("{RUT}", rut);

  // Primero, pedimos al modelo que genere la query si es necesario
  const lastUserMessage = messages[messages.length - 1]?.content ?? "";

  // Intentar generar SQL primero
  const sqlGenerationResult = await streamText({
    model: openai("gpt-4o-mini"),
    system: systemPrompt,
    messages: [
      ...messages.slice(0, -1),
      {
        role: "user" as const,
        content: `${lastUserMessage}\n\nSi necesitas datos de la base de datos para responder, genera la query SQL necesaria. Si puedes responder sin consultar datos (por ejemplo, una pregunta general), responde directamente.`,
      },
    ],
  });

  // Recopilar la respuesta completa para verificar si tiene SQL
  let fullResponse = "";
  const reader = sqlGenerationResult.textStream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fullResponse += value;
  }

  const sql = extractSQL(fullResponse);

  if (sql) {
    // Ejecutar la query con el RUT del usuario
    const safeSQL = sql.includes("rut_cliente")
      ? sql
      : sql.replace(/WHERE/i, `WHERE rut_cliente = '${rut}' AND`);

    try {
      const rows = await query(safeSQL);
      const resultData = JSON.stringify(rows).substring(0, 8000); // Limitar tamaño

      // Generar respuesta final con los datos reales
      const finalResult = streamText({
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        messages: [
          ...messages,
          {
            role: "assistant" as const,
            content: `Ejecuté la siguiente consulta:\n\`\`\`sql\n${safeSQL}\n\`\`\``,
          },
          {
            role: "user" as const,
            content: `Estos son los resultados de la consulta (datos reales de la base de datos):\n${resultData}\n\nAhora responde la pregunta original del usuario de forma clara y formateada, basándote SOLO en estos datos. No menciones la query SQL en tu respuesta final.`,
          },
        ],
      });

      return finalResult.toUIMessageStreamResponse();
    } catch (dbError) {
      const errorMsg = dbError instanceof Error ? dbError.message : String(dbError);
      // Si la query falla, responder con el error
      const errorResult = streamText({
        model: openai("gpt-4o-mini"),
        system: systemPrompt,
        messages: [
          ...messages,
          {
            role: "user" as const,
            content: `La consulta SQL falló con este error: ${errorMsg}. Informa al usuario que no pudiste obtener los datos e intenta reformular si es posible.`,
          },
        ],
      });
      return errorResult.toUIMessageStreamResponse();
    }
  }

  // Si no necesita SQL, devolver la respuesta directa
  const directResult = streamText({
    model: openai("gpt-4o-mini"),
    system: systemPrompt,
    messages,
  });

  return directResult.toUIMessageStreamResponse();
}
