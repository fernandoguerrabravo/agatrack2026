import "server-only";
import { pgQuery } from "../postgres";
import { sellar, actualizar, verificar as otsVerificar } from "./ots";
import { verificarCadena } from "./chain";

/**
 * Sella la cabeza actual de la cadena con OpenTimestamps (Bitcoin).
 */
export async function sellarCabeza(actor = "sistema") {
  const cabezaRows = await pgQuery<{ indice: number; hash: string }>("SELECT indice, hash FROM cadena ORDER BY indice DESC LIMIT 1");
  const cabeza = cabezaRows[0];
  if (!cabeza) throw new Error("Cadena vacía: no hay nada que sellar.");

  const otsB64 = await sellar(cabeza.hash);
  const ins = await pgQuery<{ id: number }>(
    "INSERT INTO anclajes_ots (cabeza_indice, cabeza_hash, ots_b64, estado) VALUES ($1,$2,$3,'pendiente') RETURNING id",
    [cabeza.indice, cabeza.hash, otsB64]
  );

  await pgQuery("INSERT INTO audit_log (accion, entidad, entidad_id, actor, detalle) VALUES ($1,$2,$3,$4,$5)",
    ["ots.sellado", "anclaje_ots", String(ins[0].id), actor, `cabeza_indice=${cabeza.indice}`]);

  return { id: ins[0].id, cabezaIndice: cabeza.indice, cabezaHash: cabeza.hash };
}

/**
 * Actualiza pruebas OTS pendientes (cuando Bitcoin confirma).
 */
export async function actualizarPendientes(actor = "sistema") {
  const pendientes = await pgQuery<{ id: number; cabeza_hash: string; ots_b64: string }>(
    "SELECT id, cabeza_hash, ots_b64 FROM anclajes_ots WHERE estado = 'pendiente'"
  );
  const resultados: Array<{ id: number; estado: string; height?: number }> = [];

  for (const p of pendientes) {
    try {
      const { cambiada, otsB64 } = await actualizar(p.ots_b64);
      if (cambiada) {
        let height: number | null = null;
        let ts: number | null = null;
        try {
          const v = await otsVerificar(p.cabeza_hash, otsB64);
          if (v && (v as Record<string, unknown>).bitcoin) {
            const btc = (v as Record<string, Record<string, number>>).bitcoin;
            height = btc.height || null;
            ts = btc.timestamp || null;
          }
        } catch {}

        if (height) {
          await pgQuery("UPDATE anclajes_ots SET estado='confirmado', btc_height=$1, btc_timestamp=$2, ots_b64=$3, confirmado_en=NOW() WHERE id=$4",
            [height, ts, otsB64, p.id]);
          resultados.push({ id: p.id, estado: "confirmado", height });
        } else {
          await pgQuery("UPDATE anclajes_ots SET ots_b64=$1 WHERE id=$2", [otsB64, p.id]);
          resultados.push({ id: p.id, estado: "actualizado" });
        }
      } else {
        resultados.push({ id: p.id, estado: "pendiente" });
      }
    } catch (err) {
      resultados.push({ id: p.id, estado: "error" });
    }
  }
  return resultados;
}

/**
 * Verifica un anclaje específico.
 */
export async function verificarAnclaje(id: number) {
  const rows = await pgQuery<Record<string, unknown>>("SELECT * FROM anclajes_ots WHERE id = $1", [id]);
  const a = rows[0];
  if (!a) return { existe: false };

  const bloqueRows = await pgQuery<{ indice: number }>("SELECT indice FROM cadena WHERE hash = $1", [a.cabeza_hash]);
  const cadenaIntegra = await verificarCadena();

  let bitcoin = null;
  try {
    const v = await otsVerificar(String(a.cabeza_hash), String(a.ots_b64));
    if (v && (v as Record<string, unknown>).bitcoin) bitcoin = (v as Record<string, unknown>).bitcoin;
  } catch {}

  return { existe: true, anclaje: a, cabezaEnCadena: bloqueRows.length > 0, cadenaIntegra, bitcoin };
}

/**
 * Lista todos los anclajes.
 */
export async function listarAnclajes() {
  return pgQuery("SELECT * FROM anclajes_ots ORDER BY id DESC");
}
