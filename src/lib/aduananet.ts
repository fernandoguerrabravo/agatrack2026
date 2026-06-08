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
