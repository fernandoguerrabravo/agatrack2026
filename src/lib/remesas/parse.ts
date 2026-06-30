/**
 * Parser de la tabla de remesas que viene en el cuerpo del correo.
 * Tabla esperada (columnas): Embarque | Fecha límite | N° de despacho | Total
 * - Cada fila → { despacho, monto }
 * - Fila final TOTAL → total
 * Montos en formato chileno (CLP enteros, "." separador de miles): "436.861" → 436861.
 */

export type LineaRemesa = { despacho: string; monto: number };
export type RemesaParseResult = { lineas: LineaRemesa[]; total: number; sumaLineas: number; cuadra: boolean };

/** Convierte "1.021.354" / "436.861" (CLP, miles con punto) → entero. */
export function parseMontoCLP(raw: string): number {
  const s = String(raw).trim().replace(/\s/g, "");
  if (!s) return 0;
  // CLP entero: quitar separadores de miles (puntos). Si hubiera coma decimal, la ignoramos (CLP no usa decimales).
  const soloDigitos = s.replace(/[.\u00a0]/g, "").replace(/,\d{1,2}$/, "");
  const n = parseInt(soloDigitos.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Extrae el texto plano de una celda HTML. */
function cellText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

/**
 * Parsea la tabla desde el HTML del correo.
 * Estrategia: ubica las filas (<tr>), toma celdas (<td>/<th>), e identifica:
 *  - despacho: celda con 6 dígitos (N° de despacho)
 *  - monto: última celda numérica de la fila
 *  - total: fila cuya primera celda contiene "TOTAL"
 */
export function parseRemesaTabla(html: string): RemesaParseResult {
  const lineas: LineaRemesa[] = [];
  let total = 0;

  const filas = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
  for (const fila of filas) {
    const celdas = [...fila.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cellText(c[1]));
    if (celdas.length === 0) continue;
    const joined = celdas.join(" ").toUpperCase();

    // Fila de encabezado: la saltamos
    if (/N[°º]?\s*DE\s*DESPACHO/i.test(joined) && /TOTAL/i.test(joined) && /EMBARQUE/i.test(joined)) continue;

    // Fila TOTAL
    if (/^\s*TOTAL\b/i.test(celdas[0]) || celdas.some(c => /^TOTAL$/i.test(c))) {
      // el monto total es la última celda con número
      for (let i = celdas.length - 1; i >= 0; i--) {
        const n = parseMontoCLP(celdas[i]);
        if (n > 0) { total = n; break; }
      }
      continue;
    }

    // Fila de datos: buscar despacho (6 dígitos) y monto (última celda numérica)
    const despacho = (celdas.find(c => /^\d{6}$/.test(c.replace(/\D/g, "")) && /^\d{6}$/.test(c.trim())) || "").trim();
    const despachoMatch = despacho || (joined.match(/\b(\d{6})\b/) || [])[1] || "";
    if (!despachoMatch) continue;
    let monto = 0;
    for (let i = celdas.length - 1; i >= 0; i--) {
      if (celdas[i].replace(/\D/g, "") === despachoMatch.replace(/\D/g, "")) continue; // no confundir con el despacho
      const n = parseMontoCLP(celdas[i]);
      if (n > 0) { monto = n; break; }
    }
    if (monto > 0) lineas.push({ despacho: despachoMatch, monto });
  }

  const sumaLineas = lineas.reduce((s, l) => s + l.monto, 0);
  // Si no detectó TOTAL explícito, usar la suma
  if (total === 0) total = sumaLineas;
  return { lineas, total, sumaLineas, cuadra: sumaLineas === total };
}
