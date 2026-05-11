/**
 * Utilidades para validar y formatear RUT chileno.
 * Formato esperado: 12345678-9 o 12.345.678-9
 */

/**
 * Limpia un RUT removiendo puntos y espacios, dejando solo dígitos y guión + dígito verificador.
 * Ejemplo: "96.691.060-7" → "96691060-7"
 */
export function cleanRut(rut: string): string {
  return rut.replace(/\./g, "").replace(/\s/g, "").toUpperCase();
}

/**
 * Valida el formato y dígito verificador de un RUT chileno.
 * Acepta formatos: 96691060-7, 96.691.060-7
 */
export function isValidRut(raw: string): boolean {
  const rut = cleanRut(raw);

  // Formato: dígitos + guión + dígito verificador (0-9 o K)
  const match = rut.match(/^(\d{7,8})-([0-9K])$/);
  if (!match) return false;

  const body = match[1];
  const dv = match[2];

  return calculateDv(body) === dv;
}

/**
 * Calcula el dígito verificador de un RUT.
 */
function calculateDv(body: string): string {
  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);

  if (remainder === 11) return "0";
  if (remainder === 10) return "K";
  return remainder.toString();
}
