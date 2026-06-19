import "server-only";
import { pgQuery } from "../postgres";
import { encrypt, decrypt, blindIndex, sha256, generarFolio, generarFolioArsop } from "./crypto";
import { anclar } from "./chain";

const TEXTO_VERSION = "2026-06-ley-21719-v1";

// ────── CONSENTIMIENTOS ──────

export async function crearConsentimiento({ nombre, rut, email, finalidades, ipHash, userAgent }: {
  nombre: string; rut: string; email?: string; finalidades: string[]; ipHash?: string; userAgent?: string;
}) {
  const folio = generarFolio();
  const finalidadesJson = JSON.stringify(finalidades);
  const contenidoHash = sha256(`${folio}|${rut}|${finalidadesJson}|${TEXTO_VERSION}`);

  await pgQuery(
    `INSERT INTO consentimientos (folio, titular_nombre_enc, titular_rut_enc, titular_rut_idx, titular_email_enc, finalidades_json, texto_version, contenido_hash, estado, ip_hash, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'otorgado',$9,$10)`,
    [folio, encrypt(nombre), encrypt(rut), blindIndex(rut), email ? encrypt(email) : null, finalidadesJson, TEXTO_VERSION, contenidoHash, ipHash || null, userAgent?.slice(0, 255) || null]
  );

  const bloque = await anclar({ evento: "consentimiento.otorgado", folio, contenidoHash, datos: { finalidades, textoVersion: TEXTO_VERSION } });

  // Sellar con OpenTimestamps (Bitcoin) — async, no bloquea
  try {
    const { sellar } = await import("./ots");
    const otsProof = await sellar(contenidoHash);
    await pgQuery("UPDATE consentimientos SET ots_proof = $1, ots_status = 'pending' WHERE folio = $2", [otsProof, folio]);
  } catch (otsErr) {
    console.error("[consentimiento] Error OTS:", otsErr instanceof Error ? otsErr.message : otsErr);
  }

  return { folio, contenidoHash, textoVersion: TEXTO_VERSION, bloque };
}

export async function obtenerConsentimiento(folio: string) {
  const rows = await pgQuery<Record<string, string>>("SELECT * FROM consentimientos WHERE folio = $1", [folio]);
  return descifrarConsentimiento(rows[0]);
}

export async function listarConsentimientosPorRut(rut: string) {
  const rows = await pgQuery<Record<string, string>>("SELECT * FROM consentimientos WHERE titular_rut_idx = $1 ORDER BY id DESC", [blindIndex(rut)]);
  return rows.map(descifrarConsentimiento).filter(Boolean);
}

export async function consentimientoVigente(rut: string): Promise<boolean> {
  const rows = await pgQuery<{ id: number }>(
    "SELECT id FROM consentimientos WHERE titular_rut_idx = $1 AND estado = 'otorgado' LIMIT 1",
    [blindIndex(rut)]
  );
  return rows.length > 0;
}

export async function revocarConsentimiento(folio: string, rut: string): Promise<boolean> {
  const rows = await pgQuery<Record<string, string>>("SELECT * FROM consentimientos WHERE folio = $1", [folio]);
  if (!rows[0]) return false;
  if (rows[0].titular_rut_idx !== blindIndex(rut)) return false;
  const result = await pgQuery(
    "UPDATE consentimientos SET estado = 'revocado', revocado_en = NOW() WHERE folio = $1 AND estado = 'otorgado'",
    [folio]
  );
  if (result && (result as unknown as { rowCount: number }).rowCount > 0) {
    await anclar({ evento: "consentimiento.revocado", folio, contenidoHash: rows[0].contenido_hash });
    return true;
  }
  return false;
}

export async function listarConsentimientos(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const rows = await pgQuery<Record<string, string>>("SELECT * FROM consentimientos ORDER BY id DESC LIMIT $1 OFFSET $2", [pageSize, offset]);
  const countRows = await pgQuery<{ n: string }>("SELECT COUNT(*) AS n FROM consentimientos");
  return { items: rows.map(descifrarConsentimiento).filter(Boolean), total: parseInt(countRows[0].n, 10), page, pageSize };
}

function descifrarConsentimiento(row: Record<string, string> | null) {
  if (!row) return null;
  return {
    id: row.id, folio: row.folio,
    nombre: decrypt(row.titular_nombre_enc),
    rut: decrypt(row.titular_rut_enc),
    email: row.titular_email_enc ? decrypt(row.titular_email_enc) : null,
    finalidades: JSON.parse(row.finalidades_json),
    textoVersion: row.texto_version,
    contenidoHash: row.contenido_hash,
    estado: row.estado,
    otorgadoEn: row.otorgado_en,
    revocadoEn: row.revocado_en,
  };
}

// ────── ARSOP (Derechos del Titular) ──────

export const TIPOS_ARSOP: Record<string, string> = {
  acceso: "Derecho de Acceso",
  rectificacion: "Derecho de Rectificación",
  supresion: "Derecho de Supresión (Cancelación)",
  oposicion: "Derecho de Oposición",
  portabilidad: "Derecho de Portabilidad",
};

export async function crearArsop({ tipo, nombre, rut, email, detalle, ipHash }: {
  tipo: string; nombre: string; rut: string; email?: string; detalle?: string; ipHash?: string;
}) {
  const folio = generarFolioArsop();
  await pgQuery(
    `INSERT INTO arsop (folio, tipo, titular_nombre_enc, titular_rut_enc, titular_rut_idx, titular_email_enc, detalle, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [folio, tipo, encrypt(nombre), encrypt(rut), blindIndex(rut), email ? encrypt(email) : null, detalle || null, ipHash || null]
  );
  await anclar({ evento: "arsop.recibida", folio, datos: { tipo } });
  return { folio, tipo };
}

export async function listarArsop(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const rows = await pgQuery<Record<string, string>>("SELECT * FROM arsop ORDER BY id DESC LIMIT $1 OFFSET $2", [pageSize, offset]);
  const countRows = await pgQuery<{ n: string }>("SELECT COUNT(*) AS n FROM arsop");
  return { items: rows.map(descifrarArsop), total: parseInt(countRows[0].n, 10), page, pageSize };
}

export async function responderArsop(folio: string, respuesta: string) {
  await pgQuery("UPDATE arsop SET estado = 'respondida', respuesta = $1, respondido_en = NOW() WHERE folio = $2", [respuesta, folio]);
  await anclar({ evento: "arsop.respondida", folio, datos: { respuesta: respuesta.substring(0, 100) } });
}

function descifrarArsop(row: Record<string, string>) {
  return {
    id: row.id, folio: row.folio, tipo: row.tipo,
    tipoLabel: TIPOS_ARSOP[row.tipo] || row.tipo,
    nombre: decrypt(row.titular_nombre_enc),
    rut: decrypt(row.titular_rut_enc),
    email: row.titular_email_enc ? decrypt(row.titular_email_enc) : null,
    detalle: row.detalle, estado: row.estado,
    respuesta: row.respuesta, creadoEn: row.created_at, respondidoEn: row.respondido_en,
  };
}

// ────── AUDIT ──────

export async function auditLog({ accion, entidad, entidadId, actor, detalle, ipHash }: {
  accion: string; entidad?: string; entidadId?: string; actor?: string; detalle?: string; ipHash?: string;
}) {
  await pgQuery(
    "INSERT INTO audit_log (accion, entidad, entidad_id, actor, detalle, ip_hash) VALUES ($1,$2,$3,$4,$5,$6)",
    [accion, entidad || null, entidadId || null, actor || null, detalle || null, ipHash || null]
  );
}

export { TEXTO_VERSION };
export { verificarCadena, historialFolio, listarBloques } from "./chain";
