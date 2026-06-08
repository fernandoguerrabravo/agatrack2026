import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { uploadToSpaces } from "@/lib/spaces";
import { guardarEjemploBL, obtenerEjemplosBL } from "@/lib/bl-ejemplos";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, embed } from "ai";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Modelos de visión avanzados para análisis de BL (máxima precisión OCR)
const GPT_VISION_MODEL = "gpt-5.5";          // GPT-5.5: segundo modelo (backup)
const CLAUDE_VISION_MODEL = "claude-opus-4-7"; // Claude Opus 4.7: modelo principal
const TEXT_FALLBACK_MODEL = "gpt-4o-mini";   // Fallback de texto (sin imagen) — más barato
const PRIMARY_MODEL = "claude"; // Usar Claude como modelo principal para clasificación

const TIPOS_DOCUMENTO = [
  "Bill of Lading (BL)",
  "Invoice (Factura Comercial)",
  "Póliza de Seguro",
  "Lista de Empaque (Packing List)",
  "Ficha Técnica",
  "Certificado de Origen",
  "Certificado Fitosanitario",
  "Certificado de Calidad",
  "Certificado Sanitario (SEREMI)",
  "Documento de Transporte",
  "Mandato",
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
    const rutCliente = formData.get("rut_cliente") as string || "";

    if (!file) {
      return NextResponse.json({ error: "No se recibió archivo." }, { status: 400 });
    }
    if (!nroOperacion) {
      return NextResponse.json({ error: "Número de operación requerido." }, { status: 400 });
    }

    // Determinar el rut_cliente: si viene del form usarlo, sino buscar de la operación existente, sino usar el rut del usuario
    let finalRutCliente = rutCliente;
    if (!finalRutCliente) {
      const opRow = await pgQuery<{ rut_cliente: string }>("SELECT rut_cliente FROM operaciones WHERE nro_operacion = $1", [nroOperacion]);
      finalRutCliente = opRow[0]?.rut_cliente || session.rut;
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

    // Usar siempre los modelos avanzados para máxima precisión en todos los documentos
    const gptModel = GPT_VISION_MODEL;
    const claudeModel = CLAUDE_VISION_MODEL;
    console.log("[docs] Usando modelos avanzados:", gptModel, "+", claudeModel);

    const prompt = `Eres un experto en documentos de comercio exterior. Analiza TODAS las páginas del siguiente documento y extrae TODOS los datos relevantes con el máximo detalle posible.

INSTRUCCIONES IMPORTANTES:
1. Identifica el tipo de documento con MÁXIMA PRECISIÓN. REGLAS DE CLASIFICACIÓN:
   - "Lista de Empaque (Packing List)": documentos titulados "PACKING LIST", "LISTA DE EMPAQUE", "LISTA DE EMBALAJE", "PACKING SLIP", "WEIGHT LIST", o que detallan bultos/cajas/pallets con pesos y dimensiones SIN precios ni valores monetarios. Si ves "PACKING LIST" o "LISTA DE EMPAQUE" en el título → clasificar SIEMPRE como "Lista de Empaque (Packing List)".
   - "Certificado de Origen": documentos titulados "CERTIFICATE OF ORIGIN", "CERTIFICADO DE ORIGEN", "CO", "CERTIFICADo DE ORIGEN FORM A/B", "EUR.1", "FORM E", certificados de cámaras de comercio, certificados de TRATADO DE LIBRE COMERCIO / FREE TRADE AGREEMENT (TLC Chile-USA, Chile-UE, etc.), o cualquier documento que declare el origen de la mercancía bajo un tratado con campos como "Criterio de Origen / Preference Criterion", "Clasificación Arancelaria / HS Tariff", "mercancía originaria / originating". OJO: muchos certificados de origen de TLC NO dicen literalmente "certificate of origin" — se titulan con el nombre del tratado (ej: "Tratado de Libre Comercio Chile - Estados Unidos" / "United States - Chile Free Trade Agreement"). Si ves un formato con "Criterio de Origen", "Preference Criterion", productor/exportador/importador y clasificación arancelaria bajo un tratado → es "Certificado de Origen".
   - "Bill of Lading (BL)": "BILL OF LADING", "B/L", "CONOCIMIENTO DE EMBARQUE", "SEA WAYBILL".
   - "Invoice (Factura Comercial)": "COMMERCIAL INVOICE", "FACTURA COMERCIAL", "INVOICE" con precios/valores.
   IMPORTANTE: NO confundir Packing List con Invoice — el Packing List NO tiene precios, solo cantidades/pesos/bultos. NO confundir Certificado de Origen con otros certificados (fitosanitario, calidad). El tipo_documento debe coincidir EXACTAMENTE con uno de la lista permitida.
2. Extrae ABSOLUTAMENTE TODOS los datos visibles: números, fechas, nombres, direcciones, montos, pesos, medidas, códigos
3. Para BL: identifica CADA contenedor por separado con su número, sello, contenido detallado (pallets, bolsas, peso por contenedor, volumen, descripción de mercancía, HS code). NÚMERO DE CONTENEDOR - REGLA ABSOLUTA: Todo número de contenedor tiene EXACTAMENTE 4 letras seguidas de EXACTAMENTE 7 dígitos numéricos. Total: 11 caracteres. NUNCA puede tener 6 dígitos. Si lees solo 6 dígitos, HAY UN DÍGITO QUE NO ESTÁS VIENDO entre las letras y los números — mira con más cuidado el primer dígito después de las 4 letras. Ejemplo real: "MSCU5310319" — el "5" es el primer dígito después de "MSCU", NO lo omitas. Error común: leer "MSCU310319" (6 dígitos, INCORRECTO) cuando el correcto es "MSCU5310319" (7 dígitos). Otros ejemplos correctos: TCLU6223479, OERU4815696, MEDU4718562. No confundir 6↔8, 0↔O, 1↔I, 5↔S. Si hay una sección "per container" o "per cntr" al final del listado (común en BLs de MSC/Mediterranean Shipping Company), esos detalles (peso, volumen, pallets, descripción) aplican a CADA UNO de los contenedores listados arriba — replicar esos datos en cada contenedor del array. Indicar SIEMPRE el número de pallets por contenedor (campo "pallets") si aparece en el documento. Si dice "X PALLETS PER CONTAINER" o "X PLTS", ese es el número de pallets de cada contenedor.
4. Incluye información del shipper, consignee, notify party con direcciones completas. REGLA CRÍTICA BL MASTER vs HOUSE — MÁXIMA PRIORIDAD: PASO 1: Buscar en TODAS las páginas del documento TODOS los números de BL. Revisar ESPECIALMENTE: campo "B/L No.", "Bill of Lading No.", encabezado superior, esquina superior derecha, primera línea del documento, sellos, marcas de agua, pie de página, campo "Reference", "Booking No.", y CUALQUIER número alfanumérico que parezca un código de BL. TAMBIÉN buscar bloques de texto/sellos de agencias (Asia Shipping, ILS CARGO SPA, Danmar, UFM) que contengan "MBL:", "NAVE:", "CONTENEDOR:" — estos datos son CORRECCIONES VÁLIDAS y tienen prioridad sobre lo impreso en el BL. PASO 2: Si encuentras DOS o más números de BL distintos, buscar si alguno tiene "(H)", "(h)", "HBL", "House", "House B/L", "H/BL", "Hijo", "Nieto" al lado o cerca. PASO 3: CLASIFICAR según estas reglas: (A) Número con "(H)", "House", "Hijo" o "Nieto" al lado → numero_bl_house. (B) El OTRO número (sin marca, o con "MBL", "Master", "Ocean B/L") → numero_bl_master. (C) Si solo hay UN número → es el MASTER. (D) NUNCA poner el número con "(H)" o "Nieto" como master — ese SIEMPRE es el house/hijo. (E) Si hay dos números sin marca clara, el del campo principal "B/L No." es MASTER. (F) Si hay un bloque de corrección (sello de ILS CARGO, Asia Shipping, etc.) con "MBL: [número]", ese número es el MASTER REAL — tiene prioridad sobre cualquier otro. ATENCIÓN ESPECIAL: En BLs de freight forwarders (ILS CARGO SPA, Asia Shipping, Danmar, UFM, etc.) es MUY COMÚN que aparezcan DOS números: uno del freight forwarder (house/hijo/nieto, con "(H)") y uno de la naviera (master, sin marca o en bloque "MBL:"). El "(H)" puede estar en paréntesis pequeños, difícil de ver — BUSCAR CON CUIDADO en toda la página. DATOS DE CORRECCIÓN EN SELLOS: Los bloques de ILS CARGO SPA y Asia Shipping contienen datos corregidos/validados. ESTOS DATOS TIENEN PRIORIDAD ABSOLUTA sobre lo impreso en el cuerpo del BL. Si el bloque dice "VAPOR: EVER LINKING" pero el BL impreso dice otra nave, USAR LA DEL BLOQUE. Si dice "CNTR:OTPU6663866" pero el BL impreso tiene otro número, USAR EL DEL BLOQUE. Campos del bloque ILS CARGO: "BL MASTER:" → numero_bl_master, "BL NIETO:" → numero_bl_house, "VAPOR:" → nave (nave_corregida), "VIAJE:" → viaje (viaje_corregido), "TRANSHIPMENT:" → puerto_transbordo, "CNTR:" → numero_contenedor (4 letras + 7 dígitos), "EMISOR MBL:" → naviera, "PT DESC.:" → puerto_desembarque. Campos del bloque Asia Shipping: "MBL:" → numero_bl_master, "CIA:" → naviera, "O/F:" → flete, "GASTOS HASTA FOB:" → gastos origen. OBLIGATORIO: Si existe un bloque de corrección, incluir en el JSON un campo "correccion_aprobada" con TODOS los datos del bloque tal como aparecen: {"bl_master": "...", "bl_nieto": "...", "vapor": "...", "viaje": "...", "transhipment": "...", "cntr": "...", "emisor_mbl": "...", "pt_desc": "..."}. EJEMPLOS: "SSZ1761903" (sin marca) = MASTER, "UFM225040036 (H)" = HOUSE. "IBC1361555" (en bloque MBL:) = MASTER, "TBME250168 (H)" = HOUSE. OBLIGATORIO en el JSON: numero_bl_master (siempre), numero_bl_house ("" si no existe), numero_bl (= numero_bl_master), tipo_bl_house ("hijo" si tiene marca (H)/House/HBL, "nieto" si tiene marca (N)/Nieto, "" si no hay house). VALIDACIÓN: ALFANUMÉRICOS MAYÚSCULAS + dígitos solamente. REGLA ANTI-ALUCINACIÓN: NUNCA inventar un número de BL. Si no puedes leer claramente un número de BL master en el documento, dejar numero_bl_master como "" (vacío). Es MEJOR dejar vacío que inventar un número que no existe en el documento. Solo reportar números que REALMENTE aparecen escritos en el BL.
5. Incluye datos de flete, nave, viaje, puertos. REGLA ABSOLUTA DE FLETE: En TODOS los BL sin excepción, el flete se considera SIEMPRE PREPAID. No importa si el BL indica "COLLECT", "FREIGHT COLLECT", o si los valores aparecen en la columna COLLECT — para nuestros efectos el flete es SIEMPRE PREPAID. IDENTIFICACIÓN DE CARGOS: "O/F" = Ocean Freight (flete marítimo principal). Otros cargos de flete marítimo: BAF, CAF, THC destino, ISPS, bunker, EBS, GRI, PSS, CFS, LSS, DTHC, piracy surcharge, war risk, peak season. BÚSQUEDA OBLIGATORIA DE "GASTOS HASTA FOB" / "FOB CHARGES": En TODOS los BL, buscar ACTIVAMENTE en TODAS las páginas si existe una línea, sección, o campo que diga "Gastos hasta FOB", "FOB charges", "Gastos hasta F.O.B.", "FOB Charges", "Origin charges", "Charges at origin", "Local charges origin", o cualquier variación. FORMATO ASIA SHIPPING Y FREIGHT FORWARDERS: En BLs de Asia Shipping, Asi Shipping, ILS CARGO SPA, Danmar, UFM y otros freight forwarders, hay un BLOQUE DE TEXTO (sello o anotación) que contiene datos clave en formato: "MBL: [número]", "CIA: [naviera]", "FECHA: [fecha]", "O/F: [moneda] [monto]", "GASTOS HASTA FOB: [moneda] [monto]", "NAVE: [nombre]", "CONTENEDOR: [número]". Este bloque suele estar en la PARTE INFERIOR del BL, cerca de los sellos de la agencia de aduanas. ES OBLIGATORIO leer este bloque completo. El "MBL:" de este bloque es el numero_bl_master REAL. El "O/F:" es el flete marítimo. El "GASTOS HASTA FOB:" son los gastos de origen. El "NAVE:" es la nave corregida (tiene prioridad). El "CONTENEDOR:" es el número de contenedor correcto (tiene prioridad). INSTRUCCIONES DE REPORTE: (A) flete_detalle: array con cada cargo de flete MARÍTIMO ({concepto, monto, moneda}) — SOLO O/F + recargos marítimos. (B) gastos_hasta_fob: array con cada cargo de origen/FOB ({concepto, monto, moneda}) — incluye "Gastos hasta FOB", "FOB charges", handling, THC origen, documentation, stuffing, inland, wharfage, etc. (C) flete_total_prepaid: suma SOLO de (A). (D) gastos_fob_total: suma de (B). REGLA INCOTERM EXW y FOB: cuando es EXW o FOB, el flete es ÚNICO (solo el Ocean Freight / O/F). Cualquier OTRO cargo prepaid (THC, handling, documentation, BL fee, etc.) es "Gasto hasta FOB" y NO se suma al flete — va en gastos_hasta_fob. Para EXW y FOB: flete_total_prepaid = SOLO el ocean freight. Para otros incoterms (CIF, CFR, CPT, etc.) los gastos prepaid SÍ se suman al flete. condicion_flete SIEMPRE "PREPAID". Reportar OBLIGATORIAMENTE: flete_detalle, flete_total_prepaid, gastos_hasta_fob (NUNCA omitir — si no hay, poner []), gastos_fob_total (0 si no hay), moneda, condicion_flete, incoterm. NUNCA omitir flete_total_prepaid. NUNCA dejar flete_total_prepaid en 0 si hay valores de flete visibles. EJEMPLO REAL (Asia Shipping, EXW): Si el BL dice "O/F: EUR 1870,00" y "GASTOS HASTA FOB: EUR 895,00", reportar: flete_detalle: [{"concepto": "O/F", "monto": 1870.00, "moneda": "EUR"}], flete_total_prepaid: 1870.00, gastos_hasta_fob: [{"concepto": "Gastos hasta FOB", "monto": 895.00, "moneda": "EUR"}], gastos_fob_total: 895.00, incoterm: "EXW".
6. IMPORTANTE NAVES: Si aparecen DOS nombres de nave/vessel en el BL (ya sea tachado, sobreescrito, impreso o en cualquier formato), la PRIMERA es la nave original (nave_original) y la SEGUNDA es la nave corregida/actual (nave_corregida). No necesariamente están en manuscrito, pueden estar ambas impresas. REVISAR ESPECIALMENTE el campo "INITIAL CARRIAGE" o "PRE-CARRIAGE" en la primera página donde suelen aparecer ambas naves con sus viajes (formato: NAVE VIAJE). Si hay dos líneas en ese campo, son dos naves distintas. Ejemplo: "ZIM BALTIMORE 347/S" y "MYD SHENZHEN 68/S" significa nave_original=ZIM BALTIMORE, viaje_original=347/S, nave_corregida=MYD SHENZHEN, viaje_corregido=68/S.
7. IMPORTANTE PUERTOS: Si aparecen DOS puertos de descarga en el BL (en cualquier formato, no necesariamente manuscrito), el PRIMERO es el puerto de descarga final (puerto_desembarque) y el SEGUNDO es el puerto de transbordo (puerto_transbordo). SIEMPRE revisar si hay dos puertos o dos naves. Si el número de viaje fue corregido, incluir viaje_original y viaje_corregido. VALIDACIÓN DE PUERTOS: todos los puertos deben ser puertos marítimos REALES. Si el OCR lee un nombre que no es un puerto conocido, corregirlo al puerto real más similar (ej: "CAUCFDO" → "CAUCEDO", "MANZANLLO" → "MANZANILLO", "BALROA" → "BALBOA", "SAN ANTONO" → "SAN ANTONIO", "CALLAD" → "CALLAO").

EJEMPLO REAL DE EXTRACCIÓN CORRECTA (BL ZIM con corrección de nave):
Input: BL con INITIAL CARRIAGE mostrando "ZIM BALTIMORE 347/S" en primera línea y "MYD SHENZHEN 68/S" en segunda línea. PORT OF LOADING: "HOUSTON, TX // CALLAO". PORT OF DESTINATION: "SAN ANTONIO PORT".
Output esperado:
{
  "nave": "MYD SHENZHEN",
  "nave_original": "ZIM BALTIMORE",
  "nave_corregida": "MYD SHENZHEN",
  "viaje": "68/S",
  "viaje_original": "347/S",
  "viaje_corregido": "68/S",
  "puerto_embarque": "HOUSTON, TX",
  "puerto_transbordo": "CALLAO",
  "puerto_desembarque": "SAN ANTONIO PORT",
  "naviera": "ZIM Integrated Shipping Services"
}
Nota: "HOUSTON, TX // CALLAO" significa puerto de carga HOUSTON TX con transbordo en CALLAO. El "//" separa el puerto de carga del puerto de transbordo.
8. Para MANDATO: identificar fecha de firma y calcular fecha de vencimiento (1 año exacto desde la firma). Incluir mandante, mandatario, RUTs, notario y repertorio
9. NO omitas ningún dato visible en el documento

Responde SOLO con JSON válido (sin markdown, sin explicaciones) con este formato. IMPORTANTE: el JSON debe estar COMPLETO, no lo cortes. Si hay muchos contenedores, usa formato compacto (una línea por contenedor en el array). NO incluyas el campo "texto_completo" si el documento tiene más de 1 página — solo incluye tipo_documento, resumen y datos_extraidos:
{
  "tipo_documento": "uno de: ${TIPOS_DOCUMENTO.join(", ")}",
  "resumen": "resumen de 1-2 líneas del documento",
  "datos_extraidos": {
    // TODOS los campos que encuentres. Ejemplos según tipo:
    // BL: numero_bl (=numero_bl_master), numero_bl_master (OBLIGATORIO), numero_bl_house (OBLIGATORIO, "" si no existe), fecha_emision, shipper (nombre y dirección completa), consignee (nombre y dirección completa), notify_party, puerto_embarque, puerto_destino, nave, viaje, naviera, 
    //     contenedores: array de objetos con { numero_contenedor, sello, tipo_contenedor, numero_bultos, tipo_bulto, descripcion_mercancia, peso_bruto, peso_bruto_unidad, volumen, volumen_unidad, marcas, hs_code, pallets, bolsas_por_pallet },
    //     total_contenedores, total_bultos, peso_bruto_total, volumen_total, flete_detalle (array {concepto, monto, moneda}), flete_total_prepaid, condicion_flete ("PREPAID" siempre), incoterm, bl_tipo (original/copy),
    //     nave (nombre del buque actual), nave_original (si hubo corrección), nave_corregida (nuevo buque si aplica), viaje, viaje_original (si hubo corrección), viaje_corregido (nuevo viaje si aplica), naviera,
    //     puerto_destino, puerto_destino_original (si fue corregido), puerto_destino_corregido (si aplica), puerto_transbordo (si existe transbordo)
    // Invoice: numero_factura, proveedor, comprador, fecha, moneda, monto_total, items (array con descripcion, cantidad, unidad, precio_unitario, total), incoterm, pais_origen, condiciones_pago
    // Póliza: numero_poliza, aseguradora, asegurado, monto_asegurado, prima, moneda, cobertura, vigencia_desde, vigencia_hasta. IMPORTANTE PRIMA: la "prima" del seguro (premium) es OBLIGATORIA y va SIEMPRE en la raíz del JSON como campo "prima" (número). Buscarla con cuidado — suele aparecer como "PREMIUM", "PRIMA", o junto a las marcas/referencias. NO anidarla dentro de marcas_y_numeros. Convertir formato europeo (13,38 → 13.38). La prima es distinta del monto_asegurado (insured value).
    // Packing List: total_bultos, tipo_embalaje, peso_bruto_total, peso_neto_total, volumen_total, items (array con descripcion, cantidad, peso_bruto, peso_neto, dimensiones)
    // Certificado de Origen: numero_certificado, pais_origen, exportador, importador, descripcion_mercancia, tratado_aplicable, partida_arancelaria, fecha_emision
    // Ficha Técnica: producto, marca, modelo, especificaciones_tecnicas, composicion, uso
    // Mandato: mandante (quien otorga), mandatario (agente de aduanas), rut_mandante, rut_mandatario, fecha_firma, fecha_vencimiento (1 año desde la firma), alcance, notario, repertorio
  },
  "texto_completo": "el texto completo del documento tal como fue extraído"
}`;

    let analysisText: string = "";
    let gptFinishReason: string = "";

    // Buscar BLs anteriores correctos para dar contexto al modelo (few-shot memory + banco por naviera)
    let blExamples = "";
    try {
      // Obtener últimos BLs procesados con datos validados (preferir los que tienen mbl_shipsgo)
      const prevDocs = await pgQuery<{ datos_extraidos: string; datos_extraidos_claude: string; tipo_documento: string }>(
        "SELECT datos_extraidos, datos_extraidos_claude, tipo_documento FROM documentos WHERE rut_cliente = $1 AND tipo_documento = 'Bill of Lading (BL)' ORDER BY created_at DESC LIMIT 15",
        [finalRutCliente]
      );
      
      // Agrupar ejemplos por naviera/freight forwarder
      const porNaviera: Record<string, Array<{master: string; house: string; flete: string; gastosFob: string; containers: string; naviera: string; incoterm: string}>> = {};
      const allExamples: string[] = [];

      for (const d of prevDocs) {
        try {
          const parsed = typeof d.datos_extraidos === "string" ? JSON.parse(d.datos_extraidos) : d.datos_extraidos;
          if (!parsed) continue;
          
          const master = parsed.mbl_shipsgo || parsed.numero_bl_master || parsed.numero_bl || "";
          const house = parsed.numero_bl_house || "";
          const flete = parsed.flete_total_prepaid || "";
          const gastosFob = parsed.gastos_fob_total || "";
          const incoterm = parsed.incoterm || "";
          const naviera = String(parsed.naviera || parsed.cia_transportadora || parsed.carrier || "").toUpperCase();
          const containers = Array.isArray(parsed.contenedores) 
            ? parsed.contenedores.map((c: Record<string, unknown>) => c.numero_contenedor).filter(Boolean).join(", ")
            : "";
          
          if (master) {
            const entry = { master, house, flete, gastosFob, containers, naviera, incoterm };
            
            // Agrupar por naviera
            if (naviera) {
              if (!porNaviera[naviera]) porNaviera[naviera] = [];
              if (porNaviera[naviera].length < 3) porNaviera[naviera].push(entry);
            }
            
            // Lista general (máximo 5)
            if (allExamples.length < 5) {
              let example = `MBL: ${master}`;
              if (house) example += ` | HBL(H): ${house}`;
              if (flete) example += ` | O/F: ${flete}`;
              if (gastosFob) example += ` | Gastos FOB: ${gastosFob}`;
              if (incoterm) example += ` | Incoterm: ${incoterm}`;
              if (naviera) example += ` | Naviera: ${naviera}`;
              if (containers) example += ` | Contenedores: ${containers}`;
              allExamples.push(example);
            }
          }
        } catch { /* ignore individual parse errors */ }
      }
      
      if (allExamples.length > 0) {
        blExamples = `\n\nEJEMPLOS DE BLs ANTERIORES CORRECTAMENTE PROCESADOS (usa como referencia):
${allExamples.map((e, i) => `${i + 1}. ${e}`).join("\n")}`;
      }

      // Agregar reglas específicas por naviera
      const navieraRules: string[] = [];
      for (const [naviera, entries] of Object.entries(porNaviera)) {
        const hasHouse = entries.some(e => e.house);
        const hasGastosFob = entries.some(e => e.gastosFob);
        const incoterms = [...new Set(entries.map(e => e.incoterm).filter(Boolean))];
        
        let rule = `- ${naviera}: `;
        if (hasHouse) {
          const houseExample = entries.find(e => e.house);
          rule += `Tiene MBL + HBL(H). Ej: MBL=${houseExample?.master}, HBL=${houseExample?.house}. `;
        }
        if (hasGastosFob) {
          const fobExample = entries.find(e => e.gastosFob);
          rule += `Tiene "Gastos hasta FOB" separados del flete (O/F=${fobExample?.flete}, FOB=${fobExample?.gastosFob}). `;
        }
        if (incoterms.length > 0) {
          rule += `Incoterms usados: ${incoterms.join(", ")}. `;
        }
        navieraRules.push(rule);
      }

      if (navieraRules.length > 0) {
        blExamples += `\n\nREGLAS APRENDIDAS POR NAVIERA/FREIGHT FORWARDER (aplicar cuando el BL sea de la misma naviera):
${navieraRules.join("\n")}
IMPORTANTE: Si el BL actual es de una naviera listada arriba, SEGUIR el mismo patrón de clasificación (master/house, flete/gastos FOB).`;
      }

      blExamples += `\nREGLA: Si no puedes identificar claramente un número de BL master DIFERENTE al house en el documento, deja numero_bl_master vacío (""). NUNCA inventes un número.`;
    } catch { /* ignore */ }

    // Agregar ejemplos VERIFICADOS (gold standard) de la tabla de feedback
    try {
      // Detectar naviera probable por el texto para priorizar ejemplos relevantes
      const navieraHint = (() => {
        const t = (documentText || "").toUpperCase();
        const navieras = ["ASIA SHIPPING", "ILS CARGO", "DANMAR", "MAERSK", "MSC", "CMA", "HAPAG", "COSCO", "ONE", "ZIM", "EVERGREEN", "HMM", "YANG MING", "WAN HAI", "OOCL"];
        return navieras.find(n => t.includes(n)) || "";
      })();
      const ejemplosVerificados = await obtenerEjemplosBL(finalRutCliente, navieraHint);
      if (ejemplosVerificados) {
        blExamples += ejemplosVerificados;
        console.log("[docs] Ejemplos verificados agregados al prompt (naviera hint:", navieraHint || "ninguna", ")");
      }
    } catch { /* ignore */ }

    // Agregar ejemplos al prompt
    const finalPrompt = prompt + blExamples;

    if (isImage) {
      // Para imágenes: usar modelo de visión avanzado
      const dataUrl = `data:${mimeType};base64,${base64}`;
      console.log("[docs] Analyzing image with vision model:", gptModel);
      const result = await generateText({
        model: openai(gptModel),
        maxOutputTokens: 32000,
        providerOptions: { openai: { reasoningEffort: "minimal" } },
        messages: [
          { role: "user" as const, content: [{ type: "text" as const, text: finalPrompt }, { type: "image" as const, image: dataUrl }] },
        ],
      });
      analysisText = result.text;
      gptFinishReason = result.finishReason;
    } else if (isPdf && documentText.length > 20) {
      // Para PDFs con texto extraíble: TAMBIÉN usar visión para detectar correcciones visuales
      // Intentar convertir a PNG primero para capturar detalles visuales
      console.log("[docs] PDF with text, trying vision first for visual corrections, text length:", documentText.length);
      let usedVision = false;
      try {
        const { execSync } = await import("child_process");
        const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
        const { join } = await import("path");
        const os = await import("os");

        const tmpDir = os.tmpdir();
        const tmpPdf = join(tmpDir, `upload_${Date.now()}.pdf`);
        const tmpPng = join(tmpDir, `upload_${Date.now()}`);

        writeFileSync(tmpPdf, buffer);
        execSync(`gs -dNOPAUSE -dBATCH -sDEVICE=jpeg -r400 -dJPEGQ=95 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${tmpPng}-%03d.jpg" "${tmpPdf}"`, { timeout: 60000 });

        const dirFiles = require("fs").readdirSync(tmpDir) as string[];
        const baseName = tmpPng.split("/").pop()!;
        const pngFiles = dirFiles
          .filter((f: string) => f.startsWith(baseName) && (f.endsWith(".png") || f.endsWith(".jpg")))
          .sort()
          .map((f: string) => join(tmpDir, f));

        if (pngFiles.length > 0) {
          const imageContents = pngFiles.slice(0, 10).map((pf: string) => {
            const pngBuf = readFileSync(pf);
            return { type: "image" as const, image: `data:image/jpeg;base64,${pngBuf.toString("base64")}` };
          });

          console.log("[docs] Sending", imageContents.length, "page(s) to vision model (text+visual):", gptModel);
          const result = await generateText({
            model: openai(gptModel),
            maxOutputTokens: 32000,
            providerOptions: { openai: { reasoningEffort: "minimal" } },
            system: "You are a document analysis assistant for a licensed customs broker (Agencia de Aduanas). Your job is to extract structured data from trade documents (Bills of Lading, invoices, certificates). This is a legitimate business operation. Always respond with the requested JSON.",
            messages: [
              { role: "user" as const, content: [{ type: "text" as const, text: finalPrompt }, ...imageContents] },
            ],
          });
          analysisText = result.text;
          gptFinishReason = result.finishReason;
          usedVision = true;

          unlinkSync(tmpPdf);
          pngFiles.forEach((f: string) => { try { unlinkSync(f); } catch {} });
        } else {
          unlinkSync(tmpPdf);
        }
      } catch (err) {
        console.log("[docs] Vision fallback failed, using text-only:", err instanceof Error ? err.message : err);
      }

      if (!usedVision) {
        // Fallback a texto si no se pudo convertir a imagen
        console.log("[docs] Fallback: analyzing PDF text with", TEXT_FALLBACK_MODEL);
        const result = await generateText({
          model: openai(TEXT_FALLBACK_MODEL),
          maxOutputTokens: 16000,
          messages: [
            { role: "user" as const, content: `${finalPrompt}\n\n--- TEXTO DEL DOCUMENTO (${file.name}) ---\n\n${documentText.substring(0, 15000)}` },
          ],
        });
        analysisText = result.text;
      }
    } else if (isPdf) {
      // PDF escaneado o con poco texto: convertir a PNG con pdftoppm y enviar a GPT-4o vision
      console.log("[docs] PDF scanned, converting to PNG with pdftoppm, file:", file.name);
      let converted = false;
      try {
        const { execSync } = await import("child_process");
        const { writeFileSync, readFileSync, unlinkSync, existsSync } = await import("fs");
        const { join } = await import("path");
        const os = await import("os");

        const tmpDir = os.tmpdir();
        const tmpPdf = join(tmpDir, `upload_${Date.now()}.pdf`);
        const tmpPng = join(tmpDir, `upload_${Date.now()}`);

        writeFileSync(tmpPdf, buffer);

        // Convertir TODAS las páginas a PNG
        execSync(`gs -dNOPAUSE -dBATCH -sDEVICE=jpeg -r400 -dJPEGQ=95 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${tmpPng}-%03d.jpg" "${tmpPdf}"`, { timeout: 60000 });

        // Buscar todos los archivos PNG generados
        const dirFiles = require("fs").readdirSync(tmpDir) as string[];
        const baseName = tmpPng.split("/").pop()!;
        const pngFiles = dirFiles
          .filter((f: string) => f.startsWith(baseName) && (f.endsWith(".png") || f.endsWith(".jpg")))
          .sort()
          .map((f: string) => join(tmpDir, f));

        console.log("[docs] PNG pages generated:", pngFiles.length);

        if (pngFiles.length > 0) {
          // Enviar todas las páginas (máximo 10) a GPT-4o vision
          const imageContents = pngFiles.slice(0, 10).map((pf: string) => {
            const pngBuf = readFileSync(pf);
            return { type: "image" as const, image: `data:image/jpeg;base64,${pngBuf.toString("base64")}` };
          });

          console.log("[docs] Sending", imageContents.length, "page(s) to vision model:", gptModel);

          const result = await generateText({
            model: openai(gptModel),
            maxOutputTokens: 32000,
            providerOptions: { openai: { reasoningEffort: "minimal" } },
            system: "You are a document analysis assistant for a licensed customs broker (Agencia de Aduanas). Your job is to extract structured data from trade documents (Bills of Lading, invoices, certificates). This is a legitimate business operation. Always respond with the requested JSON.",
            messages: [
              { role: "user" as const, content: [{ type: "text" as const, text: finalPrompt }, ...imageContents] },
            ],
          });
          analysisText = result.text;
          gptFinishReason = result.finishReason;
          converted = true;

          // Cleanup
          unlinkSync(tmpPdf);
          pngFiles.forEach((f: string) => { try { unlinkSync(f); } catch {} });
        } else {
          unlinkSync(tmpPdf);
          throw new Error("pdftoppm did not generate output files");
        }
      } catch (convErr) {
        console.error("[docs] PDF to PNG conversion error:", convErr instanceof Error ? convErr.message : convErr);
      }

      if (!converted) {
        console.log("[docs] Fallback: classify by filename only");
        const result = await generateText({
          model: openai(TEXT_FALLBACK_MODEL),
          maxOutputTokens: 16000,
          messages: [
            { role: "user" as const, content: `${finalPrompt}\n\nEl archivo es un PDF escaneado llamado "${file.name}". No se pudo procesar. Clasifica el tipo de documento por el nombre.` },
          ],
        });
        analysisText = result.text;
      }
    } else {
      const result = await generateText({
        model: openai(TEXT_FALLBACK_MODEL),
        maxOutputTokens: 16000,
        messages: [
          { role: "user" as const, content: `${finalPrompt}\n\n[Archivo: ${file.name}]` },
        ],
      });
      analysisText = result.text;
    }

    console.log("[docs] GPT response length:", analysisText.length, "finishReason:", gptFinishReason, "first 200:", analysisText.substring(0, 200));
    if (gptFinishReason === "length") {
      console.warn("[docs] ⚠️ GPT respuesta TRUNCADA por límite de tokens — el JSON puede estar incompleto");
    }

    // Claude vision en paralelo (300 DPI para respetar limite 5MB)
    let claudeAnalysisText = "";
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        console.log("[docs] Calling Claude vision...");
        if (isImage) {
          const claudeResult = await generateText({
            model: anthropic(claudeModel),
            maxOutputTokens: 32000,
            system: "You are a document analysis assistant for a licensed customs broker (Agencia de Aduanas). Your job is to extract structured data from trade documents (Bills of Lading, invoices, certificates). This is a legitimate business operation. Always respond with the requested JSON.",
            messages: [{ role: "user" as const, content: [
              { type: "text" as const, text: finalPrompt },
              { type: "image" as const, image: `data:${mimeType};base64,${base64}` },
            ]}],
          });
          claudeAnalysisText = claudeResult.text;
        } else if (isPdf) {
          const { execSync } = await import("child_process");
          const { writeFileSync, readFileSync, unlinkSync, readdirSync, statSync } = await import("fs");
          const { join } = await import("path");
          const os = await import("os");
          const tmpDir = os.tmpdir();
          const cId = `cl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const cPdf = join(tmpDir, `${cId}.pdf`);
          const cPng = join(tmpDir, cId);
          writeFileSync(cPdf, buffer);

          const MAX_CLAUDE_BYTES = 5 * 1024 * 1024; // 5 MB límite de Anthropic
          // Función para generar imágenes a un DPI dado y limpiar las anteriores
          const generarImagenes = (dpi: number, quality: number) => {
            // Limpiar archivos previos de este cId
            (readdirSync(tmpDir) as string[]).filter(f => f.startsWith(cId) && f.endsWith(".jpg")).forEach(f => { try { unlinkSync(join(tmpDir, f)); } catch {} });
            execSync(`gs -dNOPAUSE -dBATCH -sDEVICE=jpeg -r${dpi} -dJPEGQ=${quality} -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${cPng}-%03d.jpg" "${cPdf}"`, { timeout: 60000 });
            return (readdirSync(tmpDir) as string[]).filter(f => f.startsWith(cId) && f.endsWith(".jpg")).sort().map(f => join(tmpDir, f));
          };

          // Intentar con DPI decreciente hasta que todas las imágenes estén bajo 5 MB
          const dpiOptions = [400, 300, 250, 200, 150];
          let cFiles: string[] = [];
          for (const dpi of dpiOptions) {
            const quality = dpi >= 300 ? 90 : 85;
            cFiles = generarImagenes(dpi, quality);
            const maxSize = cFiles.reduce((max, f) => Math.max(max, statSync(f).size), 0);
            console.log(`[docs] Claude: DPI ${dpi} → max image size ${(maxSize / 1024 / 1024).toFixed(2)} MB (${cFiles.length} páginas)`);
            if (maxSize <= MAX_CLAUDE_BYTES) {
              console.log(`[docs] Claude: usando DPI ${dpi} (todas las imágenes bajo 5 MB)`);
              break;
            }
            if (dpi === dpiOptions[dpiOptions.length - 1]) {
              console.warn(`[docs] Claude: ⚠️ incluso a ${dpi} DPI alguna imagen supera 5 MB`);
            }
          }

          if (cFiles.length > 0) {
            // Filtrar solo imágenes bajo el límite (descartar las que aún superen 5 MB)
            const validFiles = cFiles.filter(f => statSync(f).size <= MAX_CLAUDE_BYTES);
            const filesToUse = validFiles.length > 0 ? validFiles : cFiles;
            const cImages = filesToUse.slice(0, 10).map(f => ({ type: "image" as const, image: `data:image/jpeg;base64,${readFileSync(f).toString("base64")}` }));
            console.log("[docs] Sending", cImages.length, "page(s) to Claude vision:", claudeModel);
            const claudeResult = await generateText({
              model: anthropic(claudeModel),
              maxOutputTokens: 32000,
              system: "You are a document analysis assistant for a licensed customs broker (Agencia de Aduanas). Your job is to extract structured data from trade documents (Bills of Lading, invoices, certificates). This is a legitimate business operation. Always respond with the requested JSON.",
            messages: [{ role: "user" as const, content: [{ type: "text" as const, text: finalPrompt }, ...cImages] }],
            });
            claudeAnalysisText = claudeResult.text;
            unlinkSync(cPdf);
            cFiles.forEach(f => { try { unlinkSync(f); } catch {} });
          } else {
            unlinkSync(cPdf);
          }
        }
        console.log("[docs] Claude response length:", claudeAnalysisText.length);
      }
    } catch (claudeErr) {
      console.error("[docs] Claude error:", claudeErr instanceof Error ? claudeErr.message : String(claudeErr));
    }

    // Parsear Claude
    let claudeAnalysis = {};
    if (claudeAnalysisText) {
      try {
        let cl = claudeAnalysisText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const s = cl.indexOf("{"), e = cl.lastIndexOf("}");
        if (s >= 0 && e > s) cl = cl.substring(s, e + 1);
        const parsed = JSON.parse(cl);
        claudeAnalysis = parsed.datos_extraidos || parsed;
      } catch {
        try {
          let cl = claudeAnalysisText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const s = cl.indexOf("{");
          if (s >= 0) {
            cl = cl.substring(s);
            let ob = 0, oq = 0, ins = false;
            for (let i = 0; i < cl.length; i++) { const c = cl[i]; if (c === '"' && cl[i-1] !== '\\') ins = !ins; if (!ins) { if (c === '{') ob++; if (c === '}') ob--; if (c === '[') oq++; if (c === ']') oq--; } }
            if (ins) cl += '"';
            for (let i = 0; i < oq; i++) cl += "]";
            for (let i = 0; i < ob; i++) cl += "}";
            const parsed = JSON.parse(cl);
            claudeAnalysis = parsed.datos_extraidos || parsed;
          }
        } catch (e2) {
          console.error("[docs] Claude JSON error:", e2 instanceof Error ? e2.message : e2);
        }
      }
    }

    // Llamada paralela a Claude para comparación
    // Parsear respuesta GPT
    let analysis;
    try {
      let cleaned = analysisText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }
      analysis = JSON.parse(cleaned);
    } catch (parseErr) {
      // Si el JSON está cortado, intentar repararlo
      console.error("[docs] JSON parse error:", parseErr instanceof Error ? parseErr.message : parseErr);
      console.error("[docs] Raw response (first 500):", analysisText.substring(0, 500));
      try {
        let cleaned = analysisText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const jsonStart = cleaned.indexOf("{");
        if (jsonStart >= 0) {
          cleaned = cleaned.substring(jsonStart);
          // Cerrar strings, arrays y objetos abiertos
          let openBraces = 0, openBrackets = 0, inString = false;
          for (let i = 0; i < cleaned.length; i++) {
            const c = cleaned[i];
            if (c === '"' && cleaned[i-1] !== '\\') inString = !inString;
            if (!inString) {
              if (c === '{') openBraces++;
              if (c === '}') openBraces--;
              if (c === '[') openBrackets++;
              if (c === ']') openBrackets--;
            }
          }
          // Si estamos dentro de un string, cerrarlo
          if (inString) cleaned += '"';
          // Cerrar brackets y braces abiertos
          for (let i = 0; i < openBrackets; i++) cleaned += "]";
          for (let i = 0; i < openBraces; i++) cleaned += "}";
          analysis = JSON.parse(cleaned);
          console.log("[docs] JSON repaired successfully");
        } else {
          throw new Error("No JSON found");
        }
      } catch {
        analysis = {
          tipo_documento: "Otro",
          resumen: "JSON incompleto - documento procesado parcialmente",
          datos_extraidos: {},
          texto_completo: documentText || analysisText,
        };
      }
    }

    // Si el PDF tenía texto, usarlo como texto_completo
    if (isPdf && documentText.length > 50) {
      analysis.texto_completo = documentText;
    }

    // Post-procesamiento: corregir clasificación del tipo de documento por keywords
    // (la IA a veces confunde Packing List con Invoice, o Certificado de Origen con otros)
    {
      // Incluir TODAS las fuentes de texto: nombre, texto PDF, respuestas raw de ambos modelos, y JSON parseado
      const textoClasif = [
        file.name,
        documentText,
        analysisText,
        claudeAnalysisText,
        JSON.stringify(analysis || {}),
        JSON.stringify(claudeAnalysis || {}),
      ].filter(Boolean).join(" ").toUpperCase();
      const tipoActual = String(
        (claudeAnalysis as Record<string, unknown>)?.tipo_documento || 
        analysis.tipo_documento || ""
      );
      console.log("[docs] CLASIFICACIÓN: tipo IA =", tipoActual,
        "| ORIGIN/ORIGEN:", /ORIGIN|ORIGEN/.test(textoClasif),
        "| CRITERIO DE ORIGEN:", /CRITERIO\s*DE\s*ORIGEN/.test(textoClasif),
        "| PREFERENCE CRITERION:", /PREFERENCE\s*CRITERION/.test(textoClasif),
        "| TRATADO/FTA:", /TRATADO\s*DE\s*LIBRE\s*COMERCIO|FREE\s*TRADE\s*AGREEMENT/.test(textoClasif),
        "| PACKING:", /PACKING/.test(textoClasif));

      // Si la IA ya clasificó como BL o Invoice con datos sólidos, NO reclasificar
      // (un BL puede mencionar "origin", "free trade" en cláusulas legales)
      const esBLConfiable = tipoActual === "Bill of Lading (BL)" &&
        (analysis.datos_extraidos?.numero_bl_master || analysis.datos_extraidos?.numero_bl || Array.isArray(analysis.datos_extraidos?.contenedores));
      const esInvoiceConfiable = tipoActual === "Invoice (Factura Comercial)" && analysis.datos_extraidos?.numero_factura;

      if (esBLConfiable || esInvoiceConfiable) {
        console.log("[docs] CLASIFICACIÓN: respetando tipo IA confiable (", tipoActual, ") — no se reclasifica");
      } else
      // Bill of Lading — rescatar si la IA lo puso como "Otro" pero tiene keywords de BL
      if (/BILL\s*OF\s*LADING|B\/L\s*N|CONOCIMIENTO\s*DE\s*EMBARQUE|SEA\s*WAYBILL|SHIPPED\s*ON\s*BOARD|FREIGHT\s*PREPAID|OCEAN\s*BILL/.test(textoClasif)
          && tipoActual !== "Bill of Lading (BL)"
          && tipoActual !== "Invoice (Factura Comercial)"
          && tipoActual !== "Lista de Empaque (Packing List)") {
        console.log("[docs] CLASIFICACIÓN corregida:", tipoActual, "→ Bill of Lading (BL)");
        analysis.tipo_documento = "Bill of Lading (BL)";
      } else
      // Invoice — rescatar si tiene keywords de factura comercial
      if (/COMMERCIAL\s*INVOICE|FACTURA\s*COMERCIAL|INVOICE\s*N|INVOICE\s*DATE|TOTAL\s*AMOUNT|UNIT\s*PRICE|PRECIO\s*UNITARIO/.test(textoClasif)
          && !/PACKING|WEIGHT\s*LIST/.test(textoClasif)
          && tipoActual !== "Invoice (Factura Comercial)"
          && tipoActual !== "Bill of Lading (BL)"
          && tipoActual !== "Lista de Empaque (Packing List)"
          && tipoActual !== "Certificado de Origen") {
        console.log("[docs] CLASIFICACIÓN corregida:", tipoActual, "→ Invoice (Factura Comercial)");
        analysis.tipo_documento = "Invoice (Factura Comercial)";
      } else
      // Póliza de Seguro — rescatar si tiene keywords de seguro/póliza (ANTES de Packing List)
      if (/INSURANCE\s*CERTIFICATE|INSURANCE\s*POLICY|POLIZA\s*DE\s*SEGURO|CERTIFICADO\s*DE\s*SEGURO|OPEN\s*CARGO\s*POLICY|MARINE\s*INSURANCE|INSURED\s*AMOUNT|MONTO\s*ASEGURADO|SUMA\s*ASEGURADA|CLAIM\s*AGENT/.test(textoClasif)
          && tipoActual !== "Póliza de Seguro"
          && tipoActual !== "Bill of Lading (BL)"
          && tipoActual !== "Invoice (Factura Comercial)") {
        console.log("[docs] CLASIFICACIÓN corregida:", tipoActual, "→ Póliza de Seguro");
        analysis.tipo_documento = "Póliza de Seguro";
      } else
      // Certificado Sanitario SEREMI — CDA, SEREMI, Destinación Aduanera
      if (/SEREMI|DESTINACI[OÓ]N\s*ADUANERA|\bCDA\b|CERTIFICADO\s*DE\s*DESTINACI|AUTORIDAD\s*SANITARIA/.test(textoClasif)
          && tipoActual !== "Certificado Sanitario (SEREMI)"
          && tipoActual !== "Bill of Lading (BL)"
          && tipoActual !== "Invoice (Factura Comercial)") {
        console.log("[docs] CLASIFICACIÓN corregida:", tipoActual, "→ Certificado Sanitario (SEREMI)");
        analysis.tipo_documento = "Certificado Sanitario (SEREMI)";
      } else
      // Packing List (NO aplicar si el documento ES una póliza de seguro)
      if (/PACKING\s*LIST|LISTA\s*DE\s*EMPAQUE|LISTA\s*DE\s*EMBALAJE|PACKING\s*SLIP|WEIGHT\s*LIST/.test(textoClasif)
          && !/INSURANCE\s*(CERTIFICATE|POLICY)|POLIZA\s*DE\s*SEGURO|OPEN\s*CARGO\s*POLICY|MARINE\s*INSURANCE/.test(textoClasif)
          && tipoActual !== "Lista de Empaque (Packing List)") {
        console.log("[docs] CLASIFICACIÓN corregida:", tipoActual, "→ Lista de Empaque (Packing List)");
        analysis.tipo_documento = "Lista de Empaque (Packing List)";
      }
      // Certificado de Origen (solo si no es fitosanitario/calidad)
      // Incluye certificados de TLC/FTA que NO dicen "certificate of origin" explícitamente
      else if ((/CERTIFICATE\s*OF\s*ORIGIN|CERTIFICAT\s*D'ORIGINE|CERTIFICADO\s*DE\s*ORIGEN|ZERTIFIKAT|CERTIFICATO\s*DI\s*ORIGINE|\bFORM\s*[AEB]\b|EUR\.?\s*1|NON[\s-]*PREFERENTIAL\s*ORIGIN|PREFERENTIAL\s*ORIGIN|DECLARATION\s*OF\s*ORIGIN|CHAMBER\s*OF\s*COMMERCE|CCPIT/.test(textoClasif)
            || /CRITERIO\s*DE\s*ORIGEN/.test(textoClasif)
            || /PREFERENCE\s*CRITERION/.test(textoClasif)
            || (/TRATADO\s*DE\s*LIBRE\s*COMERCIO|FREE\s*TRADE\s*AGREEMENT/.test(textoClasif) && /ORIGEN|ORIGIN|ORIGINARIA|ORIGINATING|ARANCELARIA|HS\s*TARIFF/.test(textoClasif)))
          && !/FITOSANITARI|PHYTOSANITARY|QUALITY\s*CERTIFICATE|CERTIFICADO\s*DE\s*CALIDAD/.test(textoClasif)
          && tipoActual !== "Certificado de Origen") {
        console.log("[docs] CLASIFICACIÓN corregida:", tipoActual, "→ Certificado de Origen");
        analysis.tipo_documento = "Certificado de Origen";
      }
    }

    // Post-procesamiento PÓLIZA: normalizar la prima (puede venir anidada o en formato europeo)
    {
      const normPrima = (datos: Record<string, unknown>) => {
        if (!datos) return;
        const toNum = (v: unknown): number => {
          if (v == null) return 0;
          // Formato europeo: "13,38" → 13.38 ; "1.234,56" → 1234.56
          let s = String(v).trim().replace(/[^\d.,-]/g, "");
          if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
          else if (s.includes(",")) s = s.replace(",", ".");
          const n = parseFloat(s);
          return isNaN(n) ? 0 : n;
        };
        // Si no hay prima en raíz, buscarla anidada
        let prima = toNum(datos.prima);
        if (!prima) {
          const mn = datos.marcas_y_numeros as Record<string, unknown> | undefined;
          if (mn && mn.prima) prima = toNum(mn.prima);
        }
        if (!prima && datos.premium) prima = toNum(datos.premium);
        if (prima) {
          datos.prima = prima; // dejar siempre en raíz como número
          console.log("[docs] PÓLIZA prima normalizada:", prima);
        }
      };
      if (analysis.tipo_documento === "Póliza de Seguro") {
        if (analysis.datos_extraidos) normPrima(analysis.datos_extraidos);
        if (claudeAnalysis) normPrima(claudeAnalysis as Record<string, unknown>);
      }
    }

    // Post-procesamiento: separar gastos hasta FOB del flete cuando es EXW
    // Estrategia: identificar qué ES flete marítimo, todo lo demás es gasto hasta FOB
    const OCEAN_FREIGHT_KEYWORDS = [
      "o/f", "ocean freight", "freight", "baf", "caf", "bunker", "ebs", "gri", 
      "pss", "peak season", "war risk", "piracy", "ams", "isps destination",
      "currency adjustment", "fuel surcharge", "emergency bunker", "low sulphur",
      "lss", "imo 2020", "carrier security", "panama canal", "suez canal",
      "congestion surcharge", "port congestion", "winter surcharge",
      "rate restoration", "general rate increase"
    ];

    const isOceanFreight = (concepto: string): boolean => {
      const lower = (concepto || "").toLowerCase();
      // O/F es siempre flete marítimo
      if (lower === "o/f" || lower === "of") return true;
      return OCEAN_FREIGHT_KEYWORDS.some(kw => lower.includes(kw));
    };

    // Keywords que son SIEMPRE gastos hasta FOB (origin charges)
    const FOB_CHARGE_KEYWORDS = [
      "fob", "origin", "inland", "haulage", "stuffing", "wharfage", "documentation",
      "handling", "thc", "container stuffing", "loading", "cartage",
      "pick up", "pickup", "drayage", "warehouse", "consolidation",
      "gastos origen", "cargos origen", "local charges", "export customs",
      "seal", "vgm", "isf filing", "bl fee", "b/l fee", "cfs",
      "terminal handling", "port charges", "chassis", "gate", "inspection",
      "fumigation", "lashing", "securing", "weighing", "scanning",
      "booking fee", "equipment", "container deposit", "detention",
      "demurrage", "storage", "lift on", "lift off"
    ];

    const isFobCharge = (concepto: string): boolean => {
      const lower = (concepto || "").toLowerCase();
      return FOB_CHARGE_KEYWORDS.some(kw => lower.includes(kw));
    };

    const fixFleteEXW = (datos: Record<string, unknown>) => {
      const incoterm = String(datos.incoterm || "").toUpperCase();
      // Aplica para EXW y FOB: el flete es único (solo O/F), el resto es gasto hasta FOB
      if (!incoterm.includes("EXW") && !incoterm.includes("FOB")) return;

      console.log("[docs]", incoterm, "detectado. Buscando O/F y Gastos hasta FOB...");

      // ESTRATEGIA PRINCIPAL: Buscar directamente en el texto del PDF
      // Esto es lo más confiable para BLs de Asia Shipping y freight forwarders
      const textToSearch = documentText || "";
      let ofFromText = 0;
      let fobFromText = 0;
      let monedaFromText = "";

      if (textToSearch.length > 0) {
        // Buscar O/F: EUR 1870,00 o O/F: 1870.00
        const ofPatterns = [
          /O\/F\s*:?\s*([A-Z]{3})?\s*([\d.,]+)/gi,
          /OCEAN\s*FREIGHT\s*:?\s*([A-Z]{3})?\s*([\d.,]+)/gi,
        ];
        for (const pattern of ofPatterns) {
          const match = pattern.exec(textToSearch);
          if (match) {
            monedaFromText = match[1] || "";
            const montoStr = match[2].replace(/\./g, "").replace(",", ".");
            ofFromText = parseFloat(montoStr) || 0;
            if (ofFromText > 0) {
              console.log("[docs] EXW TEXT: O/F encontrado:", ofFromText, monedaFromText);
              break;
            }
          }
        }

        // Buscar GASTOS HASTA FOB: EUR 895,00
        const fobPatterns = [
          /GASTOS\s*HASTA\s*F\.?O\.?B\.?\s*:?\s*([A-Z]{3})?\s*([\d.,]+)/gi,
          /FOB\s*CHARGES?\s*:?\s*([A-Z]{3})?\s*([\d.,]+)/gi,
          /CARGOS?\s*HASTA\s*F\.?O\.?B\.?\s*:?\s*([A-Z]{3})?\s*([\d.,]+)/gi,
          /ORIGIN\s*CHARGES?\s*:?\s*([A-Z]{3})?\s*([\d.,]+)/gi,
          /GASTOS?\s*F\.?O\.?B\.?\s*:?\s*([A-Z]{3})?\s*([\d.,]+)/gi,
        ];
        for (const pattern of fobPatterns) {
          const match = pattern.exec(textToSearch);
          if (match) {
            if (!monedaFromText) monedaFromText = match[1] || "";
            const montoStr = match[2].replace(/\./g, "").replace(",", ".");
            fobFromText = parseFloat(montoStr) || 0;
            if (fobFromText > 0) {
              console.log("[docs] EXW TEXT: Gastos hasta FOB encontrado:", fobFromText, monedaFromText);
              break;
            }
          }
        }
      }

      // Si encontramos valores en el texto, usarlos como fuente de verdad
      if (ofFromText > 0 || fobFromText > 0) {
        const moneda = monedaFromText || String(datos.moneda || "EUR");
        
        if (ofFromText > 0) {
          datos.flete_detalle = [{ concepto: "O/F", monto: ofFromText, moneda }];
          datos.flete_total_prepaid = ofFromText;
          console.log("[docs]", incoterm, "FIX: flete_total_prepaid corregido a O/F:", ofFromText, moneda);
        }
        
        if (fobFromText > 0) {
          datos.gastos_hasta_fob = [{ concepto: "Gastos hasta FOB", monto: fobFromText, moneda }];
          datos.gastos_fob_total = fobFromText;
          console.log("[docs]", incoterm, "FIX: gastos_fob_total:", fobFromText, moneda);
        } else {
          datos.gastos_hasta_fob = [];
          datos.gastos_fob_total = 0;
        }
        
        datos._flete_exw_corregido = true;
        datos._fob_extraido_de_texto = true;
        return;
      }

      // FALLBACK: Si no hay texto del PDF, buscar en el JSON de la IA
      console.log("[docs]", incoterm, ": no se encontró en texto PDF, buscando en JSON...");

      // Buscar gastos_hasta_fob en campos del JSON
      const fobFieldNames = [
        "gastos_hasta_fob", "gastos_fob", "fob_charges", "origin_charges",
        "gastos_origen", "cargos_origen", "local_charges", "charges_fob",
        "gastos_hasta_fob_total", "total_fob_charges", "fob_total"
      ];
      
      let fobTotal = 0;
      let fobItems: Array<Record<string, unknown>> = [];
      
      for (const fieldName of fobFieldNames) {
        const val = datos[fieldName];
        if (val !== undefined && val !== null && val !== "" && val !== 0) {
          if (typeof val === "number") {
            fobTotal = val;
          } else if (typeof val === "string" && parseFloat(val)) {
            fobTotal = parseFloat(val);
          } else if (Array.isArray(val)) {
            fobItems = val as Array<Record<string, unknown>>;
          }
        }
      }

      // Buscar en flete_detalle items que NO sean ocean freight
      const fleteDetalle = datos.flete_detalle;
      if (Array.isArray(fleteDetalle) && fleteDetalle.length > 0) {
        const fleteItems: Array<Record<string, unknown>> = [];
        const fobFromFlete: Array<Record<string, unknown>> = [];

        for (const item of fleteDetalle) {
          const concepto = String((item as Record<string, unknown>).concepto || (item as Record<string, unknown>).descripcion || "").toLowerCase();
          if (concepto.includes("o/f") || concepto.includes("ocean freight") || concepto.includes("freight") && !concepto.includes("fob")) {
            fleteItems.push(item as Record<string, unknown>);
          } else if (concepto.includes("fob") || concepto.includes("origin") || concepto.includes("gastos")) {
            fobFromFlete.push(item as Record<string, unknown>);
          } else if (isOceanFreight(concepto)) {
            fleteItems.push(item as Record<string, unknown>);
          } else {
            fobFromFlete.push(item as Record<string, unknown>);
          }
        }

        if (fobFromFlete.length > 0) {
          datos.flete_detalle = fleteItems;
          fobItems = [...fobItems, ...fobFromFlete];
          const sumar = (items: Array<Record<string, unknown>>) => 
            items.reduce((sum, i) => sum + (parseFloat(String(i.monto || i.valor || i.amount || 0)) || 0), 0);
          datos.flete_total_prepaid = sumar(fleteItems);
        }
      }

      // Guardar resultados
      if (fobItems.length > 0 || fobTotal > 0) {
        datos.gastos_hasta_fob = fobItems.length > 0 ? fobItems : [{ concepto: "Gastos hasta FOB", monto: fobTotal, moneda: datos.moneda || "EUR" }];
        const sumar = (items: Array<Record<string, unknown>>) => 
          items.reduce((sum, i) => sum + (parseFloat(String(i.monto || i.valor || i.amount || 0)) || 0), 0);
        datos.gastos_fob_total = fobItems.length > 0 ? sumar(fobItems) : fobTotal;
        datos._flete_exw_corregido = true;
      } else {
        datos.gastos_hasta_fob = [];
        datos.gastos_fob_total = 0;
      }
    };

    // Post-procesamiento: corregir BL (nunca minúsculas)
    const fixBL = (bl: unknown): string => {
      if (!bl || typeof bl !== "string") return String(bl || "");
      // Remover marcas (H), (h), HBL, nieto, hijo, etc. del número
      let fixed = bl.replace(/\s*\(H\)\s*/gi, "").replace(/\s*HBL\s*/gi, "").replace(/\s*H\/BL\s*/gi, "").replace(/\s*nieto\s*/gi, "").replace(/\s*hijo\s*/gi, "").trim();
      fixed = fixed.replace(/l/g, "1");
      fixed = fixed.toUpperCase();
      // Corregir letras que están ENTRE dígitos (contexto numérico puro)
      fixed = fixed.replace(/(\d)I(\d)/g, "$11$2");  // dígito-I-dígito → dígito-1-dígito
      fixed = fixed.replace(/(\d)O(\d)/g, "$10$2");  // dígito-O-dígito → dígito-0-dígito
      fixed = fixed.replace(/(\d)L(\d)/g, "$11$2");  // dígito-L-dígito → dígito-1-dígito
      fixed = fixed.replace(/(\d)Z(\d)/g, "$17$2");  // dígito-Z-dígito → dígito-7-dígito
      fixed = fixed.replace(/(\d)S(\d)/g, "$15$2");  // dígito-S-dígito → dígito-5-dígito
      // Corregir letras en la FRONTERA letra→dígitos (justo antes de la secuencia numérica)
      // Ej: "IBCI361555" → C-I-361555, la I antes de dígitos es 1 → "IBC1361555"
      fixed = fixed.replace(/([A-Z])I(\d{3,})/g, "$11$2");  // letra-I-3+dígitos → letra-1-dígitos
      fixed = fixed.replace(/([A-Z])O(\d{3,})/g, "$10$2");  // letra-O-3+dígitos → letra-0-dígitos
      fixed = fixed.replace(/([A-Z])L(\d{3,})/g, "$11$2");  // letra-L-3+dígitos → letra-1-dígitos
      // Corregir dígitos en el PREFIJO de letras (antes de la secuencia numérica)
      // Ej: "N0DET250401201" → el 0 entre N y D es una letra, no un dígito
      // En el prefijo (letras), un 0 rodeado de letras no tiene sentido → convertir a O
      // El cross-validation entre modelos (mergeBLChars) resolverá si es Q u O
      fixed = fixed.replace(/^([A-Z])0([A-Z]{2,})/g, "$1O$2");  // letra-0-2+letras al inicio → O
      // MSC siempre tiene 5 letras en el prefijo (MEDUO, MEDUM, MEDUW, etc.)
      // Si detectamos 4 letras + "0" + 7 dígitos para prefijos MSC → el "0" es "O"
      fixed = fixed.replace(/^(MEDU)0(\d{7})$/, "$1O$2");
      fixed = fixed.replace(/^(MSCU|MSKU|TRIU|GCXU|MSDU)0(\d{7})$/, "$1O$2");
      return fixed;
    };

    // Función para detectar si un BL fue marcado como house en el texto original
    const isHouseBL = (bl: unknown, rawText: string): boolean => {
      if (!bl || typeof bl !== "string") return false;
      const blClean = bl.replace(/\s*\(H\)\s*/gi, "").replace(/\s*nieto\s*/gi, "").replace(/\s*hijo\s*/gi, "").trim();
      // Buscar el BL en el texto original y ver si tiene (H), hijo, o nieto al lado
      const escapedBL = blClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patternH = new RegExp(escapedBL + "\\s*\\(?[Hh]\\)?", "i");
      const patternNieto = new RegExp(escapedBL + "\\s*(?:nieto|hijo)", "i");
      return patternH.test(rawText) || patternNieto.test(rawText) || /\(H\)/i.test(bl) || /nieto/i.test(bl) || /hijo/i.test(bl);
    };

    // Función para corregir master/house swap
    const fixMasterHouseSwap = (datos: Record<string, unknown>, rawText: string) => {
      const master = String(datos.numero_bl_master || datos.numero_bl || "");
      const house = String(datos.numero_bl_house || "");

      // CASO 1: El "master" contiene "(H)" → está al revés, intercambiar
      if (/\(H\)/i.test(master) || /\(h\)/i.test(master)) {
        console.log("[docs] FIX: master contiene (H), intercambiando. master:", master, "house:", house);
        const realHouse = master.replace(/\s*\(H\)\s*/gi, "").trim();
        const realMaster = house || "";
        datos.numero_bl_master = realMaster;
        datos.numero_bl_house = realHouse;
        datos.numero_bl = realMaster;
        datos._bl_swap_corregido = true;
        return;
      }

      // CASO 2: El master aparece en el texto con (H) al lado → está al revés
      if (master && isHouseBL(master, rawText)) {
        console.log("[docs] FIX: master aparece con (H) en texto, intercambiando. master:", master, "house:", house);
        datos.numero_bl_master = house;
        datos.numero_bl_house = master;
        datos.numero_bl = house;
        datos._bl_swap_corregido = true;
        return;
      }

      // CASO 3: No reportó house, pero en el texto hay otro BL con (H)
      // Buscar patrones de BL con (H) en el texto del documento
      if (!house && rawText) {
        const hblPattern = /([A-Z0-9]{8,20})\s*\(H\)/gi;
        const matches = rawText.match(hblPattern);
        if (matches && matches.length > 0) {
          const hblFound = matches[0].replace(/\s*\(H\)\s*/gi, "").trim();
          if (hblFound && hblFound.toUpperCase() !== master.toUpperCase()) {
            console.log("[docs] FIX: encontrado HBL en texto que no fue reportado:", hblFound);
            datos.numero_bl_house = hblFound.toUpperCase();
            datos._bl_house_encontrado = true;
          } else if (hblFound && hblFound.toUpperCase() === master.toUpperCase()) {
            // El master ES el house! Buscar el verdadero master
            console.log("[docs] FIX: el master reportado es en realidad el house (tiene (H) en texto):", master);
            // Buscar otros números de BL en el texto que NO tengan (H)
            const allBLs = rawText.match(/[A-Z]{3,5}[A-Z0-9]{6,15}/g) || [];
            const otherBLs = allBLs.filter(b => {
              const clean = b.toUpperCase();
              return clean !== master.toUpperCase() && clean.length >= 9 && clean.length <= 20;
            });
            // Filtrar los que aparecen con (H)
            const nonHouseBLs = otherBLs.filter(b => !isHouseBL(b, rawText));
            if (nonHouseBLs.length > 0) {
              const realMaster = nonHouseBLs[0].toUpperCase();
              console.log("[docs] FIX: verdadero master encontrado en texto:", realMaster);
              datos.numero_bl_house = master;
              datos.numero_bl_master = realMaster;
              datos.numero_bl = realMaster;
              datos._bl_swap_corregido = true;
            }
          }
        }
      }

      // CASO 4: Master ALUCINADO — el master reportado NO existe en el texto del PDF
      // Esto pasa cuando ambos modelos inventan un número de BL master
      if (master && house && rawText.length > 50) {
        // Verificar si el master existe en el texto (buscar al menos 6 chars consecutivos del master)
        const masterClean = master.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        const masterExists = masterClean.length >= 6 && rawText.toUpperCase().includes(masterClean.substring(0, Math.min(masterClean.length, 10)));
        
        if (!masterExists) {
          console.log("[docs] FIX ALUCINACIÓN: master reportado NO existe en texto PDF:", master);
          // Buscar números de BL reales en el texto que NO sean el house
          const houseClean = house.replace(/[^A-Z0-9]/gi, "").toUpperCase();
          // Buscar patrones típicos de BL: 3-4 letras + números, o formatos conocidos de navieras
          const blPatterns = rawText.toUpperCase().match(/[A-Z]{3,5}[A-Z0-9]{5,15}/g) || [];
          // Filtrar: no debe ser el house, debe tener al menos 9 chars, no debe tener (H) al lado
          const candidates = blPatterns.filter(b => {
            const clean = b.replace(/[^A-Z0-9]/g, "");
            return clean !== houseClean && 
                   clean.length >= 9 && 
                   clean.length <= 20 &&
                   !isHouseBL(b, rawText);
          });
          // Eliminar duplicados
          const uniqueCandidates = [...new Set(candidates)];
          if (uniqueCandidates.length > 0) {
            // Tomar el primer candidato que parezca un BL real (no palabras comunes)
            const commonWords = ["SHIPPER", "CONSIGNEE", "NOTIFY", "PARTY", "FREIGHT", "PREPAID", "COLLECT", "CONTAINER", "ORIGINAL", "RECEIVED"];
            const realBL = uniqueCandidates.find(c => !commonWords.some(w => c.includes(w)));
            if (realBL) {
              console.log("[docs] FIX ALUCINACIÓN: master corregido a:", realBL, "(era:", master, ")");
              datos.numero_bl_master_alucinado = master;
              datos.numero_bl_master = realBL;
              datos.numero_bl = realBL;
              datos._bl_master_corregido_alucinacion = true;
            }
          }
        }
      }
    };

    // Texto raw para buscar patrones de (H) — combinar texto PDF + respuestas raw de ambos modelos
    const rawTextForBL = [documentText, analysisText, claudeAnalysisText].filter(Boolean).join("\n");

    if (analysis.datos_extraidos) {
      // Primero corregir swap master/house
      fixMasterHouseSwap(analysis.datos_extraidos, rawTextForBL);
      // Luego aplicar fixBL
      if (analysis.datos_extraidos.numero_bl) analysis.datos_extraidos.numero_bl = fixBL(analysis.datos_extraidos.numero_bl);
      if (analysis.datos_extraidos.numero_bl_master) analysis.datos_extraidos.numero_bl_master = fixBL(analysis.datos_extraidos.numero_bl_master);
      if (analysis.datos_extraidos.numero_bl_house) analysis.datos_extraidos.numero_bl_house = fixBL(analysis.datos_extraidos.numero_bl_house);
      // Corregir flete EXW: separar gastos hasta FOB del flete
      fixFleteEXW(analysis.datos_extraidos);
    }
    // Fix Claude también
    if (claudeAnalysis) {
      const ca = claudeAnalysis as Record<string, unknown>;
      // Primero corregir swap master/house
      fixMasterHouseSwap(ca, rawTextForBL);
      // Luego aplicar fixBL
      if (ca.numero_bl) ca.numero_bl = fixBL(ca.numero_bl);
      if (ca.numero_bl_master) ca.numero_bl_master = fixBL(ca.numero_bl_master);
      if (ca.numero_bl_house) ca.numero_bl_house = fixBL(ca.numero_bl_house);
      // Corregir flete EXW: separar gastos hasta FOB del flete
      fixFleteEXW(ca);
    }

    // Extraer datos del bloque de corrección (sellos de ILS CARGO, Asia Shipping, etc.) del texto PDF
    // Estos datos tienen PRIORIDAD sobre lo que leyó la IA
    // Buscar en: texto PDF + respuestas raw de los modelos (por si el bloque es imagen/sello)
    const correctionText = [documentText, analysisText, claudeAnalysisText].filter(Boolean).join("\n");
    console.log("[docs] Buscando bloque de corrección. Texto combinado length:", correctionText.length);
    // Verificar si hay bloque de corrección (ILS CARGO, Asia Shipping, etc.)
    const hasCorrection = /CORRECCION\s*APROBADA|ILS\s*CARGO|BL\s*MASTER\s*:|BL\s*NIETO|CNTR\s*:/i.test(correctionText);
    if (hasCorrection) {
      console.log("[docs] BLOQUE DE CORRECCIÓN DETECTADO en texto");
      // Log contexto alrededor de "NIETO" o "MASTER" para debug
      const nietoIdx = correctionText.toUpperCase().indexOf("NIETO");
      if (nietoIdx >= 0) {
        console.log("[docs] NIETO contexto:", correctionText.substring(Math.max(0, nietoIdx - 10), nietoIdx + 40));
      }
      const cntrIdx = correctionText.toUpperCase().indexOf("CNTR");
      if (cntrIdx >= 0) {
        console.log("[docs] CNTR contexto:", correctionText.substring(Math.max(0, cntrIdx - 5), cntrIdx + 30));
      }
      const masterIdx = correctionText.toUpperCase().indexOf("BL MASTER");
      if (masterIdx >= 0) {
        console.log("[docs] BL MASTER contexto:", correctionText.substring(masterIdx, masterIdx + 40));
      }
    }
    if (correctionText.length > 0) {
      const applyCorrections = (datos: Record<string, unknown>) => {
        if (!datos) return;
        
        // Buscar BL MASTER / MBL en el texto (formatos: "BL MASTER: 022F520430" o "bl_master": "022F520430" o "numero_bl_master": "022F520430")
        const mblPatterns = [
          /(?:BL\s*MASTER|MBL)\s*:\s*([A-Z0-9]{6,20})/i,
          /"(?:bl_master|numero_bl_master|mbl)"\s*:\s*"([A-Z0-9]{6,20})"/i,
        ];
        for (const pat of mblPatterns) {
          const mblMatch = correctionText.match(pat);
          if (mblMatch) {
            const mblFromBlock = fixBL(mblMatch[1]);
            const currentMaster = String(datos.numero_bl_master || "");
            if (mblFromBlock && mblFromBlock !== currentMaster) {
              console.log("[docs] BLOQUE CORRECCIÓN: MBL del sello:", mblFromBlock, "(antes:", currentMaster, ")");
              datos.numero_bl_master = mblFromBlock;
              datos.numero_bl = mblFromBlock;
              datos._mbl_corregido_bloque = true;
            }
            break;
          }
        }

        // Buscar BL NIETO / BL HIJO / HBL en el texto (= house)
        const hblPatterns = [
          /(?:BL\s*NIETO|BL\s*HIJO|HBL)\s*:\s*([A-Z0-9]{6,20})/i,
          /"(?:bl_nieto|bl_hijo|numero_bl_house|hbl)"\s*:\s*"([A-Z0-9]{6,20})"/i,
        ];
        for (const pat of hblPatterns) {
          const hblMatch = correctionText.match(pat);
          if (hblMatch) {
            const hblFromBlock = hblMatch[1].toUpperCase(); // NO aplicar fixBL aquí — el bloque tiene el valor correcto
            const currentHouse = String(datos.numero_bl_house || "");
            console.log("[docs] BLOQUE CORRECCIÓN: BL Nieto/Hijo encontrado:", hblMatch[1], "→", hblFromBlock, "(actual house:", currentHouse, ")");
            // Detectar si es NIETO o HIJO según el texto del match
            const matchedText = hblMatch[0].toUpperCase();
            if (matchedText.includes("NIETO")) datos.tipo_bl_house = "nieto";
            else if (matchedText.includes("HIJO") || matchedText.includes("HBL")) datos.tipo_bl_house = "hijo";
            if (hblFromBlock && hblFromBlock !== currentHouse) {
              datos.numero_bl_house = hblFromBlock;
              datos._hbl_corregido_bloque = true;
            }
            break;
          }
        }

        // Buscar VAPOR / NAVE / VESSEL en el texto
        const naveMatch = correctionText.match(/(?:VAPOR|NAVE|VESSEL)\s*:\s*([A-Z][A-Z\s]+[A-Z])/i);
        if (naveMatch) {
          const naveFromBlock = naveMatch[1].trim().toUpperCase();
          const currentNave = String(datos.nave_corregida || datos.nave || "").toUpperCase();
          if (naveFromBlock && naveFromBlock !== currentNave) {
            console.log("[docs] BLOQUE CORRECCIÓN: Nave del sello:", naveFromBlock, "(antes:", currentNave, ")");
            if (datos.nave) datos.nave_original = datos.nave;
            datos.nave_corregida = naveFromBlock;
            datos.nave = naveFromBlock;
            datos._nave_corregida_bloque = true;
          }
        }

        // Buscar VIAJE en el texto
        const viajeMatch = correctionText.match(/VIAJE\s*:\s*([A-Z0-9]+)/i);
        if (viajeMatch) {
          const viajeFromBlock = viajeMatch[1].trim().toUpperCase();
          if (viajeFromBlock) {
            datos.viaje = viajeFromBlock;
            datos.viaje_corregido = viajeFromBlock;
          }
        }

        // Buscar TRANSHIPMENT / TRANSBORDO en el texto
        const transMatch = correctionText.match(/(?:TRANSHIPMENT|TRANSBORDO|TRANSSHIPMENT)\s*:\s*([A-Z][A-Z\s]+[A-Z])/i);
        if (transMatch) {
          const transFromBlock = transMatch[1].trim().toUpperCase();
          if (transFromBlock) {
            console.log("[docs] BLOQUE CORRECCIÓN: Transbordo del sello:", transFromBlock);
            datos.puerto_transbordo = transFromBlock;
            datos._transbordo_corregido_bloque = true;
          }
        }

        // Buscar CNTR / CONTENEDOR en el texto (formato: "CNTR:OTPU6663866" o "CNTR: OTPU6663866")
        const contPatterns = [
          /(?:CNTR|CONTENEDOR(?:ES)?)\s*:?\s*([A-Z]{4}\d{7})/i,
          /"(?:cntr|contenedor|container_number)"\s*:\s*"([A-Z]{4}\d{7})"/i,
        ];
        for (const pat of contPatterns) {
          const contMatch = correctionText.match(pat);
          if (contMatch) {
            const contFromBlock = contMatch[1].toUpperCase();
            console.log("[docs] BLOQUE CORRECCIÓN: Contenedor encontrado:", contFromBlock);
            if (Array.isArray(datos.contenedores)) {
              const containers = datos.contenedores as Array<Record<string, unknown>>;
              if (containers.length >= 1) {
                const current = String(containers[0].numero_contenedor || "");
                if (current !== contFromBlock) {
                  console.log("[docs] BLOQUE CORRECCIÓN: Contenedor corregido:", contFromBlock, "(antes:", current, ")");
                  containers[0].numero_contenedor_original = current;
                  containers[0].numero_contenedor = contFromBlock;
                  containers[0]._corregido_bloque = true;
                }
              }
            } else {
              datos.contenedores = [{ numero_contenedor: contFromBlock, _corregido_bloque: true }];
            }
            break;
          }
        }

        // Buscar EMISOR MBL / CIA en el texto (naviera)
        const ciaMatch = correctionText.match(/(?:EMISOR\s*MBL|CIA)\s*:\s*([A-Z][A-Z\s\-]+[A-Z])/i);
        if (ciaMatch) {
          const ciaFromBlock = ciaMatch[1].trim().toUpperCase();
          if (ciaFromBlock) {
            datos.naviera = ciaFromBlock;
          }
        }

        // Buscar PT DESC / PUERTO DESCARGA en el texto
        const ptDescMatch = correctionText.match(/(?:PT\s*DESC\.?|PUERTO\s*DESC(?:ARGA)?)\s*:\s*([A-Z][A-Z\s]+[A-Z])/i);
        if (ptDescMatch) {
          const ptFromBlock = ptDescMatch[1].trim().toUpperCase();
          if (ptFromBlock) {
            datos.puerto_desembarque = ptFromBlock;
          }
        }

        // Buscar O/F (Ocean Freight / flete) en el texto del bloque de corrección
        // Aplica SIEMPRE, sin importar el incoterm. Formato: "O/F: EUR 1870,00" o "O/F EUR 1870.00"
        const ofPatterns = [
          /O\/F\s*:?\s*([A-Z]{3})?\s*\$?\s*([\d.,]+)/i,
          /OCEAN\s*FREIGHT\s*:?\s*([A-Z]{3})?\s*\$?\s*([\d.,]+)/i,
          /FLETE\s*:?\s*([A-Z]{3})?\s*\$?\s*([\d.,]+)/i,
        ];
        for (const pat of ofPatterns) {
          const ofMatch = correctionText.match(pat);
          if (ofMatch) {
            const moneda = ofMatch[1] || String(datos.moneda || "USD");
            const montoStr = ofMatch[2].replace(/\./g, "").replace(",", ".");
            const monto = parseFloat(montoStr);
            if (monto > 0) {
              const currentFlete = Number(datos.flete_total_prepaid || 0);
              if (!currentFlete || currentFlete !== monto) {
                console.log("[docs] BLOQUE CORRECCIÓN: O/F (flete) encontrado:", monto, moneda, "(antes:", currentFlete, ")");
                datos.flete_detalle = [{ concepto: "O/F", monto, moneda }];
                datos.flete_total_prepaid = monto;
                datos.moneda = moneda;
                datos.condicion_flete = "PREPAID";
                datos._flete_corregido_bloque = true;
              }
              break;
            }
          }
        }
      };

      if (analysis.datos_extraidos) applyCorrections(analysis.datos_extraidos);
      if (claudeAnalysis) applyCorrections(claudeAnalysis as Record<string, unknown>);
    }

    // SEGUNDA PASADA: Buscar datos de corrección en los JSON parseados de los modelos
    // Los modelos pueden haber extraído el bloque de ILS CARGO/Asia Shipping en campos del JSON
    const applyJsonCorrections = (datos: Record<string, unknown>, source: string) => {
      if (!datos) return;
      
      // Buscar en TODOS los campos del JSON valores que parezcan datos de corrección
      // Buscar campo "vapor" o "nave_correccion" o similar
      const naveFields = ["vapor", "nave_correccion", "nave_corregida", "vessel_correction"];
      for (const f of naveFields) {
        const val = datos[f];
        if (val && typeof val === "string" && val.length > 2) {
          const currentNave = String(datos.nave_corregida || datos.nave || "").toUpperCase();
          if (val.toUpperCase() !== currentNave) {
            console.log(`[docs] JSON CORRECCIÓN (${source}): nave de campo '${f}':`, val);
            if (datos.nave) datos.nave_original = datos.nave;
            datos.nave_corregida = val.toUpperCase();
            datos.nave = val.toUpperCase();
          }
        }
      }

      // Buscar contenedor válido (4 letras + 7 dígitos) en campos de corrección
      const allValues = JSON.stringify(datos);
      const validContainers = allValues.match(/[A-Z]{4}\d{7}/g) || [];
      if (validContainers.length > 0 && Array.isArray(datos.contenedores)) {
        const containers = datos.contenedores as Array<Record<string, unknown>>;
        for (const container of containers) {
          const current = String(container.numero_contenedor || "");
          // Si el contenedor actual NO tiene formato válido (4 letras + 7 dígitos), buscar uno válido
          if (current && !/^[A-Z]{4}\d{7}$/.test(current)) {
            // Buscar en validContainers uno que sea similar
            const similar = validContainers.find(vc => {
              let match = 0;
              for (let i = 0; i < Math.min(vc.length, current.length); i++) {
                if (vc[i] === current[i]) match++;
              }
              return match >= 7; // Al menos 7 de 11 caracteres iguales
            });
            if (similar && similar !== current) {
              console.log(`[docs] JSON CORRECCIÓN (${source}): contenedor inválido corregido:`, current, "→", similar);
              container.numero_contenedor_original = current;
              container.numero_contenedor = similar;
              container._corregido_formato = true;
            }
          }
        }
      }
    };

    if (analysis.datos_extraidos) applyJsonCorrections(analysis.datos_extraidos, "GPT");
    if (claudeAnalysis) applyJsonCorrections(claudeAnalysis as Record<string, unknown>, "Claude");

    // TERCERA PASADA: Si la IA creó un campo "correccion_aprobada", aplicar esos valores
    const applyCorreccionAprobada = (datos: Record<string, unknown>) => {
      const corr = datos.correccion_aprobada as Record<string, unknown> | undefined;
      if (!corr || typeof corr !== "object") return;
      
      console.log("[docs] CORRECCION APROBADA encontrada en JSON:", JSON.stringify(corr));
      
      // BL Master
      if (corr.bl_master) {
        const mbl = String(corr.bl_master).toUpperCase();
        datos.numero_bl_master = mbl;
        datos.numero_bl = mbl;
        datos._mbl_corregido_bloque = true;
      }
      // BL Nieto/House
      if (corr.bl_nieto || corr.bl_hijo) {
        const hbl = String(corr.bl_nieto || corr.bl_hijo).toUpperCase();
        datos.numero_bl_house = hbl;
        datos._hbl_corregido_bloque = true;
      }
      // Vapor/Nave
      if (corr.vapor || corr.nave) {
        const nave = String(corr.vapor || corr.nave).toUpperCase();
        if (datos.nave) datos.nave_original = datos.nave;
        datos.nave_corregida = nave;
        datos.nave = nave;
        datos._nave_corregida_bloque = true;
      }
      // Viaje
      if (corr.viaje) {
        datos.viaje = String(corr.viaje).toUpperCase();
        datos.viaje_corregido = datos.viaje;
      }
      // Transbordo
      if (corr.transhipment || corr.transbordo) {
        datos.puerto_transbordo = String(corr.transhipment || corr.transbordo).toUpperCase();
        datos._transbordo_corregido_bloque = true;
      }
      // Contenedor (CNTR) — 4 letras + 7 dígitos
      if (corr.cntr || corr.contenedor) {
        const cntr = String(corr.cntr || corr.contenedor).toUpperCase();
        if (/^[A-Z]{4}\d{7}$/.test(cntr)) {
          if (Array.isArray(datos.contenedores)) {
            const containers = datos.contenedores as Array<Record<string, unknown>>;
            if (containers.length >= 1) {
              const current = String(containers[0].numero_contenedor || "");
              if (current !== cntr) {
                console.log("[docs] CORRECCION APROBADA: Contenedor:", cntr, "(antes:", current, ")");
                containers[0].numero_contenedor_original = current;
                containers[0].numero_contenedor = cntr;
                containers[0]._corregido_bloque = true;
              }
            }
          } else {
            datos.contenedores = [{ numero_contenedor: cntr, _corregido_bloque: true }];
          }
        }
      }
      // Naviera
      if (corr.emisor_mbl || corr.naviera || corr.cia) {
        datos.naviera = String(corr.emisor_mbl || corr.naviera || corr.cia).toUpperCase();
      }
      // Puerto descarga
      if (corr.pt_desc || corr.puerto_descarga) {
        datos.puerto_desembarque = String(corr.pt_desc || corr.puerto_descarga).toUpperCase();
      }
    };

    if (analysis.datos_extraidos) applyCorreccionAprobada(analysis.datos_extraidos);
    if (claudeAnalysis) applyCorreccionAprobada(claudeAnalysis as Record<string, unknown>);

    // VALIDACIÓN DE CONTENEDORES: eliminar cualquier "contenedor" que no tenga exactamente 4 letras + 7 dígitos
    // Los sellos/precintos (ej: WH22165740) NO son contenedores
    const filterValidContainers = (datos: Record<string, unknown>) => {
      if (!datos || !Array.isArray(datos.contenedores)) return;
      const containers = datos.contenedores as Array<Record<string, unknown>>;
      const valid = containers.filter(c => {
        const nr = String(c.numero_contenedor || "").toUpperCase();
        const isValid = /^[A-Z]{4}\d{7}$/.test(nr);
        if (!isValid && nr) {
          console.log("[docs] CONTENEDOR INVÁLIDO eliminado (no es 4 letras + 7 dígitos):", nr);
        }
        return isValid;
      });
      if (valid.length !== containers.length) {
        datos.contenedores = valid;
        datos.total_contenedores = valid.length;
      }
    };
    if (analysis.datos_extraidos) filterValidContainers(analysis.datos_extraidos);
    if (claudeAnalysis) filterValidContainers(claudeAnalysis as Record<string, unknown>);

    // Cross-validation entre GPT y Claude para BL master/house
    // Si un modelo tiene master+house y el otro solo master (o los tiene invertidos), usar el que tiene ambos
    if (analysis.datos_extraidos && claudeAnalysis) {
      const gpt = analysis.datos_extraidos;
      const cl = claudeAnalysis as Record<string, unknown>;
      const gptMaster = String(gpt.numero_bl_master || "");
      const gptHouse = String(gpt.numero_bl_house || "");
      const clMaster = String(cl.numero_bl_master || "");
      const clHouse = String(cl.numero_bl_house || "");

      // Si Claude tiene master+house y GPT no tiene house (o tiene el house como master)
      if (clMaster && clHouse && !gptHouse) {
        console.log("[docs] CROSS-FIX GPT: Claude tiene master+house, GPT no. Aplicando Claude:", clMaster, "/", clHouse);
        gpt.numero_bl_master = clMaster;
        gpt.numero_bl_house = clHouse;
        gpt.numero_bl = clMaster;
        gpt._bl_cross_validated = "claude";
      }
      // Si GPT tiene master+house y Claude no tiene house
      else if (gptMaster && gptHouse && !clHouse) {
        console.log("[docs] CROSS-FIX Claude: GPT tiene master+house, Claude no. Aplicando GPT:", gptMaster, "/", gptHouse);
        cl.numero_bl_master = gptMaster;
        cl.numero_bl_house = gptHouse;
        cl.numero_bl = gptMaster;
        cl._bl_cross_validated = "gpt";
      }
      // Si ambos tienen master+house pero están invertidos entre sí
      else if (gptMaster && gptHouse && clMaster && clHouse) {
        if (gptMaster === clHouse && gptHouse === clMaster) {
          // Están invertidos — Claude es más confiable para esta distinción
          console.log("[docs] CROSS-FIX: GPT y Claude invertidos. Usando Claude como referencia:", clMaster, "/", clHouse);
          gpt.numero_bl_master = clMaster;
          gpt.numero_bl_house = clHouse;
          gpt.numero_bl = clMaster;
          gpt._bl_cross_validated = "claude";
        }
      }
      // Si ninguno tiene house pero el master de uno es diferente al otro, 
      // y uno de los "masters" aparece con (H) en el raw text
      else if (gptMaster && clMaster && !gptHouse && !clHouse && gptMaster !== clMaster) {
        const gptIsHouse = isHouseBL(gptMaster, rawTextForBL);
        const clIsHouse = isHouseBL(clMaster, rawTextForBL);
        if (gptIsHouse && !clIsHouse) {
          // GPT leyó el house como master, Claude tiene el verdadero master
          console.log("[docs] CROSS-FIX: GPT master es house, Claude es correcto:", clMaster, "/ house:", gptMaster);
          gpt.numero_bl_master = clMaster;
          gpt.numero_bl_house = gptMaster;
          gpt.numero_bl = clMaster;
          cl.numero_bl_house = gptMaster;
          gpt._bl_cross_validated = "claude";
        } else if (clIsHouse && !gptIsHouse) {
          // Claude leyó el house como master, GPT tiene el verdadero master
          console.log("[docs] CROSS-FIX: Claude master es house, GPT es correcto:", gptMaster, "/ house:", clMaster);
          cl.numero_bl_master = gptMaster;
          cl.numero_bl_house = clMaster;
          cl.numero_bl = gptMaster;
          gpt.numero_bl_house = clMaster;
          cl._bl_cross_validated = "gpt";
        }
      }
    }

    // Cross-validation de CARACTERES: si ambos modelos leyeron el mismo BL pero difieren en un carácter
    // (ej: NQDET vs N0DET), preferir la letra en el prefijo (antes de los dígitos)
    if (analysis.datos_extraidos && claudeAnalysis) {
      const gpt = analysis.datos_extraidos;
      const cl = claudeAnalysis as Record<string, unknown>;
      
      const mergeBLChars = (gptBL: string, claudeBL: string): string => {
        if (!gptBL || !claudeBL || gptBL === claudeBL) return gptBL || claudeBL;
        if (gptBL.length !== claudeBL.length) return claudeBL; // Longitudes diferentes, usar Claude
        
        // Encontrar dónde empiezan los dígitos (fin del prefijo)
        let prefixEnd = 0;
        for (let i = 0; i < gptBL.length; i++) {
          if (/\d/.test(gptBL[i]) && /\d/.test(claudeBL[i])) { prefixEnd = i; break; }
          if (i === gptBL.length - 1) prefixEnd = gptBL.length;
        }
        
        let merged = "";
        for (let i = 0; i < gptBL.length; i++) {
          if (gptBL[i] === claudeBL[i]) {
            merged += gptBL[i];
          } else if (i < prefixEnd) {
            // En el prefijo: preferir letra sobre dígito
            const gptIsLetter = /[A-Z]/.test(gptBL[i]);
            const clIsLetter = /[A-Z]/.test(claudeBL[i]);
            if (gptIsLetter && !clIsLetter) merged += gptBL[i];
            else if (clIsLetter && !gptIsLetter) merged += claudeBL[i];
            else merged += claudeBL[i]; // Ambas letras diferentes, usar Claude
          } else {
            // En la parte numérica: preferir dígito sobre letra
            const gptIsDigit = /\d/.test(gptBL[i]);
            const clIsDigit = /\d/.test(claudeBL[i]);
            if (gptIsDigit && !clIsDigit) merged += gptBL[i];
            else if (clIsDigit && !gptIsDigit) merged += claudeBL[i];
            else merged += claudeBL[i]; // Ambos dígitos diferentes, usar Claude
          }
        }
        return merged;
      };

      const gptHouse = String(gpt.numero_bl_house || "");
      const clHouse = String(cl.numero_bl_house || "");
      if (gptHouse && clHouse && gptHouse !== clHouse && gptHouse.length === clHouse.length) {
        const merged = mergeBLChars(gptHouse, clHouse);
        if (merged !== gptHouse || merged !== clHouse) {
          console.log("[docs] CHAR-MERGE BL house: GPT=", gptHouse, "Claude=", clHouse, "→ Merged=", merged);
          gpt.numero_bl_house = merged;
          cl.numero_bl_house = merged;
        }
      }

      const gptMaster = String(gpt.numero_bl_master || "");
      const clMaster = String(cl.numero_bl_master || "");
      if (gptMaster && clMaster && gptMaster !== clMaster && gptMaster.length === clMaster.length) {
        const merged = mergeBLChars(gptMaster, clMaster);
        if (merged !== gptMaster || merged !== clMaster) {
          console.log("[docs] CHAR-MERGE BL master: GPT=", gptMaster, "Claude=", clMaster, "→ Merged=", merged);
          gpt.numero_bl_master = merged;
          gpt.numero_bl = merged;
          cl.numero_bl_master = merged;
          cl.numero_bl = merged;
        }
      }
    }

    // Subir archivo a DigitalOcean Spaces
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileKey = `documentos/${finalRutCliente}/${nroOperacion}/${Date.now()}_${safeFileName}`;
    let storageUrl = "";
    try {
      storageUrl = await uploadToSpaces(buffer, fileKey, mimeType);
      console.log("[docs] File uploaded to Spaces:", storageUrl);
    } catch (spaceErr) {
      console.error("[docs] Spaces upload error:", spaceErr instanceof Error ? spaceErr.message : spaceErr);
      // Continuar sin URL de storage
    }

    // Generar embedding del texto para búsqueda semántica
    const textoParaEmbedding = `${analysis.tipo_documento} ${analysis.resumen} ${analysis.texto_completo ?? ""}`.substring(0, 8000);

    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: textoParaEmbedding,
    });

    // Agregar prefijo (H) para hijo o (N) para nieto al inicio del número de BL house
    const addHousePrefix = (datos: Record<string, unknown>) => {
      if (!datos) return;
      const house = String(datos.numero_bl_house || "").trim();
      if (!house) return;
      // Quitar cualquier marca (H)/(N) tanto al inicio como al final, y espacios, para no duplicar
      const clean = house
        .replace(/\(\s*(?:H|N)\s*\)/gi, "")  // quitar (H) o (N) en cualquier posición
        .replace(/\s+/g, "")                   // quitar espacios internos
        .trim();
      if (!clean) return;
      // Determinar tipo: nieto o hijo (por defecto hijo si tiene marca H)
      const tipo = String(datos.tipo_bl_house || "").toLowerCase();
      const prefijo = tipo === "nieto" ? "(N)" : "(H)";
      datos.numero_bl_house = `${prefijo}${clean}`;
      console.log("[docs] BL house con prefijo:", datos.numero_bl_house);
    };
    if (analysis.datos_extraidos) addHousePrefix(analysis.datos_extraidos);
    if (claudeAnalysis) addHousePrefix(claudeAnalysis as Record<string, unknown>);

    // Combinar resultados: Claude es principal, GPT-4o es secundario
    // Donde coinciden = certeza, donde difieren = usar Claude (mejor OCR)
    const combined = Object.keys(claudeAnalysis).length > 0 
      ? { ...(claudeAnalysis as Record<string, unknown>) }
      : { ...analysis.datos_extraidos };
    
    // Para BL: usar Claude si tiene ambos (master+house), sino GPT
    const claudeA = claudeAnalysis as Record<string, unknown>;
    if (claudeA.numero_bl_master) {
      combined.numero_bl_master = claudeA.numero_bl_master;
      combined.numero_bl = claudeA.numero_bl_master;
      if (claudeA.numero_bl_house) combined.numero_bl_house = claudeA.numero_bl_house;
    } else if (analysis.datos_extraidos?.numero_bl_master || analysis.datos_extraidos?.numero_bl) {
      const gptBL = analysis.datos_extraidos.numero_bl_master || analysis.datos_extraidos.numero_bl;
      combined.numero_bl_master = gptBL;
      combined.numero_bl = gptBL;
      if (analysis.datos_extraidos.numero_bl_house) combined.numero_bl_house = analysis.datos_extraidos.numero_bl_house;
    }

    if (Object.keys(claudeAnalysis).length > 0 && Object.keys(analysis.datos_extraidos).length > 0) {
      // Marcar contenedores validados/con diferencia
      const claudeContainers = (claudeAnalysis as Record<string, unknown>).contenedores || [];
      const gptContainers = analysis.datos_extraidos.contenedores || [];
      if (Array.isArray(claudeContainers) && Array.isArray(gptContainers)) {
        const mergedContainers = claudeContainers.map((cc: Record<string, unknown>, i: number) => {
          const gc = gptContainers[i] as Record<string, unknown> | undefined;
          if (!gc) return { ...cc, _fuente: "claude" };
          const claudeNr = cc.numero_contenedor;
          const gptNr = gc.numero_contenedor;
          if (claudeNr === gptNr) return { ...cc, _validado: true };
          return { ...cc, numero_contenedor_gpt: gptNr, _revision: "contenedor_difiere" };
        });
        combined.contenedores = mergedContainers;
      }
      // Marcar flete
      const claudeFlete = (claudeAnalysis as Record<string, unknown>).flete_total_prepaid;
      const gptFlete = analysis.datos_extraidos.flete_total_prepaid;
      if (claudeFlete && gptFlete) {
        if (claudeFlete === gptFlete) {
          combined.flete_validado = true;
        } else {
          combined.flete_total_prepaid_gpt = gptFlete;
          combined._revision_flete = "flete_difiere_gpt";
        }
      }
    }

    // ShipsGo: NO enviar automáticamente - el usuario decide después de comparar
    let shipsgoId: number | null = null;
    const shipsgoData: Record<string, unknown> = {};

    // Guardar en PostgreSQL
    const embeddingStr = `[${embedding.join(",")}]`;

    // DEBUG: Log valores finales de BL antes de guardar
    console.log("[docs] VALORES FINALES antes de guardar:");
    console.log("  combined.numero_bl_master:", combined.numero_bl_master, "| numero_bl_house:", combined.numero_bl_house);
    console.log("  GPT numero_bl_master:", analysis.datos_extraidos?.numero_bl_master, "| numero_bl_house:", analysis.datos_extraidos?.numero_bl_house);
    console.log("  Claude numero_bl_master:", (claudeAnalysis as Record<string, unknown>)?.numero_bl_master, "| numero_bl_house:", (claudeAnalysis as Record<string, unknown>)?.numero_bl_house);

    // Auto-crear operación si no existe (independiente de documentos)
    // No crear si es temporal (TEMP_xxx) — se reasignará después
    if (!nroOperacion.startsWith("TEMP_")) {
      await pgQuery(
        `INSERT INTO operaciones (nro_operacion, rut_cliente, estado) VALUES ($1, $2, 'abierta') ON CONFLICT (nro_operacion) DO NOTHING`,
        [nroOperacion, finalRutCliente]
      );
    }

    // Si es un BL, eliminar el BL anterior de esta operación (el nuevo es el corregido)
    const tipoFinal = (claudeAnalysis as Record<string, unknown>)?.tipo_documento as string || analysis.tipo_documento;
    if (tipoFinal === "Bill of Lading (BL)" && !nroOperacion.startsWith("TEMP_")) {
      const blAnterior = await pgQuery<{ id: number; storage_url: string }>(
        "SELECT id, storage_url FROM documentos WHERE nro_operacion = $1 AND tipo_documento = 'Bill of Lading (BL)'",
        [nroOperacion]
      );
      if (blAnterior.length > 0) {
        console.log(`[upload] Reemplazando BL anterior (id=${blAnterior[0].id}) por nuevo BL corregido`);
        // Borrar del bucket
        if (blAnterior[0].storage_url) {
          try { const { deleteFromSpaces } = await import("@/lib/spaces"); await deleteFromSpaces(blAnterior[0].storage_url); } catch {}
        }
        await pgQuery("DELETE FROM documentos WHERE id = $1", [blAnterior[0].id]);
      }
    }

    const rows = await pgQuery(
      `INSERT INTO documentos (rut_cliente, rut_usuario, nro_operacion, nombre_archivo, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, shipsgo_id, texto_completo, embedding, storage_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12)
       RETURNING id, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, storage_url, created_at`,      [
        finalRutCliente,
        session.rut,
        nroOperacion,
        file.name,
        // Usar clasificación de Claude como principal si está disponible
        (claudeAnalysis as Record<string, unknown>)?.tipo_documento as string || analysis.tipo_documento,
        JSON.stringify(combined),
        JSON.stringify(claudeAnalysis),
        JSON.stringify(shipsgoData),
        shipsgoId,
        analysis.texto_completo ?? "",
        embeddingStr,
        storageUrl,
      ]
    );

    // Guardar como ejemplo verificado si es un BL con datos útiles (feedback loop / aprendizaje)
    if (analysis.tipo_documento === "Bill of Lading (BL)") {
      const tieneMaster = combined.numero_bl_master || combined.numero_bl;
      if (tieneMaster) {
        // fuente "auto" porque aún no está verificado manualmente; se actualizará a "shipsgo"/"flete_aprobado" después
        guardarEjemploBL(finalRutCliente, combined, "auto", false).catch(() => {});

        // Enviar automáticamente a ShipsGo para obtener tracking
        const docId = rows[0].id;
        const blNumber = String(tieneMaster);
        const shipsgoToken = process.env.SHIPSGO_API_KEY;
        if (shipsgoToken && blNumber) {
          (async () => {
            try {
              console.log("[upload] Enviando BL a ShipsGo:", blNumber);
              const createRes = await fetch("https://api.shipsgo.com/v2/ocean/shipments", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Shipsgo-User-Token": shipsgoToken },
                body: JSON.stringify({ booking_number: blNumber }),
              });
              const createJson = await createRes.json();
              const shipsgoId = createJson.shipment?.id;
              if (shipsgoId) {
                await pgQuery("UPDATE documentos SET shipsgo_id = $1 WHERE id = $2", [shipsgoId, docId]);
                // Consultar detalles
                const detailRes = await fetch(`https://api.shipsgo.com/v2/ocean/shipments/${shipsgoId}`, {
                  headers: { "X-Shipsgo-User-Token": shipsgoToken },
                });
                if (detailRes.ok) {
                  const detailJson = await detailRes.json();
                  const shipsgoData = detailJson.shipment || {};
                  await pgQuery("UPDATE documentos SET datos_shipsgo = $1 WHERE id = $2", [JSON.stringify(shipsgoData), docId]);
                  console.log("[upload] ShipsGo data guardada para BL:", blNumber, "id:", shipsgoId);
                }
              }
            } catch (err) {
              console.error("[upload] ShipsGo auto-send error:", err instanceof Error ? err.message : err);
            }
          })();
        }
      }
    }

    return NextResponse.json({
      ok: true,
      documento: rows[0],
      resumen: analysis.resumen,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Upload error:", message, error);
    return NextResponse.json(
      { error: `Error al procesar el documento: ${message}` },
      { status: 500 }
    );
  }
}
