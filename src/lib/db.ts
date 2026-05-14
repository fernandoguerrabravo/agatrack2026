import "server-only";
import { pgQuery } from "./postgres";

/**
 * Módulo de consultas a la base de datos.
 * Traduce queries MySQL a PostgreSQL (tabla despachos_replica).
 * La sincronización se hace con el script cron sync-mysql-to-pg.js
 */

export async function query<T = Record<string, unknown>[]>(
  sql: string,
  params?: ReadonlyArray<unknown>
): Promise<T> {
  let pgSql = sql;

  // Reemplazar nombre de tabla
  pgSql = pgSql.replace(/out_despacho_fguerra/g, "despachos_replica");

  // Reemplazar patrones MySQL complejos ANTES de convertir placeholders
  // CONCAT(YEAR(CURDATE()),'-01-01') → primer día del año actual
  pgSql = pgSql.replace(/CONCAT\(YEAR\(CURDATE\(\)\),'-01-01'\)/g, "TO_CHAR(DATE_TRUNC('year', CURRENT_DATE), 'YYYY-MM-DD')");
  
  // YEAR(CURDATE())-1 → año anterior
  pgSql = pgSql.replace(/YEAR\(CURDATE\(\)\)-(\d+)/g, "(EXTRACT(YEAR FROM CURRENT_DATE)::int - $1)");
  pgSql = pgSql.replace(/YEAR\(CURDATE\(\)\)/g, "EXTRACT(YEAR FROM CURRENT_DATE)::int");

  // YEAR(fecha_aceptacion) → extraer año del texto
  pgSql = pgSql.replace(/YEAR\(([^)]+)\)/g, "SUBSTRING($1, 1, 4)::int");

  // DATE_FORMAT(campo, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m') → mes actual
  pgSql = pgSql.replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m'\)\s*=\s*DATE_FORMAT\(CURDATE\(\),\s*'%Y-%m'\)/g, "SUBSTRING($1, 1, 7) = TO_CHAR(CURRENT_DATE, 'YYYY-MM')");

  // DATE_FORMAT(campo, '%Y-%m') → primeros 7 chars
  pgSql = pgSql.replace(/DATE_FORMAT\(([^,]+),\s*'%Y-%m'\)/g, "SUBSTRING($1, 1, 7)");
  pgSql = pgSql.replace(/DATE_FORMAT\(([^,]+),\s*'%Y'\)/g, "SUBSTRING($1, 1, 4)");

  // CURDATE() restante
  pgSql = pgSql.replace(/CURDATE\(\)/g, "TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')");

  // CONCAT restante
  pgSql = pgSql.replace(/CONCAT\(([^)]+)\)/g, "($1)");

  // Convertir placeholders ? a $1, $2, ...
  let paramIndex = 0;
  pgSql = pgSql.replace(/\?/g, () => `$${++paramIndex}`);

  // Campos TEXT a numéricos para SUM/AVG
  pgSql = pgSql.replace(/SUM\(total_fob\)/g, "SUM(NULLIF(total_fob,'')::numeric)");
  pgSql = pgSql.replace(/SUM\(total_cif\)/g, "SUM(NULLIF(total_cif,'')::numeric)");
  pgSql = pgSql.replace(/SUM\(total_peso_bruto\)/g, "SUM(NULLIF(total_peso_bruto,'')::numeric)");
  pgSql = pgSql.replace(/SUM\(valor_flete\)/g, "SUM(NULLIF(valor_flete,'')::numeric)");
  pgSql = pgSql.replace(/SUM\(valor_seguro\)/g, "SUM(NULLIF(valor_seguro,'')::numeric)");
  pgSql = pgSql.replace(/SUM\(iva\)/g, "SUM(NULLIF(iva,'')::numeric)");
  pgSql = pgSql.replace(/SUM\(gravamenes_valor_1\)/g, "SUM(NULLIF(gravamenes_valor_1,'')::numeric)");
  pgSql = pgSql.replace(/AVG\(total_fob\)/g, "AVG(NULLIF(total_fob,'')::numeric)");
  pgSql = pgSql.replace(/AVG\(total_cif\)/g, "AVG(NULLIF(total_cif,'')::numeric)");

  // Comparaciones numéricas con campos TEXT
  pgSql = pgSql.replace(/gravamenes_valor_1\s*=\s*0/g, "(NULLIF(gravamenes_valor_1,'')::numeric = 0 OR gravamenes_valor_1 IS NULL OR gravamenes_valor_1 = '')");

  // Comparaciones de fecha (ya son TEXT 'YYYY-MM-DD', comparación lexicográfica funciona)
  // No necesitan cast adicional

  const rows = await pgQuery<T extends Array<infer U> ? U : Record<string, unknown>>(pgSql, params as unknown[]);
  return rows as T;
}

export async function getConnection() {
  throw new Error("getConnection not supported with PostgreSQL. Use query() instead.");
}
