import "server-only";
import { pgQuery } from "./postgres";
import type { SessionPayload } from "./types";

/** Determina el rol efectivo (backward compat con tokens sin campo rol) */
function getRol(session: SessionPayload): "admin" | "ejecutivo" | "cliente" | "contabilidad" {
  return session.rol || (session.rol_prealertas === 1 ? "admin" : "cliente");
}

/**
 * Retorna la cláusula WHERE para filtrar por rut_cliente según el rol del usuario.
 */
export async function filtroClientes(
  session: SessionPayload,
  alias: string = ""
): Promise<{ condition: string; params: string[] }> {
  const col = alias ? `${alias}.rut_cliente` : "rut_cliente";
  const rol = getRol(session);

  if (rol === "admin") {
    return { condition: "1=1", params: [] };
  }

  if (rol === "ejecutivo") {
    const asignaciones = await pgQuery<{ rut_cliente: string }>(
      "SELECT rut_cliente FROM asignaciones_ejecutivo WHERE rut_ejecutivo = $1",
      [session.rut]
    );
    if (asignaciones.length === 0) {
      return { condition: "1=0", params: [] };
    }
    const ruts = asignaciones.map(a => a.rut_cliente);
    const placeholders = ruts.map((_, i) => `$${i + 1}`).join(", ");
    return { condition: `${col} IN (${placeholders})`, params: ruts };
  }

  return { condition: `${col} = $1`, params: [session.rut] };
}

/**
 * Retorna la lista de rut_cliente que el usuario puede ver.
 */
export async function clientesVisibles(session: SessionPayload): Promise<string[] | "all"> {
  const rol = getRol(session);
  if (rol === "admin") return "all";

  if (rol === "ejecutivo") {
    const asignaciones = await pgQuery<{ rut_cliente: string }>(
      "SELECT rut_cliente FROM asignaciones_ejecutivo WHERE rut_ejecutivo = $1",
      [session.rut]
    );
    return asignaciones.map(a => a.rut_cliente);
  }

  return [session.rut];
}


/**
 * Retorna los emails de los ejecutivos asignados a un cliente.
 */
export async function emailsEjecutivosCliente(rutCliente: string): Promise<string[]> {
  const rows = await pgQuery<{ email: string }>(
    `SELECT u.email FROM usuarios u 
     INNER JOIN asignaciones_ejecutivo a ON u.rut = a.rut_ejecutivo 
     WHERE a.rut_cliente = $1 AND u.email IS NOT NULL AND u.email != ''`,
    [rutCliente]
  );
  return rows.map(r => r.email);
}


/**
 * Detecta el cliente a partir del nombre del consignatario/comprador de la factura.
 * Busca en la tabla clientes por coincidencia parcial del nombre.
 * @returns { rut, razon, cli_id } o null si no encuentra
 */
// Mapeo RUT → cli_id de AduanaNet (agregar nuevos clientes aquí)
const RUT_TO_CLI_ID: Record<string, string> = {
  "92933000-5": "2710",  // PETROQUIMICA DOW S.A.
  "96691060-7": "2654",  // KSB CHILE S.A.
};

export async function detectarClientePorConsignatario(nombreConsignatario: string): Promise<{ rut: string; razon: string; cli_id: string } | null> {
  if (!nombreConsignatario) return null;
  // Usar nombre más completo para búsqueda — mínimo 5 chars por palabra, hasta 4 palabras
  const palabras = nombreConsignatario.toUpperCase().split(/\s+/).filter(w => w.length > 4 && !/^(S\.?A\.?|LTDA?|INC|LLC|SPA|CHILE|S\.?R\.?L\.?)$/i.test(w));
  if (palabras.length === 0) return null;
  
  // Intentar con nombre más largo primero (más específico)
  for (let numPalabras = Math.min(palabras.length, 4); numPalabras >= 1; numPalabras--) {
    const keyword = palabras.slice(0, numPalabras).join(" ");
    const rows = await pgQuery<{ rut: string; razon: string }>(
      "SELECT rut, razon FROM clientes WHERE UPPER(razon) LIKE $1 LIMIT 5",
      [`%${keyword}%`]
    );
    
    if (rows.length === 1) {
      return { rut: rows[0].rut, razon: rows[0].razon, cli_id: RUT_TO_CLI_ID[rows[0].rut] || "" };
    }
    if (rows.length > 1 && numPalabras >= 2) {
      // Varios resultados con búsqueda específica — tomar el match más exacto
      const target = nombreConsignatario.toUpperCase();
      const sorted = rows.sort((a, b) => {
        const aScore = target.includes(a.razon.toUpperCase()) ? 2 : a.razon.toUpperCase().includes(keyword) ? 1 : 0;
        const bScore = target.includes(b.razon.toUpperCase()) ? 2 : b.razon.toUpperCase().includes(keyword) ? 1 : 0;
        return bScore - aScore;
      });
      return { rut: sorted[0].rut, razon: sorted[0].razon, cli_id: RUT_TO_CLI_ID[sorted[0].rut] || "" };
    }
  }
  
  return null;
}
