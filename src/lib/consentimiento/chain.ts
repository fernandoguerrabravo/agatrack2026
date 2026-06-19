import "server-only";
import crypto from "crypto";
import { pgQuery } from "../postgres";

const GENESIS_PREV = "0".repeat(64);

function hashBloque(b: { indice: number; evento: string; folio: string | null; contenido_hash: string | null; datos_json: string | null; prev_hash: string; creado_en: string }): string {
  const payload = [b.indice, b.evento, b.folio || "", b.contenido_hash || "", b.datos_json || "", b.prev_hash, b.creado_en].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export async function anclar({ evento, folio, contenidoHash, datos }: { evento: string; folio?: string | null; contenidoHash?: string | null; datos?: Record<string, unknown> | null }) {
  // Get last block
  const lastRows = await pgQuery<{ indice: number; hash: string }>("SELECT indice, hash FROM cadena ORDER BY indice DESC LIMIT 1");
  const last = lastRows[0];
  const prevHash = last ? last.hash : GENESIS_PREV;
  const indice = last ? last.indice + 1 : 1;
  const creadoEn = new Date().toISOString();
  const datosJson = datos ? JSON.stringify(datos) : null;

  const base = { indice, evento, folio: folio || null, contenido_hash: contenidoHash || null, datos_json: datosJson, prev_hash: prevHash, creado_en: creadoEn };
  const hash = hashBloque(base);

  await pgQuery(
    "INSERT INTO cadena (indice, evento, folio, contenido_hash, datos_json, prev_hash, hash, creado_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [indice, evento, folio || null, contenidoHash || null, datosJson, prevHash, hash, creadoEn]
  );

  return { indice, evento, folio, contenidoHash, prevHash, hash, creadoEn };
}

export async function verificarCadena(): Promise<{ valido: boolean; longitud: number; error?: string; indiceRoto?: number }> {
  const bloques = await pgQuery<{ indice: number; evento: string; folio: string; contenido_hash: string; datos_json: string; prev_hash: string; hash: string; creado_en: string }>(
    "SELECT * FROM cadena ORDER BY indice ASC"
  );
  let prevHash = GENESIS_PREV;
  for (const b of bloques) {
    if (b.prev_hash !== prevHash) {
      return { valido: false, longitud: bloques.length, indiceRoto: b.indice, error: "Enlace prev_hash roto" };
    }
    const recomputado = hashBloque(b);
    if (recomputado !== b.hash) {
      return { valido: false, longitud: bloques.length, indiceRoto: b.indice, error: "Hash de bloque alterado" };
    }
    prevHash = b.hash;
  }
  return { valido: true, longitud: bloques.length };
}

export async function historialFolio(folio: string) {
  return pgQuery("SELECT * FROM cadena WHERE folio = $1 ORDER BY indice ASC", [folio]);
}

export async function listarBloques(limit = 50) {
  return pgQuery("SELECT * FROM cadena ORDER BY indice DESC LIMIT $1", [limit]);
}
