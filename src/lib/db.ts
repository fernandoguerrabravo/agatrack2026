import "server-only";
import { pgQuery } from "./postgres";

/**
 * Módulo de consultas a la base de datos.
 * Ahora usa PostgreSQL (tabla despachos_replica) en vez de MySQL directo.
 * La sincronización se hace con el script cron sync-mysql-to-pg.js
 */

export async function query<T = Record<string, unknown>[]>(
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<T> {
  // Convertir query MySQL a PostgreSQL:
  // - Reemplazar ? por $1, $2, etc.
  // - Reemplazar nombre de tabla
  let pgSql = sql.replace(/out_despacho_fguerra/g, "despachos_replica");

  // Convertir placeholders ? a $1, $2, ...
  let paramIndex = 0;
  pgSql = pgSql.replace(/\?/g, () => `$${++paramIndex}`);

  // Convertir funciones MySQL a PostgreSQL (fechas almacenadas como TEXT 'YYYY-MM-DD')
  pgSql = pgSql.replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m'\)/g, "SUBSTRING($1, 1, 7)");
  pgSql = pgSql.replace(/DATE_FORMAT\(([^,]+),\s*'%Y'\)/g, "SUBSTRING($1, 1, 4)");
  pgSql = pgSql.replace(/YEAR\(([^)]+)\)/g, "SUBSTRING($1, 1, 4)::int");
  pgSql = pgSql.replace(/CURDATE\(\)/g, "TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')");
  pgSql = pgSql.replace(/CONCAT\(([^)]+)\)/g, "($1)");
  pgSql = pgSql.replace(/NOW\(\)/g, "NOW()");

  // Convertir campos TEXT a numéricos para SUM/AVG (PostgreSQL no suma TEXT)
  pgSql = pgSql.replace(/SUM\(total_fob\)/g, "SUM(total_fob::numeric)");
  pgSql = pgSql.replace(/SUM\(total_cif\)/g, "SUM(total_cif::numeric)");
  pgSql = pgSql.replace(/SUM\(total_peso_bruto\)/g, "SUM(total_peso_bruto::numeric)");
  pgSql = pgSql.replace(/SUM\(valor_flete\)/g, "SUM(valor_flete::numeric)");
  pgSql = pgSql.replace(/SUM\(valor_seguro\)/g, "SUM(valor_seguro::numeric)");
  pgSql = pgSql.replace(/SUM\(iva\)/g, "SUM(iva::numeric)");
  pgSql = pgSql.replace(/SUM\(gravamenes_valor_1\)/g, "SUM(gravamenes_valor_1::numeric)");
  pgSql = pgSql.replace(/AVG\(total_fob\)/g, "AVG(total_fob::numeric)");
  pgSql = pgSql.replace(/AVG\(total_cif\)/g, "AVG(total_cif::numeric)");

  // Comparaciones de fecha (formato YYYY-MM-DD almacenado como TEXT)
  pgSql = pgSql.replace(/fecha_aceptacion::timestamp\s*>=\s*\$/g, "fecha_aceptacion >= $");
  pgSql = pgSql.replace(/fecha_aceptacion::timestamp\s*<=\s*\$/g, "fecha_aceptacion <= $");
  pgSql = pgSql.replace(/fecha_aceptacion::timestamp\s*>\s*\$/g, "fecha_aceptacion > $");
  pgSql = pgSql.replace(/fecha_carga_data::timestamp\s*>\s*\$/g, "fecha_carga_data > $");

  const rows = await pgQuery<T extends Array<infer U> ? U : Record<string, unknown>>(pgSql, params as unknown[]);
  return rows as T;
}

export async function getConnection() {
  throw new Error("getConnection not supported with PostgreSQL. Use query() instead.");
}
