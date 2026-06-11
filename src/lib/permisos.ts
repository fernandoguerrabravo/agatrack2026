import "server-only";
import { pgQuery } from "./postgres";
import type { SessionPayload } from "./types";

/** Determina el rol efectivo (backward compat con tokens sin campo rol) */
function getRol(session: SessionPayload): "admin" | "ejecutivo" | "cliente" {
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
