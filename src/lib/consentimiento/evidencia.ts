import "server-only";
import crypto from "crypto";
import { pgQuery } from "../postgres";
import { obtenerConsentimiento } from "./index";
import { historialFolio, verificarCadena } from "./chain";

/**
 * Genera paquete de evidencia judicial para un consentimiento.
 * Contiene toda la información necesaria para probar ante un juez
 * que el consentimiento fue otorgado/revocado de manera verificable.
 */
export async function generarEvidencia(folio: string) {
  const c = await obtenerConsentimiento(folio);
  if (!c) return null;

  const eventos = await historialFolio(folio);
  if (eventos.length === 0) return null;

  const bloqueOtorgado = eventos.find((e: Record<string, unknown>) => e.evento === "consentimiento.otorgado") || eventos[0];

  // Buscar anclaje OTS que cubre ese bloque
  const anclajes = await pgQuery<Record<string, unknown>>("SELECT * FROM anclajes_ots ORDER BY cabeza_indice ASC");
  const anclaje = anclajes.find((a: Record<string, unknown>) => Number(a.cabeza_indice) >= Number((bloqueOtorgado as Record<string, unknown>).indice)) || null;

  // Segmento de cadena hasta la cabeza sellada
  let segmento: unknown[] = [];
  if (anclaje) {
    segmento = await pgQuery("SELECT indice, evento, folio, contenido_hash, datos_json, prev_hash, hash, creado_en FROM cadena WHERE indice <= $1 ORDER BY indice ASC", [anclaje.cabeza_indice]);
  }

  // Recalcular hash del contenido para verificación
  const formulaContenido = `${c.folio}|${c.rut}|${JSON.stringify(c.finalidades)}|${c.textoVersion}`;
  const contenidoHashRecalculado = crypto.createHash("sha256").update(formulaContenido).digest("hex");

  // Prueba OTS del consentimiento individual
  const consRows = await pgQuery<{ ots_proof: string; ots_status: string }>(
    "SELECT ots_proof, ots_status FROM consentimientos WHERE folio = $1", [folio]
  );
  const otsProof = consRows[0]?.ots_proof || null;
  const otsStatus = consRows[0]?.ots_status || null;

  // Audit trail
  const auditTrail = await pgQuery(
    "SELECT accion, entidad, entidad_id, actor, detalle, ip_hash, created_at FROM audit_log WHERE entidad_id = $1 ORDER BY id ASC",
    [folio]
  );

  return {
    meta: {
      generadoEn: new Date().toISOString(),
      version: "1.0",
      esquemaHash: "SHA-256",
      formatoCadena: "indice|evento|folio|contenido_hash|datos_json|prev_hash|creado_en",
      formatoContenido: "folio|rut|finalidades_json|texto_version",
      ley: "Ley 21.719 de Protección de Datos Personales (Chile)",
    },
    consentimiento: {
      folio: c.folio,
      titular_nombre: c.nombre,
      titular_rut: c.rut,
      titular_email: c.email,
      finalidades: c.finalidades,
      texto_version: c.textoVersion,
      estado: c.estado,
      otorgado_en: c.otorgadoEn,
      revocado_en: c.revocadoEn,
      contenido_hash_guardado: c.contenidoHash,
      contenido_hash_recalculado: contenidoHashRecalculado,
      contenido_coincide: contenidoHashRecalculado === c.contenidoHash,
    },
    cadena: {
      bloque_del_consentimiento: bloqueOtorgado,
      todos_los_eventos_del_folio: eventos,
      segmento_hasta_cabeza_sellada: segmento,
      integridad: await verificarCadena(),
    },
    bitcoin: anclaje
      ? {
          cabeza_indice: anclaje.cabeza_indice,
          cabeza_hash: anclaje.cabeza_hash,
          estado: anclaje.estado,
          btc_height: anclaje.btc_height,
          btc_timestamp: anclaje.btc_timestamp,
          prueba_ots_base64: anclaje.ots_b64,
        }
      : { nota: "La cadena aún no ha sido sellada en Bitcoin para este bloque." },
    ots_individual: otsProof
      ? { estado: otsStatus, prueba_base64: otsProof }
      : { nota: "Sin prueba OTS individual." },
    auditoria: auditTrail,
    instrucciones_verificacion: {
      paso1: "Verificar que contenido_hash_recalculado === contenido_hash_guardado (integridad del contenido)",
      paso2: "Verificar que el bloque de la cadena contiene el contenido_hash y que su hash es correcto",
      paso3: "Verificar la integridad de toda la cadena (cada bloque enlaza al anterior via prev_hash)",
      paso4: "Si hay prueba Bitcoin: verificar el archivo .ots con opentimestamps-client contra el hash de cabeza",
      herramienta: "https://opentimestamps.org para verificación independiente del sellado Bitcoin",
    },
  };
}
