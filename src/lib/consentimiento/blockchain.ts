import "server-only";
import crypto from "crypto";
import { pgQuery } from "@/lib/postgres";

const GENESIS_PREV = "0".repeat(64);

interface BloqueBase {
  indice: number;
  evento: string;
  folio: string | null;
  contenido_hash: string | null;
  datos_json: string | null;
  prev_hash: string;
  creado_en: string;
}

function hashBloque(b: BloqueBase): string {
  const payload = [
    b.indice,
    b.evento,
    b.folio || "",
    b.contenido_hash || "",
    b.datos_json || "",
    b.prev_hash,
    b.creado_en,
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export interface AnclarParams {
  evento: string;
  folio?: string;
  contenidoHash?: string;
  datos?: Record<string, unknown>;
}

export interface BloqueResult {
  indice: number;
  hash: string;
  prevHash: string;
  creadoEn: string;
}

export async function anclar(params: AnclarParams): Promise<BloqueResult> {
  const lastRows = await pgQuery<{ indice: number; hash: string }>(
    "SELECT indice, hash FROM cadena ORDER BY indice DESC LIMIT 1"
  );
  const last = lastRows[0];
  const prevHash = last ? last.hash : GENESIS_PREV;
  const indice = last ? last.indice + 1 : 1;
  const creadoEn = new Date().toISOString();
  const datosJson = params.datos ? JSON.stringify(params.datos) : null;

  const base: BloqueBase = {
    indice,
    evento: params.evento,
    folio: params.folio || null,
    contenido_hash: params.contenidoHash || null,
    datos_json: datosJson,
    prev_hash: prevHash,
    creado_en: creadoEn,
  };
  const hash = hashBloque(base);

  await pgQuery(
    `INSERT INTO cadena (indice, evento, folio, contenido_hash, datos_json, prev_hash, hash, creado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      indice,
      params.evento,
      params.folio || null,
      params.contenidoHash || null,
      datosJson,
      prevHash,
      hash,
      creadoEn,
    ]
  );

  return { indice, hash, prevHash, creadoEn };
}

export interface VerificacionResult {
  valido: boolean;
  longitud: number;
  error?: string;
}

export async function verificarCadena(): Promise<VerificacionResult> {
  const bloques = await pgQuery<BloqueBase & { hash: string }>(
    "SELECT * FROM cadena ORDER BY indice ASC"
  );
  let prevHash = GENESIS_PREV;
  for (const b of bloques) {
    if (b.prev_hash !== prevHash) {
      return {
        valido: false,
        longitud: bloques.length,
        error: `Enlace roto en bloque ${b.indice}`,
      };
    }
    const recomputado = hashBloque(b);
    if (recomputado !== b.hash) {
      return {
        valido: false,
        longitud: bloques.length,
        error: `Hash alterado en bloque ${b.indice}`,
      };
    }
    prevHash = b.hash;
  }
  return { valido: true, longitud: bloques.length };
}

export async function historialFolio(folio: string) {
  return pgQuery(
    "SELECT * FROM cadena WHERE folio = $1 ORDER BY indice ASC",
    [folio]
  );
}
