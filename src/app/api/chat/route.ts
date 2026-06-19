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
10. NO uses formato markdown (no uses **, ##, *, etc). Responde en texto plano sin formato.
11. Si el contexto incluye TRACKING CONTENEDOR, presenta la información de forma clara: origen, destino, puerto de carga (POL), puerto de descarga (POD), ETA, estado del contenedor, naviera (SCAC), y los últimos eventos relevantes. Usa KPIs para mostrar los datos principales.
11. Cuando tu respuesta incluya datos numéricos relevantes (totales, comparaciones, tendencias), DEBES incluir un bloque de visualización al INICIO de tu respuesta usando el formato:
<<<CHART
{JSON con datos para visualización}
CHART>>>
Seguido de tu explicación en texto plano.

FORMATO DEL BLOQUE CHART:
El JSON debe tener esta estructura:
{
  "kpis": [{"label": "Nombre", "value": "$1,234", "color": "blue|green|red|yellow|purple"}],
  "chart": {"type": "bar|line|pie", "data": [{"name": "Label", "value": 123}], "title": "Título"},
  "tracking": {"container": "XXXX1234567", "type": "40'HQ", "scac": "COSU", "origin": "Shanghai, China", "destination": "San Antonio, Chile", "pol": "Shanghai, China", "pod": "San Antonio, Chile", "eta": "2026-05-20", "etd": "2026-04-15", "completed": false, "events": [{"date": "2026-04-15", "action": "Cargado", "location": "Shanghai, China", "type": "actual"}]}
}
- "kpis" es un array de KPIs a mostrar como cards (máximo 4)
- "chart" es opcional, solo inclúyelo si hay datos de tendencia o comparación
- "tracking" es SOLO para respuestas de rastreo de contenedores. Incluye TODOS los eventos disponibles.
- Para chart tipo "bar" o "line": data debe tener "name" y "value"
- Para chart tipo "pie": data debe tener "name" y "value"
- Usa valores numéricos sin formato en "value" del chart (sin $ ni puntos)
- En "value" de kpis usa formato legible ($1,234 o 1.234 kg)
- Para tracking events, "type" debe ser "actual" o "expected"

Ejemplo:
<<<CHART
{"kpis":[{"label":"Total CIF","value":"$5,234,567","color":"blue"},{"label":"Operaciones","value":"156","color":"green"}],"chart":{"type":"bar","data":[{"name":"Ene","value":45},{"name":"Feb","value":52}],"title":"Operaciones por mes"}}
CHART>>>
Este año llevas 156 operaciones de importación con un CIF total de $5,234,567 USD.`;
}

function extractQueryIntent(message: string): string[] {
  const queries: string[] = [];
  const msg = message.toLowerCase();

  // Detectar si es una consulta de tracking de contenedor
  if (msg.match(/[a-z]{4}\d{7}/i) || msg.includes("contenedor") || msg.includes("container") || msg.includes("rastrear") || msg.includes("tracking") || msg.includes("track")) {
    queries.push("tracking");
  }

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
  if (msg.includes("mes") || msg.includes("mensual") || msg.includes("tendencia") || msg.includes("evolución") || msg.includes("este mes") || msg.includes("del mes")) {
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

async function fetchContainerTracking(containerNr: string): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.FINDTEU_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`https://api.findteu.com/container/${containerNr}`, {
      method: "POST",
      headers: {
        "X-Authorization-ApiKey": apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
    });
    const json = await res.json();
    if (!json.success) return null;
    return json.data;
  } catch (error) {
    console.error("[tracking] Error:", error);
    return null;
  }
}

async function getDbContext(rut: string, intents: string[], userMessage: string): Promise<string> {
  const results: string[] = [];
  const placeholders = OPERACIONES_EXPORT.map(() => "?").join(",");

  try {
    // Si es tracking de contenedor, consultar FindTEU
    if (intents.includes("tracking")) {
      const containerMatch = userMessage.match(/[A-Z]{4}\d{7}/i);
      if (containerMatch) {
        const containerNr = containerMatch[0].toUpperCase();
        const trackingData = await fetchContainerTracking(containerNr);
        if (trackingData) {
          results.push(`TRACKING CONTENEDOR ${containerNr}: ${JSON.stringify(trackingData)}`);
        } else {
          results.push(`TRACKING CONTENEDOR ${containerNr}: No se encontró información o error en la consulta.`);
        }
      }
    }

    // SIEMPRE traer resumen histórico completo (desde primera fecha hasta hoy)
    const [historico] = await query<Record<string, unknown>[]>(
      `SELECT MIN(fecha_aceptacion) as primera_fecha, MAX(fecha_aceptacion) as ultima_fecha, COUNT(*) as total_ops, COALESCE(SUM(total_fob),0) as total_fob, COALESCE(SUM(total_cif),0) as total_cif, COALESCE(SUM(total_peso_bruto),0) as total_kilos FROM out_despacho_fguerra WHERE rut_cliente = ?`,
      [rut]
    );
    results.push(`RESUMEN HISTÓRICO COMPLETO (toda la data disponible): ${JSON.stringify(historico)}`);

    // Resumen por año (histórico completo)
    const porAnio = await query<Record<string, unknown>[]>(
      `SELECT YEAR(fecha_aceptacion) as anio, COUNT(*) as ops, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE rut_cliente = ? GROUP BY anio ORDER BY anio`,
      [rut]
    );
    results.push(`OPERACIONES POR AÑO (histórico): ${JSON.stringify(porAnio)}`);

    if (intents.includes("resumen")) {
      const [row] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as total_ops, COALESCE(SUM(total_fob),0) as total_fob, COALESCE(SUM(total_cif),0) as total_cif, COALESCE(SUM(total_peso_bruto),0) as total_kilos FROM out_despacho_fguerra WHERE rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [rut]
      );
      results.push(`RESUMEN AÑO ACTUAL (hasta hoy): ${JSON.stringify(row)}`);
    }

    if (intents.includes("exportaciones")) {
      // Año actual
      const [expActual] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as total_fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES AÑO ACTUAL (hasta hoy): ${JSON.stringify(expActual)}`);

      // Histórico por año
      const expAnual = await query<Record<string, unknown>[]>(
        `SELECT YEAR(fecha_aceptacion) as anio, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? GROUP BY anio ORDER BY anio`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES POR AÑO (histórico): ${JSON.stringify(expAnual)}`);

      // Por país (histórico)
      const porPais = await query<Record<string, unknown>[]>(
        `SELECT pais_destino, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? GROUP BY pais_destino ORDER BY fob DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES POR PAÍS DESTINO (histórico): ${JSON.stringify(porPais)}`);

      // Por aduana (histórico)
      const porAduana = await query<Record<string, unknown>[]>(
        `SELECT aduana, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? GROUP BY aduana ORDER BY cantidad DESC`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES POR ADUANA (histórico): ${JSON.stringify(porAduana)}`);

      // Por mes año actual
      const expMes = await query<Record<string, unknown>[]>(
        `SELECT DATE_FORMAT(fecha_aceptacion,'%Y-%m') as mes, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') GROUP BY mes ORDER BY mes`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES POR MES (año actual): ${JSON.stringify(expMes)}`);
    }

    if (intents.includes("importaciones")) {
      // Año actual
      const [impActual] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as total_cif, COALESCE(SUM(total_fob),0) as total_fob, COALESCE(SUM(total_peso_bruto),0) as kilos, COALESCE(SUM(valor_flete),0) as flete, COALESCE(SUM(valor_seguro),0) as seguro FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES AÑO ACTUAL (hasta hoy): ${JSON.stringify(impActual)}`);

      // Histórico por año
      const impAnual = await query<Record<string, unknown>[]>(
        `SELECT YEAR(fecha_aceptacion) as anio, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? GROUP BY anio ORDER BY anio`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES POR AÑO (histórico): ${JSON.stringify(impAnual)}`);

      // Por país origen (histórico)
      const porPais = await query<Record<string, unknown>[]>(
        `SELECT pais_origen_mercancias as pais, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? GROUP BY pais_origen_mercancias ORDER BY cif DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES POR PAÍS ORIGEN (histórico): ${JSON.stringify(porPais)}`);

      // Por aduana (histórico)
      const porAduana = await query<Record<string, unknown>[]>(
        `SELECT aduana, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? GROUP BY aduana ORDER BY cantidad DESC`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES POR ADUANA (histórico): ${JSON.stringify(porAduana)}`);

      // Por incoterms (histórico)
      const porIncoterms = await query<Record<string, unknown>[]>(
        `SELECT clausula_venta_incoterms as incoterm, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? GROUP BY clausula_venta_incoterms ORDER BY cantidad DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES POR INCOTERMS (histórico): ${JSON.stringify(porIncoterms)}`);

      // Por mes año actual
      const impMes = await query<Record<string, unknown>[]>(
        `SELECT DATE_FORMAT(fecha_aceptacion,'%Y-%m') as mes, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') GROUP BY mes ORDER BY mes`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES POR MES (año actual): ${JSON.stringify(impMes)}`);
    }

    if (intents.includes("impuestos")) {
      // Año actual
      const [impuestos] = await query<Record<string, unknown>[]>(
        `SELECT COALESCE(SUM(iva),0) as total_iva, COALESCE(SUM(gravamenes_valor_1),0) as total_derechos, COALESCE(SUM(total_cif),0) as total_cif FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPUESTOS IMPORTACIONES AÑO ACTUAL: ${JSON.stringify(impuestos)}`);

      // Histórico por año
      const impAnual = await query<Record<string, unknown>[]>(
        `SELECT YEAR(fecha_aceptacion) as anio, COALESCE(SUM(iva),0) as iva, COALESCE(SUM(gravamenes_valor_1),0) as derechos, COALESCE(SUM(total_cif),0) as cif FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? GROUP BY anio ORDER BY anio`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPUESTOS POR AÑO (histórico): ${JSON.stringify(impAnual)}`);

      // Bien de capital
      const [bk] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif_bk FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND regimen = 'GENERAL' AND gravamenes_valor_1 = 0 AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE()`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`BIEN DE CAPITAL AÑO ACTUAL (régimen GENERAL, derechos $0): ${JSON.stringify(bk)}`);
    }

    if (intents.includes("mensual")) {
      // Mes actual
      const [mesActual] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as ops, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE rut_cliente = ? AND DATE_FORMAT(fecha_aceptacion, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`,
        [rut]
      );
      results.push(`OPERACIONES MES ACTUAL: ${JSON.stringify(mesActual)}`);

      // Importaciones mes actual
      const [impMesActual] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as ops, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? AND DATE_FORMAT(fecha_aceptacion, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`IMPORTACIONES MES ACTUAL: ${JSON.stringify(impMesActual)}`);

      // Exportaciones mes actual
      const [expMesActual] = await query<Record<string, unknown>[]>(
        `SELECT COUNT(*) as ops, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? AND DATE_FORMAT(fecha_aceptacion, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`EXPORTACIONES MES ACTUAL: ${JSON.stringify(expMesActual)}`);

      // Por mes año actual
      const rows = await query<Record<string, unknown>[]>(
        `SELECT DATE_FORMAT(fecha_aceptacion,'%Y-%m') as mes, COUNT(*) as ops, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE rut_cliente = ? AND fecha_aceptacion >= CONCAT(YEAR(CURDATE()),'-01-01') AND fecha_aceptacion <= CURDATE() GROUP BY mes ORDER BY mes`,
        [rut]
      );
      results.push(`OPERACIONES POR MES (año actual): ${JSON.stringify(rows)}`);
    }

    if (intents.includes("transporte")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT emisor_docto_transporte as emisor, COUNT(*) as cantidad, COALESCE(SUM(total_peso_bruto),0) as kilos, COALESCE(SUM(valor_flete),0) as flete FROM out_despacho_fguerra WHERE rut_cliente = ? GROUP BY emisor_docto_transporte ORDER BY cantidad DESC LIMIT 10`,
        [rut]
      );
      results.push(`TOP EMISORES TRANSPORTE (histórico): ${JSON.stringify(rows)}`);
    }

    if (intents.includes("paises")) {
      const destino = await query<Record<string, unknown>[]>(
        `SELECT pais_destino as pais, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion IN (${placeholders}) AND rut_cliente = ? GROUP BY pais_destino ORDER BY fob DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`PAÍSES DESTINO EXPORTACIONES (histórico): ${JSON.stringify(destino)}`);

      const origen = await query<Record<string, unknown>[]>(
        `SELECT pais_origen_mercancias as pais, COUNT(*) as cantidad, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE operacion NOT IN (${placeholders}) AND rut_cliente = ? GROUP BY pais_origen_mercancias ORDER BY cif DESC LIMIT 10`,
        [...OPERACIONES_EXPORT, rut]
      );
      results.push(`PAÍSES ORIGEN IMPORTACIONES (histórico): ${JSON.stringify(origen)}`);
    }

    if (intents.includes("anual")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT YEAR(fecha_aceptacion) as anio, COUNT(*) as ops, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE rut_cliente = ? GROUP BY anio ORDER BY anio`,
        [rut]
      );
      results.push(`OPERACIONES POR AÑO (histórico completo): ${JSON.stringify(rows)}`);
    }

    if (intents.includes("aduanas")) {
      const rows = await query<Record<string, unknown>[]>(
        `SELECT aduana, COUNT(*) as cantidad, COALESCE(SUM(total_fob),0) as fob, COALESCE(SUM(total_cif),0) as cif, COALESCE(SUM(total_peso_bruto),0) as kilos FROM out_despacho_fguerra WHERE rut_cliente = ? GROUP BY aduana ORDER BY cantidad DESC`,
        [rut]
      );
      results.push(`POR ADUANA (histórico): ${JSON.stringify(rows)}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.push(`ERROR AL CONSULTAR: ${msg}`);
  }

  return results.join("\n\n");
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return new Response(JSON.stringify({ error: "No autorizado." }), { status: 401 });
    }

    const { messages } = await request.json();
    const rut = session.rut;

    // Obtener la última pregunta del usuario (compatible con v6 parts y legacy content)
    const lastMsg = messages[messages.length - 1];
    let lastUserMessage = "";
    if (typeof lastMsg?.content === "string") {
      lastUserMessage = lastMsg.content;
    } else if (Array.isArray(lastMsg?.content)) {
      lastUserMessage = lastMsg.content.filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("");
    } else if (lastMsg?.parts) {
      lastUserMessage = lastMsg.parts.filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("");
    }

    // Detectar intención y obtener datos relevantes
    const intents = extractQueryIntent(lastUserMessage);
    const dbContext = await getDbContext(rut, intents, lastUserMessage);

    // Convertir mensajes del formato UI (parts/content) al formato que espera el modelo
    const convertedMessages = messages.map((msg: { role: string; content?: string | Array<{ type: string; text?: string }>; parts?: Array<{ type: string; text?: string }> }) => {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("");
      } else if (msg.parts && Array.isArray(msg.parts)) {
        content = msg.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("");
      }
      return {
        role: msg.role as "user" | "assistant" | "system",
        content,
      };
    });

    // Generar respuesta con contexto de datos reales
    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: buildSystemPrompt(rut, dbContext),
      messages: convertedMessages,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[chat] POST error:", error);
    return new Response(JSON.stringify({ error: "Error interno del chat." }), { status: 500 });
  }
}
