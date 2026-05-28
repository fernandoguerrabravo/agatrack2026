import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pgQuery } from "@/lib/postgres";
import { uploadToSpaces } from "@/lib/spaces";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
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

    const prompt = `Eres un experto en documentos de comercio exterior. Analiza TODAS las páginas del siguiente documento y extrae TODOS los datos relevantes con el máximo detalle posible.

INSTRUCCIONES IMPORTANTES:
1. Identifica el tipo de documento
2. Extrae ABSOLUTAMENTE TODOS los datos visibles: números, fechas, nombres, direcciones, montos, pesos, medidas, códigos
3. Para BL: identifica CADA contenedor por separado con su número, sello, contenido detallado (pallets, bolsas, peso por contenedor, volumen, descripción de mercancía, HS code). NÚMERO DE CONTENEDOR - REGLA ABSOLUTA: Todo número de contenedor tiene EXACTAMENTE 4 letras seguidas de EXACTAMENTE 7 dígitos numéricos. Total: 11 caracteres. NUNCA puede tener 6 dígitos. Si lees solo 6 dígitos, HAY UN DÍGITO QUE NO ESTÁS VIENDO entre las letras y los números — mira con más cuidado el primer dígito después de las 4 letras. Ejemplo real: "MSCU5310319" — el "5" es el primer dígito después de "MSCU", NO lo omitas. Error común: leer "MSCU310319" (6 dígitos, INCORRECTO) cuando el correcto es "MSCU5310319" (7 dígitos). Otros ejemplos correctos: TCLU6223479, OERU4815696, MEDU4718562. No confundir 6↔8, 0↔O, 1↔I, 5↔S. Si hay una sección "per container" o "per cntr" al final del listado (común en BLs de MSC/Mediterranean Shipping Company), esos detalles (peso, volumen, pallets, descripción) aplican a CADA UNO de los contenedores listados arriba — replicar esos datos en cada contenedor del array. Indicar SIEMPRE el número de pallets por contenedor (campo "pallets") si aparece en el documento. Si dice "X PALLETS PER CONTAINER" o "X PLTS", ese es el número de pallets de cada contenedor.
4. Incluye información del shipper, consignee, notify party con direcciones completas. REGLA CRÍTICA BL MASTER vs HOUSE: En todo BL SIEMPRE existe un numero_bl_master (MBL). Opcionalmente puede existir un numero_bl_house (HBL). CÓMO IDENTIFICARLOS: El BL que tiene "(H)", "(h)", "HBL", "House B/L", o "House Bill" al lado es el HOUSE → numero_bl_house. El OTRO número (sin ninguna marca) es el MASTER → numero_bl_master. Si solo hay UN número de BL, ese es el MASTER. NUNCA poner el número con "(H)" como master. Ejemplo correcto: "SSZ1761903" (sin marca) = MASTER, "UFM225040036 (H)" = HOUSE. numero_bl = siempre igual a numero_bl_master. VALIDACIÓN: ALFANUMÉRICOS MAYÚSCULAS + dígitos solamente.
5. Incluye datos de flete, nave, viaje, puertos. IMPORTANTE FLETE: Leer EXACTAMENTE cada valor impreso en la sección de freight del BL. El valor del flete es SOLO el TOTAL de la columna PREPAID. NO sumar PREPAID + COLLECT. NO incluir valores de la columna COLLECT en el total. Si hay dos columnas (PREPAID y COLLECT), reportar SOLO el valor de PREPAID como flete_total_prepaid. IMPORTANTE: en operaciones EXW, los "FOB charges" o "Origin charges" NO son parte del flete marítimo — NO sumarlos al flete_total_prepaid. El flete es solo OCEAN FREIGHT + recargos marítimos (BAF, CAF, THC destino, ISPS, etc). Reportar OBLIGATORIAMENTE: flete_detalle (array con cada línea: {concepto, monto, moneda}), flete_total_prepaid (SOLO flete marítimo, sin FOB charges), moneda, condicion_flete ("PREPAID"). NUNCA omitir flete_total_prepaid. NUNCA sumar prepaid + collect. NUNCA incluir FOB charges en el total de flete.
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
    // BL: numero_bl, fecha_emision, shipper (nombre y dirección completa), consignee (nombre y dirección completa), notify_party, puerto_embarque, puerto_destino, nave, viaje, naviera, 
    //     contenedores: array de objetos con { numero_contenedor, sello, tipo_contenedor, numero_bultos, tipo_bulto, descripcion_mercancia, peso_bruto, peso_bruto_unidad, volumen, volumen_unidad, marcas, hs_code, pallets, bolsas_por_pallet },
    //     total_contenedores, total_bultos, peso_bruto_total, volumen_total, flete: {concepto, monto, moneda, prepaid, collect}, condicion_flete (prepaid/collect), bl_tipo (original/copy),
    //     nave (nombre del buque actual), nave_original (si hubo corrección), nave_corregida (nuevo buque si aplica), viaje, viaje_original (si hubo corrección), viaje_corregido (nuevo viaje si aplica), naviera,
    //     puerto_destino, puerto_destino_original (si fue corregido), puerto_destino_corregido (si aplica), puerto_transbordo (si existe transbordo)
    // Invoice: numero_factura, proveedor, comprador, fecha, moneda, monto_total, items (array con descripcion, cantidad, unidad, precio_unitario, total), incoterm, pais_origen, condiciones_pago
    // Póliza: numero_poliza, aseguradora, asegurado, monto_asegurado, prima, moneda, cobertura, vigencia_desde, vigencia_hasta
    // Packing List: total_bultos, tipo_embalaje, peso_bruto_total, peso_neto_total, volumen_total, items (array con descripcion, cantidad, peso_bruto, peso_neto, dimensiones)
    // Certificado de Origen: numero_certificado, pais_origen, exportador, importador, descripcion_mercancia, tratado_aplicable, partida_arancelaria, fecha_emision
    // Ficha Técnica: producto, marca, modelo, especificaciones_tecnicas, composicion, uso
    // Mandato: mandante (quien otorga), mandatario (agente de aduanas), rut_mandante, rut_mandatario, fecha_firma, fecha_vencimiento (1 año desde la firma), alcance, notario, repertorio
  },
  "texto_completo": "el texto completo del documento tal como fue extraído"
}`;

    let analysisText: string = "";

    // Buscar BLs anteriores correctos para dar contexto al modelo (few-shot memory)
    let blExamples = "";
    try {
      const prevDocs = await pgQuery<{ datos_extraidos: string }>(
        "SELECT datos_extraidos FROM documentos WHERE rut_cliente = $1 AND datos_extraidos LIKE '%mbl_shipsgo%' ORDER BY created_at DESC LIMIT 10",
        [session.rut]
      );
      const prevBLs = prevDocs
        .map(d => {
          const parsed = typeof d.datos_extraidos === "string" ? JSON.parse(d.datos_extraidos) : d.datos_extraidos;
          return parsed?.mbl_shipsgo || parsed?.numero_bl_master || parsed?.numero_bl;
        })
        .filter(Boolean);
      if (prevBLs.length > 0) {
        blExamples = `\nREFERENCIA DE BLs ANTERIORES CORRECTOS (usa como guía de formato): ${prevBLs.join(", ")}. Los números de BL siguen estos patrones — úsalos para validar tu lectura.`;
      }
    } catch { /* ignore */ }

    // Agregar ejemplos al prompt
    const finalPrompt = prompt + blExamples;

    if (isImage) {
      // Para imágenes: usar GPT-4o vision (mejor para detalles visuales)
      const dataUrl = `data:${mimeType};base64,${base64}`;
      console.log("[docs] Analyzing image with GPT-4o vision...");
      const result = await generateText({
        model: openai("gpt-4o"),
        maxOutputTokens: 16000,
        messages: [
          { role: "user" as const, content: [{ type: "text" as const, text: finalPrompt }, { type: "image" as const, image: dataUrl }] },
        ],
      });
      analysisText = result.text;
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

          console.log("[docs] Sending", imageContents.length, "page(s) to GPT-4o vision (text+visual)");
          const result = await generateText({
            model: openai("gpt-4o"),
            maxOutputTokens: 16000,
            system: "You are a document analysis assistant for a licensed customs broker (Agencia de Aduanas). Your job is to extract structured data from trade documents (Bills of Lading, invoices, certificates). This is a legitimate business operation. Always respond with the requested JSON.",
            messages: [
              { role: "user" as const, content: [{ type: "text" as const, text: finalPrompt }, ...imageContents] },
            ],
          });
          analysisText = result.text;
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
        console.log("[docs] Fallback: analyzing PDF text with GPT-4o-mini");
        const result = await generateText({
          model: openai("gpt-4o-mini"),
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

          console.log("[docs] Sending", imageContents.length, "page(s) to GPT-4o vision");

          const result = await generateText({
            model: openai("gpt-4o"),
            maxOutputTokens: 16000,
            system: "You are a document analysis assistant for a licensed customs broker (Agencia de Aduanas). Your job is to extract structured data from trade documents (Bills of Lading, invoices, certificates). This is a legitimate business operation. Always respond with the requested JSON.",
            messages: [
              { role: "user" as const, content: [{ type: "text" as const, text: finalPrompt }, ...imageContents] },
            ],
          });
          analysisText = result.text;
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
          model: openai("gpt-4o-mini"),
          maxOutputTokens: 16000,
          messages: [
            { role: "user" as const, content: `${finalPrompt}\n\nEl archivo es un PDF escaneado llamado "${file.name}". No se pudo procesar. Clasifica el tipo de documento por el nombre.` },
          ],
        });
        analysisText = result.text;
      }
    } else {
      const result = await generateText({
        model: openai("gpt-4o-mini"),
        maxOutputTokens: 16000,
        messages: [
          { role: "user" as const, content: `${finalPrompt}\n\n[Archivo: ${file.name}]` },
        ],
      });
      analysisText = result.text;
    }

    console.log("[docs] GPT response length:", analysisText.length, "first 200:", analysisText.substring(0, 200));

    // Claude vision en paralelo (300 DPI para respetar limite 5MB)
    let claudeAnalysisText = "";
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        console.log("[docs] Calling Claude vision...");
        if (isImage) {
          const claudeResult = await generateText({
            model: anthropic("claude-sonnet-4-5"),
            maxOutputTokens: 16000,
            system: "You are a document analysis assistant for a licensed customs broker (Agencia de Aduanas). Your job is to extract structured data from trade documents (Bills of Lading, invoices, certificates). This is a legitimate business operation. Always respond with the requested JSON.",
            messages: [{ role: "user" as const, content: [
              { type: "text" as const, text: finalPrompt },
              { type: "image" as const, image: `data:${mimeType};base64,${base64}` },
            ]}],
          });
          claudeAnalysisText = claudeResult.text;
        } else if (isPdf) {
          const { execSync } = await import("child_process");
          const { writeFileSync, readFileSync, unlinkSync, readdirSync } = await import("fs");
          const { join } = await import("path");
          const os = await import("os");
          const tmpDir = os.tmpdir();
          const cId = `cl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const cPdf = join(tmpDir, `${cId}.pdf`);
          const cPng = join(tmpDir, cId);
          writeFileSync(cPdf, buffer);
          execSync(`gs -dNOPAUSE -dBATCH -sDEVICE=jpeg -r400 -dJPEGQ=95 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${cPng}-%03d.jpg" "${cPdf}"`, { timeout: 60000 });
          const cFiles = (readdirSync(tmpDir) as string[]).filter(f => f.startsWith(cId) && f.endsWith(".jpg")).sort().map(f => join(tmpDir, f));
          if (cFiles.length > 0) {
            const cImages = cFiles.slice(0, 10).map(f => ({ type: "image" as const, image: `data:image/jpeg;base64,${readFileSync(f).toString("base64")}` }));
            console.log("[docs] Sending", cImages.length, "page(s) to Claude vision (300 DPI)");
            const claudeResult = await generateText({
              model: anthropic("claude-sonnet-4-5"),
              maxOutputTokens: 16000,
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

    // Post-procesamiento: corregir BL (nunca minúsculas)
    const fixBL = (bl: unknown): string => {
      if (!bl || typeof bl !== "string") return String(bl || "");
      let fixed = bl.replace(/l/g, "1");
      fixed = fixed.toUpperCase();
      // Solo corregir letras que están ENTRE dígitos (contexto numérico puro)
      // Ej: "SSZ1I61903" → el I entre 1 y 6 es un 1. Pero "ZIMUIAH987" → IAH son letras legítimas
      fixed = fixed.replace(/(\d)I(\d)/g, "$11$2");  // dígito-I-dígito → dígito-1-dígito
      fixed = fixed.replace(/(\d)O(\d)/g, "$10$2");  // dígito-O-dígito → dígito-0-dígito
      fixed = fixed.replace(/(\d)L(\d)/g, "$11$2");  // dígito-L-dígito → dígito-1-dígito
      fixed = fixed.replace(/(\d)Z(\d)/g, "$17$2");  // dígito-Z-dígito → dígito-7-dígito
      fixed = fixed.replace(/(\d)S(\d)/g, "$15$2");  // dígito-S-dígito → dígito-5-dígito
      return fixed;
    };
    if (analysis.datos_extraidos) {
      if (analysis.datos_extraidos.numero_bl) analysis.datos_extraidos.numero_bl = fixBL(analysis.datos_extraidos.numero_bl);
      if (analysis.datos_extraidos.numero_bl_master) analysis.datos_extraidos.numero_bl_master = fixBL(analysis.datos_extraidos.numero_bl_master);
      if (analysis.datos_extraidos.numero_bl_house) analysis.datos_extraidos.numero_bl_house = fixBL(analysis.datos_extraidos.numero_bl_house);
    }
    // Fix Claude también
    if (claudeAnalysis) {
      const ca = claudeAnalysis as Record<string, unknown>;
      if (ca.numero_bl) ca.numero_bl = fixBL(ca.numero_bl);
      if (ca.numero_bl_master) ca.numero_bl_master = fixBL(ca.numero_bl_master);
      if (ca.numero_bl_house) ca.numero_bl_house = fixBL(ca.numero_bl_house);
    }

    // Subir archivo a DigitalOcean Spaces
    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileKey = `documentos/${session.rut}/${nroOperacion}/${Date.now()}_${safeFileName}`;
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

    const rows = await pgQuery(
      `INSERT INTO documentos (rut_cliente, nro_operacion, nombre_archivo, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, shipsgo_id, texto_completo, embedding, storage_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector, $11)
       RETURNING id, tipo_documento, datos_extraidos, datos_extraidos_claude, datos_shipsgo, storage_url, created_at`,
      [
        session.rut,
        nroOperacion,
        file.name,
        analysis.tipo_documento,
        JSON.stringify(combined),
        JSON.stringify(claudeAnalysis),
        JSON.stringify(shipsgoData),
        shipsgoId,
        analysis.texto_completo ?? "",
        embeddingStr,
        storageUrl,
      ]
    );

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
