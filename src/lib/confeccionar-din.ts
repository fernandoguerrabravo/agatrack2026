import "server-only";
import { aduananetLogin, aduananetFetch, aduananetGet, resolverNave, resolverPuerto, buscarTransportista, datosTransportista } from "./aduananet";
import { buscarManifiesto } from "./aduana-manifiesto";
import { resolverRegimen } from "./din-estructura";
import { aduananetBrowserLogin, browserValoresFactura, browserCuentasValores } from "./aduananet-browser";

/**
 * Confección completa de DIN en AduanaNet.
 * Graba módulos: Valores Generales, Destino, Antecedentes, Mercancía, Bultos, Cuentas.
 */

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";

type DocRow = {
  id: number;
  tipo_documento: string;
  datos_extraidos: string | Record<string, unknown>;
  datos_extraidos_claude?: string | Record<string, unknown>;
  datos_shipsgo?: string | Record<string, unknown>;
};

function parseDoc(row: DocRow): Record<string, unknown> {
  const main = typeof row.datos_extraidos === "string" ? JSON.parse(row.datos_extraidos) : row.datos_extraidos;
  // Merge con Claude para campos que faltan en main
  if (row.datos_extraidos_claude) {
    const claude = typeof row.datos_extraidos_claude === "string" ? JSON.parse(row.datos_extraidos_claude) : row.datos_extraidos_claude;
    for (const [k, v] of Object.entries(claude)) {
      if (v && !main[k]) main[k] = v;
    }
  }
  return main;
}

function extractFields(html: string): Record<string, string> {
  const f: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (type === "button") continue;
    if (type === "checkbox" || type === "radio") { if (/checked/i.test(tag)) f[name] = value || "1"; }
    else f[name] = value;
  }
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    f[name] = (m[2].match(/<option\s[^>]*value\s*=\s*["']?([^"'>]*)["']?[^>]*selected/i) || [])[1] || "";
  }
  for (const m of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (name) f[name] = m[2].trim();
  }
  return f;
}

function pickXml(xml: string, tag: string): string {
  return (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) || [])[1]?.trim() || "";
}

async function postForm(url: string, fields: Record<string, string>, referer?: string): Promise<Response> {
  const cookies = await aduananetLogin();
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.set(k, v ?? "");
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookies,
      "User-Agent": "Mozilla/5.0 (AgaTrack DIN Bot)",
      ...(referer ? { "Referer": referer } : {}),
    },
    body: body.toString(),
    redirect: "manual",
  });
}

const INCOTERM_MAP: Record<string, string> = { CIF: "1", CFR: "2", CPT: "11", CIP: "12", EXW: "3", FAS: "4", FOB: "5", FCA: "7", DDP: "9" };

/** Resuelve el código de país AduanaNet a partir del nombre (para terrestre). Default Argentina (224). */
function codigoPais(nombre: string, def = "224"): string {
  const MAP: Record<string, string> = {
    "UNITED STATES": "225", "USA": "225", "US": "225", "ESTADOS UNIDOS": "225",
    "GERMANY": "563", "ALEMANIA": "563", "DEUTSCHLAND": "563",
    "SPAIN": "517", "ESPAÑA": "517", "ESPANA": "517",
    "FRANCE": "505", "FRANCIA": "505",
    "ITALY": "504", "ITALIA": "504",
    "NETHERLANDS": "506", "HOLANDA": "506", "PAISES BAJOS": "506",
    "BELGIUM": "514", "BELGICA": "514", "BÉLGICA": "514",
    "UNITED KINGDOM": "510", "UK": "510", "REINO UNIDO": "510", "ENGLAND": "510",
    "SWITZERLAND": "508", "SUIZA": "508", "SWEDEN": "511", "SUECIA": "511",
    "CHINA": "336", "JAPAN": "331", "JAPON": "331",
    "KOREA": "333", "COREA": "333", "SOUTH KOREA": "333", "COREA DEL SUR": "333",
    "INDIA": "317", "BRAZIL": "220", "BRASIL": "220",
    "CANADA": "226", "MEXICO": "216", "COLOMBIA": "202",
    "PERU": "219", "ARGENTINA": "224", "CHILE": "997",
    "AUSTRALIA": "406", "TAIWAN": "330",
  };
  return MAP[String(nombre || "").toUpperCase().trim()] || def;
}

/**
 * Obtiene el código de unidad de medida (ume_id) de un descriptor de mercancía.
 * El descriptor lo define en formulario_desde_mercancia.php (campo dsc_cod_unidad_medida).
 * Es lo mismo que hace post_open_descriptor() en el navegador.
 * Ej: bombas KSB partida 84137000 → "10" (U); graneles/químicos → "6" (KN).
 */
async function unidadMedidaDescriptor(codigoProducto: string, cliId: string): Promise<string> {
  try {
    const cookies = await aduananetLogin();
    const url = `${BASE_URL}/modulos/mantenedores/dsc_mercancia/formulario_desde_mercancia.php?accion=E&dsc_cod_producto=${encodeURIComponent(codigoProducto)}&cli_id=${cliId}&cli_id_despacho=${cliId}`;
    const html = await (await fetch(url, { headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0 (AgaTrack DIN Bot)" } })).text();
    const m = html.match(/name\s*=\s*["']dsc_cod_unidad_medida["'][^>]*\bvalue\s*=\s*["'](\d+)["']/i);
    return (m && m[1]) ? m[1] : "6";
  } catch {
    return "6";
  }
}

export async function confeccionarDIN(nroOperacion: string, docs: DocRow[]) {
  const getDoc = (tipo: string) => {
    const row = docs.find(d => d.tipo_documento === tipo);
    return row ? parseDoc(row) : null;
  };

  // Obtener cli_id (RUT sin DV) para búsqueda de descriptores
  const { pgQuery: pgQ2 } = await import("./postgres");
  const cliRows = await pgQ2<{ rut_cliente: string }>("SELECT rut_cliente FROM despachos_replica WHERE despacho = $1 LIMIT 1", [nroOperacion]);
  const cliId = (cliRows[0]?.rut_cliente || "").split("-")[0].replace(/\./g, "") || "2710";

  const invoice = getDoc("Invoice (Factura Comercial)") as Record<string, unknown>;
  const co = getDoc("Certificado de Origen") as Record<string, unknown> | null;
  const bl = getDoc("Bill of Lading (BL)") as Record<string, unknown> | null;
  const crt = getDoc("Carta de Porte Internacional (CRT)") as Record<string, unknown> | null;
  const mic = getDoc("MIC/DTA") as Record<string, unknown> | null;
  const poliza = getDoc("Póliza de Seguro") as Record<string, unknown> | null;

  if (!invoice) throw new Error("No se encontró Invoice");

  // Detectar operación terrestre: presencia de CRT y/o MIC/DTA, sin BL
  const esTerrestre = !!(crt || mic) && !bl;
  if (esTerrestre) {
    console.log("[confeccionar] Operación TERRESTRE detectada (CRT/MIC presente, sin BL)");
    return confeccionarDINTerrestre(nroOperacion, docs, invoice, co, crt, mic, poliza, cliId);
  }

  // Detectar aéreo
  const awb = getDoc("Guía Aérea (AWB)") as Record<string, unknown> | null;
  const papeleta = getDoc("Papeleta Aérea") as Record<string, unknown> | null;
  const esAereo = !!awb && !bl;
  if (esAereo) console.log("[confeccionar] Operación AÉREA detectada (AWB presente, sin BL)");

  // Datos base
  let regimen = co ? resolverRegimen(String(co.tratado_aplicable || co.pais_origen || "")) : { regId: "1", nombre: "GENERAL" };
  
  // Detectar TLC Chile-UE por código REX en factura, packing list o certificado de origen
  // Formato REX: XXREXXXX (2 letras + "RE" + 4+ caracteres)
  const packing = getDoc("Lista de Empaque (Packing List)") as Record<string, unknown> | null;
  const textoInvoice = JSON.stringify(invoice).toUpperCase();
  const textoPacking = packing ? JSON.stringify(packing).toUpperCase() : "";
  const textoCO = co ? JSON.stringify(co).toUpperCase() : "";
  const textoCompleto = textoInvoice + " " + textoPacking + " " + textoCO;
  const rexMatch1 = textoCompleto.match(/\b([A-Z]{2}REX[A-Z]{2}\d{6,})\b/);
  const rexMatch2 = textoCompleto.match(/\b([A-Z]{2}RE[A-Z]{2}\d{6,})\b/);
  const rexMatch = rexMatch1 || rexMatch2;
  let esRexEuropa = false;
  let nroRex = "";
  if (rexMatch) {
    regimen = { regId: "91", nombre: "AICCH-UE" };
    esRexEuropa = true;
    nroRex = rexMatch[1];
    console.log("[confeccionar] REX detectado:", nroRex, "→ aplicando TLC Chile-UE (91)");
  }

  const incoterm = String(invoice.incoterm || "").split(/\s/)[0].toUpperCase();
  const cvtId = INCOTERM_MAP[incoterm] || "2";
  const nave = String(bl?.nave_corregida || bl?.nave || "");
  const viaje = String(bl?.viaje_corregido || bl?.viaje || "");
  const fobValue = Number(invoice.fob_value || invoice.monto_total || 0);
  // Flete y peso: fuente según tipo de operación
  let fleteValue = 0;
  let pesoBruto = 0;
  if (esAereo && awb) {
    // AÉREO: flete y peso del AWB/Papeleta
    fleteValue = Number((awb.flete as Record<string, unknown>)?.monto || awb.total_prepaid || 0);
    pesoBruto = Number(papeleta?.peso_verificado_kg || awb.peso_bruto_kg || 0);
  } else {
    // MARÍTIMO: flete del BL
    const fletePrepaid = Number(bl?.flete_total_prepaid || bl?.total_prepaid || 0);
    const gastosHastaFob = (bl?.gastos_hasta_fob || []) as Array<Record<string, unknown>>;
    const gastosPrepaidExtra = gastosHastaFob
      .filter(g => !/\bTHC\b|\bDTHC\b|terminal\s*handling/i.test(String(g.concepto || "")))
      .reduce((sum, g) => sum + Number(g.monto || 0), 0);
    fleteValue = bl?.total_prepaid ? Number(bl.total_prepaid) : fletePrepaid + gastosPrepaidExtra;
    pesoBruto = Number(bl?.peso_bruto_total || (invoice.items as Array<Record<string, unknown>>)?.[0]?.peso_bruto || 0);
  }
  const primaRaw = poliza?.prima || (poliza?.marcas_y_numeros as Record<string, unknown>)?.prima || "0";
  const seguroValue = parseFloat(String(primaRaw).replace(",", ".")) || 0;
  const cifValue = fobValue + fleteValue + seguroValue;

  const certNumero = String(co?.numero_certificado || "S/N");
  const certFecha = String((co?.representante_legal_autorizado as Record<string, unknown>)?.fecha_firma || co?.fecha_emision || "");
  // Para Chile-UE con REX en factura: cert_orig_tipo = "f" (certificación en factura)
  const certTipo = regimen.regId === "1" ? "" : (esRexEuropa ? "f" : "c");

  const resultado: Record<string, string> = {};

  // ── BUSCAR MANIFIESTO ──
  let manifNumero = "";
  let manifFecha = "";
  if (viaje) {
    const puertoDesembarque = String(bl?.puerto_desembarque || "SAN ANTONIO");
    const manif = await buscarManifiesto(puertoDesembarque, viaje, nave);
    if (manif) {
      manifNumero = manif.manifiesto;
      manifFecha = manif.fecha;
      resultado.manifiesto = `${manifNumero} (${manifFecha})`;
    }
  }

  // ── MÓDULO 2: VALORES GENERALES (via Puppeteer — clickea "Ejecute Cálculos" + "Aceptar") ──
  const { browser, page } = await aduananetBrowserLogin();
  try {
    const vgResult = await browserValoresFactura(page, nroOperacion, {
      termCompra: cvtId,
      moneda: "13",
      pesoBruto: String(pesoBruto),
      totalNetoFactura: String(invoice.monto_total),
      fleteFac: String(fleteValue),
      fleteMon: fleteValue > 0 ? "13" : "",
      fleteParidad: fleteValue > 0 ? "1" : "0",
      seguroFac: seguroValue.toFixed(2),
      seguroMon: seguroValue > 0 ? "13" : "",
      seguroParidad: seguroValue > 0 ? "1" : "0",
    });
    resultado.valores_generales = `FOB=${vgResult.fob} Flete=${vgResult.flete} CIF=${vgResult.cif}`;
  } catch (err) {
    console.error("[confeccionar] Error Puppeteer Valores:", err instanceof Error ? err.message : err);
    await browser.close();
    throw new Error("Error en módulo Valores Factura: " + (err instanceof Error ? err.message : "desconocido"));
  }
  // No cerrar browser aún — se reutiliza para Cuentas y Valores

  // ── MÓDULO 3: IDENTIFICACIÓN (consignante) ──
  const idUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_identificacion.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const idHtml = await aduananetGet(idUrl);
  const idf = extractFields(idHtml);

  // Buscar consignante (emisor de la factura comercial)
  const proveedorNombre = String((invoice.proveedor as Record<string, unknown>)?.nombre || invoice.proveedor || "");
  if (proveedorNombre) {
    // Buscar usando primera palabra significativa (AduanaNet busca "empieza con")
    const cleanedProv = proveedorNombre
      .replace(/\b(S\.?R\.?L\.?|S\.?A\.?|LTDA\.?|INC\.?|LLC|SOCIEDAD\s*DE\s*RESPONS\w*|DE\s*RESPONS\w*)\b/gi, "")
      .replace(/\(.*?\)/g, "")
      .replace(/\s*-\s*.*$/, "")
      .trim();
    const palabras = (cleanedProv || proveedorNombre).split(/[\s,]+/).filter((w: string) => w.length >= 3);
    const firstWord = palabras.length > 0
      ? palabras.sort((a, b) => b.length - a.length)[0]
      : proveedorNombre.substring(0, 8);
    console.log(`[confeccionar] Buscando consignante: "${firstWord}" (original: "${proveedorNombre}")`);
    const csgSearchUrl = `/modulos/general/ventanas/listados/consignante.php?identificador=&fil_csg_nombre=${encodeURIComponent(firstWord)}`;
    const csgHtml = await aduananetGet(csgSearchUrl);
    const csgMatches = [...csgHtml.matchAll(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/gi)];
    
    if (csgMatches.length > 0) {
      const target = proveedorNombre.toUpperCase();
      let best = csgMatches[0];
      let bestScore = 0;
      for (const m of csgMatches) {
        const mNombre = m[2].toUpperCase().replace(/\s*\.\s*\.\s*\.?\s*/g, "").trim();
        let score = 0;
        if (target === mNombre) score = 10;
        else if (target.includes(mNombre)) score = 8;
        else if (mNombre.includes(target)) score = 7;
        else if (mNombre.includes(firstWord.toUpperCase())) score = 5;
        else if (target.includes(mNombre.split(/\s+/)[0])) score = 3;
        if (score > bestScore) { bestScore = score; best = m; }
      }
      idf.csg_id = best[1];
      idf.csg_nombre = best[2];
      idf.dus_nombre_consignatario = best[2];
      idf.csg_direccion = best[6] || "";
      idf.pai_id = best[3] || "";
      console.log(`[confeccionar] Consignante encontrado: ${best[2]} (ID ${best[1]})`);
    } else {
      console.log("[confeccionar] ⚠️ Consignante no encontrado:", proveedorNombre);
    }
  }

  idf.comando = "U";
  await postForm(idUrl, idf, idUrl);
  resultado.identificacion = `consignante=${idf.csg_nombre || "(no encontrado)"}`;

  // ── MÓDULO 4: DESTINO ──
  const destUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const destHtml = await aduananetGet(destUrl);
  const df = extractFields(destHtml);
  // País origen/adquisición — del CO, o de la factura si es REX Europa
  // Mapeo básico de países a código AduanaNet (los más comunes)
  const PAIS_MAP: Record<string, string> = {
    "UNITED STATES": "225", "USA": "225", "US": "225", "ESTADOS UNIDOS": "225", "U.S.A.": "225", "U.S.A": "225",
    "GERMANY": "563", "ALEMANIA": "563", "DEUTSCHLAND": "563",
    "SPAIN": "517", "ESPAÑA": "517", "ESPANA": "517",
    "FRANCE": "505", "FRANCIA": "505",
    "ITALY": "504", "ITALIA": "504",
    "NETHERLANDS": "506", "HOLANDA": "506", "PAISES BAJOS": "506",
    "BELGIUM": "514", "BELGICA": "514", "BÉLGICA": "514",
    "UNITED KINGDOM": "510", "UK": "510", "REINO UNIDO": "510", "ENGLAND": "510",
    "SWITZERLAND": "508", "SUIZA": "508",
    "SWEDEN": "511", "SUECIA": "511",
    "CHINA": "336", "JAPAN": "331", "JAPON": "331",
    "KOREA": "333", "COREA": "333", "SOUTH KOREA": "333", "COREA DEL SUR": "333",
    "INDIA": "317", "BRAZIL": "220", "BRASIL": "220",
    "CANADA": "226", "MEXICO": "216", "COLOMBIA": "202",
    "PERU": "219", "ARGENTINA": "224", "CHILE": "997",
    "AUSTRALIA": "406", "TAIWAN": "330",
  };
  const paisInvoice = String(invoice.pais_origen || co?.pais_origen || "").toUpperCase().trim();
  const paisCodigo = PAIS_MAP[paisInvoice] || "225"; // default USA
  // País de adquisición = país del emisor de la factura (proveedor)
  const proveedorDir = String((invoice.proveedor as Record<string, unknown>)?.direccion || (invoice.proveedor as Record<string, unknown>)?.pais || "").toUpperCase();
  let paisAdquisicion = "";
  for (const [key, code] of Object.entries(PAIS_MAP)) {
    if (proveedorDir.includes(key)) { paisAdquisicion = code; break; }
  }
  if (!paisAdquisicion) paisAdquisicion = paisCodigo; // fallback al mismo de origen
  df.pai_id_origen = paisCodigo;
  df.pai_id_adquisicion = paisAdquisicion;
  df.via_id = esAereo ? "4" : "1"; // 4=aérea, 1=marítima
  // Puerto embarque
  const puertoEmbRaw = esAereo
    ? String(awb?.aeropuerto_origen || "").replace(/\s*\([^)]*\)/, "").trim().toUpperCase()
    : String(bl?.puerto_transbordo || bl?.puerto_embarque || "").toUpperCase();
  const puertoEmb = puertoEmbRaw
    .replace(/\([^)]*\)/g, "")  // quitar paréntesis: "CARTAGENA (COLOMBIA)" → "CARTAGENA"
    .replace(/,\s*(USA|CHILE|CHINA|DOMINICAN REPUBLIC|PERU|BRAZIL|COLOMBIA|REPUBLIC|TX|CA|NY).*$/i, "")
    .trim();
  // Pasar nombre original (con país) para hint geográfico al resolver
  const puertoRes = await resolverPuerto(puertoEmbRaw, false); // false = puerto extranjero
  if (puertoRes) {
    df.pue_id = puertoRes.codigo;
    // Siempre usar el nombre del popup de AduanaNet
    df.pue_nombre = puertoRes.nombre;
    // Glosa: si el nombre del popup es genérico, poner el nombre real del BL
    const esGenerico = /OTROS.*NO ESPECIFICADOS|NO IDENTIFICADOS/i.test(puertoRes.nombre);
    df.dus_puerto_embarque_glosa = esGenerico ? puertoEmb : puertoRes.nombre;
  } else {
    df.pue_nombre = puertoEmb;
    df.dus_puerto_embarque_glosa = puertoEmb;
  }
  df.pue_adic = "0";
  // Transbordo: si hay puerto de transbordo Y hay tratado (reg_id ≠ 1) → "P"
  const hayTransbordo = !!(bl?.puerto_transbordo);
  const hayTratado = regimen.regId !== "1";
  df.din_transbordo = (hayTransbordo && hayTratado) ? "P" : "";
  // Nave — dejar en blanco (se incluye en observaciones del banco central en bultos)
  df.nav_id = "";
  df.nav_nombre = "";
  df.dus_nombre_nave = "";
  // Naviera/Cia Transportadora (del BL o aerolínea del AWB)
  const navieraName = String(esAereo ? (awb?.aerolinea || "") : (bl?.naviera || ""));
  if (navieraName) {
    const navieraRes = await buscarTransportista(navieraName, nroOperacion);
    if (navieraRes) {
      df.cia_id = navieraRes.codigo;
      df.dus_nombre_cia_transp = navieraRes.nombre;
      // Obtener país y RUT de la naviera
      const navieraDatos = await datosTransportista(navieraRes.codigo);
      if (navieraDatos) {
        df.pai_idcia = navieraDatos.paiId;
        df.dus_rut_cia_transp = navieraDatos.rut;
      }
    }
  }
  // Emisor documento de transporte: si no hay HBL → misma naviera
  const blHouse = String(bl?.numero_bl_house || "");
  if (blHouse) {
    // Si hay HBL, el emisor es el forwarder
    const forwarder = String(bl?.forwarder || bl?.naviera || "");
    const emisorRes = await buscarTransportista(forwarder, nroOperacion);
    if (emisorRes) {
      df.cia_id_emisora = emisorRes.codigo;
      df.dus_emisor_docto_transp = emisorRes.nombre;
      const emisorDatos = await datosTransportista(emisorRes.codigo);
      if (emisorDatos) df.cia_emisora_rut = emisorDatos.rut;
    }
  } else {
    // Sin HBL → emisor = misma naviera
    df.cia_id_emisora = df.cia_id || "";
    df.dus_emisor_docto_transp = df.dus_nombre_cia_transp || "";
    df.cia_emisora_rut = df.dus_rut_cia_transp || "";
  }
  // Manifiesto — solo si no es IMPORT. CTDO/ANTIC. (tio_id=151)
  const tioId = df.tio_id || "";
  if (manifNumero && tioId !== "151") {
    df.din_manifiesto1 = manifNumero;
    df.din_fec_manifiesto = manifFecha;
  } else if (manifNumero && tioId === "151") {
    df.din_manifiesto1 = manifNumero;
    df.din_fec_manifiesto = ""; // No se pone fecha en anticipada
  }
  // Documento de transporte
  if (esAereo) {
    df.din_nro_docto_transp = String(awb?.numero_hawb || awb?.numero_mawb || "");
    // Fecha AWB
    const fechaAwb = String(awb?.fecha_emision || "");
    const mesesAwb: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const pAwb = fechaAwb.match(/(\d{1,2})[/-](\w{3})[/-](\d{2,4})/i);
    if (pAwb) { const m = mesesAwb[pAwb[2].toLowerCase()] || "01"; const y = pAwb[3].length === 2 ? "20" + pAwb[3] : pAwb[3]; df.din_fec_docto_transp = `${pAwb[1].padStart(2, "0")}/${m}/${y}`; }
    else if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaAwb)) df.din_fec_docto_transp = fechaAwb;
    // Manifiesto de papeleta
    if (papeleta?.numero_manifiesto) { df.din_manifiesto1 = String(papeleta.numero_manifiesto); df.din_fec_manifiesto = String(papeleta.fecha_manifiesto || ""); }
  } else {
  const blMaster = String(bl?.numero_bl_master || bl?.numero_bl || "");
  const blHouseNum = blHouse ? `(H)${blHouse}` : "";
  df.din_nro_docto_transp = blMaster + blHouseNum;
  // Fecha emisión BL — priorizar shipped_on_board, luego fecha_emision
  const fechaEmisionRaw = String(bl?.shipped_on_board_date || bl?.fecha_shipped_on_board || bl?.fecha_emision || "");
  let fechaDocto = "";
  if (fechaEmisionRaw) {
    // Si ya viene en formato DD/MM/YYYY → usar tal cual
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaEmisionRaw)) {
      fechaDocto = fechaEmisionRaw;
    }
    // Formato YYYY-MM-DD
    else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaEmisionRaw)) {
      const [y, m, d] = fechaEmisionRaw.split("-");
      fechaDocto = `${d}/${m}/${y}`;
    }
    // Formato DD-Mon-YYYY (ej: "28-Apr-2026")
    else {
      const meses: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const parts = fechaEmisionRaw.match(/(\d{1,2})[/-](\w{3})[/-](\d{4})/i);
      if (parts) {
        const mes = meses[parts[2].toLowerCase()] || "01";
        fechaDocto = `${parts[1].padStart(2, "0")}/${mes}/${parts[3]}`;
      }
    }
  }
  df.din_fec_docto_transp = fechaDocto;
  } // fin else marítimo doc transporte
  df.tic_id = "R";
  // Certificado Sanitario SEREMI — va en Visto Bueno (SNS = código 2)
  const seremiRow = docs.find(d => d.tipo_documento === "Certificado Sanitario (SEREMI)");
  if (seremiRow) {
    const seremi = parseDoc(seremiRow);
    // numero_certificado puede estar en datos_extraidos (combined) que ya prioriza Claude
    const nroCDA = String(seremi.numero_certificado || seremi.numero_cda || seremi.nro_cda || seremi.resolucion || "");
    const fechaSeremi = String(seremi.fecha_emision || "");
    if (nroCDA) {
      df.din_cod_regla1_vb = "2"; // SNS
      df.ldin_cod_regla1_vb = "2";
      df.din_nro_regla1_vb = nroCDA;
      const anioFromFecha = fechaSeremi.match(/(\d{4})/);
      df.din_agno_regla1_vb = anioFromFecha ? anioFromFecha[1] : String(new Date().getFullYear());
      console.log("[confeccionar] Visto Bueno: SNS, CDA=" + nroCDA + ", año=" + df.din_agno_regla1_vb);
    }
  }

  df.comando = "U";
  await postForm(destUrl, df, destUrl);
  resultado.destino = `nave=${nave} naviera=${df.dus_nombre_cia_transp || ""} manif=${manifNumero}`;

  // ── MÓDULO 5: ANTECEDENTES ──
  const antUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const antHtml = await aduananetGet(antUrl);
  const af = extractFields(antHtml);
  af.reg_id = regimen.regId; af.lreg_id = regimen.regId;
  af.bcc_id = ""; af.lbcc_id = "";
  af.fpa_id = "1"; af.lfpa_id = "1";
  // Calcular días de cobranza: diferencia entre fecha_vencimiento_pago y fecha de emisión factura
  let diasCobranza = "60"; // default
  const fechaFactura = String(invoice.fecha || "");
  const fechaVencimiento = String(invoice.fecha_vencimiento_pago || "");
  if (fechaFactura && fechaVencimiento) {
    const parseFechaInv = (f: string): Date | null => {
      // Formatos: "13MAY2026", "2026-05-13", "13/05/2026"
      const m1 = f.match(/^(\d{1,2})([A-Z]{3})(\d{4})$/i);
      if (m1) {
        const meses: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        const mes = meses[m1[2].toUpperCase()];
        if (mes !== undefined) return new Date(Number(m1[3]), mes, Number(m1[1]));
      }
      const m2 = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
      const m3 = f.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m3) return new Date(Number(m3[3]), Number(m3[2]) - 1, Number(m3[1]));
      return null;
    };
    const d1 = parseFechaInv(fechaFactura);
    const d2 = parseFechaInv(fechaVencimiento);
    if (d1 && d2 && d2 > d1) {
      const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      diasCobranza = String(diffDays);
    }
  }
  af.din_dias = diasCobranza;
  af.mda_id = "13"; af.lmda_id = "13";
  af.div_id = ""; af.ldiv_id = "";
  af.cvt_id = cvtId; af.lcvt_id = cvtId;
  af.din_valor_ex_fabrica = "0.00";
  af.fpg_id = "4"; af.lfpg_id = "4";
  af.din_gastos_hasta_fob = "0.00";
  af.cert_orig_tipo = certTipo;
  af.cert_numero = regimen.regId !== "1" ? certNumero : "";
  af.cert_fecha = regimen.regId !== "1" ? certFecha : "";
  af.comando = "U";
  await postForm(antUrl, af, antUrl);
  resultado.antecedentes = `reg=${regimen.regId} cert=${certTipo}/${certNumero}`;

  // ── MÓDULO 6: MERCANCÍA (via Puppeteer — ejecuta TraeCuenta popup por cada item) ──
  const mercUrl = `${BASE_URL}/modulos/din/dus_encabezado/din_mercancia.php`;
  const mercFormUrl = `${mercUrl}?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const rawItems = (invoice.items || []) as Array<Record<string, unknown>>;

  // Consolidar items con mismo código de producto (sumar cantidades y montos)
  const itemMap = new Map<string, Record<string, unknown>>();
  for (const item of rawItems) {
    const code = String(item.referencia_interna || item.product_code || item.codigo_material || item.codigo_producto || "UNKNOWN");
    if (itemMap.has(code)) {
      const existing = itemMap.get(code)!;
      existing.peso_neto = Number(existing.peso_neto || 0) + Number(item.peso_neto_kg || item.peso_neto || item.cantidad_kg || item.cantidad || 0);
      existing.cantidad = Number(existing.cantidad || 0) + Number(item.cantidad || 0);
      existing.monto = Number(existing.monto || 0) + Number(item.monto || item.total || 0);
      existing.peso_bruto = Number(existing.peso_bruto || 0) + Number(item.peso_bruto || 0);
    } else {
      itemMap.set(code, { ...item, peso_neto: Number(item.peso_neto_kg || item.peso_neto || item.cantidad_kg || item.cantidad || 0), monto: Number(item.monto || item.total || 0) });
    }
  }
  const items = Array.from(itemMap.values());

  // Eliminar items existentes via POST
  const mercCheck = await aduananetGet(mercFormUrl);
  const existing = [...(mercCheck.match(/<select[^>]*name\s*=\s*['"]linea['"][^>]*>([\s\S]*?)<\/select>/i) || ["", ""])[1]
    .matchAll(/<option[^>]*value\s*=\s*['"](\d+)['"]/gi)].map(m => m[1]);
  for (const n of existing.reverse()) {
    const eb = { lib_base: "1", lib_nid: nroOperacion, lbac_nid: "0", dus_tipo_envio: "2", mer_nro_item: n, comando: "E", pagno: "0" };
    await postForm(mercUrl, eb);
  }

  for (const item of items) {
    const codigoProd = String(item.referencia_interna || item.product_code || item.codigo_material || item.codigo_producto || "");
    const totalNetoItem = Number(item.monto || item.total || Number(invoice.monto_total) / items.length);
    const cantidadRaw = String(item.peso_neto || item.cantidad_kg || item.cantidad || item.quantity_of_boxes || "1");
    const cantidad = parseFloat(cantidadRaw.replace(/[^0-9.,]/g, "").replace(",", "")) || 1;
    const cantStr = Math.round(cantidad).toString().padStart(8, "0");

    // ═══ PASO 1: Navegar al form y extraer cli_id correcto (hardcodeado en busca_codigo) ═══
    await page.goto(mercFormUrl, { waitUntil: "networkidle0" });
    const cliIdForm = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll("script")).map(s => s.textContent || "").join(" ");
      const m = scripts.match(/cli_id\s*=\s*["'](\d+)["']/);
      return m ? m[1] : "";
    });
    const cliIdReal = cliIdForm || cliId;

    // ═══ PASO 2: Buscar descriptor via HTTP con cli_id correcto ═══
    const cookies = await aduananetLogin();
    const descXml = await (await fetch(`${BASE_URL}/inc/getXML/buscar_descriptores.php?partida=&codigo=${codigoProd}&descripcion=&cli_id=${cliIdReal}`, { headers: { Cookie: cookies } })).text();
    const dscPartida = pickXml(descXml, "dsc_partida") || String((co?.mercancia as Record<string, unknown>)?.clasificacion_arancelaria_hs || "");
    const dscCod = pickXml(descXml, "dsc_cod_producto") || codigoProd;
    const merNombre = [dscCod.padEnd(16), pickXml(descXml, "dsc_descrip_corta"), pickXml(descXml, "dsc_otro1"), pickXml(descXml, "dsc_otro2"), pickXml(descXml, "dsc_obs")].join(";");

    // ═══ PASO 3: Unidad de medida y arancel ═══
    const umeId = await unidadMedidaDescriptor(dscCod, cliIdReal);
    const esPorPeso = umeId === "6" || umeId === "3";
    const glosaUnidad = esPorPeso ? "KN" : "UNIDADES";
    const paisOrigenForm = await page.evaluate(() => (document as unknown as { frm: Record<string, HTMLInputElement> }).frm.pai_id_origen?.value || "225").catch(() => "225");

    // ═══ PASO 3b: Calcular FOB unitario y CIF item DIRECTAMENTE (igual que terrestre/marítimo) ═══
    // NO se abre el popup "Calculo Valores Item" ni "Calculo de Derechos": en Puppeteer headless
    // el window.open() del popup derechos.php sólo funciona la 1ª vez por sesión (su window.close()
    // interno envenena la sesión y bloquea los popups siguientes → cuelga la confección con 2+ items).
    // Por eso replicamos EXACTAMENTE el cálculo de Aceptar() de derechos.php aquí.
    const cifNeto = await page.evaluate(() => parseFloat((document as unknown as { frm: Record<string, HTMLInputElement> }).frm.cif_neto?.value) || 1);
    const fobTotal = (await page.evaluate(() => parseFloat((document as unknown as { frm: Record<string, HTMLInputElement> }).frm.dus_total_valor_fob?.value) || 0)) || fobValue;
    const merCif = (totalNetoItem * cifNeto).toFixed(2);
    const merFob = cantidad > 0 ? ((totalNetoItem / Number(invoice.monto_total)) * fobTotal / cantidad).toFixed(6) : "0.000000";
    const arancelHtml = await aduananetGet(`/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dscPartida}&pais=${paisOrigenForm}&regimen=${regimen.regId}`);
    const sels = [...arancelHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
    // Ad-valorem en Chile = 6% sobre CIF (cuenta 223). Sólo baja a 0 si:
    //   a) hay certificado de origen → tarifa preferencial del tratado (fila con nro_acuerdo), o
    //   b) la partida es bien de capital (ley 18.634) → la fila general ya viene con 0%.
    // Por eso: con CO usamos la fila del tratado; sin CO usamos la fila general (MFN/bien capital).
    const tieneCO = !!co && certNumero !== "" && certNumero !== "S/N";
    const selTratado = sels.find(s => s[3] && s[3] !== "");
    const selGeneral = sels.find(s => !s[3] || s[3] === "") || sels[0];
    const sel = (tieneCO && selTratado) ? selTratado : selGeneral;
    const advalorem = sel ? sel[1] : (tieneCO ? "0" : "6");
    const codAranTratado = sel ? sel[2] : dscPartida;
    const nroAcuerdo = (tieneCO && sel) ? sel[3] : "";
    console.log(`[confeccionar] Item ${codigoProd}: CO=${tieneCO} advalorem=${advalorem}% acuerdo=${nroAcuerdo || "-"}`);

    // Derechos (réplica de Aceptar() en derechos.php):
    //   valoraduanero = CIF item; ad-valorem = CIF * %adv; IVA = (CIF + ad-valorem) * 19%
    const advalNum = parseFloat(advalorem) || 0;
    const val223 = parseFloat(merCif) * advalNum / 100;
    const mtoCtaAdval = val223.toFixed(2);
    const ivaMonto = ((parseFloat(merCif) + val223) * 19 / 100).toFixed(2);

    // ═══ PASO 4: Setear campos manualmente (sin post_open_descriptor) ═══
    await page.evaluate((data: Record<string, string>) => {
      const frm = (document as unknown as { frm: Record<string, HTMLInputElement | HTMLSelectElement> }).frm;
      frm.linea.value = "";
      frm.mer_producto.value = data.merProducto;
      frm.mer_producto1.value = data.codigoProd;
      if (frm.descripcion_corta) frm.descripcion_corta.value = "";
      frm.mer_cod_arancel.value = data.dscPartida;
      frm.mer_cod_arancel_tratado.value = data.codAranTratado;
      if (frm.mer_nro_correlativo_arancel) frm.mer_nro_correlativo_arancel.value = data.correlativo;
      frm.mer_nro_acuerdo_comercial.value = data.nroAcuerdo;
      if (frm.lmer_nro_acuerdo_comercial) frm.lmer_nro_acuerdo_comercial.value = data.nroAcuerdo;
      frm.mer_sujeto_cupo.value = "0";
      frm.mer_nombre.value = data.merNombre;
      frm.ume_id.value = data.umeId;
      if (frm.lume_id) (frm.lume_id as HTMLSelectElement).value = data.umeId;
      frm.mer_cantidad.value = data.cantidad;
      frm.mer_cantidad_mercancia_um.value = data.cantidad;
      frm.mer_fob_unitario.value = data.merFob;
      frm.mer_valor_cif_item.value = data.merCif;
      frm.mer_total_neto.value = data.totalNeto;
      frm.mer_monto_ajuste_item.value = "0.00";
      frm.mer_sig_ajuste.value = "+";
      frm.mer_porc_advalorem.value = data.advalorem;
      frm.mer_cuenta_advalorem.value = "223";
      frm.mer_mto_cta_advalorem.value = data.mtoCtaAdval;
      frm.mer_cod_obs1.value = "99";
      if (frm.lmer_cod_obs1) frm.lmer_cod_obs1.value = "99";
      frm.mer_obs1.value = data.obs1;
      frm.mer_porc_otro1.value = "19.000";
      frm.mer_cod_otro1.value = "178";
      frm.mer_signo_otro1.value = "+";
      frm.mer_monto_impto_otro1.value = data.ivaMonto;
      frm.mer_cod_obs2.value = ""; frm.mer_obs2.value = "";
      frm.mer_porc_otro2.value = "0.000"; frm.mer_cod_otro2.value = ""; frm.mer_monto_impto_otro2.value = "0.00";
      frm.mer_cod_obs3.value = ""; frm.mer_obs3.value = "";
      frm.mer_porc_otro3.value = "0.000"; frm.mer_cod_otro3.value = ""; frm.mer_monto_impto_otro3.value = "0.00";
      frm.mer_porc_otro4.value = "0.000"; frm.mer_cod_otro4.value = ""; frm.mer_monto_impto_otro4.value = "0.00"; frm.mer_cod_obs4.value = "";
      frm.mer_nro_item.value = "";
      frm.comando.value = "U";
    }, {
      merProducto: `${dscCod}@#~${cliIdReal}`, codigoProd, dscPartida, codAranTratado,
      correlativo: sel ? (sel[4] || "") : "", nroAcuerdo, merNombre, umeId,
      cantidad: cantidad.toFixed(4), totalNeto: totalNetoItem.toFixed(6), advalorem,
      obs1: `${cantStr}.000000 ${glosaUnidad}`,
      merFob, merCif, ivaMonto, mtoCtaAdval,
    });

    // ═══ PASO 5: Grabar item ═══
    // Los derechos (ad-valorem + IVA) ya quedaron seteados en PASO 4 replicando el cálculo
    // de "Calculo de Derechos" (Aceptar de derechos.php). No se abre el popup porque en headless
    // sólo funciona una vez por sesión y cuelga la confección con 2+ items.
    console.log(`[confeccionar] Item ${codigoProd}: CIF=${merCif} adv=${advalorem}% IVA=${ivaMonto}`);
    await page.evaluate(() => { (document as unknown as { frm: HTMLFormElement }).frm.submit(); });
    await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 10000 }).catch(() => {});
    console.log(`[confeccionar] ✅ Item grabado: ${codigoProd}`);
  }
  resultado.mercancia = `${items.length} items`;

  // ── MÓDULO 7: BULTOS ──
  const bultosUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const bultosHtml = await aduananetGet(bultosUrl);
  const bf = extractFields(bultosHtml);

  if (esAereo && awb) {
    // ── BULTOS AÉREOS ──
    const cantBultos = Number(papeleta?.bultos_doc || awb.bultos || 0);
    const marcasAereo = String(awb.marcas || "");
    bf.din_id_bultos = `${marcasAereo}\n${cantBultos} CAJON (21)`;
    const obsLinesAereo: string[] = [];
    if (regimen.regId !== "1") obsLinesAereo.push(`CERTIFICADO DE ORIGEN ${certNumero} FECHA ${certFecha}`);
    obsLinesAereo.push("Mandato FEA");
    bf.din_obs_banco_sna = obsLinesAereo.join("\n");
    bf.comando = "U";
    await postForm(bultosUrl, bf, bultosUrl);
    await postForm(`${BASE_URL}/modulos/din/dus_encabezado/dus_bulto.php`, {
      lib_nid: nroOperacion, lib_base: "1", lbac_nid: "0", dus_tipo_envio: "2",
      lineas: "1", enviar: "1", bul_sec_nro_bulto0: "1", bul_cod_tipo_bulto0: "21",
      sel_bul_cod_tipo_bulto0: "21", bul_glosa0: "", bul_cantidad0: String(cantBultos),
    });
    resultado.bultos = `${cantBultos} CAJON (21)`;
  } else {
  // ── BULTOS MARÍTIMOS ──
  const contenedores = (bl?.contenedores || []) as Array<Record<string, unknown>>;
  const contNums = contenedores.map(c => {
    const num = String(c.numero_contenedor || "");
    // Separar último dígito con guión: MSDU1834570 → MSDU183457-0
    if (num.length >= 5) return num.slice(0, -1) + "-" + num.slice(-1);
    return num;
  }).filter(Boolean).join("\n");
  const pallets = contenedores.reduce((s, c) => s + Number(c.pallets || 0), 0);
  const bultosCount = contenedores.reduce((s, c) => s + Number(c.numero_bultos || c.octabins || 0), 0);
  // Resolver tipo de bulto en español usando tabla tipos_bulto (keywords)
  const tipoBultoRaw = String(contenedores[0]?.tipo_bulto || "BULTO").toUpperCase().trim();
  const { pgQuery: pgQ } = await import("./postgres");
  const tiposBultoDb = await pgQ<{ codigo: string; nombre: string; keywords: string[] }>("SELECT codigo, nombre, keywords FROM tipos_bulto");
  let tipoBultoEs = "BULTONOESP";
  let codBulto = "93";
  // Primero buscar match exacto del keyword (o keyword contenido en el tipo)
  // Priorizar keywords más largas (más específicas)
  const allMatches: Array<{ codigo: string; nombre: string; kw: string }> = [];
  for (const tb of tiposBultoDb) {
    for (const kw of tb.keywords) {
      const kwUp = kw.toUpperCase();
      if (tipoBultoRaw === kwUp || tipoBultoRaw === kwUp + "S" || tipoBultoRaw.replace(/S$/, "") === kwUp) {
        allMatches.push({ codigo: tb.codigo, nombre: tb.nombre, kw });
      } else if (tipoBultoRaw.includes(kwUp) && kwUp.length >= 3 && tb.codigo !== "78") {
        // Contenido pero excluir CONTNOESP (78) para evitar match con "container" genérico
        allMatches.push({ codigo: tb.codigo, nombre: tb.nombre, kw });
      }
    }
  }
  if (allMatches.length > 0) {
    // Preferir el match con keyword más larga (más específica), excluir 78 si hay IBC
    allMatches.sort((a, b) => b.kw.length - a.kw.length);
    codBulto = allMatches[0].codigo;
    tipoBultoEs = allMatches[0].nombre;
  }
  // Si sigue siendo 93 (no especificado), usar el nombre real del BL en vez de "BULTONOESP"
  if (codBulto === "93" && tipoBultoRaw && tipoBultoRaw !== "BULTO") {
    // Extraer nombre corto: "Intermediate Bulk Container (IBC)" → "IBC", "OCTABINS" → "OCTABIN"
    const parenMatch = tipoBultoRaw.match(/\(([^)]+)\)/);
    tipoBultoEs = parenMatch ? parenMatch[1] : tipoBultoRaw.replace(/S$/, "");
  }
  bf.din_id_bultos = pallets > 0
    ? `${contNums}\nCONT llevan ${pallets} Pallets (80) con ${bultosCount} ${tipoBultoEs}(${codBulto})`
    : `${contNums}\nCONT llevan ${bultosCount} ${tipoBultoEs}(${codBulto})`;
  const obsLines: string[] = [];
  if (regimen.regId !== "1") {
    if (esRexEuropa) {
      // Determinar si la letanía está en la factura o en otro documento
      const letaniaEnFactura = textoInvoice.includes("THE EXPORTER") || textoInvoice.includes("EXPORTER OF THE PRODUCTS") || textoInvoice.match(/\b[A-Z]{2}REX[A-Z]{2}\d{6,}\b/);
      obsLines.push(letaniaEnFactura ? "LETANIA EN FACTURA" : "LETANIA EN DOC. DE EMBARQUE");
    } else {
      obsLines.push(`CERTIFICADO DE ORIGEN ${certNumero} FECHA ${certFecha}`);
    }
  }
  obsLines.push("Mandato FEA");
  if (nave) obsLines.push(`M/N ${nave}`);
  bf.din_obs_banco_sna = obsLines.join("\n");
  bf.comando = "U";
  await postForm(bultosUrl, bf, bultosUrl);

  // Popup bultos (tipo contenedor)
  const tipoCont = String(contenedores[0]?.tipo_contenedor || "");
  const codCont = /40/i.test(tipoCont) ? "74" : /20/i.test(tipoCont) ? "73" : "74";
  const bultoPopup: Record<string, string> = {
    lib_nid: nroOperacion, lib_base: "1", lbac_nid: "0", dus_tipo_envio: "2",
    lineas: "1", enviar: "1",
    bul_sec_nro_bulto0: "1", bul_cod_tipo_bulto0: codCont,
    sel_bul_cod_tipo_bulto0: codCont, bul_glosa0: "", bul_cantidad0: String(contenedores.length),
  };
  await postForm(`${BASE_URL}/modulos/din/dus_encabezado/dus_bulto.php`, bultoPopup);
  resultado.bultos = `${contenedores.length} cont (${codCont})`;
  } // fin else bultos marítimos

  // ── MÓDULO 8: CUENTAS Y VALORES (via Puppeteer — clickea "Traer Cuentas" + "Aceptar") ──
  try {
    const ctasResult = await browserCuentasValores(page, nroOperacion);
    resultado.cuentas = `IVA=${ctasResult.iva} Total=${ctasResult.total} CLP=${ctasResult.clp}`;
  } catch (err) {
    console.error("[confeccionar] Error Puppeteer Cuentas:", err instanceof Error ? err.message : err);
  } finally {
    await browser.close();
  }

  return resultado;
}


/**
 * Confección DIN para operaciones TERRESTRES (CRT + MIC/DTA, sin BL).
 * Diferencias clave vs marítimo:
 * - via_id = 7 (terrestre)
 * - adu_id = 33 (Los Andes)
 * - Documento transporte = CRT (numero_crt)
 * - Transportista = porteador del CRT
 * - Puerto embarque = aduana_partida del MIC (BAHIA BLANCA)
 * - No hay nave, no hay manifiesto, no hay ShipsGo
 * - Observaciones: "TRANSPORTE PAGADA HASTA CLAUSULA CPT\nMandato FEA"
 * - País origen/adquisición = ARGENTINA
 * - Flete = gastos.flete.monto_remitente del CRT
 */
async function confeccionarDINTerrestre(
  nroOperacion: string,
  docs: DocRow[],
  invoice: Record<string, unknown>,
  co: Record<string, unknown> | null,
  crtRaw: Record<string, unknown> | null,
  micRaw: Record<string, unknown> | null,
  poliza: Record<string, unknown> | null,
  cliId: string
) {
  // Normalizar: si el documento CRT tiene sub-objetos crt y mic_dta, extraerlos
  const crt = (crtRaw?.crt as Record<string, unknown>) || (micRaw?.crt as Record<string, unknown>) || crtRaw;
  const mic = (crtRaw?.mic_dta as Record<string, unknown>) || (micRaw?.mic_dta as Record<string, unknown>) || micRaw;
  // Datos base
  let regimen = co ? resolverRegimen(String(co.tratado_aplicable || co.pais_origen || "")) : { regId: "1", nombre: "GENERAL" };

  const incoterm = String(invoice.incoterm || crt?.incoterm || "CPT").split(/\s/)[0].toUpperCase();
  const cvtId = "8"; // Terrestre CPT → código 8 (OTRA) en AduanaNet
  const fobValue = Number(invoice.fob_value || invoice.monto_total || 0);
  
  // Flete terrestre: del CRT gastos (varios nombres posibles según extracción IA)
  const gastosRaw = (crt?.gastos as Record<string, unknown>) || (mic?.gastos as Record<string, unknown>) || undefined;
  const fleteValue = Number(
    gastosRaw?.flete_monto_remitente ||
    gastosRaw?.flete_remitente ||
    gastosRaw?.total_remitente ||
    (gastosRaw?.flete as Record<string, unknown>)?.monto_remitente ||
    mic?.flete_usd || 
    0
  );
  
  const primaRaw = poliza?.prima || (poliza?.marcas_y_numeros as Record<string, unknown>)?.prima || "0";
  const seguroValue = parseFloat(String(primaRaw).replace(",", ".")) || 0;
  const cifValue = fobValue + fleteValue + seguroValue;
  const pesoBruto = Number(crt?.peso_bruto_kg || mic?.peso_bruto_kg || (invoice.items as Array<Record<string, unknown>>)?.[0]?.peso_bruto || 0);

  const certNumero = String(co?.numero_certificado || "S/N");
  const certFecha = String((co?.firma_exportador as Record<string, unknown>)?.fecha || co?.fecha_emision || "");
  const certTipo = regimen.regId === "1" ? "" : "c"; // siempre independiente para terrestres

  const resultado: Record<string, string> = {};

  // ── MÓDULO 2: VALORES GENERALES (via Puppeteer) ──
  // WORKAROUND BUG AduanaNet: para CPT terrestre, calcular como CFR (código 2) 
  // y luego cambiar a OTRA (código 8) antes de grabar
  const { browser, page } = await aduananetBrowserLogin();
  try {
    const vgResult = await browserValoresFactura(page, nroOperacion, {
      termCompra: "2",      // CFR para que calcule FOB = factura - flete
      termCompraFinal: "8", // Cambiar a OTRA antes de grabar
      moneda: "13",
      pesoBruto: String(pesoBruto),
      totalNetoFactura: String(invoice.monto_total),
      fleteFac: String(fleteValue),
      fleteMon: fleteValue > 0 ? "13" : "",
      fleteParidad: fleteValue > 0 ? "1" : "0",
      seguroFac: seguroValue.toFixed(2),
      seguroMon: seguroValue > 0 ? "13" : "",
      seguroParidad: seguroValue > 0 ? "1" : "0",
    });
    resultado.valores_generales = `FOB=${vgResult.fob} Flete=${vgResult.flete} CIF=${vgResult.cif}`;
  } catch (err) {
    console.error("[confeccionar-terrestre] Error Puppeteer Valores:", err instanceof Error ? err.message : err);
    await browser.close();
    throw new Error("Error en módulo Valores Factura (terrestre): " + (err instanceof Error ? err.message : "desconocido"));
  }

  // ── MÓDULO 3: IDENTIFICACIÓN (consignante) ──
  const idUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_identificacion.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const idHtml = await aduananetGet(idUrl);
  const idf = extractFields(idHtml);

  // Consignante = remitente del CRT o proveedor de la factura
  const proveedorNombre = String(
    crt?.remitente && (crt.remitente as Record<string, unknown>)?.nombre
      ? (crt.remitente as Record<string, unknown>).nombre
      : (invoice.proveedor as Record<string, unknown>)?.nombre || invoice.proveedor || ""
  );
  if (proveedorNombre) {
    // Buscar consignante en AduanaNet: usar primera palabra significativa del nombre
    // AduanaNet busca "empieza con", así que usar el nombre/keyword más corto posible
    const cleanedName = proveedorNombre
      .replace(/\b(S\.?R\.?L\.?|S\.?A\.?|LTDA\.?|INC\.?|LLC|SOCIEDAD\s*DE\s*RESPONS\w*)\b/gi, "")
      .replace(/\(.*?\)/g, "")
      .trim();
    // Primera palabra que tenga al menos 3 caracteres (el keyword más preciso)
    const firstWord = (cleanedName || proveedorNombre).split(/[\s,]+/).find((w: string) => w.length >= 3) || proveedorNombre.substring(0, 6);
    console.log(`[confeccionar-terrestre] Buscando consignante: "${firstWord}" (original: "${proveedorNombre}")`);
    
    const csgSearchUrl = `/modulos/general/ventanas/listados/consignante.php?identificador=&fil_csg_nombre=${encodeURIComponent(firstWord)}`;
    const csgHtml = await aduananetGet(csgSearchUrl);
    const csgMatches = [...csgHtml.matchAll(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/gi)];

    if (csgMatches.length > 0) {
      const target = proveedorNombre.toUpperCase();
      let best = csgMatches[0];
      for (const m of csgMatches) {
        const mNombre = m[2].toUpperCase().replace(/\s*\.\s*\.\s*\.?\s*/g, "").trim();
        if (target.includes(mNombre) || mNombre.includes(target.split(/\s+/)[0]) || mNombre.includes(firstWord.toUpperCase())) {
          best = m;
          break;
        }
      }
      idf.csg_id = best[1];
      idf.csg_nombre = best[2];
      idf.dus_nombre_consignatario = best[2];
      idf.csg_direccion = best[6] || "";
      idf.pai_id = best[3] || "";
      console.log(`[confeccionar-terrestre] Consignante encontrado: ${best[2]} (ID ${best[1]})`);
    } else {
      console.log(`[confeccionar-terrestre] ⚠️ Consignante no encontrado para "${firstWord}"`);
    }
  }

  idf.comando = "U";
  await postForm(idUrl, idf, idUrl);
  resultado.identificacion = `consignante=${idf.csg_nombre || "(no encontrado)"}`;

  // ── MÓDULO 4: DESTINO ──
  const destUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const destHtml = await aduananetGet(destUrl);
  const df = extractFields(destHtml);

  // País origen = origen REAL de la mercancía (puede diferir del país de despacho terrestre).
  // Ej: DOW Argentina despacha por carretera mercancía de origen Francia → origen 505, adquisición 224.
  const paisOrigenNombreTerr = String(
    invoice.pais_origen ||
    (Array.isArray(invoice.items) ? (invoice.items[0] as Record<string, unknown>)?.pais_origen : "") ||
    (crt as Record<string, unknown>)?.pais_origen_mercancia ||
    (mic as Record<string, unknown>)?.pais_origen_mercancia ||
    co?.pais_origen || ""
  );
  const paisOrigenTerr = codigoPais(paisOrigenNombreTerr, "224");
  df.pai_id_origen = paisOrigenTerr;
  // País de adquisición = país del despacho terrestre (Argentina)
  df.pai_id_adquisicion = "224";

  // Vía terrestre
  df.via_id = "7";

  // Puerto embarque = aduana_partida del MIC (ej: BAHIA BLANCA)
  const puertoEmbRaw = String(mic?.aduana_ciudad_pais_partida || mic?.aduana_partida || crt?.lugar_emision || "BAHIA BLANCA").toUpperCase()
    .replace(/-.*$/, "").replace(/\(.*\)/, "").trim(); // "BAHIA BLANCA-ARGENTINA" → "BAHIA BLANCA"
  const puertoRes = await resolverPuerto(puertoEmbRaw, false);
  if (puertoRes) {
    df.pue_id = puertoRes.codigo;
    df.pue_nombre = puertoRes.nombre;
    df.dus_puerto_embarque_glosa = puertoRes.nombre;
  } else {
    df.pue_nombre = puertoEmbRaw;
    df.dus_puerto_embarque_glosa = puertoEmbRaw;
  }
  df.pue_adic = "0";
  df.din_transbordo = ""; // Sin transbordo terrestre

  // Puerto desembarque = siempre 997 LOS ANDES para terrestre
  df.pue_id2 = "997";
  df.pue_nombre2 = "LOS ANDES";
  df.dus_puerto_desembarque_glosa = "LOS ANDES";

  // Nave — NO HAY en terrestre
  df.nav_id = "";
  df.nav_nombre = "";
  df.dus_nombre_nave = "";

  // Transportista = porteador del CRT
  const porteadorNombre = String((crt?.porteador as Record<string, unknown>)?.nombre || (mic?.porteador as Record<string, unknown>)?.nombre || "");
  if (porteadorNombre) {
    // Buscar en array de la página primero
    const transportistaRes = await buscarTransportista(porteadorNombre, nroOperacion);
    let usarCia = transportistaRes;
    let usarRut = "";
    let usarPais = "224"; // default Argentina
    
    if (transportistaRes) {
      const transDatos = await datosTransportista(transportistaRes.codigo);
      if (transDatos && transDatos.rut) {
        usarRut = transDatos.rut;
        usarPais = transDatos.paiId || "224";
      }
    }
    
    // Si no tiene RUT, buscar via popup y preferir el que tenga RUT válido (último creado)
    if (!usarRut) {
      const keyword = porteadorNombre.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 2).join(" ");
      const popupHtml = await aduananetGet(`/modulos/general/ventanas/listados/transportista.php?identificador=&fil_tra_nombre=${encodeURIComponent(keyword)}`);
      const traMatches = [...popupHtml.matchAll(/seleccion\(\s*'([^']*)'\s*,\s*'([^']*)'/gi)];
      // Verificar RUT de cada uno vía XML, preferir el que tenga RUT válido y de ID más alto
      let mejorConRut: { codigo: string; nombre: string; rut: string; pais: string } | null = null;
      for (const m of traMatches) {
        const datos = await datosTransportista(m[1]);
        if (datos && datos.rut && /\d+-[\dkK]/.test(datos.rut)) {
          if (!mejorConRut || Number(m[1]) > Number(mejorConRut.codigo)) {
            mejorConRut = { codigo: m[1], nombre: m[2], rut: datos.rut, pais: datos.paiId };
          }
        }
      }
      if (mejorConRut) {
        usarCia = { codigo: mejorConRut.codigo, nombre: mejorConRut.nombre };
        usarRut = mejorConRut.rut;
        usarPais = mejorConRut.pais || "224";
      }
    }
    
    if (usarCia) {
      df.cia_id = usarCia.codigo;
      df.dus_nombre_cia_transp = usarCia.nombre;
      df.pai_idcia = usarPais;
      df.dus_rut_cia_transp = usarRut;
    }
  }

  // Emisor documento de transporte = mismo porteador
  df.cia_id_emisora = df.cia_id || "";
  df.dus_emisor_docto_transp = df.dus_nombre_cia_transp || "";
  df.cia_emisora_rut = df.dus_rut_cia_transp || "";

  // NO hay manifiesto para terrestre — se indica "ENVIOS PARCIALES"
  df.din_manifiesto1 = "ENVIOS PARCIALES";
  df.din_fec_manifiesto = "";

  // Documento de transporte = CRT (numero_crt) o MIC (numero_mic_dta / numero_carta_porte_crt)
  const numeroCrt = String(
    crt?.numero_crt || 
    mic?.numero_carta_porte_crt || 
    (mic?.datos_crt_adjunto as Record<string, unknown>)?.numero_crt || 
    mic?.numero_carta_porte || 
    mic?.numero_mic_dta || 
    ""
  );
  df.din_nro_docto_transp = numeroCrt;

  // Fecha del CRT
  const fechaCrtRaw = String(
    crt?.fecha_emision || 
    (mic?.datos_crt_adjunto as Record<string, unknown>)?.lugar_fecha_porteador ||
    mic?.fecha_emision || 
    ""
  );
  // Extraer fecha del formato "Bahia Blanca - ARGENTINA - 10-06-2026" o directo
  let fechaDocto = "";
  const fechaFromString = fechaCrtRaw.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (fechaFromString) {
    fechaDocto = `${fechaFromString[1]}/${fechaFromString[2]}/${fechaFromString[3]}`;
  } else if (fechaCrtRaw) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaCrtRaw)) {
      fechaDocto = fechaCrtRaw;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(fechaCrtRaw)) {
      const [y, m, d] = fechaCrtRaw.split("-");
      fechaDocto = `${d}/${m}/${y}`;
    } else {
      // Formato DD-MM-YYYY o DD-Mon-YYYY
      const meses: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const parts = fechaCrtRaw.match(/(\d{1,2})[/-](\w{2,3})[/-](\d{2,4})/i);
      if (parts) {
        const mesStr = parts[2].toLowerCase();
        const mes = meses[mesStr] || (mesStr.length === 2 ? mesStr : "01");
        const anio = parts[3].length === 2 ? "20" + parts[3] : parts[3];
        fechaDocto = `${parts[1].padStart(2, "0")}/${mes}/${anio}`;
      }
    }
  }
  df.din_fec_docto_transp = fechaDocto;
  df.tic_id = "R"; // Carga general

  // Certificado Sanitario SEREMI — va en Visto Bueno (SNS = código 2)
  const seremiRow = docs.find(d => d.tipo_documento === "Certificado Sanitario (SEREMI)");
  if (seremiRow) {
    const seremi = parseDoc(seremiRow);
    const nroCDA = String(seremi.numero_certificado || seremi.numero_cda || seremi.nro_cda || seremi.resolucion || "");
    const fechaSeremi = String(seremi.fecha_emision || "");
    if (nroCDA) {
      df.din_cod_regla1_vb = "2";
      df.ldin_cod_regla1_vb = "2";
      df.din_nro_regla1_vb = nroCDA;
      const anioFromFecha = fechaSeremi.match(/(\d{4})/);
      df.din_agno_regla1_vb = anioFromFecha ? anioFromFecha[1] : String(new Date().getFullYear());
    }
  }

  df.comando = "U";
  await postForm(destUrl, df, destUrl);
  resultado.destino = `terrestre via_id=7 transportista=${df.dus_nombre_cia_transp || ""} CRT=${numeroCrt}`;

  // ── MÓDULO 5: ANTECEDENTES ──
  const antUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const antHtml = await aduananetGet(antUrl);
  const af = extractFields(antHtml);
  af.reg_id = regimen.regId; af.lreg_id = regimen.regId;
  af.bcc_id = ""; af.lbcc_id = "";
  af.fpa_id = "1"; af.lfpa_id = "1";

  // Calcular días de cobranza
  let diasCobranza = "60";
  const fechaFactura = String(invoice.fecha || invoice.fecha_emision || "");
  const fechaVencimiento = String(invoice.fecha_vencimiento_pago || invoice.payment_terms || "");
  if (fechaFactura && fechaVencimiento) {
    const parseFechaInv = (f: string): Date | null => {
      const m1 = f.match(/^(\d{1,2})([A-Z]{3})(\d{4})$/i);
      if (m1) {
        const meses: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
        const mes = meses[m1[2].toUpperCase()];
        if (mes !== undefined) return new Date(Number(m1[3]), mes, Number(m1[1]));
      }
      const m2 = f.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
      const m3 = f.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m3) return new Date(Number(m3[3]), Number(m3[2]) - 1, Number(m3[1]));
      return null;
    };
    const d1 = parseFechaInv(fechaFactura);
    const d2 = parseFechaInv(fechaVencimiento);
    if (d1 && d2 && d2 > d1) {
      const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      diasCobranza = String(diffDays);
    }
  }

  af.din_dias = diasCobranza;
  af.mda_id = "13"; af.lmda_id = "13";
  af.div_id = ""; af.ldiv_id = "";
  af.cvt_id = cvtId; af.lcvt_id = cvtId;
  af.din_valor_ex_fabrica = "0.00";
  af.fpg_id = "4"; af.lfpg_id = "4";
  af.din_gastos_hasta_fob = "0.00";
  af.cert_orig_tipo = certTipo;
  af.cert_numero = regimen.regId !== "1" ? certNumero : "";
  af.cert_fecha = regimen.regId !== "1" ? certFecha : "";
  af.comando = "U";
  await postForm(antUrl, af, antUrl);
  resultado.antecedentes = `reg=${regimen.regId} cert=${certTipo}/${certNumero}`;

  // ── MÓDULO 6: MERCANCÍA ──
  const mercUrl = `${BASE_URL}/modulos/din/dus_encabezado/din_mercancia.php`;
  const mercFormUrl = `${mercUrl}?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  // Filter out FREIGHT items from invoice items for terrestrial
  const allItems = (invoice.items || []) as Array<Record<string, unknown>>;
  const filteredItems = allItems.filter(item => !/^FREIGHT$/i.test(String(item.descripcion || "")));

  // Consolidar items con mismo código de producto (sumar cantidades y montos)
  const itemMapT = new Map<string, Record<string, unknown>>();
  for (const item of filteredItems) {
    const code = String(item.codigo_material || item.codigo_producto || item.product_code || item.codigo_referencia || "UNKNOWN");
    if (itemMapT.has(code)) {
      const existing = itemMapT.get(code)!;
      existing.peso_neto = Number(existing.peso_neto || 0) + Number(item.peso_neto_kg || item.peso_neto || item.cantidad_kg || item.cantidad || 0);
      existing.cantidad = Number(existing.cantidad || 0) + Number(item.cantidad || 0);
      existing.monto = Number(existing.monto || 0) + Number(item.monto || item.total || 0);
      existing.peso_bruto = Number(existing.peso_bruto || 0) + Number(item.peso_bruto || 0);
    } else {
      itemMapT.set(code, { ...item, peso_neto: Number(item.peso_neto_kg || item.peso_neto || item.cantidad_kg || item.cantidad || 0), monto: Number(item.monto || item.total || 0) });
    }
  }
  const items = Array.from(itemMapT.values());

  // Eliminar existentes
  const mercCheck = await aduananetGet(mercFormUrl);
  const existing = [...(mercCheck.match(/<select[^>]*name\s*=\s*['"]linea['"][^>]*>([\s\S]*?)<\/select>/i) || ["", ""])[1]
    .matchAll(/<option[^>]*value\s*=\s*['"](\d+)['"]/gi)].map(m => m[1]);
  for (const n of existing.reverse()) {
    const eb = { lib_base: "1", lib_nid: nroOperacion, lbac_nid: "0", dus_tipo_envio: "2", mer_nro_item: n, comando: "E", pagno: "0" };
    await postForm(mercUrl, eb);
  }

  // Partida arancelaria: del CO si existe
  const coPartida = co?.mercaderias
    ? String((co.mercaderias as Array<Record<string, unknown>>)?.[0]?.partida_arancelaria || "")
    : String((co?.mercancia as Record<string, unknown>)?.clasificacion_arancelaria_hs || "");

  // ── DEDUCCIÓN TRAMO NACIONAL (solo terrestre, primer item) ──
  // Usar ruta del MIC si existe, sino calcular con IA
  let deduccionTramoNacional = 0;
  if (fleteValue > 0) {
    try {
      const rutaTransporte = String(mic?.ruta_transporte || "");
      const origenDir = String(mic?.aduana_ciudad_pais_partida || mic?.aduana_partida || crt?.lugar_emision || "BAHIA BLANCA").replace(/-.*$/, "").trim();
      const destinoDir = "LOS ANDES, CHILE"; // siempre LOS ANDES para terrestre

      const { generateText: genText } = await import("ai");
      const { openai: oai } = await import("@ai-sdk/openai");
      const prompt = rutaTransporte
        ? `La ruta de transporte terrestre es: "${rutaTransporte}". ¿Cuál es la distancia total aproximada en kilómetros POR CARRETERA de esta ruta? Responde SOLO con el número (sin texto, sin "km"). Ejemplo: 1450`
        : `¿Cuál es la distancia aproximada en kilómetros POR CARRETERA (ruta terrestre) entre "${origenDir}" y "${destinoDir}"? Considera el paso Los Libertadores/Cristo Redentor. Responde SOLO con el número (sin texto, sin "km"). Ejemplo: 1450`;

      const distResult = await genText({
        model: oai("gpt-4o-mini"),
        maxOutputTokens: 100,
        messages: [{ role: "user", content: prompt }],
      });
      const kmStr = distResult.text.replace(/[^0-9]/g, "");
      const km = parseInt(kmStr) || 0;
      // Tabla de porcentajes según KM
      let porcentaje = 14;
      if (km > 3300) porcentaje = 7;
      else if (km > 3000) porcentaje = 8;
      else if (km > 2600) porcentaje = 9;
      else if (km > 2300) porcentaje = 10;
      else if (km > 2000) porcentaje = 11;
      else if (km > 1600) porcentaje = 12;
      else if (km > 1300) porcentaje = 13;
      else porcentaje = 14;
      deduccionTramoNacional = Math.round(fleteValue * porcentaje / 100 * 100) / 100;
      console.log(`[confeccionar-terrestre] Deducción tramo nacional: ${km} km → ${porcentaje}% de flete ${fleteValue} = ${deduccionTramoNacional}`);
    } catch (err) {
      console.error("[confeccionar-terrestre] Error calculando distancia:", err instanceof Error ? err.message : err);
      // Fallback: usar 14% (tramo corto)
      deduccionTramoNacional = Math.round(fleteValue * 14 / 100 * 100) / 100;
    }
  }

  let itemIndex = 0;
  for (const item of items) {
    // Obtener datos de arancel/descriptor via HTTP
    const codigoProd = String(item.codigo_material || item.codigo_producto || item.product_code || item.codigo_referencia || "");
    const cookies = await aduananetLogin();
    const descXml = await (await fetch(`${BASE_URL}/inc/getXML/buscar_descriptores.php?partida=&codigo=${codigoProd}&descripcion=&cli_id=${cliId}`, { headers: { Cookie: cookies } })).text();
    const dscPartida = pickXml(descXml, "dsc_partida") || coPartida || "";
    const dscCod = pickXml(descXml, "dsc_cod_producto") || codigoProd;
    const merNombre = [dscCod.padEnd(16), pickXml(descXml, "dsc_descrip_corta"), pickXml(descXml, "dsc_otro1"), pickXml(descXml, "dsc_otro2"), pickXml(descXml, "dsc_obs")].join(";");

    // Consultar arancel con el país de origen real (régimen general si no hay CO)
    const arancelHtml = await aduananetGet(`/modulos/din/dus_encabezado/consulta_arancel_json.php?partida=${dscPartida}&pais=${paisOrigenTerr}&regimen=${regimen.regId}`);
    const sels = [...arancelHtml.matchAll(/seleccionar\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,?\s*'?([^']*)'?\s*\)/gi)];
    // Régimen general (sin CO) → NO aplicar fila de tratado; usar tarifa general (MFN, ~6%)
    const sel = regimen.regId === "1"
      ? (sels.find(s => !s[3] || s[3] === "") || sels[0])
      : (sels.find(s => s[3] && s[3] !== "") || sels[0]);
    const advalorem = sel ? sel[1] : "0";
    const codAranTratado = sel ? sel[2] : dscPartida;
    const nroAcuerdo = sel ? sel[3] : "";

    // Valor total item = monto total CPT (incluye flete) / cantidad de items producto
    const totalNetoItem = Number(invoice.monto_total) / items.length;
    const cantidadRaw = String(item.peso_neto || item.cantidad_kg || item.cantidad || "0");
    const cantidad = parseFloat(cantidadRaw.replace(/[^0-9.,]/g, "").replace(",", "")) || 0;
    const cantStr = Math.round(cantidad).toString().padStart(8, "0");

    // Navegar al formulario de mercancía en Puppeteer
    await page.goto(mercFormUrl, { waitUntil: "networkidle0" });

    // Leer valores precargados
    const cifNeto = await page.evaluate(() => parseFloat((document as unknown as { frm: Record<string, HTMLInputElement> }).frm.cif_neto?.value) || 1);
    const fobTotal = await page.evaluate(() => parseFloat((document as unknown as { frm: Record<string, HTMLInputElement> }).frm.dus_total_valor_fob?.value) || 0) || fobValue;
    const merCif = (totalNetoItem * cifNeto).toFixed(2);
    const merFob = cantidad > 0 ? ((totalNetoItem / Number(invoice.monto_total)) * fobTotal / cantidad).toFixed(6) : "0.000000";
    const ivaMonto = (parseFloat(merCif) * 19 / 100).toFixed(2);

    // Deducción tramo nacional: solo primer item
    const ajusteMonto = (itemIndex === 0 && deduccionTramoNacional > 0) ? deduccionTramoNacional.toFixed(2) : "0.00";
    const ajusteSigno = (itemIndex === 0 && deduccionTramoNacional > 0) ? "-" : "+";
    const codObs2 = (itemIndex === 0 && deduccionTramoNacional > 0) ? "09" : "";
    const obs2 = (itemIndex === 0 && deduccionTramoNacional > 0) ? "DEDUCT. TRAMO NACIONAL" : "";

    // Llenar campos via evaluate
    await page.evaluate((data: Record<string, string>) => {
      const frm = (document as unknown as { frm: Record<string, HTMLInputElement | HTMLSelectElement> }).frm;
      frm.linea.value = "";
      frm.mer_producto.value = data.merProducto;
      frm.mer_producto1.value = data.codigoProd;
      if (frm.descripcion_corta) frm.descripcion_corta.value = "";
      frm.mer_cod_arancel.value = data.dscPartida;
      frm.mer_cod_arancel_tratado.value = data.codAranTratado;
      if (frm.mer_nro_correlativo_arancel) frm.mer_nro_correlativo_arancel.value = data.correlativo;
      frm.mer_nro_acuerdo_comercial.value = data.nroAcuerdo;
      if (frm.lmer_nro_acuerdo_comercial) frm.lmer_nro_acuerdo_comercial.value = data.nroAcuerdo;
      frm.mer_sujeto_cupo.value = "0";
      frm.mer_nombre.value = data.merNombre;
      frm.ume_id.value = "6";
      if (frm.lume_id) (frm.lume_id as HTMLSelectElement).value = "6";
      frm.mer_cantidad.value = data.cantidad;
      frm.mer_cantidad_mercancia_um.value = data.cantidad;
      frm.mer_fob_unitario.value = data.merFob;
      frm.mer_valor_cif_item.value = data.merCif;
      frm.mer_total_neto.value = data.totalNeto;
      frm.mer_monto_ajuste_item.value = data.ajusteMonto;
      frm.mer_sig_ajuste.value = data.ajusteSigno;
      frm.mer_porc_advalorem.value = data.advalorem;
      frm.mer_cuenta_advalorem.value = "223";
      frm.mer_mto_cta_advalorem.value = "0.00";
      frm.mer_cod_obs1.value = "99";
      if (frm.lmer_cod_obs1) frm.lmer_cod_obs1.value = "99";
      frm.mer_obs1.value = data.obs1;
      // Obs2: DEDUCT. TRAMO NACIONAL (solo primer item)
      frm.mer_cod_obs2.value = data.codObs2;
      if (frm.lmer_cod_obs2) frm.lmer_cod_obs2.value = data.codObs2;
      frm.mer_obs2.value = data.obs2;
      frm.mer_porc_otro1.value = "19.000";
      frm.mer_cod_otro1.value = "178";
      frm.mer_signo_otro1.value = "+";
      frm.mer_monto_impto_otro1.value = data.ivaMonto;
      frm.mer_porc_otro2.value = "0.000"; frm.mer_cod_otro2.value = ""; frm.mer_monto_impto_otro2.value = "0.00";
      frm.mer_cod_obs3.value = ""; frm.mer_obs3.value = "";
      frm.mer_porc_otro3.value = "0.000"; frm.mer_cod_otro3.value = ""; frm.mer_monto_impto_otro3.value = "0.00";
      frm.mer_porc_otro4.value = "0.000"; frm.mer_cod_otro4.value = ""; frm.mer_monto_impto_otro4.value = "0.00"; frm.mer_cod_obs4.value = "";
      frm.mer_nro_item.value = "";
      frm.comando.value = "U";
    }, {
      merProducto: `${dscCod}@#~${cliId}`, codigoProd, dscPartida, codAranTratado,
      correlativo: sel ? (sel[4] || "") : "", nroAcuerdo, merNombre,
      cantidad: cantidad.toFixed(4), merFob, merCif,
      totalNeto: totalNetoItem.toFixed(6), advalorem,
      obs1: `${cantStr}.000000 KG`, ivaMonto,
      ajusteMonto, ajusteSigno, codObs2, obs2,
    });

    // Click "Cálculo de Derechos" (TraeCuenta) — popup
    const popupPromise = new Promise<import("puppeteer").Page | null>(resolve => {
      browser.once("targetcreated", async target => { resolve(await target.page()); });
      setTimeout(() => resolve(null), 10000);
    });
    await page.evaluate(() => { (window as unknown as Record<string, () => void>).TraeCuenta(); });
    const popupPage = await popupPromise;
    if (popupPage) {
      await popupPage.waitForSelector("body", { timeout: 5000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));
      const aceptarBtn = await popupPage.$('input[value="Aceptar"]') || await popupPage.$('input[type="button"]');
      if (aceptarBtn) await aceptarBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      await popupPage.close().catch(() => {});
    }

    // Grabar Mercadería
    await page.evaluate(() => { (document as unknown as { frm: HTMLFormElement }).frm.submit(); });
    await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
    console.log(`[confeccionar-terrestre] Mercancía item: cod=${codigoProd} arancel=${dscPartida} cantidad=${cantidad} cif=${merCif} ajuste=${ajusteSigno}${ajusteMonto}`);
    itemIndex++;
  }
  resultado.mercancia = `${items.length} items, deducción tramo nacional=${deduccionTramoNacional}`;

  // ── MÓDULO 7: BULTOS ──
  const bultosUrl = `${BASE_URL}/modulos/din/dus_encabezado/dus_desc_bulto.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const bultosHtml = await aduananetGet(bultosUrl);
  const bf = extractFields(bultosHtml);

  // Para terrestre: datos de bultos del CRT/MIC
  const cantidadBultos = Number(crt?.cantidad_bultos || mic?.cantidad_bultos || 0);
  const tipoBultoRaw = String(crt?.tipo_bultos || mic?.tipo_bultos || "PALLET").toUpperCase().trim();
  const marcas = String(crt?.marcas || mic?.marcas || "");
  // Contenido: bolsas u otro contenido dentro de los pallets
  const contenidoTotal = String(mic?.marcas_descripcion_mercancia || crt?.descripcion_mercancia || "");
  // Extraer cantidad y tipo del contenido (ej: "1.080 BOLSAS DE POLIETILENO" → 1080, BOLSA)
  const contenidoMatch = contenidoTotal.match(/([\d.,]+)\s+(BOLSA|SACO|TAMBOR|CAJA|BIDON|BULTO|BAG|DRUM)/i);
  const cantidadContenido = contenidoMatch ? parseInt(contenidoMatch[1].replace(/[.,]/g, "")) : 0;

  // Resolver tipo de bulto
  const { pgQuery: pgQ } = await import("./postgres");
  const tiposBultoDb = await pgQ<{ codigo: string; nombre: string; keywords: string[] }>("SELECT codigo, nombre, keywords FROM tipos_bulto");
  let tipoBultoEs = "PALLET";
  let codBulto = "80";
  const allMatches: Array<{ codigo: string; nombre: string; kw: string }> = [];
  for (const tb of tiposBultoDb) {
    for (const kw of tb.keywords) {
      const kwUp = kw.toUpperCase();
      if (tipoBultoRaw === kwUp || tipoBultoRaw === kwUp + "S" || tipoBultoRaw.replace(/S$/, "") === kwUp) {
        allMatches.push({ codigo: tb.codigo, nombre: tb.nombre, kw });
      } else if (tipoBultoRaw.includes(kwUp) && kwUp.length >= 3) {
        allMatches.push({ codigo: tb.codigo, nombre: tb.nombre, kw });
      }
    }
  }
  if (allMatches.length > 0) {
    allMatches.sort((a, b) => b.kw.length - a.kw.length);
    codBulto = allMatches[0].codigo;
    tipoBultoEs = allMatches[0].nombre;
  }

  // Placas del camión/semirremolque como identificador
  const placaCamion = String((mic?.camion_original as Record<string, unknown>)?.placa_camion || "");
  const placaSemi = String((mic?.camion_original as Record<string, unknown>)?.placa_semirremolque || "");
  const precintos = String(mic?.numero_precintos || "");
  
  // Formato: marcas + pallets conteniendo contenido
  // Resolver código del contenido (bolsa=64, saco=62, tambor=45, etc.)
  let codContenido = "64"; // default BOLSA
  let nombreContenido = "Bolsas";
  if (contenidoMatch) {
    const tipoContenidoRaw = contenidoMatch[2].toUpperCase();
    for (const tb of tiposBultoDb) {
      for (const kw of tb.keywords) {
        if (tipoContenidoRaw.includes(kw.toUpperCase()) || kw.toUpperCase().includes(tipoContenidoRaw)) {
          codContenido = tb.codigo;
          nombreContenido = tb.nombre;
          break;
        }
      }
    }
  }

  const idBultos = [
    marcas ? `${marcas} ${String((crt?.destinatario as Record<string, unknown>)?.nombre || "")}`.trim() : "",
    `${cantidadBultos} ${tipoBultoEs} (${codBulto}) conteniendo ${cantidadContenido || ""} ${nombreContenido} (${codContenido})`,
  ].filter(Boolean).join("\n");
  bf.din_id_bultos = idBultos;

  // Observaciones banco central para terrestre
  const obsLines: string[] = [];
  if (regimen.regId !== "1") {
    // Formato: COD.-{país abreviado}. {número certificado} FECHA {fecha}
    const paisAbrev = String(co?.pais_origen || "ARG").toUpperCase().substring(0, 3);
    obsLines.push(`COD.-${paisAbrev}. ${certNumero} FECHA ${certFecha}`);
  }
  obsLines.push("TRANSPORTE PAGADO HASTA CLAUSULA CPT");
  obsLines.push("Mandato FEA");
  bf.din_obs_banco_sna = obsLines.join("\n");
  bf.comando = "U";
  await postForm(bultosUrl, bf, bultosUrl);

  // Popup bultos — para terrestre usar PALLET (80) como tipo principal
  const bultoPopup: Record<string, string> = {
    lib_nid: nroOperacion, lib_base: "1", lbac_nid: "0", dus_tipo_envio: "2",
    lineas: "1", enviar: "1",
    bul_sec_nro_bulto0: "1", bul_cod_tipo_bulto0: codBulto,
    sel_bul_cod_tipo_bulto0: codBulto, bul_glosa0: "", bul_cantidad0: String(cantidadBultos),
  };
  await postForm(`${BASE_URL}/modulos/din/dus_encabezado/dus_bulto.php`, bultoPopup);
  resultado.bultos = `${cantidadBultos} ${tipoBultoEs} (${codBulto})`;

  // ── MÓDULO 8: CUENTAS Y VALORES (via Puppeteer) ──
  try {
    const ctasResult = await browserCuentasValores(page, nroOperacion);
    resultado.cuentas = `IVA=${ctasResult.iva} Total=${ctasResult.total} CLP=${ctasResult.clp}`;
  } catch (err) {
    console.error("[confeccionar-terrestre] Error Puppeteer Cuentas:", err instanceof Error ? err.message : err);
  } finally {
    await browser.close();
  }

  return resultado;
}
