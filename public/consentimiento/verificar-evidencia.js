'use strict';

/**
 * VERIFICADOR INDEPENDIENTE de un paquete de evidencia.
 *
 * Este script NO usa la base de datos ni el código de la aplicación: solo
 * Node.js estándar (módulo crypto). Un auditor puede leerlo en 5 minutos,
 * convencerse de que no hace trampa, y ejecutarlo sobre el JSON entregado.
 *
 * Uso:
 *   node verificar-evidencia.js evidencia-CONS-2026-XXXX.json
 *
 * Comprueba:
 *  1) El sello de integridad del consentimiento (no fue alterado).
 *  2) Que la cadena reproduce sus hashes y está bien encadenada.
 *  3) Que la cabeza de la cadena coincide con lo sellado en Bitcoin.
 *
 * El paso final (que ese hash esté realmente en Bitcoin en cierta fecha) se
 * comprueba con el cliente oficial: ots verify <folio>.ots
 */

const fs = require('fs');
const crypto = require('crypto');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function ok(m) { console.log('  ✅ ' + m); }
function fail(m) { console.log('  ⛔ ' + m); }
function head(t) { console.log('\n' + t); console.log('─'.repeat(60)); }

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: node verificar-evidencia.js <paquete.json>');
  process.exit(1);
}

const p = JSON.parse(fs.readFileSync(archivo, 'utf8'));
let errores = 0;

head('1) SELLO DE INTEGRIDAD DEL CONSENTIMIENTO');
const c = p.consentimiento;
const formula = `${c.folio}|${c.titular_rut}|${JSON.stringify(c.finalidades)}|${c.texto_version}`;
const recalculado = sha256(formula);
console.log('  Fórmula:', p.meta.formatoContenido);
if (recalculado === c.contenido_hash_guardado) {
  ok('El contenido NO fue alterado tras otorgarse.');
} else {
  fail('El sello NO coincide: el contenido fue modificado.');
  console.log('     guardado   :', c.contenido_hash_guardado);
  console.log('     recalculado:', recalculado);
  errores++;
}

head('2) INTEGRIDAD DE LA CADENA (hash-chain)');
const seg = (p.cadena && p.cadena.segmento_hasta_cabeza_sellada) || [];
if (seg.length === 0) {
  console.log('  (Sin segmento de cadena: el consentimiento aún no fue sellado.)');
} else {
  const GENESIS = '0'.repeat(64);
  let prev = GENESIS;
  let cadenaOk = true;
  for (const b of seg) {
    const payload = [b.indice, b.evento, b.folio || '', b.contenido_hash || '', b.datos_json || '', b.prev_hash, b.creado_en].join('|');
    const h = sha256(payload);
    if (b.prev_hash !== prev) { fail(`Bloque #${b.indice}: prev_hash no enlaza con el anterior.`); cadenaOk = false; errores++; break; }
    if (h !== b.hash) { fail(`Bloque #${b.indice}: hash recalculado no coincide (alterado).`); cadenaOk = false; errores++; break; }
    prev = b.hash;
  }
  if (cadenaOk) ok(`Cadena íntegra: ${seg.length} bloque(s) reproducen sus hashes y enlazan correctamente.`);

  head('3) ENLACE CON BITCOIN');
  const cabezaCalculada = seg[seg.length - 1].hash;
  if (p.bitcoin && p.bitcoin.cabeza_hash) {
    if (cabezaCalculada === p.bitcoin.cabeza_hash) {
      ok('La cabeza recomputada coincide con el hash sellado en Bitcoin.');
      console.log('     cabeza_hash:', p.bitcoin.cabeza_hash);
      if (p.bitcoin.btc_height) {
        console.log(`     Bitcoin: bloque ${p.bitcoin.btc_height} (${new Date(p.bitcoin.btc_timestamp * 1000).toISOString()})`);
      } else {
        console.log('     Estado: ' + p.bitcoin.estado + ' (usa "ots verify" para confirmar en Bitcoin).');
      }
    } else {
      fail('La cabeza recomputada NO coincide con el hash sellado en Bitcoin.');
      errores++;
    }
  } else {
    console.log('  (Sin anclaje en Bitcoin todavía.)');
  }
}

head('RESULTADO');
if (errores === 0) {
  console.log('  ✅ EVIDENCIA CONSISTENTE.');
  console.log('  Paso final independiente: ejecuta');
  console.log(`     ots verify ${c.folio}.ots`);
  console.log('  y confirma el bloque Bitcoin en https://blockstream.info');
  process.exit(0);
} else {
  console.log(`  ⛔ SE DETECTARON ${errores} PROBLEMA(S). La evidencia no es consistente.`);
  process.exit(2);
}
