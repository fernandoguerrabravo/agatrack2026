import "server-only";
import { pgQuery } from "./postgres";
import type { SessionPayload } from "./types";

/**
 * Retorna la cláusula WHERE para filtrar por rut_cliente según el rol del usuario.
 * 
 * - admin: ve todo (sin filtro)
 * - ejecutivo: ve solo clientes asignados en asignaciones_ejecutivo
 * - cliente: ve solo sus propias operaciones (rut del usuario = rut_cliente)
 * 
 * @param session - sesión del usuario
 * @param alias - alias de la tabla que tiene rut_cliente (ej: "d", "o")
 * @returns { where: string, params: string[] } — where clause (sin "WHERE") y params a agregar
 */
export async function filtroClientes(
  session: SessionPayload,
  alias: string = ""
): Promise<{ condition: string; params: string[] }> {
  const col = alias ? `${alias}.rut_cliente` : "rut_cliente";

  if (session.rol === "admin") {
    // Admin ve todo
    return { condition: "1=1", params: [] };
  }

  if (session.rol === "ejecutivo") {
    // Ejecutivo ve solo sus clientes asignados
    const asignaciones = await pgQuery<{ rut_cliente: string }>(
      "SELECT rut_cliente FROM asignaciones_ejecutivo WHERE rut_ejecutivo = $1",
      [session.rut]
    );
    if (asignaciones.length === 0) {
      return { condition: "1=0", params: [] }; // sin asignaciones = no ve nada
    }
    const ruts = asignaciones.map(a => a.rut_cliente);
    const placeholders = ruts.map((_, i) => `$${i + 1}`).join(", ");
    return { condition: `${col} IN (${placeholders})`, params: ruts };
  }

  // Cliente: ve solo operaciones de su propio RUT
  return { condition: `${col} = $1`, params: [session.rut] };
}

/**
 * Retorna la lista de rut_cliente que el usuario puede ver.
 */
export async function clientesVisibles(session: SessionPayload): Promise<string[] | "all"> {
  if (session.rol === "admin") return "all";

  if (session.rol === "ejecutivo") {
    const asignaciones = await pgQuery<{ rut_cliente: string }>(
      "SELECT rut_cliente FROM asignaciones_ejecutivo WHERE rut_ejecutivo = $1",
      [session.rut]
    );
    return asignaciones.map(a => a.rut_cliente);
  }

  // Cliente
  return [session.rut];
}
