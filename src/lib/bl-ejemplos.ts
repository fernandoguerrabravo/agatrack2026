import "server-only";
import { pgQuery, initBlEjemplosTable } from "./postgres";

/**
 * Módulo de gestión de ejemplos verificados de BL (gold standard).
 * Estos ejemplos alimentan el few-shot learning del análisis de documentos.
 * Se guardan cuando un BL es verificado/corregido (ShipsGo, aprobación manual de flete, etc.).
 */

type DatosBL = Record<string, unknown>;

let tableInitialized = false;
async function ensureTable() {
  if (tableInitialized) return;
  try {
    await initBlEjemplosTable();
    tableInitialized = true;
  } catch (err) {
    console.error("[bl-ejemplos] Error inicializando tabla:", err instanceof Error ? err.message : err);
  }
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Guarda (o actualiza) un ejemplo verificado de BL.
 * fuente: "shipsgo" | "flete_aprobado" | "manual" | "auto"
 */
export async function guardarEjemploBL(
  rutCliente: string,
  datos: DatosBL,
  fuente: string,
  verificadoShipsgo = false
): Promise<void> {
  await ensureTable();

  const master = str(datos.mbl_shipsgo || datos.numero_bl_master || datos.numero_bl);
  if (!master) return; // sin MBL no sirve como ejemplo

  const naviera = str(datos.naviera || datos.cia_transportadora || datos.carrier).toUpperCase();
  const house = str(datos.numero_bl_house);
  const tipoHouse = str(datos.tipo_bl_house);
  const flete = num(datos.flete_total_prepaid || datos.flete_total);
  const gastosFob = num(datos.gastos_fob_total);
  const moneda = str(datos.moneda);
  const incoterm = str(datos.incoterm).toUpperCase();
  const nave = str(datos.nave_corregida || datos.nave).toUpperCase();
  const viaje = str(datos.viaje_corregido || datos.viaje);
  const transbordo = str(datos.puerto_transbordo).toUpperCase();
  const desembarque = str(datos.puerto_desembarque || datos.puerto_destino).toUpperCase();
  const contenedores = Array.isArray(datos.contenedores)
    ? (datos.contenedores as Array<Record<string, unknown>>)
        .map((c) => str(c.numero_contenedor))
        .filter(Boolean)
        .join(", ")
    : "";

  try {
    // UPSERT: si ya existe el MBL para este cliente, actualizar; sino insertar
    await pgQuery(
      `INSERT INTO bl_ejemplos_verificados
        (rut_cliente, naviera, numero_bl_master, numero_bl_house, tipo_bl_house, flete_total_prepaid, gastos_fob_total, moneda, incoterm, contenedores, nave, viaje, puerto_transbordo, puerto_desembarque, fuente, verificado_shipsgo, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
       ON CONFLICT (rut_cliente, numero_bl_master) WHERE numero_bl_master <> ''
       DO UPDATE SET
         naviera = EXCLUDED.naviera,
         numero_bl_house = CASE WHEN EXCLUDED.numero_bl_house <> '' THEN EXCLUDED.numero_bl_house ELSE bl_ejemplos_verificados.numero_bl_house END,
         tipo_bl_house = CASE WHEN EXCLUDED.tipo_bl_house <> '' THEN EXCLUDED.tipo_bl_house ELSE bl_ejemplos_verificados.tipo_bl_house END,
         flete_total_prepaid = CASE WHEN EXCLUDED.flete_total_prepaid > 0 THEN EXCLUDED.flete_total_prepaid ELSE bl_ejemplos_verificados.flete_total_prepaid END,
         gastos_fob_total = CASE WHEN EXCLUDED.gastos_fob_total > 0 THEN EXCLUDED.gastos_fob_total ELSE bl_ejemplos_verificados.gastos_fob_total END,
         moneda = CASE WHEN EXCLUDED.moneda <> '' THEN EXCLUDED.moneda ELSE bl_ejemplos_verificados.moneda END,
         incoterm = CASE WHEN EXCLUDED.incoterm <> '' THEN EXCLUDED.incoterm ELSE bl_ejemplos_verificados.incoterm END,
         contenedores = CASE WHEN EXCLUDED.contenedores <> '' THEN EXCLUDED.contenedores ELSE bl_ejemplos_verificados.contenedores END,
         nave = CASE WHEN EXCLUDED.nave <> '' THEN EXCLUDED.nave ELSE bl_ejemplos_verificados.nave END,
         viaje = CASE WHEN EXCLUDED.viaje <> '' THEN EXCLUDED.viaje ELSE bl_ejemplos_verificados.viaje END,
         puerto_transbordo = CASE WHEN EXCLUDED.puerto_transbordo <> '' THEN EXCLUDED.puerto_transbordo ELSE bl_ejemplos_verificados.puerto_transbordo END,
         puerto_desembarque = CASE WHEN EXCLUDED.puerto_desembarque <> '' THEN EXCLUDED.puerto_desembarque ELSE bl_ejemplos_verificados.puerto_desembarque END,
         fuente = EXCLUDED.fuente,
         verificado_shipsgo = bl_ejemplos_verificados.verificado_shipsgo OR EXCLUDED.verificado_shipsgo,
         updated_at = NOW()`,
      [rutCliente, naviera, master, house, tipoHouse, flete, gastosFob, moneda, incoterm, contenedores, nave, viaje, transbordo, desembarque, fuente, verificadoShipsgo]
    );
    console.log("[bl-ejemplos] Ejemplo guardado:", master, "| naviera:", naviera, "| fuente:", fuente);
  } catch (err) {
    console.error("[bl-ejemplos] Error guardando ejemplo:", err instanceof Error ? err.message : err);
  }
}

type EjemploRow = {
  naviera: string;
  numero_bl_master: string;
  numero_bl_house: string;
  tipo_bl_house: string;
  flete_total_prepaid: string;
  gastos_fob_total: string;
  moneda: string;
  incoterm: string;
  contenedores: string;
  nave: string;
  viaje: string;
  puerto_transbordo: string;
  verificado_shipsgo: boolean;
};

/**
 * Obtiene ejemplos verificados para usar como few-shot context.
 * Prioriza: misma naviera > verificados con ShipsGo > más recientes.
 */
export async function obtenerEjemplosBL(
  rutCliente: string,
  navieraHint?: string
): Promise<string> {
  await ensureTable();

  try {
    const rows = await pgQuery<EjemploRow>(
      `SELECT naviera, numero_bl_master, numero_bl_house, tipo_bl_house, flete_total_prepaid, gastos_fob_total, moneda, incoterm, contenedores, nave, viaje, puerto_transbordo, verificado_shipsgo
       FROM bl_ejemplos_verificados
       WHERE rut_cliente = $1
       ORDER BY
         CASE WHEN $2 <> '' AND UPPER(naviera) LIKE '%' || UPPER($2) || '%' THEN 0 ELSE 1 END,
         verificado_shipsgo DESC,
         updated_at DESC
       LIMIT 8`,
      [rutCliente, navieraHint || ""]
    );

    if (rows.length === 0) return "";

    const lines = rows.map((r, i) => {
      let line = `${i + 1}. `;
      if (r.naviera) line += `[${r.naviera}] `;
      line += `MBL: ${r.numero_bl_master}`;
      if (r.numero_bl_house) line += ` | HBL${r.tipo_bl_house === "nieto" ? "(N)" : "(H)"}: ${r.numero_bl_house}`;
      if (Number(r.flete_total_prepaid) > 0) line += ` | Flete(O/F): ${r.flete_total_prepaid} ${r.moneda}`;
      if (Number(r.gastos_fob_total) > 0) line += ` | Gastos FOB: ${r.gastos_fob_total} ${r.moneda}`;
      if (r.incoterm) line += ` | Incoterm: ${r.incoterm}`;
      if (r.nave) line += ` | Nave: ${r.nave}`;
      if (r.contenedores) line += ` | Cntr: ${r.contenedores}`;
      if (r.verificado_shipsgo) line += ` ✓ShipsGo`;
      return line;
    });

    return `\n\nEJEMPLOS VERIFICADOS (corregidos/validados previamente — USA COMO REFERENCIA DE ALTA CONFIANZA):
${lines.join("\n")}
IMPORTANTE: Estos ejemplos fueron verificados manualmente o con ShipsGo. Si el BL actual es de la misma naviera, SIGUE el mismo formato de número, clasificación master/house, y separación flete/gastos FOB. Los marcados con ✓ShipsGo tienen contenedores y datos confirmados por la naviera.`;
  } catch (err) {
    console.error("[bl-ejemplos] Error obteniendo ejemplos:", err instanceof Error ? err.message : err);
    return "";
  }
}
