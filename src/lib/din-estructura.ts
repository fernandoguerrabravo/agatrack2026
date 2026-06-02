import "server-only";

/**
 * ESTRUCTURA DE LA DECLARACIÓN DE INGRESO (DIN) — AduanaNet
 *
 * Mapeo módulo por módulo de los campos de la DIN y su fuente de datos.
 * Fuentes posibles:
 *   - "documento"  → extraído de los documentos (tabla documentos: BL, invoice, packing, CO, póliza)
 *   - "despacho"   → de operaciones históricas (tabla despachos_replica) o datos del cliente
 *   - "aduananet"  → ya viene precargado en el sistema AduanaNet (no se modifica)
 *   - "scraping"   → se obtiene scrapeando AduanaNet (aranceles, paridad, validaciones)
 *   - "calculado"  → se calcula a partir de otros campos
 *   - "manual"     → requiere ingreso/confirmación del usuario
 *
 * URL base del encabezado:
 *   /modulos/din/dus_encabezado/dus_encabezado.php?comando=M&lib_nid={OPERACION}&dus_tipo_envio=2&lbac_nid=0&lib_base=1&pagno=0
 *   donde lib_nid = número de operación
 */

export type FuenteDato = "documento" | "despacho" | "aduananet" | "scraping" | "calculado" | "manual";

export type CampoDIN = {
  name: string;          // name del input/select en el formulario
  etiqueta: string;      // etiqueta visible
  tipo: "text" | "select" | "hidden" | "textarea";
  fuente: FuenteDato;
  origenDoc?: string;    // de qué documento/campo sale (si fuente = documento)
  readonly?: boolean;
  nota?: string;
};

// ============================================================
// MÓDULO 1: ENCABEZADO (dus_encabezado)
// ============================================================
// NOTA IMPORTANTE: El encabezado se crea PREVIAMENTE mediante una API que
// genera el número de operación (lib_nid) automáticamente. En esta etapa del
// scraping este formulario NO SE MODIFICA — solo se usa como punto de entrada:
// el lib_nid (= número de operación) ya existe y es la clave para acceder a los
// demás módulos de la DIN. Los campos quedan documentados solo como referencia.
export const MODULO_ENCABEZADO: CampoDIN[] = [
  {
    name: "vv_lib_nid",
    etiqueta: "No. Despacho",
    tipo: "text",
    fuente: "aduananet",
    readonly: true,
    nota: "Número de operación (lib_nid). Es la clave que conecta con nuestra base (nro_operacion).",
  },
  {
    name: "tio_id",
    etiqueta: "Tipo de Operación (código)",
    tipo: "text",
    fuente: "manual",
    nota: "Código de tipo de operación. 101=IMPORT. CTDO/NORMAL (el más común). Ver tio_desc para la lista.",
  },
  {
    name: "tio_desc",
    etiqueta: "Tipo de Operación (descripción)",
    tipo: "select",
    fuente: "manual",
    nota: "64 opciones. La más común para importación normal al contado: 101 IMPORT. CTDO/NORMAL.",
  },
  {
    name: "din_form",
    etiqueta: "Formulario",
    tipo: "select",
    fuente: "manual",
    nota: "Opciones: 14=Diferido, 15=Contado, 17=Dips. Para importación normal contado → 15.",
  },
  {
    name: "din_vcto",
    etiqueta: "Fecha de Vencimiento",
    tipo: "text",
    fuente: "calculado",
    nota: "Fecha vencimiento (formato DD/MM/YYYY). Viene precargada por AduanaNet.",
  },
  {
    name: "adu_id",
    etiqueta: "Aduana (código)",
    tipo: "text",
    fuente: "documento",
    origenDoc: "BL.puerto_desembarque → aduana correspondiente (39=San Antonio aprox.)",
    nota: "Código de aduana. Se determina por el puerto de desembarque del BL.",
  },
  {
    name: "ladu_id",
    etiqueta: "Aduana (lista)",
    tipo: "select",
    fuente: "documento",
    nota: "19 opciones (ARICA=3, IQUIQUE=7, ANTOFAGASTA=14, ... SAN ANTONIO, VALPARAISO). Mapear desde puerto_desembarque.",
  },
  {
    name: "cli_id",
    etiqueta: "Cliente (código)",
    tipo: "text",
    fuente: "aduananet",
    readonly: true,
    nota: "Código interno del cliente en AduanaNet (ej: 2710). Ya viene asignado al despacho.",
  },
  {
    name: "agen_codigo",
    etiqueta: "Agente",
    tipo: "text",
    fuente: "aduananet",
    nota: "Código del agente de aduanas (ej: C69). Fijo para la agencia.",
  },
];

/** Tabla de mapeo puerto → aduana (se completará con datos reales). */
export const PUERTO_A_ADUANA: Record<string, { adu_id: string; ladu_id: string; nombre: string }> = {
  "SAN ANTONIO": { adu_id: "39", ladu_id: "39", nombre: "SAN ANTONIO" },
  "VALPARAISO": { adu_id: "34", ladu_id: "34", nombre: "VALPARAISO" },
  "ARICA": { adu_id: "3", ladu_id: "3", nombre: "ARICA" },
  "IQUIQUE": { adu_id: "7", ladu_id: "7", nombre: "IQUIQUE" },
  "ANTOFAGASTA": { adu_id: "14", ladu_id: "14", nombre: "ANTOFAGASTA" },
};

// ============================================================
// MÓDULO 2: VALORES GENERALES (din_valores_generales)
// ============================================================
// URL: /modulos/din/dus_encabezado/din_valores_generales.php?lib_base=1&lib_nid={OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0
//
// Es el núcleo financiero de la DIN. Patrón de campos en grupos de 4:
//   {campo}_fac      → monto en moneda de la factura
//   {campo}_mon      → código de moneda (ver MONEDAS)
//   {campo}_paridad  → tipo de cambio a USD
//   {campo}          → valor convertido a USD (calculado)
// Los selects sel_{campo}_mon son los desplegables de moneda (62 opciones).
//
// Navegación: doc_origen=dus_valores_generales, doc_destino=dus_identificacion
// (el siguiente módulo del flujo es "Identificación").

export const MODULO_VALORES_GENERALES: CampoDIN[] = [
  // --- Campos ocultos de control ---
  { name: "lib_nid", etiqueta: "Operación", tipo: "hidden", fuente: "aduananet", nota: "Número de operación" },
  { name: "tio_id", etiqueta: "Tipo operación", tipo: "hidden", fuente: "aduananet" },
  { name: "comando", etiqueta: "Comando", tipo: "hidden", fuente: "aduananet", nota: "M=modificar, L=listar/guardar" },
  { name: "doc_destino", etiqueta: "Documento destino", tipo: "hidden", fuente: "aduananet", nota: "dus_identificacion (siguiente módulo)" },

  // --- Moneda y cláusula ---
  {
    name: "moneda_desc / sel_moneda_desc",
    etiqueta: "Moneda",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Invoice.moneda",
    nota: "62 monedas. Valor 13=USD (default). Mapear desde la moneda de la factura comercial.",
  },
  {
    name: "term_compra / sel_term_compra",
    etiqueta: "Cláusula de compra (Incoterm)",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Invoice.incoterm / BL.incoterm",
    nota: "14 opciones: 1=CIF, 2=CFR, 11=CPT, 12=CIP, 9=DDP, 16=DPU, 18=DAP, ... (FOB, EXW, etc.). Mapear desde incoterm.",
  },

  // --- Pesos ---
  {
    name: "dus_peso_bruto_total",
    etiqueta: "Peso bruto total",
    tipo: "text",
    fuente: "documento",
    origenDoc: "BL.peso_bruto_total (fuente principal)",
    nota: "Peso bruto en KG. SALE DEL BL. VALIDACIÓN: comparar con PackingList.peso_bruto_total — si difieren, alertar al usuario para revisión. Si coinciden, usar el del BL.",
  },
  {
    name: "dus_peso_neto_total",
    etiqueta: "Peso neto total",
    tipo: "text",
    fuente: "manual",
    nota: "NO SE USA en nuestro flujo. Dejar como viene / vacío.",
  },
  {
    name: "dus_prorrat_peso",
    etiqueta: "Prorratear peso",
    tipo: "text",
    fuente: "manual",
    nota: "Checkbox (value=1). Indica si se prorratea el peso entre ítems.",
  },

  // --- Totales de items/factura ---
  {
    name: "dus_total_neto_item",
    etiqueta: "Total Neto Items",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Invoice.monto_total",
    nota: "Se indica el VALOR TOTAL DE LA FACTURA comercial (no es un cálculo de ítems).",
  },
  {
    name: "dus_total_neto_factura",
    etiqueta: "Total Neto Factura",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Invoice.monto_total",
    nota: "Valor total de la factura comercial (mismo valor que Total Neto Items).",
  },

  // --- Gastos Adicionales FOB (grupo de 4) ---
  {
    name: "gastos_adic_fob_fac / gastos_adic_fob_mon / gastos_adic_fob_paridad / gastos_adic_fob",
    etiqueta: "Gastos Adicionales FOB",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Invoice (ajustes al FOB, comisiones, etc.)",
    nota: "Grupo de 4: monto factura / moneda / paridad / USD.",
  },

  // --- Valor Ex-Fábrica (grupo de 4) ---
  {
    name: "dus_valor_exfabrica_*",
    etiqueta: "Valor Ex-Fábrica",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Invoice (EXW: valor ex-works)",
    nota: "Aplica cuando incoterm=EXW. Grupo de 4.",
  },

  // --- Gastos hasta FOB 1..4 (cada uno grupo de 4) ---
  {
    name: "dus_gast_hast_fob_1 / mon_id_1 / dus_paridad_1 / dus_gast_hast_fob_1_usd",
    etiqueta: "Gastos hasta FOB 1",
    tipo: "text",
    fuente: "documento",
    origenDoc: "documentos: gastos_hasta_fob[] (O/F origen, THC, handling, etc.)",
    nota: "Hasta 4 líneas de gastos hasta FOB. Provienen del campo gastos_hasta_fob que extraemos del BL (EXW/FOB).",
  },
  {
    name: "dus_gastos_hasta_fob_* (total)",
    etiqueta: "TOTAL Gastos hasta FOB",
    tipo: "text",
    fuente: "calculado",
    readonly: true,
    nota: "Suma de las 4 líneas. = gastos_fob_total que ya calculamos.",
  },

  // --- Total Valor FOB (grupo de 4) ---
  {
    name: "dus_total_valor_fob_*",
    etiqueta: "Total valor FOB",
    tipo: "text",
    fuente: "calculado",
    origenDoc: "Invoice.monto_total (FOB) + ajustes",
    nota: "Valor FOB total. Base para el cálculo CIF.",
  },

  // --- Flete (grupo de 4 + código teórico) ---
  {
    name: "dus_valor_flete_* / dus_cod_flete_teorico",
    etiqueta: "Valor Flete",
    tipo: "text",
    fuente: "documento",
    origenDoc: "BL.flete_total_prepaid",
    nota: "Flete marítimo extraído del BL. SIEMPRE EN USD: dus_valor_flete_mon=13 (USD), dus_valor_flete_paridad=1, y dus_valor_flete_fac = dus_valor_flete = monto en USD. Si el BL trae el flete en otra moneda (ej: EUR), CONVERTIR a USD antes de ingresar. REGLA SEGÚN INCOTERM: CFR/CPT → se agrega el flete del BL (este caso). EXW/FOB/FAS/FCA → flete por cuenta del comprador, también se agrega el O/F del BL. CIF/CIP → flete ya incluido (revisar). dus_cod_flete_teorico: 5 o 7.",
  },

  // --- Seguro (grupo de 4 + código teórico) ---
  {
    name: "dus_valor_seguro_* / dus_cod_seguro_teorico",
    etiqueta: "Valor Seguro",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Póliza.prima (puede venir en marcas_y_numeros.prima, formato europeo 13,38)",
    nota: "Va la PRIMA de la póliza (NO el monto_asegurado). La prima a veces queda anidada en marcas_y_numeros.prima y en formato europeo — el post-procesamiento la normaliza a la raíz como número. SIEMPRE EN USD (mon=13, paridad=1). SI NO HAY PÓLIZA/PRIMA: seguro teórico = 2% sobre FOB. dus_cod_seguro_teorico: 1,2,7,9.",
  },

  // --- Valor CIF (grupo de 4) ---
  {
    name: "dus_valor_cif_*",
    etiqueta: "Valor CIF",
    tipo: "text",
    fuente: "calculado",
    nota: "CIF = FOB + Flete + Seguro. Calculado automáticamente.",
  },

  // --- Adicional a CIF / Ajuste global ---
  { name: "dus_valor_adicional_*", etiqueta: "Adicional a CIF", tipo: "text", fuente: "manual", nota: "Ajustes adicionales sobre CIF (poco común)." },
  { name: "dus_ajuste_global_* / dus_signo_ajuste", etiqueta: "Ajuste global", tipo: "text", fuente: "manual", nota: "Ajuste global con signo (+/-)." },
];

/** Catálogo de monedas de AduanaNet (código → descripción). Las más usadas. */
export const MONEDAS: Record<string, string> = {
  "13": "USD - DOLAR USA",
  "51": "CORONA DINAMARCA",
  "4": "BOLIVIANO",
  "134": "BOLIVAR",
  "161": "BALBOA PA",
  "145": "BATH TH",
  "160": "COLON CR",
  "143": "CORONA CZ",
  // (62 monedas en total — completar según necesidad)
};

/** Cláusulas de compra / Incoterms (código AduanaNet → incoterm). */
export const INCOTERMS_DIN: Record<string, string> = {
  "1": "CIF",
  "2": "CFR",
  "11": "CPT",
  "12": "CIP",
  "9": "DDP",
  "16": "DPU",
  "18": "DAP",
  // FOB, EXW, FAS, FCA, etc. — completar con las 14 opciones reales
};

// ============================================================
// LÓGICA DE CÁLCULO DE VALORES GENERALES (botón "Ejecute Cálculos" → calculos())
// ============================================================
// El botón "Ejecute Cálculos" ejecuta la función JS calculos() que calcula
// FOB/Flete/Seguro/CIF según el incoterm (term_compra). Replicamos esa lógica
// para no depender de ejecutar JS.
//
// Variables base:
//   v_fact_us          = valor total factura en USD (dus_total_neto_factura)
//   cod_flete (5 o '') = código flete teórico (5 = flete teórico 5% sobre FOB)
//   cod_seguro (1,2,'')= código seguro teórico (1 o 2 = % sobre FOB)
//   gastos_hasta_fob_us= total gastos hasta FOB en USD
//   gastos_adic_fob_us = gastos adicionales FOB en USD
//   valor_exfabrica_us = valor ex-fábrica en USD
//
// calcula_usd: si paridad==1 → valor_usd = monto_factura (mismo). Si paridad!=1 → valor_usd = monto/paridad.
//
// Regla CIF en TODOS los casos: CIF = FOB + Flete + Seguro
//
// Cálculo del FOB según incoterm (term_compra):
//   "1"  CIF      → FOB = CIF - Flete - Seguro   (CIF = factura; flete/seguro teóricos o ingresados)
//   "2"  CFR      → FOB = factura - Flete;  Flete ingresado del BL;  Seguro = prima o 2%FOB;  CIF = FOB+Flete+Seguro
//   "11" CPT      → igual que CFR
//   "3"  EXW      → FOB = ex_fabrica + gastos_hasta_fob;  CIF = FOB+Flete+Seguro
//   "4"  FAS      → FOB = factura + gastos_hasta_fob
//   "7"  FCA      → FOB = factura + gastos_hasta_fob
//   "5"  FOB      → FOB = factura + gastos_adic_fob
//   "6"  S/CL     → FOB = factura + gastos_adic_fob
//   "9","13"-"18" DDP/etc → CIF = factura - adicional_cif; FOB = CIF - Flete - Seguro
//   "8"  OTROS    → FOB = ex_fabrica + gastos_hasta_fob + gastos_adic_fob
//
// Seguro:
//   - Si hay prima de póliza → se ingresa (USD).
//   - Si cod_seguro=1 o 2 → seguro = (FOB/100)*cod_seguro (teórico).
//   - Nuestra regla: sin póliza usar 2% sobre FOB (equivale a cod_seguro=2).
// Flete:
//   - Si hay flete del BL → se ingresa (USD).
//   - Si cod_flete=5 → flete = 5% sobre FOB (teórico).
//
// CASO CONFIRMADO (operación 190248, CFR):
//   factura(FOB+flete) ... FOB=20736, Flete=3595, Seguro=13.38 → CIF=24344.38  ✓ (20736+3595+13.38)

export type IncotermDIN = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "11" | "13" | "14" | "15" | "16" | "17" | "18";

export type ValoresInput = {
  termCompra: IncotermDIN;      // código incoterm AduanaNet
  valorFacturaUsd: number;      // v_fact_us (total factura USD)
  fleteUsd?: number;            // flete del BL en USD (CFR/CPT/FOB/EXW...)
  seguroUsd?: number;           // prima de póliza en USD (si existe)
  gastosHastaFobUsd?: number;   // suma gastos hasta FOB (EXW/FAS/FCA)
  gastosAdicFobUsd?: number;    // gastos adicionales FOB (FOB/S-CL)
  valorExFabricaUsd?: number;   // ex-fábrica (EXW)
  valorAdicionalCifUsd?: number;// adicional a CIF (DDP/13-18)
  codFlete?: 5 | null;          // flete teórico
  codSeguro?: 1 | 2 | null;     // seguro teórico
};

export type ValoresCalculados = {
  fob: number;
  flete: number;
  seguro: number;
  cif: number;
};

/** Replica calculos() de AduanaNet para obtener FOB/Flete/Seguro/CIF. */
export function calcularValoresDIN(input: ValoresInput): ValoresCalculados {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const v = input.valorFacturaUsd || 0;
  const codFlete = input.codFlete ?? null;
  const codSeguro = input.codSeguro ?? null;
  const ghf = input.gastosHastaFobUsd || 0;
  const gaf = input.gastosAdicFobUsd || 0;
  const exf = input.valorExFabricaUsd || 0;
  const adicCif = input.valorAdicionalCifUsd || 0;

  let fob = 0, flete = input.fleteUsd || 0, seguro = input.seguroUsd || 0, cif = 0;

  const calcSeguroTeorico = (base: number) => (codSeguro ? r2((base / 100) * codSeguro) : seguro);
  const calcFleteTeorico = (base: number) => (codFlete === 5 ? r2((base / 100) * 5) : flete);

  switch (input.termCompra) {
    case "2": // CFR
    case "11": { // CPT
      flete = codFlete === 5 ? r2((v / 105) * 5) : flete;
      fob = r2(v - flete);
      seguro = (codSeguro === 1 || codSeguro === 2) ? r2((fob / 100) * codSeguro) : seguro;
      cif = r2(fob + flete + seguro);
      break;
    }
    case "3": { // EXW
      fob = r2(exf + ghf);
      flete = calcFleteTeorico(fob);
      seguro = calcSeguroTeorico(fob);
      cif = r2(fob + flete + seguro);
      break;
    }
    case "4": // FAS
    case "7": { // FCA / CYS (ojo: 7 reutilizado)
      fob = r2(v + ghf);
      flete = calcFleteTeorico(fob);
      seguro = calcSeguroTeorico(fob);
      cif = r2(fob + flete + seguro);
      break;
    }
    case "5": // FOB
    case "6": { // S/CL
      fob = r2(v + gaf);
      flete = calcFleteTeorico(fob);
      seguro = calcSeguroTeorico(fob);
      cif = r2(fob + flete + seguro);
      break;
    }
    case "1": { // CIF
      cif = v;
      // flete y seguro teóricos se descuentan del CIF
      seguro = (codSeguro === 1 || codSeguro === 2)
        ? (codFlete === 5 ? r2((cif / (105 + codSeguro)) * codSeguro) : r2(((cif - flete) / (100 + codSeguro)) * codSeguro))
        : seguro;
      flete = codFlete === 5
        ? (codSeguro ? r2((cif / (105 + codSeguro)) * 5) : r2(((cif - seguro) / 105) * 5))
        : flete;
      fob = r2(cif - flete - seguro);
      break;
    }
    case "9": case "13": case "14": case "15": case "16": case "17": case "18": { // DDP y otros incluidos
      cif = r2(v - adicCif);
      seguro = (codSeguro === 1 || codSeguro === 2)
        ? (codFlete === 5 ? r2((cif / (105 + codSeguro)) * codSeguro) : r2(((cif - flete) / (100 + codSeguro)) * codSeguro))
        : seguro;
      flete = codFlete === 5
        ? (codSeguro ? r2((cif / (105 + codSeguro)) * 5) : r2(((cif - seguro) / 105) * 5))
        : flete;
      fob = r2(cif - flete - seguro);
      break;
    }
    case "8": { // OTROS
      fob = r2(exf + ghf + gaf);
      flete = calcFleteTeorico(fob);
      seguro = calcSeguroTeorico(fob);
      cif = r2(fob + flete + seguro);
      break;
    }
  }

  return { fob, flete, seguro, cif };
}

// ============================================================
// FLUJO DE GUARDADO (función aceptar() → grabar.php)
// ============================================================
// Tras llenar y ejecutar cálculos, el guardado es:
//   1. Validaciones de peso (si solo hay peso bruto, estima neto = 3/4 * bruto; dus_estima_peso_neto="E")
//   2. document.frm.action = "grabar.php"
//   3. document.frm.submit()  (POST con TODOS los campos del form)
//   4. Navega a dus_identificacion.php (siguiente módulo)
//
// Para el scraping: POST a /modulos/din/dus_encabezado/grabar.php con todos los
// campos del formulario (hidden + valores). comando="M", recalcular="0".
export const VALORES_GENERALES_GRABAR = {
  action: "/modulos/din/dus_encabezado/grabar.php",
  metodo: "POST",
  siguienteModulo: "/modulos/din/dus_encabezado/dus_identificacion.php",
  nota: "Enviar todos los campos del form. Peso neto: si vacío, AduanaNet estima 3/4 del bruto.",
};

// ============================================================
// MÓDULO 4: IDENTIFICACIÓN (dus_identificacion)
// ============================================================
// URL: /modulos/din/dus_encabezado/dus_identificacion.php?lib_nid={OP}&lbac_nid=1&lib_base=0&dus_tipo_envio=2&comando=M&pagno=0
//
// NOTA: Este módulo NO SE MODIFICA en el scraping. Viene PRECARGADO desde la
// apertura de la operación (datos del importador/consignatario, despachante,
// dirección, etc. ya quedan definidos al crear la operación vía API).
// Solo es un paso del flujo de navegación; se pasa sin cambios al siguiente módulo.
export const MODULO_IDENTIFICACION = {
  noSeModifica: true,
  motivo: "Datos precargados en la apertura de la operación (igual que el Encabezado).",
  url: "/modulos/din/dus_encabezado/dus_identificacion.php",
};

// ============================================================
// MÓDULO 5: DESTINO / TRANSPORTE (dus_destino)
// ============================================================
// URL: /modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid={OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0
//
// Módulo de transporte/logística. La mayoría de campos salen del BL.
// Guardado: botón "Aceptar" → aceptar() → POST grabar.php (mismo patrón que Valores Generales).
//
// Valores actuales de ejemplo (op 190248): pais_origen=225, via=1 (marítima),
// puerto_desembarque=SAN ANTONIO (pue_id2=906), tic_id=R (general).

export const MODULO_DESTINO: CampoDIN[] = [
  // Identificación (readonly)
  { name: "vv_lib_nid", etiqueta: "No. Despacho", tipo: "text", fuente: "aduananet", readonly: true },
  { name: "tio_id", etiqueta: "Tipo operación", tipo: "text", fuente: "aduananet", readonly: true },

  // --- País origen / adquisición ---
  {
    name: "pai_id_origen / lpai_id_origen",
    etiqueta: "País Origen",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Certificado de Origen (prioritario) → Invoice (fallback)",
    nota: "REGLA: SI existe Certificado de Origen → usar el país donde se aplica el tratado (país de origen declarado en el CO, ej: TLC Chile-USA → USA). SI NO hay CO → usar el país de origen del EMISOR DE LA FACTURA (Invoice.pais_origen / país del proveedor). 243 países, código AduanaNet (225 = USA).",
  },
  {
    name: "pai_id_adquisicion / lpai_id_adquisicion",
    etiqueta: "País Adquisición",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Certificado de Origen (prioritario) → Invoice (fallback)",
    nota: "MISMA REGLA que País Origen: SI existe CO → país del tratado; SI NO → país del emisor de la factura. Normalmente coincide con País Origen.",
  },

  // --- Vía de transporte ---
  {
    name: "via_id / lvia_id",
    etiqueta: "Vía transporte",
    tipo: "select",
    fuente: "documento",
    origenDoc: "BL (marítimo)",
    nota: "12 opciones: 1=MARÍTIMA (lo común para BL), 4=AÉREO, 7=CARRETERO. Para BL → 1.",
  },

  // --- Puertos ---
  {
    name: "pue_id / pue_nombre / dus_puerto_embarque_glosa",
    etiqueta: "Puerto Embarque",
    tipo: "text",
    fuente: "documento",
    origenDoc: "BL.puerto_embarque (o BL.puerto_transbordo si existe)",
    nota: "REGLA: por defecto usar BL.puerto_embarque. SI EXISTE puerto_transbordo → usar el TRANSBORDO como puerto de embarque. CÓDIGO VÍA POPUP: consultar /modulos/general/otros_puertos.php?identificador=pue_id&modo=desc&valor={NOMBRE}&via=&nacional=0 (puertos EXTRANJEROS). Parsear la respuesta: la fila trae seleccion(\"{CODIGO}\",\"{NOMBRE}\"). Ej: CALLAO → seleccion('252','CALLAO') → pue_id=252. Setear pue_id, pue_nombre y dus_puerto_embarque_glosa con el código y nombre obtenidos.",
  },
  {
    name: "pue_id2 / pue_nombre2 / dus_puerto_desembarque_glosa",
    etiqueta: "Puerto Desembarque",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Predefinido en apertura + validar con BL.puerto_desembarque (corregido)",
    nota: "Viene PREDEFINIDO en la apertura de la operación, PERO SIEMPRE confirmar/validar contra el puerto_desembarque del BL (incluyendo correcciones del bloque ILS CARGO/Asia Shipping y ShipsGo). Si el predefinido difiere del BL corregido → usar el del BL y re-resolver el código vía popup. CÓDIGO VÍA POPUP: /modulos/general/puertos.php?identificador=pue_id2&modo=desc&valor={NOMBRE}&via={via_id}&nacional=1 (NACIONALES). Ej: SAN ANTONIO = pue_id2 906.",
  },
  {
    name: "din_transbordo",
    etiqueta: "Transbordo",
    tipo: "select",
    fuente: "documento",
    origenDoc: "BL.puerto_transbordo (si existe)",
    nota: "Opciones: T, P, D, A. Indicar si hubo transbordo. OJO: aunque el transbordo se use como puerto de embarque, este flag igual marca que hubo transbordo.",
  },

  // --- Nave / Compañía transportadora ---
  {
    name: "nav_id / nav_nombre",
    etiqueta: "Nave",
    tipo: "text",
    fuente: "documento",
    origenDoc: "BL.nave_corregida (prioriza bloque corrección/ShipsGo)",
    nota: "Usar la NAVE CORREGIDA. BUSCAR vía popup: /modulos/general/ventanas/listados/nave.php?identificador=&fil_nav_nombre={NOMBRE}. La respuesta trae filas seleccion('nav_id','nombre','tra_id','pai_id'). SI EXISTE → tomar nav_id. SI NO EXISTE (respuesta vacía) → CREARLA en mantenedores/nave.php?comando=I (campos: nav_nombre, pai_id, tra_id) y luego re-buscar para obtener el nav_id. Ej: MAERSK COLORADO=216. 'MYD SHENZHEN' no existía → se debe crear.",
  },
  {
    name: "cia_id / dus_nombre_cia_transp / pai_idcia / dus_rut_cia_transp",
    etiqueta: "Cía. Transportadora (Naviera Master)",
    tipo: "text",
    fuente: "documento",
    origenDoc: "BL.naviera (naviera del MBL/master)",
    nota: "Es la NAVIERA MASTER (del MBL). BUSCAR vía autocompletado: la página dus_destino trae un array JS arrcia_id (2429 navieras) con [codigo, NOMBRE]. SI EXISTE → tomar cia_id; SI HAY VARIAS COINCIDENCIAS → tomar SIEMPRE LA ÚLTIMA CREADA (código más alto). SI NO EXISTE → CREARLA en mantenedores/transportista.php?comando=I (campos: tra_nombre, tra_rut, pai_id). ANTES de crear, CONSULTAR AL USUARIO el PAÍS y el RUT. IMPORTANTE — ESPERAR DATOS: al seleccionar la cía (setear cia_id), AduanaNet dispara carga_datos_transportista() que llama a /modulos/general/getXML/transportista.php?tra_id={cia_id} y PEGA el país (pai_idcia) y el RUT (dus_rut_cia_transp). HAY QUE ESPERAR/LLAMAR ese endpoint y setear esos campos ANTES de guardar. Implementado en datosTransportista(). Ej op 190248: ZIM cia_id=96850241 → pai_id=997, rut=77622451-0.",
  },

  // --- Tipo de carga ---
  {
    name: "tic_id",
    etiqueta: "Tipo Carga",
    tipo: "select",
    fuente: "documento",
    origenDoc: "BL (tipo de contenedor/mercancía)",
    nota: "F=Frigorizados, G=Granel sólido, L=Granel líquido/gaseoso, O=Electricidad, R=General (lo común contenedores), S=Servicios.",
  },

  // --- Manifiestos ---
  {
    name: "din_manifiesto1/2/3 / din_fec_manifiesto",
    etiqueta: "Manifiestos",
    tipo: "text",
    fuente: "scraping",
    origenDoc: "Aduana Chile (comext.aduana.cl) — Consulta Manifestación Marítima",
    nota: "Se obtiene scrapeando el sistema de Aduana: http://comext.aduana.cl:7001/ManifestacionMaritima/limpiarListaProgramacionNaves.do. PROCEDIMIENTO: filtrar por puerto de llegada (= puerto desembarque, ej SAN ANTONIO=906), año, mes, tipo='I' (MFTO. Ingreso). BUSCAR en MES ANTERIOR + MES ACTUAL + MES SIGUIENTE por el NÚMERO DE VIAJE (columna Viaje). din_manifiesto1 = PRIMERA COLUMNA (N° manifiesto). din_fec_manifiesto = columna FECHA (última col) del mismo registro. Códigos puerto: SAN ANTONIO=906, VALPARAISO=905, ARICA=901, IQUIQUE=902, ANTOFAGASTA=903. Implementado en buscarManifiesto() que devuelve { manifiesto, nave, viaje, agencia, fecha }. Ej validado: viaje NX618A → manifiesto 271593, fecha 08/06/2026.",
  },

  // --- Emisor documento de transporte ---
  {
    name: "cia_id_emisora / dus_emisor_docto_transp / cia_emisora_rut",
    etiqueta: "Emisor Docto. Transporte",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Emisor del BL HOUSE (freight forwarder) → si no hay HBL, naviera master",
    nota: "REGLA: es el EMBARCADOR que emite el BL HIJO/HOUSE (freight forwarder, ej: ILS CARGO, Asia Shipping, BDP). SI NO EXISTE BL hijo → usar la MISMA empresa de transporte del MASTER (la naviera master, = cia_id). Mismo mecanismo de búsqueda que Cía. Transportadora: autocompletado arrcia_id; si hay varias coincidencias → la última creada; si no existe → crear (consultar país y RUT). Usa Complete()/carga_datos_emisor().",
  },

  // --- Almacenista ---
  {
    name: "alm_id / lalm_id / din_fec_recep / din_fec_retiro",
    etiqueta: "Almacenista",
    tipo: "select",
    fuente: "manual",
    nota: "102 opciones (A01=Aduana, A02=Empresa Portuaria Valparaíso, etc.). Depende del puerto/terminal donde quedó la carga. Confirmar fuente (¿del bloque de corrección ILS CARGO 'ALMACEN'?).",
  },

  // --- Documento de transporte (conocimiento) ---
  {
    name: "din_nro_docto_transp / din_fec_docto_transp",
    etiqueta: "N° Doc. Transporte (Conocimiento)",
    tipo: "text",
    fuente: "documento",
    origenDoc: "BL.numero_bl_master (+ numero_bl_house si existe) / fecha_emision",
    nota: "REGLA: din_nro_docto_transp = MASTER + HIJO CONCATENADOS EN UN SOLO STRING (sin separador). Ej: master 'ZIMUIAH987933' + hijo '(H)SHA25051364' → 'ZIMUIAH987933(H)SHA25051364'. Si NO hay hijo → solo el MASTER. El hijo conserva su prefijo (H)/(N). FECHA (din_fec_docto_transp): si NO hay hijo → fecha emisión del MASTER; si HAY hijo → fecha emisión del HIJO (HBL). Formato DD/MM/YYYY.",
  },

  // --- Visto Bueno / Reglas ---
  {
    name: "din_cod_regla1_vb / din_nro_regla1_vb / din_agno_regla1_vb / ldin_cod_regla1_vb",
    etiqueta: "Visto Bueno",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Certificado de Origen / certificados (según producto)",
    nota: "22 opciones (16=Aduana, 30=C ORIGEN, etc.). Vistos buenos requeridos según la mercancía/tratado.",
  },

  // --- Certificados ISP / SESMA (sanitarios) ---
  {
    name: "isp_cod_certificado / isp_ano / isp_parcial / isp_emisor / sesma_*",
    etiqueta: "Certificados ISP/SESMA",
    tipo: "text",
    fuente: "manual",
    nota: "Certificados sanitarios (solo si la mercancía los requiere).",
  },

  // --- Info importación ---
  {
    name: "num_inf_imp / fec_inf_imp",
    etiqueta: "Núm. Inf. Importación",
    tipo: "text",
    fuente: "manual",
    nota: "Default 999. Informe de importación si aplica.",
  },

  // Hidden de control
  { name: "comando", etiqueta: "Comando", tipo: "hidden", fuente: "aduananet", nota: "M=modificar / L al guardar" },
];

export const DESTINO_GRABAR = {
  action: "/modulos/din/dus_encabezado/dus_destino.php",
  metodo: "POST",
  comando: "U",
  nota: "Botón Aceptar → aceptar() valida (ChequeaNoNulos, validaDinEnviada) y hace comando.value='U' + submit a SÍ MISMO (action vacío = dus_destino.php, NO grabar.php). Enviar TODOS los campos del form con comando=U. Validado: persiste puertos, nave, naviera, emisor, manifiesto y doc transporte. CREAR NAVE: si no existe, mantenedores/nave.php con comando='N' (responde 'creado!'); luego re-buscar para obtener nav_id.",
};

// ============================================================
// MÓDULO 6: ANTECEDENTES FINANCIEROS (dus_antecedentes)
// ============================================================
// URL: /modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid={OP}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0
// Guardado: botón "Aceptar" → aceptar() → comando="U" + submit a SÍ MISMO (igual que Destino).
//
// Valores actuales op 190248: reg_id=92 (régimen), fpa_id=1, din_dias=60,
// mda_id=13 (USD divisas), cvt_id=2 (CFR cláusula venta), fpg_id=4 (forma pago gravámenes).

export const MODULO_ANTECEDENTES: CampoDIN[] = [
  {
    name: "reg_id / lreg_id",
    etiqueta: "Régimen de Importación",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Certificado de Origen.tratado_aplicable",
    nota: "REGLA: el régimen debe COINCIDIR con el tratado de libre comercio del Certificado de Origen. SI hay CO → seleccionar el código del tratado (ej: TLC Chile-USA → 92 TLCCH-USA). SI NO hay CO → 1 (GENERAL). Ver TRATADO_A_REGIMEN. Validado op 190248: CO TLC Chile-USA → reg_id=92.",
  },
  {
    name: "bcc_id / lbcc_id",
    etiqueta: "Banco Comercial",
    tipo: "select",
    fuente: "manual",
    nota: "41 bancos (1=CENTRAL BANK, 2=CORPBANCA, 9=BBVA...). Banco de la operación de cambio. Suele venir del cliente/operación. Confirmar.",
  },
  {
    name: "fpa_id / lfpa_id",
    etiqueta: "Forma de Pago",
    tipo: "select",
    fuente: "manual",
    nota: "SIEMPRE = 1 (COB1). Valor fijo por defecto.",
  },
  {
    name: "din_dias",
    etiqueta: "Días",
    tipo: "text",
    fuente: "documento",
    origenDoc: "Invoice.condiciones_pago (plazo en días)",
    nota: "Días de plazo de pago. Valor actual=60. Del plazo de la factura (ej: 60 días).",
  },
  {
    name: "mda_id / lmda_id / moneda_glosa",
    etiqueta: "Divisas (Moneda)",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Invoice.moneda",
    nota: "53 monedas. 13=USD. Moneda de la operación de cambio. Mapear desde la moneda de la factura.",
  },
  {
    name: "div_id / ldiv_id",
    etiqueta: "Tipo de Divisas",
    tipo: "select",
    fuente: "manual",
    nota: "6 opciones: 1=MERC.CAMB.FORMAL, 2=TESORERIA GENERAL, 3=SIN PAGO, 4=DISPONIB. PROPIAS, 5=OTROS. Cómo se obtienen las divisas. Confirmar regla.",
  },
  {
    name: "cvt_id / lcvt_id",
    etiqueta: "Cláusula de Venta (Incoterm)",
    tipo: "select",
    fuente: "documento",
    origenDoc: "Invoice.incoterm / BL.incoterm",
    nota: "10 opciones: 1=CIF, 2=CFR, 3=EXW, 4=FAS, 5=FOB, 6=S/CL, 7=FCA, 8=OTRA, 9=DDP. DEBE coincidir con term_compra de Valores Generales. Valor actual=2 (CFR). Mapear desde incoterm.",
  },
  {
    name: "din_valor_ex_fabrica",
    etiqueta: "Valor Ex-Fábrica",
    tipo: "text",
    fuente: "calculado",
    nota: "Solo aplica para EXW. Valor ex-fábrica en USD. 0.00 si no es EXW.",
  },
  {
    name: "fpg_id / lfpg_id",
    etiqueta: "Forma de Pago Gravámenes",
    tipo: "select",
    fuente: "manual",
    nota: "84 opciones (1=CONT/CONT, 2=Sp/IVA Sp, 4=Sp/IVA C, etc). Cómo se pagan los gravámenes/IVA. Valor actual=4. Confirmar regla.",
  },
  {
    name: "din_gastos_hasta_fob",
    etiqueta: "Gastos hasta FOB",
    tipo: "text",
    fuente: "documento",
    origenDoc: "gastos_fob_total (EXW/FOB)",
    nota: "Gastos hasta FOB en USD. 0.00 si no aplica. = gastos_fob_total ya calculado.",
  },
  // Certificado de origen (campos hidden, se completan si hay CO)
  {
    name: "cert_orig_tipo / cert_numero / cert_fecha",
    etiqueta: "Certificado de Origen",
    tipo: "hidden",
    fuente: "documento",
    origenDoc: "Certificado de Origen",
    nota: "Tipo, número y fecha del certificado de origen (para preferencia arancelaria del tratado).",
  },
];

export const ANTECEDENTES_GRABAR = {
  action: "/modulos/din/dus_encabezado/dus_antecedentes.php",
  metodo: "POST",
  comando: "U",
  nota: "Botón Aceptar → aceptar() → comando='U' + submit a SÍ MISMO (dus_antecedentes.php). Mismo patrón que Destino.",
};

/**
 * Catálogo de regímenes de importación (reg_id) por tratado de libre comercio.
 * El régimen se determina por el tratado declarado en el Certificado de Origen.
 * Si no hay CO → GENERAL (1).
 */
export const REGIMENES: Record<string, string> = {
  "0": "SIN REGIMEN", "1": "GENERAL",
  "51": "TLC-CHINDO", "52": "AACH-RU", "53": "ALCAPS", "54": "CEPA-EAU",
  "60": "AMCHIAP", "61": "TLCCH-HON", "62": "TLCCH-PAN", "63": "TLCCH-AUS",
  "64": "ALCCH-COL", "65": "TLCCH-GU", "66": "TLCCH-TURQ", "67": "ALCCH-MAL",
  "68": "TLCCH-VIET", "69": "TLCCH-NIC", "70": "TLCCH-TAI", "71": "ALADI",
  "72": "ACEM", "73": "TLCCHC", "75": "TLCCH-M", "79": "TLCCH-CR",
  "80": "TLCCH-ES", "86": "GATT", "89": "TLCCH-HGK", "91": "AICCH-UE",
  "92": "TLCCH-USA", "93": "TLCCH-COR", "94": "TLCCH-AELC", "96": "TLC-CHCHI",
  "97": "AAPCH-IND", "98": "AAEECH-JAP",
};

/**
 * Mapea palabras clave del tratado (del Certificado de Origen) al código de régimen.
 * Se busca por coincidencia de país/tratado en el texto del CO.
 */
export const TRATADO_A_REGIMEN: Array<{ keywords: RegExp; regId: string; nombre: string }> = [
  { keywords: /ESTADOS UNIDOS|UNITED STATES|USA|EE\.?UU/i, regId: "92", nombre: "TLCCH-USA" },
  { keywords: /UNION EUROPEA|EUROPEAN UNION|\bUE\b|\bEU\b/i, regId: "91", nombre: "AICCH-UE" },
  { keywords: /CHINA(?!\s*TAI)/i, regId: "96", nombre: "TLC-CHCHI" },
  { keywords: /COREA|KOREA/i, regId: "93", nombre: "TLCCH-COR" },
  { keywords: /JAPON|JAPAN/i, regId: "98", nombre: "AAEECH-JAP" },
  { keywords: /INDIA/i, regId: "97", nombre: "AAPCH-IND" },
  { keywords: /CANADA/i, regId: "73", nombre: "TLCCHC" },
  { keywords: /MEXICO|MÉXICO/i, regId: "75", nombre: "TLCCH-M" },
  { keywords: /COLOMBIA/i, regId: "64", nombre: "ALCCH-COL" },
  { keywords: /PANAMA|PANAMÁ/i, regId: "62", nombre: "TLCCH-PAN" },
  { keywords: /AUSTRALIA/i, regId: "63", nombre: "TLCCH-AUS" },
  { keywords: /TURQUIA|TURQUÍA|TURKEY/i, regId: "66", nombre: "TLCCH-TURQ" },
  { keywords: /VIETNAM/i, regId: "68", nombre: "TLCCH-VIET" },
  { keywords: /HONG\s*KONG/i, regId: "89", nombre: "TLCCH-HGK" },
  { keywords: /CENTROAMERICA|HONDURAS/i, regId: "61", nombre: "TLCCH-HON" },
  { keywords: /COSTA RICA/i, regId: "79", nombre: "TLCCH-CR" },
  { keywords: /EL SALVADOR/i, regId: "80", nombre: "TLCCH-ES" },
  { keywords: /AELC|EFTA/i, regId: "94", nombre: "TLCCH-AELC" },
];

/** Resuelve el reg_id a partir del tratado/país del Certificado de Origen. Default GENERAL (1). */
export function resolverRegimen(tratadoOPais: string): { regId: string; nombre: string } {
  if (!tratadoOPais) return { regId: "1", nombre: "GENERAL" };
  for (const r of TRATADO_A_REGIMEN) {
    if (r.keywords.test(tratadoOPais)) return { regId: r.regId, nombre: r.nombre };
  }
  return { regId: "1", nombre: "GENERAL" };
}
