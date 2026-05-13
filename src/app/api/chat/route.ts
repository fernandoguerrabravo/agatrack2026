import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OPERACIONES_EXPORT = [
  "EXPORTACION NORMAL",
  "EXPORTACION S/CARACTER COMERC.",
  "EXPORTACION DE SERVICIOS",
  "EXPORTACION DE SERVICIOS SIMPLIFICADA",
  "EXPORTACION ABONA DAPEX DTO. 224",
  "EXPORTACION CANCELA DAPEX DTO. 135",
  "EXPORTACION ABONA DAPEX DTO. 473",
  "EXPORT. ABONA SALIDA TEMPORAL",
  "EXPORTACION VIA COURIER",
  "EXPORTACIÓN ABONA DATPA DTO. 28",
  "SALIDA TEMPORAL",
  "SALIDA TEMPORAL PARA PERFECCIONAMIENTO PASIVO",
  "SALIDA TEMP.EFECTOS DE TURISTA",
  "SALIDA ABONA RANCHO DE IMPORTACION",
];

function buildSystemPrompt(rut: string, dbContext: string) {
  return `Eres un asistente experto en comercio exterior chileno. Respondes preguntas sobre las operaciones de importación y exportación del usuario basándote ÚNICAMENTE en los datos reales proporcionados.

DATOS DEL USUARIO:
- RUT Empresa: ${rut}

CONTEXTO DE DATOS (resultados reales de la base de datos):
${dbContext}

REGLAS:
1. NUNCA inventes datos. Basa tu respuesta SOLO en los datos proporcionados arriba.
2. Siempre responde en español.
3. Formatea valores monetarios en USD cuando corresponda.
4. Formatea pesos en kg o toneladas según corresponda.
5. Si los datos no contienen la información solicitada, dilo claramente.
6. Sé conciso y directo en tus respuestas.
7. Si el usuario pregunta algo que no tiene relación con comercio exterior, indica amablemente que solo puedes ayudar con consultas sobre sus operaciones.
8. Las exportaciones son operaciones como: EXPORTACION NORMAL, EXPORTACION DE SERVICIOS, etc.
9. Las importaciones son todas las demás operaciones (que NO son exportaciones).
10. NO uses formato markdown (no uses **, ##, *, etc). Responde en texto plano sin formato.`;
}

function extractQueryIntent(message: string): string[] {
  const queries: string[] = [];
  const msg = message.toLowerCase();

  // Siempre traer un resumen general
  queries.push("resumen");

  if (msg.includes("export")) {
    queries.push("exportaciones");
  }
  if (msg.includes("import")) {
    queries.push("importaciones");
  }
  if (msg.includes("país") || msg.includes("pais") || msg.includes("destino") || msg.includes("origen")) {
    queries.push("paises");
  }
  if (msg.includes("aduana")) {
    queries.push("aduanas");
  }
  if (msg.includes("fob")) {
    queries.push("fob");
  }
  if (msg.includes("cif")) {
    queries.push("cif");
  }
  if (msg.includes("kilo") || msg.includes("peso") || msg.includes("tonelada")) {
    queries.push("peso");
  }
  if (msg.includes("derecho") || msg.includes("impuesto") || msg.includes("iva") || msg.includes("gravamen") || msg.includes("arancel")) {
    queries.push("impuestos");
  }
  if (msg.includes("flete") || msg.includes("transporte") || msg.includes("naviera") || msg.includes("emisor")) {
    queries.push("transporte");
  }
  if (msg.includes("mes") || msg.includes("mensual") || msg.includes("tendencia") || msg.includes("evolución")) {
    queries.push("mensual");
  }
  if (msg.includes("2024") || msg.includes("2025") || msg.includes("2026") || msg.includes("año") || msg.includes("anual")) {
    queries.push("anual");
  }

  // Si no se detectó nada específico, traer todo
  if (queries.length === 1) {
    queries.push("exportaciones", "importaciones");
  }

  return queries;
}

async function getDbContext(rut: string, intents: string[]): Promise<string> {
  const results: string[] = [];
  const placeholders = OPERACIONES_EXPORT.map(() => "?").join(",");

  try {
    if (intents.includes("resumen")) {
      const [row] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as total_ops, COALESCE(SUM(total_fob),0) as total_fob, COALESCE(SUM(total_cif),0) as total_cif, COALESCE(SUM(total_peso_bruto),0) as total_kilos FROM out_despacho_fguerra WHERE rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [rut]
      );
      results.push(`RESUMEN AÑO ACTUAL (hasta hoy): ${JSON.stringify(row)}`);
    }

    if (intents.includes("exportaciones")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as total_fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES AÑO ACTUAL (hasta hoy): ${JSON.stringify(rows[0])}`);

      const porPais = await query<Record<string, unknown>[]>(
        `SELECT pais_destino, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE() GROUP BY pais_destino ORDER BY fob DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES POR PAÍS DESTINO: ${JSON.stringify(porPais)}`);
    }

    if (intents.includes("importaciones")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as total_cif, COALESCE(SUM(total_fob),0) as total_fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES AÑO ACTUAL (hasta hoy): ${JSON.stringify(rows[0])}`);

      const porPais = await query<Record<string, unknown>[]>(
        `SELECT pais_origen_mercancias as pais, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE() GROUP BY pais_origen_mercancias ORDER BY cif DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES POR PAÍS ORIGEN: ${JSON.stringify(porPais)}`);
    }

    if (intents.includes("impuestos")) {
      const [row] = await query<Record<string, unknown>[]>(
        `SELECT COALESCE(SUM(iva),0) as total_iva, COALESCE(SUM(gravamenes_valor_1),0) as total_derechos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPUESTOS IMPORTACIONES AÑO ACTUAL (hasta hoy): ${JSON.stringify(row)}`);
    }

    if (intents.includes("mensual")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT DATE_FORMAT(fecha_aceptacion,'%Y-%m') as mes, COUNT(*) as ops, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_cif),0) as cif FROM out_despacho_fguerra WHERE rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE() GROUP BY mes ORDER BY mes`,
        [rut]
      );
      results.push(`OPERACIONES POR MES (AÑO ACTUAL hasta hoy): ${JSON.stringify(rows)}`);
    }

    if (intents.includes("transporte")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT emisor_docto_transporte as emisor, COUNT(*) as cantidad, COALESCE(SUM(total_peso_bruto),0) as kilos, COALESCE(SUM(valor_flete),0) as flete FROM out_despacho_fguerra WHERE rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE() GROUP BY emisor_docto_transporte ORDER BY cantidad DESC LIMIT 10`,
        [rut]
      );
      results.push(`TOP EMISORES TRANSPORTE: ${JSON.stringify(rows)}`);
    }

    if (intents.includes("paises")) {
      const destino = await query<Record<string, unknown>[]>(
        `SELECT pais_destino as pais, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? AND YEAR(fecha_aceptacion) >= YEAR(CURDATE())-1 GROUP BY pais_destino ORDER BY fob DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`PAÍSES DESTINO EXPORTACIONES: ${JSON.stringify(destino)}`);

      const origen = await query<Record<string, unknown>[]>(
        `SELECT pais_origen_mercancias as pais, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND YEAR(fecha_aceptacion) >= YEAR(CURDATE())-1 GROUP BY pais_origen_mercancias ORDER BY cif DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`PAÍSES ORIGEN IMPORTACIONES: ${JSON.stringify(origen)}`);
    }

    if (intents.includes("anual")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT YEAR(fecha_aceptacion) as anio, COUNT(*) as ops, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE rut_cliente = ? AND YEAR(fecha_aceptacion) >= 2024 GROUP BY anio ORDER BY anio`,
        [rut]
      );
      results.push(`OPERACIONES POR AÑO: ${JSON.stringify(rows)}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.push(`ERROR AL CONSULTAR: ${msg}`);
  }

  return results.join("\n\n");
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "No autorizado." }), { status: 401 });
  }

  const { messages } = await request.json();
  const rut = session.rut;

  // Obtener la última pregunta del usuario
  const lastMsg = messages[messages.length - 1];
  const lastUserMessage = typeof lastMsg?.content === "string"
    ? lastMsg.content
    : lastMsg?.parts?.filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("") ?? "";

  // Detectar intención y obtener datos relevantes
  const intents = extractQueryIntent(lastUserMessage);
  const dbContext = await getDbContext(rut, intents);

  // Convertir mensajes del formato UI (parts) al formato que espera el modelo
  const convertedMessages = messages.map((msg: { role: string; content?: string; parts?: Array<{ type: string; text?: string }> }) => ({
    role: msg.role as "user" | "assistant" | "system",
    content: typeof msg.content === "string"
      ? msg.content
      : msg.parts?.filter((p) => p.type === "text").map((p) => p.text ?? "").join("") ?? "",
  }));

  // Generar respuesta con contexto de datos reales
  const result = streamText({
    model: openai("gpt-4o-mini"),
    system: buildSystemPrompt(rut, dbContext),
    messages: convertedMessages,
  });

  return result.toUIMessageStreamResponse();
}
