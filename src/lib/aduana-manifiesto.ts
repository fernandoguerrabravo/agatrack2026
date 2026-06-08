import "server-only";

/**
 * Cliente para el sistema público de Aduana Chile — Consulta Manifestación Marítima.
 * http://comext.aduana.cl:7001/ManifestacionMaritima/
 *
 * Permite buscar el N° de Manifiesto de una nave/viaje que arribó a un puerto chileno.
 * Es una app NetUI/WebLogic: maneja JSESSIONID en cookie + URL, y el formulario
 * filtra por puerto + año + mes + tipo (I = MFTO. Ingreso).
 *
 * La tabla de resultados tiene columnas:
 *   [0] N° Manifiesto (programación)  [1] Puerto  [2] Nave  [3] Viaje  [4] Agencia  [5] Fecha
 * El N° de Manifiesto a usar en la DIN es la PRIMERA COLUMNA.
 */

const BASE = "http://comext.aduana.cl:7001/ManifestacionMaritima";

/** Códigos de puerto chileno en el sistema de Aduana (Consulta Manifiesto). */
export const PUERTOS_MANIFIESTO: Record<string, string> = {
  "SAN ANTONIO": "906",
  "VALPARAISO": "905",
  "ARICA": "901",
  "IQUIQUE": "902",
  "ANTOFAGASTA": "903",
  "ZONA FRANCA IQUIQUE": "952",
};

export type ManifiestoRow = {
  manifiesto: string;  // N° de manifiesto (primera columna)
  puerto: string;
  nave: string;
  viaje: string;
  agencia: string;
  fecha: string;
};

/** Resuelve el código de puerto del sistema de manifiesto a partir del nombre. */
export function codigoPuertoManifiesto(nombrePuerto: string): string | null {
  if (!nombrePuerto) return null;
  const n = nombrePuerto.toUpperCase().replace(/[^A-Z\s]/g, " ").trim();
  // match exacto o por inclusión
  for (const [nombre, codigo] of Object.entries(PUERTOS_MANIFIESTO)) {
    if (n === nombre || n.includes(nombre) || nombre.includes(n)) return codigo;
  }
  return null;
}

/** Consulta la programación de naves de un puerto/año/mes. Devuelve las filas de la tabla. */
async function consultarProgramacion(
  codigoPuerto: string,
  anho: number,
  mes: number,
  tipo: "I" | "S" = "I"
): Promise<ManifiestoRow[]> {
  // 1) GET inicial para obtener JSESSIONID y cookies
  const r1 = await fetch(`${BASE}/limpiarListaProgramacionNaves.do`, { redirect: "manual" });
  const setCookies = typeof (r1.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (r1.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : [];
  const cookie = setCookies.map(c => c.split(";")[0]).join("; ");
  const html1 = await r1.text();
  const js = (html1.match(/jsessionid=([^"';\s]+)/i) || [])[1] || "";

  // 2) POST filtro
  const body = new URLSearchParams();
  body.set("wlw-select_key:{actionForm.puerto}OldValue", "true");
  body.set("wlw-select_key:{actionForm.puerto}", codigoPuerto);
  body.set("{actionForm.anho}", String(anho));
  body.set("wlw-select_key:{actionForm.mes}OldValue", "true");
  body.set("wlw-select_key:{actionForm.mes}", String(mes));
  body.set("wlw-select_key:{actionForm.tipo}OldValue", "true");
  body.set("wlw-select_key:{actionForm.tipo}", tipo);

  const r2 = await fetch(`${BASE}/limpiarListaProgramacionNaves.do;jsessionid=${js}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body: body.toString(),
    redirect: "manual",
  });
  const t = await r2.text();

  // Parsear filas de datos (primera celda es número de manifiesto)
  return [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(c => c[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()))
    .filter(c => c.length >= 6 && /^\d{3,}$/.test(c[0]))
    .map(c => ({ manifiesto: c[0], puerto: c[1], nave: c[2], viaje: c[3], agencia: c[4], fecha: c[5] }));
}

/**
 * Busca el manifiesto de una nave por su VIAJE en un puerto, revisando
 * el mes anterior, el mes actual y el mes siguiente.
 * @param puertoNombre nombre del puerto de llegada (ej: "SAN ANTONIO")
 * @param viaje  número de viaje a buscar en la columna Viaje (ej: "NX618A")
 * @param naveNombre (opcional) nombre de nave para validar/desempatar
 * @param refDate fecha de referencia (default hoy) para calcular los 3 meses
 * @returns la fila del manifiesto encontrada, o null
 */
export async function buscarManifiesto(
  puertoNombre: string,
  viaje: string,
  naveNombre?: string,
  refDate: Date = new Date()
): Promise<ManifiestoRow | null> {
  const codigoPuerto = codigoPuertoManifiesto(puertoNombre);
  if (!codigoPuerto) {
    console.warn("[manifiesto] Puerto no reconocido:", puertoNombre);
    return null;
  }
  if (!viaje) {
    console.warn("[manifiesto] Falta número de viaje");
    return null;
  }

  const viajeTarget = viaje.toUpperCase().replace(/\s+/g, "");
  // Meses a revisar: anterior, actual, siguiente
  const meses: Array<{ anho: number; mes: number }> = [-1, 0, 1].map(delta => {
    const d = new Date(refDate.getFullYear(), refDate.getMonth() + delta, 1);
    return { anho: d.getFullYear(), mes: d.getMonth() + 1 };
  });

  for (const { anho, mes } of meses) {
    try {
      const rows = await consultarProgramacion(codigoPuerto, anho, mes, "I");
      // Solo match exacto por viaje
      const match = rows.find(r => r.viaje.toUpperCase().replace(/\s+/g, "") === viajeTarget);
      if (match) {
        console.log(`[manifiesto] Encontrado: ${match.manifiesto} (${match.nave} / ${match.viaje}) en ${mes}/${anho}`);
        return match;
      }
    } catch (err) {
      console.error(`[manifiesto] Error consultando ${mes}/${anho}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("[manifiesto] No se encontró viaje", viaje, "en", puertoNombre, "(3 meses)");
  return null;
}
