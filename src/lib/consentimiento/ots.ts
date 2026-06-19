import "server-only";

/**
 * OpenTimestamps: Sellado de tiempo anclado a Bitcoin.
 * Solo se envía un hash SHA-256 a los servidores calendario (nunca datos personales).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpenTimestamps = require("opentimestamps");

function detachedDesdeHash(hashHex: string) {
  const buf = Buffer.from(hashHex, "hex");
  if (buf.length !== 32) throw new Error("El hash debe ser SHA-256 (32 bytes).");
  return OpenTimestamps.DetachedTimestampFile.fromHash(new OpenTimestamps.Ops.OpSHA256(), buf);
}

/** Crea prueba de sellado. Devuelve .ots en base64. */
export async function sellar(hashHex: string): Promise<string> {
  const detached = detachedDesdeHash(hashHex);
  await OpenTimestamps.stamp(detached);
  const bytes = detached.serializeToBytes();
  return Buffer.from(bytes).toString("base64");
}

/** Intenta actualizar una prueba pendiente (cuando Bitcoin confirma). */
export async function actualizar(otsB64: string): Promise<{ cambiada: boolean; otsB64: string }> {
  const otsBytes = Buffer.from(otsB64, "base64");
  const detached = OpenTimestamps.DetachedTimestampFile.deserialize(otsBytes);
  const cambiada = await OpenTimestamps.upgrade(detached);
  return {
    cambiada: Boolean(cambiada),
    otsB64: cambiada ? Buffer.from(detached.serializeToBytes()).toString("base64") : otsB64,
  };
}

/** Verifica una prueba contra el hash original. */
export async function verificar(hashHex: string, otsB64: string): Promise<Record<string, unknown>> {
  const detached = detachedDesdeHash(hashHex);
  const detachedOts = OpenTimestamps.DetachedTimestampFile.deserialize(Buffer.from(otsB64, "base64"));
  const resultado = await OpenTimestamps.verify(detachedOts, detached, { ignoreBitcoinNode: true, timeout: 5000 });
  return resultado || {};
}

/** Info legible de una prueba. */
export function info(otsB64: string): string {
  const detached = OpenTimestamps.DetachedTimestampFile.deserialize(Buffer.from(otsB64, "base64"));
  return OpenTimestamps.info(detached);
}
