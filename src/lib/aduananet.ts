import "server-only";
import zlib from "zlib";

/**
 * Cliente para el sistema AduanaNet (fguerragodoy.aduananet2.cl).
 * Maneja autenticación con cookies de sesión y peticiones autenticadas
 * para la confección de Declaraciones de Ingreso (DIN).
 *
 * El sistema usa un login PHP clásico:
 *  - POST a /modulos/usuarios/validar.php con campos: login, clave
 *  - Devuelve cookies de sesión (id_AduanaNet..., user_..., section_..., usua_pass_uso_...)
 *  - Las cookies se reutilizan en peticiones posteriores
 */

const BASE_URL = process.env.ADUANANET_URL || "https://fguerragodoy.aduananet2.cl";
const LOGIN = process.env.ADUANANET_LOGIN || "";
const CLAVE = process.env.ADUANANET_CLAVE || "";

type SessionCache = {
  cookies: string;       // header Cookie listo para usar
  expiresAt: number;     // timestamp ms
};

// Cache de sesión en memoria (las cookies duran ~10h según Max-Age=36000)
const globalForAduana = globalThis as unknown as { __aduananetSession?: SessionCache };

/** Parsea los Set-Cookie de una respuesta y devuelve un string "k=v; k2=v2" */
function parseSetCookies(res: Response): string {
  // getSetCookie() disponible en runtimes modernos (Node 18.14+/undici)
  const raw: string[] = typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);

  const jar: Record<string, string> = {};
  for (const line of raw) {
    const first = line.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) {
      const k = first.slice(0, eq).trim();
      const v = first.slice(eq + 1).trim();
      // Ignorar cookies marcadas como borradas
      if (v && v !== "deleted") jar[k] = v;
    }
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Inicia sesión en AduanaNet y devuelve el header Cookie de la sesión.
 * Cachea la sesión en memoria hasta poco antes de expirar.
 */
export async function aduananetLogin(force = false): Promise<string> {
  if (!LOGIN || !CLAVE) {
    throw new Error("Credenciales de AduanaNet no configuradas (ADUANANET_LOGIN / ADUANANET_CLAVE).");
  }

  // Reusar sesión cacheada si sigue válida
  const cached = globalForAduana.__aduananetSession;
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.cookies;
  }

  // 1) GET inicial al login para obtener cookies base (lib_base, PHPSESSID si aplica)
  const loginPageRes = await fetch(`${BASE_URL}/modulos/usuarios/login.php?status=-1`, {
    method: "GET",
    headers: { "User-Agent": "Mozilla/5.0 (AgaTrack DIN Bot)" },
    redirect: "manual",
  });
  const baseCookies = parseSetCookies(loginPageRes);

  // 2) POST de credenciales a validar.php
  const body = new URLSearchParams();
  body.set("login", LOGIN);
  body.set("clave", CLAVE);

  const validarRes = await fetch(`${BASE_URL}/modulos/usuarios/validar.php`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (AgaTrack DIN Bot)",
      "Referer": `${BASE_URL}/modulos/usuarios/login.php?status=-1`,
      ...(baseCookies ? { "Cookie": baseCookies } : {}),
    },
    body: body.toString(),
    redirect: "manual",
  });

  const sessionCookies = parseSetCookies(validarRes);

  // Validar que el login fue exitoso: debe haber redirección 302 y cookie de usuario
  const ok = (validarRes.status === 302 || validarRes.status === 301) && /user_AduanaNet/i.test(sessionCookies);
  if (!ok) {
    const txt = await validarRes.text().catch(() => "");
    throw new Error(`Login AduanaNet falló (status ${validarRes.status}). ${txt.slice(0, 200)}`);
  }

  // Combinar cookies base + sesión
  const allCookies = [baseCookies, sessionCookies].filter(Boolean).join("; ");

  globalForAduana.__aduananetSession = {
    cookies: allCookies,
    expiresAt: Date.now() + 9 * 60 * 60 * 1000, // 9h (Max-Age real es 10h)
  };

  return allCookies;
}

/**
 * Realiza una petición autenticada a AduanaNet.
 * Reintenta el login una vez si la sesión expiró.
 */
export async function aduananetFetch(
  path: string,
  init: RequestInit = {},
  retry = true
): Promise<Response> {
  const cookies = await aduananetLogin();
  const url = path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "Mozilla/5.0 (AgaTrack DIN Bot)",
      "Cookie": cookies,
      ...(init.headers || {}),
    },
    redirect: init.redirect || "manual",
  });

  // Si la sesión expiró (redirección a login), reintentar una vez
  const location = res.headers.get("location") || "";
  if (retry && (res.status === 401 || /login\.php/i.test(location))) {
    await aduananetLogin(true);
    return aduananetFetch(path, init, false);
  }

  return res;
}

/** Devuelve el texto HTML de una página autenticada. */
export async function aduananetGet(path: string): Promise<string> {
  const res = await aduananetFetch(path, { method: "GET", redirect: "follow" });
  return res.text();
}


/**
 * Resuelve el código de puerto (pue_id) buscando por nombre vía el popup de AduanaNet.
 * @param nombre  Nombre del puerto (ej: "CALLAO", "SAN ANTONIO")
 * @param nacional true = puerto chileno (puertos.php), false = extranjero (otros_puertos.php)
 * @param via  código de vía de transporte (solo para nacionales, ej: "1")
 * @returns { codigo, nombre } o null si no se encuentra
 */
export async function resolverPuerto(
  nombre: string,
  nacional: boolean,
  via = ""
): Promise<{ codigo: string; nombre: string } | null> {
  if (!nombre) return null;
  // Extraer país del nombre si viene (ej: "CAUCEDO, DOMINICAN REPUBLIC" o "CARTAGENA (COLOMBIA)")
  const partes = nombre.replace(/\(([^)]*)\)/g, ", $1").split(",").map(s => s.trim());
  const nombrePuerto = partes[0];
  const paisHint = partes.length > 1 ? partes.slice(1).join(" ").toUpperCase() : "";

  const query = nombrePuerto.replace(/[^A-Za-zÁÉÍÓÚÑ\s]/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
  const pagina = nacional ? "puertos.php" : "otros_puertos.php";
  const identificador = nacional ? "pue_id2" : "pue_id";
  const pathUrl = `/modulos/general/${pagina}?identificador=${identificador}&modo=desc&valor=${encodeURIComponent(query)}&via=${via}&nacional=${nacional ? "1" : "0"}`;

  const res = await aduananetFetch(pathUrl, { method: "GET", redirect: "follow" });
  const html = await res.text();

  const matches = [...html.matchAll(/seleccion\(["']([^"']+)["']\s*,\s*["']([^"']+)["']\)/gi)];
  if (matches.length === 0) return null;
  if (matches.length === 1) return { codigo: matches[0][1], nombre: matches[0][2] };

  // Varios resultados — verificar contra la BD con info geográfica
  const { pgQuery } = await import("./postgres");
  const codigos = matches.map(m => m[1]);
  const dbResult = await pgQuery<{ codigo: string; nombre: string; pais: string }>(
    `SELECT codigo, nombre, pais FROM puertos WHERE codigo = ANY($1)`,
    [codigos]
  );

  if (dbResult.length > 0 && paisHint) {
    // Buscar match geográfico por país del BL
    const paisKeywords: Record<string, string[]> = {
      "DOMINICAN": ["AMERICA", "ANTILLAS"], "REPUBLIC": ["AMERICA"],
      "USA": ["USA"], "UNITED STATES": ["USA"], "CHINA": ["CHINA"],
      "PERU": ["PERU"], "COLOMBIA": ["COLOMBIA"], "BRAZIL": ["BRASIL"],
      "PANAMA": ["PANAMA"], "ECUADOR": ["ECUADOR"], "MEXICO": ["MEXICO"],
      "ARGENTINA": ["ARGENTINA"], "JAPAN": ["JAPON"], "KOREA": ["COREA"],
    };
    for (const [key, regiones] of Object.entries(paisKeywords)) {
      if (paisHint.includes(key)) {
        const geo = dbResult.filter(r => regiones.some(reg => r.pais.toUpperCase().includes(reg)));
        if (geo.length > 0) {
          return { codigo: geo[0].codigo, nombre: matches.find(m => m[1] === geo[0].codigo)?.[2] || geo[0].nombre };
        }
      }
    }
    // Caribe/otros → buscar "AMERICA"
    const america = dbResult.find(r => r.pais === "AMERICA" || r.nombre.includes("AMERICA"));
    if (america) return { codigo: america.codigo, nombre: matches.find(m => m[1] === america.codigo)?.[2] || america.nombre };
  }

  // Sin hint geográfico: tomar el de código más alto en BD
  if (dbResult.length > 0) {
    dbResult.sort((a, b) => Number(b.codigo) - Number(a.codigo));
    return { codigo: dbResult[0].codigo, nombre: matches.find(m => m[1] === dbResult[0].codigo)?.[2] || dbResult[0].nombre };
  }

  // Fallback
  const sorted = matches.sort((a, b) => Number(b[1]) - Number(a[1]));
  return { codigo: sorted[0][1], nombre: sorted[0][2] };
}


/**
 * Busca una nave por nombre en el catálogo de AduanaNet.
 * @returns { codigo, nombre } si existe, o null si no existe (hay que crearla).
 */
export async function buscarNave(nombre: string): Promise<{ codigo: string; nombre: string } | null> {
  if (!nombre) return null;
  const path = `/modulos/general/ventanas/listados/nave.php?identificador=&fil_nav_nombre=${encodeURIComponent(nombre)}`;
  const res = await aduananetFetch(path, { method: "GET", redirect: "follow" });
  const html = await res.text();
  // Filas: seleccion('nav_id','nombre','tra_id','pai_id')  — la primera definición es la función, se ignora
  const matches = [...html.matchAll(/seleccion\(\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]/gi)];
  if (matches.length === 0) return null;
  const target = nombre.toUpperCase().trim();
  // Exactas primero; si hay varias, tomar la ÚLTIMA CREADA (código más alto)
  const exactas = matches.filter(m => m[2].toUpperCase().trim() === target).sort((a, b) => Number(b[1]) - Number(a[1]));
  const chosen = exactas[0] || matches.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return { codigo: chosen[1], nombre: chosen[2] };
}

/**
 * Crea una nave nueva en el mantenedor de AduanaNet y devuelve su código.
 * El mantenedor usa comando "N" (alta) y el form hace submit a sí mismo.
 * Si la nave ya existe, AduanaNet responde "duplicidad" y se recupera con buscarNave.
 * @param nombre nombre de la nave
 */
export async function crearNave(nombre: string): Promise<{ codigo: string; nombre: string } | null> {
  if (!nombre) return null;
  const formUrl = "/modulos/mantenedores/nave.php?menu=0&comando=I&query=&pagno=0&maxpag=0";
  // GET inicial para sesión del mantenedor
  await aduananetGet(formUrl);
  const body = new URLSearchParams();
  body.set("nav_id", "");
  body.set("nav_nombre", nombre.toUpperCase().trim());
  body.set("pai_id", "");
  body.set("pai_nombre0", "");
  body.set("tra_id", "");
  body.set("tra_nombre1", "");
  body.set("comando", "N"); // N = alta (lo confirma aceptar() del mantenedor)
  body.set("query", "");
  body.set("pagno", "0");
  await aduananetFetch("/modulos/mantenedores/nave.php?menu=0&comando=I&query=&pagno=0&maxpag=0", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
  // Re-buscar para obtener el nav_id recién creado
  return buscarNave(nombre);
}

/**
 * Resuelve la nave: la busca y si no existe la crea. Devuelve { codigo, nombre }.
 */
export async function resolverNave(nombre: string): Promise<{ codigo: string; nombre: string } | null> {
  const existente = await buscarNave(nombre);
  if (existente) return existente;
  console.log("[aduananet] Nave no existe, creando:", nombre);
  return crearNave(nombre);
}


/**
 * Busca una naviera/transportista por nombre.
 * Estrategia: extrae el array arrcia_id embebido en la página dus_destino
 * (2429 navieras precargadas: [codigo, NOMBRE]) y busca coincidencia.
 * Si hay varias coincidencias, devuelve SIEMPRE LA ÚLTIMA CREADA (código más alto).
 * @param nombre nombre de la naviera (ej: "ZIM INTEGRATED SHIPPING")
 * @param libNid número de operación (para cargar la página con el array)
 * @returns la mejor coincidencia { codigo, nombre } o null
 */
export async function buscarTransportista(
  nombre: string,
  libNid: string
): Promise<{ codigo: string; nombre: string } | null> {
  if (!nombre) return null;
  const path = `/modulos/din/dus_encabezado/dus_destino.php?lib_base=1&lib_nid=${libNid}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;
  const html = await aduananetGet(path);
  const all = [...html.matchAll(/arrcia_id\[\d+\]\s*=\s*new Array\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/gi)]
    .map(m => ({ codigo: m[1], nombre: m[2] }));

  const target = nombre.toUpperCase().trim();
  // Ordenar por código descendente para tomar la ÚLTIMA CREADA (código más alto)
  const porCodigoDesc = (arr: Array<{ codigo: string; nombre: string }>) =>
    arr.sort((a, b) => Number(b.codigo) - Number(a.codigo));

  // Coincidencia exacta primero
  const exact = porCodigoDesc(all.filter(c => c.nombre.toUpperCase().trim() === target));
  if (exact.length) return exact[0]; // la última creada

  // Buscar por nombre completo contenido — preferir el match más largo, luego último creado
  const porNombreCompleto = all.filter(c => c.nombre.toUpperCase().includes(target) || target.includes(c.nombre.toUpperCase().trim()));
  if (porNombreCompleto.length) {
    porNombreCompleto.sort((a, b) => b.nombre.length - a.nombre.length || Number(b.codigo) - Number(a.codigo));
    return porNombreCompleto[0];
  }

  // Buscar por palabras clave significativas (excluir palabras cortas/genéricas)
  const palabrasSignificativas = target.split(/\s+/).filter(w => w.length > 3 && !/^(S\.?A\.?|LTD|INC|LLC|LTDA|COMPANY|CO\.)$/i.test(w));
  if (palabrasSignificativas.length > 1) {
    // Buscar match con al menos 2 palabras significativas
    const porMultiKeyword = all.filter(c => {
      const n = c.nombre.toUpperCase();
      return palabrasSignificativas.filter(w => n.includes(w)).length >= 2;
    });
    if (porMultiKeyword.length) {
      // Nombre más largo; si empatan, último creado
      porMultiKeyword.sort((a, b) => b.nombre.length - a.nombre.length || Number(b.codigo) - Number(a.codigo));
      return porMultiKeyword[0];
    }
  }

  // Fallback: buscar por primera palabra clave significativa (NO siglas)
  // Preferir palabras largas sobre siglas cortas (ej: "MEDITERRANEAN" sobre "MSC")
  const keywordLarga = palabrasSignificativas.find(w => w.length > 4) || palabrasSignificativas[0] || target.split(/\s+/)[0];
  const porKeyword = all.filter(c => c.nombre.toUpperCase().includes(keywordLarga));
  if (porKeyword.length) {
    // Seleccionar el de nombre más largo; si empatan en largo, el de código más alto (último creado)
    porKeyword.sort((a, b) => b.nombre.length - a.nombre.length || Number(b.codigo) - Number(a.codigo));
    return porKeyword[0];
  }
  return null;
}

/**
 * Obtiene los datos completos de un transportista (país y RUT) desde el endpoint XML.
 * Replica carga_datos_transportista() que se dispara al seleccionar la Cía. Transportadora:
 * hay que ESPERAR esta llamada para que se peguen país y RUT antes de guardar.
 * @param traId código del transportista (cia_id)
 * @returns { paiId, rut, nombre } o null
 */
export async function datosTransportista(traId: string): Promise<{ paiId: string; rut: string; nombre: string } | null> {
  if (!traId) return null;
  const res = await aduananetFetch(`/modulos/general/getXML/transportista.php?tra_id=${encodeURIComponent(traId)}`, {
    method: "GET",
    headers: { "Accept-Encoding": "gzip, deflate" },
    redirect: "follow",
  });
  // El XML puede venir comprimido (gzip) sin declarar content-encoding → descomprimir manual
  const buf = Buffer.from(await res.arrayBuffer());
  let xml: string;
  if (buf.slice(0, 2).toString("hex") === "1f8b") {
    xml = zlib.gunzipSync(buf).toString("latin1");
  } else {
    try { xml = zlib.inflateSync(buf).toString("latin1"); } catch { xml = buf.toString("latin1"); }
  }
  const pick = (tag: string) => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) || [])[1]?.trim() || "";
  const rut = pick("tra_rut");
  const paiId = pick("pai_id");
  const nombre = pick("tra_nombre");
  if (!rut && !paiId) return null;
  return { paiId, rut, nombre };
}

/**
 * Crea una naviera/transportista nueva. Requiere país y RUT (preguntar al usuario).
 * @param nombre  nombre de la naviera
 * @param paiId   código de país AduanaNet
 * @param rut     RUT de la naviera (o representante en Chile)
 */
export async function crearTransportista(
  nombre: string,
  paiId: string,
  rut: string
): Promise<{ codigo: string; nombre: string } | null> {
  if (!nombre) return null;
  const body = new URLSearchParams();
  body.set("tra_id", "");
  body.set("tra_nombre", nombre.toUpperCase().trim());
  body.set("tra_rut", rut || "");
  body.set("pai_id", paiId || "0");
  body.set("comando", "G"); // grabar — ajustar si el mantenedor usa otro comando
  body.set("query", "");
  body.set("pagno", "0");

  await aduananetFetch("/modulos/mantenedores/transportista.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
  // Re-buscar (en el popup de mantenedores) para obtener el código creado
  const path = `/modulos/mantenedores/transportista.php?menu=0&comando=I&query=${encodeURIComponent(nombre)}&pagno=0&maxpag=0`;
  const html = await aduananetGet(path);
  const matches = [...html.matchAll(/seleccion\(\s*['"](\d+)['"]\s*,\s*['"]([^'"]+)['"]/gi)];
  if (matches.length === 0) return null;
  return { codigo: matches[0][1], nombre: matches[0][2] };
}



// ============================================================
// MÓDULO: ANTECEDENTES FINANCIEROS (dus_antecedentes)
// ============================================================

/**
 * Datos de entrada para grabar Antecedentes Financieros.
 * Se obtienen de los documentos de la operación (Invoice, BL, CO).
 */
export type AntecedentesInput = {
  /** Número de operación (lib_nid) en AduanaNet */
  nroOperacion: string;

  // --- Del Certificado de Origen (si existe) ---
  /** Texto del tratado o país para resolver el régimen (ej: "UNITED STATES", "CHINA") */
  tratadoOPais?: string;
  /** Número del certificado de origen */
  numeroCertOrigen?: string;
  /** Fecha del certificado (DD/MM/YYYY) */
  fechaCertOrigen?: string;

  // --- De la Invoice ---
  /** Código de moneda de la factura. Default "USD". Se mapea a código AduanaNet. */
  moneda?: string;
  /** Incoterm de la operación (CIF, CFR, FOB, EXW, etc.) */
  incoterm?: string;
  /** Condiciones de pago / plazo en días (ej: "60", "30", "NET 60 DAYS") */
  condicionesPago?: string;

  // --- Calculados ---
  /** Valor ex-fábrica en USD (solo para EXW). Default 0. */
  valorExFabrica?: number;
  /** Gastos hasta FOB en USD (para EXW/FOB). Default 0. */
  gastosHastaFob?: number;

  // --- Defaults / Manual ---
  /** Código banco comercial (default: no tocar el que viene). 41 opciones. */
  bancoComercial?: string;
  /** Forma de pago (default "1" = COB1) */
  formaPago?: string;
  /** Tipo de divisas (default "1" = MERC.CAMB.FORMAL) */
  tipoDivisas?: string;
  /** Forma de pago gravámenes (default "4" = Sp/IVA C) */
  formaPagoGravamenes?: string;
};

export type AntecedentesResult = {
  ok: boolean;
  campos: Record<string, string>;
  verificacion?: Record<string, string>;
  error?: string;
};

/**
 * Mapeo de moneda texto → código AduanaNet (mda_id).
 * Las más comunes. Si no se encuentra, default 13 (USD).
 */
const MONEDA_A_CODIGO: Record<string, string> = {
  USD: "13", "US DOLLAR": "13", "US DOLLARS": "13", DOLLAR: "13", DOLAR: "13",
  EUR: "22", EURO: "22", EUROS: "22",
  GBP: "24", "LIBRA ESTERLINA": "24", POUND: "24",
  JPY: "19", YEN: "19",
  CNY: "133", YUAN: "133", RMB: "133", RENMINBI: "133",
  KRW: "93", WON: "93",
  BRL: "5", REAL: "5",
  ARS: "138", "PESO ARGENTINO": "138",
  MXN: "75", "PESO MEXICANO": "75",
  CLP: "1", "PESO CHILENO": "1",
  CAD: "6", "DOLAR CANADIENSE": "6",
  AUD: "144", "DOLAR AUSTRALIANO": "144",
  CHF: "18", "FRANCO SUIZO": "18",
  SEK: "43", "CORONA SUECIA": "43",
  NOK: "96", "CORONA NORUEGA": "96",
  DKK: "51", "CORONA DINAMARCA": "51",
  INR: "97", RUPIA: "97",
  TWD: "70", "DOLAR TAIWAN": "70",
  NZD: "145", "DOLAR NUEVA ZELANDA": "145",
};

/**
 * Mapeo de incoterm texto → código AduanaNet (cvt_id) para Antecedentes.
 * Nota: cvt_id en Antecedentes es diferente de term_compra en Valores Generales.
 */
const INCOTERM_A_CVT: Record<string, string> = {
  CIF: "1", CFR: "2", "C&F": "2", "CNF": "2",
  EXW: "3", FAS: "4", FOB: "5",
  "S/CL": "6", FCA: "7", OTRA: "8", DDP: "9",
  CPT: "2", CIP: "1", DAP: "9", DPU: "9", DAT: "9",
};

/**
 * Resuelve el código de moneda AduanaNet (mda_id) desde un texto.
 * @param monedaTexto ej: "USD", "EUR", "US DOLLAR"
 * @returns código AduanaNet (default "13" = USD)
 */
function resolverMoneda(monedaTexto?: string): string {
  if (!monedaTexto) return "13";
  const norm = monedaTexto.toUpperCase().trim();
  if (MONEDA_A_CODIGO[norm]) return MONEDA_A_CODIGO[norm];
  // Buscar por inclusión
  for (const [key, val] of Object.entries(MONEDA_A_CODIGO)) {
    if (norm.includes(key) || key.includes(norm)) return val;
  }
  return "13"; // default USD
}

/**
 * Resuelve el código de cláusula de venta (cvt_id) desde un incoterm.
 * @param incoterm ej: "CFR", "CIF", "FOB"
 * @returns código AduanaNet (default "5" = FOB)
 */
function resolverCvt(incoterm?: string): string {
  if (!incoterm) return "5";
  const norm = incoterm.toUpperCase().trim();
  if (INCOTERM_A_CVT[norm]) return INCOTERM_A_CVT[norm];
  // Buscar por inclusión parcial
  for (const [key, val] of Object.entries(INCOTERM_A_CVT)) {
    if (norm.includes(key)) return val;
  }
  return "5"; // default FOB
}

/**
 * Extrae el número de días del campo condiciones_pago.
 * Soporta formatos: "60", "NET 60 DAYS", "60 DAYS NET", "PAYMENT: 30 DAYS", etc.
 * @returns string con número de días, o "60" por defecto
 */
function resolverDiasPago(condiciones?: string): string {
  if (!condiciones) return "60";
  const norm = condiciones.toUpperCase().trim();
  // Si es puro número
  if (/^\d+$/.test(norm)) return norm;
  // Buscar patrón con número
  const match = norm.match(/(\d+)\s*(DAYS?|DIAS?|D[IÍ]AS?)/i)
    || norm.match(/NET\s*(\d+)/i)
    || norm.match(/(\d+)\s*D/i)
    || norm.match(/(\d+)/);
  if (match) return match[1];
  // Casos especiales
  if (/CONTADO|CASH|SIGHT|INMEDIATO/i.test(norm)) return "0";
  if (/ANTICIPADO|ADVANCE|PREPAID/i.test(norm)) return "0";
  return "60"; // default
}

/**
 * Extrae todos los campos del form HTML y devuelve como Record<string, string>.
 */
function extractFormFields(html: string): Record<string, string> {
  const f: Record<string, string> = {};
  // Inputs
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (tag.match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    const type = ((tag.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "text").toLowerCase();
    const value = (tag.match(/value\s*=\s*["']([^"']*?)["']/i) || [])[1] || "";
    if (type === "checkbox" || type === "radio") {
      if (/checked/i.test(tag)) f[name] = value || "1";
    } else {
      f[name] = value;
    }
  }
  // Selects (valor seleccionado)
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = (m[1].match(/name\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (!name || name === "modulo_seleccion[]") continue;
    f[name] = (m[2].match(/<option\s+value\s*=\s*["']?([^"'>]*?)["']?[^>]*selected/i) || [])[1] || "";
  }
  return f;
}

/**
 * Graba el módulo ANTECEDENTES FINANCIEROS de una operación en AduanaNet.
 *
 * Flujo:
 * 1. GET del formulario (obtener campos actuales + cookies de sesión del form)
 * 2. Resolver valores desde los documentos
 * 3. Inyectar valores en los campos del form
 * 4. POST con comando=U (Aceptar)
 * 5. Verificar que se guardó correctamente
 *
 * @param input datos extraídos de documentos + configuración
 * @returns resultado con campos enviados y verificación
 */
export async function grabarAntecedentes(input: AntecedentesInput): Promise<AntecedentesResult> {
  const { nroOperacion } = input;
  if (!nroOperacion) {
    return { ok: false, campos: {}, error: "Falta nroOperacion" };
  }

  const url = `/modulos/din/dus_encabezado/dus_antecedentes.php?lib_base=1&lib_nid=${nroOperacion}&lbac_nid=0&dus_tipo_envio=2&comando=M&pagno=0`;

  try {
    // 1) GET del formulario actual
    const html = await aduananetGet(url);
    const campos = extractFormFields(html);
    console.log(`[antecedentes] Op ${nroOperacion}: ${Object.keys(campos).length} campos extraídos`);

    // 2) Resolver valores desde documentos

    // --- Régimen (del CO) ---
    if (input.tratadoOPais) {
      const { resolverRegimen } = await import("./din-estructura");
      const regimen = resolverRegimen(input.tratadoOPais);
      campos.reg_id = regimen.regId;
      if (campos.lreg_id !== undefined) campos.lreg_id = regimen.regId;
      console.log(`[antecedentes] Régimen: ${regimen.nombre} (${regimen.regId}) ← tratado: "${input.tratadoOPais}"`);
    }

    // --- Forma de Pago (default COB1) ---
    campos.fpa_id = input.formaPago || "1";
    if (campos.lfpa_id !== undefined) campos.lfpa_id = input.formaPago || "1";

    // --- Días de plazo ---
    campos.din_dias = resolverDiasPago(input.condicionesPago);
    console.log(`[antecedentes] Días plazo: ${campos.din_dias} ← condiciones: "${input.condicionesPago || "(default 60)"}"`);

    // --- Moneda de divisas (de la Invoice) ---
    const codigoMoneda = resolverMoneda(input.moneda);
    campos.mda_id = codigoMoneda;
    if (campos.lmda_id !== undefined) campos.lmda_id = codigoMoneda;
    console.log(`[antecedentes] Moneda: ${codigoMoneda} ← "${input.moneda || "USD (default)"}"`);

    // --- Tipo de divisas ---
    // Solo setear si se indica explícitamente o si ya tenía valor.
    // En muchas operaciones viene vacío y AduanaNet no lo exige.
    if (input.tipoDivisas) {
      campos.div_id = input.tipoDivisas;
      if (campos.ldiv_id !== undefined) campos.ldiv_id = input.tipoDivisas;
    } else if (campos.div_id === "" || campos.div_id === undefined) {
      // Dejar vacío — no forzar valor
    } else {
      // Ya tiene valor, no tocar
    }

    // --- Cláusula de Venta / Incoterm ---
    const codigoCvt = resolverCvt(input.incoterm);
    campos.cvt_id = codigoCvt;
    if (campos.lcvt_id !== undefined) campos.lcvt_id = codigoCvt;
    console.log(`[antecedentes] Cláusula venta: ${codigoCvt} ← incoterm: "${input.incoterm || "(default FOB)"}"`);

    // --- Valor Ex-Fábrica (solo EXW) ---
    const exFab = input.valorExFabrica || 0;
    campos.din_valor_ex_fabrica = exFab.toFixed(2);

    // --- Forma de Pago Gravámenes ---
    campos.fpg_id = input.formaPagoGravamenes || "4"; // Sp/IVA C (más común)
    if (campos.lfpg_id !== undefined) campos.lfpg_id = input.formaPagoGravamenes || "4";

    // --- Gastos hasta FOB ---
    const ghf = input.gastosHastaFob || 0;
    campos.din_gastos_hasta_fob = ghf.toFixed(2);

    // --- Banco Comercial (solo si se especifica) ---
    if (input.bancoComercial) {
      campos.bcc_id = input.bancoComercial;
      if (campos.lbcc_id !== undefined) campos.lbcc_id = input.bancoComercial;
    }

    // --- Certificado de Origen (si existe) ---
    if (input.numeroCertOrigen) {
      if (campos.cert_numero !== undefined) campos.cert_numero = input.numeroCertOrigen;
    }
    if (input.fechaCertOrigen) {
      if (campos.cert_fecha !== undefined) campos.cert_fecha = input.fechaCertOrigen;
    }

    // 3) Setear comando de guardado
    campos.comando = "U";

    // 4) POST para guardar
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(campos)) {
      body.set(k, v ?? "");
    }

    const saveRes = await aduananetFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    console.log(`[antecedentes] POST comando=U: status ${saveRes.status}`);

    // 5) Verificación: re-leer el formulario y comparar valores clave
    const htmlVerif = await aduananetGet(url);
    const camposVerif = extractFormFields(htmlVerif);

    const verificacion: Record<string, string> = {
      reg_id: camposVerif.reg_id || "",
      fpa_id: camposVerif.fpa_id || "",
      din_dias: camposVerif.din_dias || "",
      mda_id: camposVerif.mda_id || "",
      div_id: camposVerif.div_id || "",
      cvt_id: camposVerif.cvt_id || "",
      fpg_id: camposVerif.fpg_id || "",
      din_valor_ex_fabrica: camposVerif.din_valor_ex_fabrica || "",
      din_gastos_hasta_fob: camposVerif.din_gastos_hasta_fob || "",
    };

    // Validar campos clave
    const errores: string[] = [];
    if (input.tratadoOPais && verificacion.reg_id !== campos.reg_id) {
      errores.push(`reg_id: esperado=${campos.reg_id}, actual=${verificacion.reg_id}`);
    }
    if (verificacion.cvt_id !== campos.cvt_id) {
      errores.push(`cvt_id: esperado=${campos.cvt_id}, actual=${verificacion.cvt_id}`);
    }
    if (verificacion.mda_id !== campos.mda_id) {
      errores.push(`mda_id: esperado=${campos.mda_id}, actual=${verificacion.mda_id}`);
    }

    if (errores.length > 0) {
      console.warn(`[antecedentes] ⚠️ Verificación con diferencias:`, errores);
      return { ok: false, campos, verificacion, error: `Verificación fallida: ${errores.join("; ")}` };
    }

    console.log(`[antecedentes] ✅ Guardado OK — reg_id=${verificacion.reg_id}, cvt_id=${verificacion.cvt_id}, mda_id=${verificacion.mda_id}, dias=${verificacion.din_dias}`);
    return { ok: true, campos, verificacion };

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[antecedentes] ERROR:`, msg);
    return { ok: false, campos: {}, error: msg };
  }
}

/**
 * Prepara los datos de Antecedentes desde los documentos de una operación.
 * Recibe los datos extraídos (JSON) de cada documento y arma el input para grabarAntecedentes().
 *
 * @param docs objeto con los datos extraídos de cada tipo de documento
 * @param nroOperacion número de operación en AduanaNet
 * @returns AntecedentesInput listo para pasar a grabarAntecedentes()
 */
export function prepararAntecedentes(
  docs: {
    invoice?: Record<string, unknown>;
    certificadoOrigen?: Record<string, unknown>;
    bl?: Record<string, unknown>;
  },
  nroOperacion: string
): AntecedentesInput {
  const { invoice, certificadoOrigen, bl } = docs;

  // --- Régimen (del CO) ---
  let tratadoOPais = "";
  let numeroCertOrigen = "";
  let fechaCertOrigen = "";
  if (certificadoOrigen) {
    tratadoOPais = String(certificadoOrigen.tratado_aplicable || certificadoOrigen.pais_origen || "");
    numeroCertOrigen = String(certificadoOrigen.numero_certificado || "");
    fechaCertOrigen = String(certificadoOrigen.fecha_emision || "");
  }

  // --- Moneda e Incoterm (de la Invoice, con fallback al BL) ---
  const moneda = String(invoice?.moneda || "USD");
  const incoterm = String(invoice?.incoterm || bl?.incoterm || "FOB");
  const condicionesPago = String(invoice?.condiciones_pago || "60");

  // --- Gastos hasta FOB (del BL, si incoterm EXW/FOB) ---
  let gastosHastaFob = 0;
  if (bl?.gastos_fob_total) {
    gastosHastaFob = Number(bl.gastos_fob_total) || 0;
  }

  // --- Valor ex-fábrica (solo EXW) ---
  let valorExFabrica = 0;
  if (/EXW/i.test(incoterm) && invoice?.monto_total) {
    valorExFabrica = Number(invoice.monto_total) || 0;
  }

  return {
    nroOperacion,
    tratadoOPais,
    numeroCertOrigen,
    fechaCertOrigen,
    moneda,
    incoterm,
    condicionesPago,
    valorExFabrica,
    gastosHastaFob,
    // Defaults que se pueden sobreescribir
    formaPago: "1",        // COB1
    tipoDivisas: undefined, // No forzar si viene vacío en el form
    formaPagoGravamenes: "4", // Sp/IVA C
  };
}
