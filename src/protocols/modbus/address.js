'use strict';
/**
 * Modbus-Adresse eines Operanden – genau so, wie easySoft sie in die .itf-Datei schreibt.
 * Damit liest easy4Visu ohne .itf-Datei dieselben Register wie mit (geprüft an den Exporten des
 * NET-Tests vom 24.10.2026, siehe docs/ITF-FORMAT.md und test/modbus-address.test.js).
 *
 *   modbusAddress({ type: 'MW', index: 3 }, FW.V240) -> { modbus: { area: 'holding', fcRead: 3, register: 46003, words: 1 }, type: 'WORD' }
 *
 * Firmware-Stufen (map.FW): V240 = ab 2.40, V140 = 1.40 bis 2.3x, OLD = älter.
 *   Merker:       MW n = 46000 + n (ab 2.40) bzw. 1000 + n; M, MB als Bits/Bytes darin, MD n = Basis + 2n − 1
 *   NET-Merker:   immer ab 2001 (NW n = 2000 + n), N und NB als Bits/Bytes darin, ND n = 2000 + 2n − 1
 *   E/As:         I n = Discrete Input n, Q n = Coil n, ID n = Discrete Input 3000 + n
 *   Analog:       IA n = Input Register 42001 + 2(n − 1) (ab 2.40) bzw. 6501 + …, QA n = 40001 + … bzw. 6001 + …
 *                 ältere FW: 16 Bit, Register n
 *   Uhr:          Register 5000..5005 (Sekunde, Minute, Stunde, Tag, Monat, Jahr)
 */

const MAP = require('./map');

const { FW } = MAP;

function fail(key, args) {
  const e = new Error(key);
  e.e4 = { key, args: args || {} };
  return e;
}

function checkIndex(type, n, fw) {
  const max = MAP.maxIndex(type, fw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw fail(max < MAP.OPS[type].max ? 'indexRangeFw' : 'indexRange', { what: type, max });
  }
}

/** Basisregister der Merker- bzw. NET-Merkerwörter (Register von Wort 1 minus 1) */
function wordBase(type, fw) {
  return /^N/.test(type) ? 2000 : (fw >= FW.V240 ? 46000 : 1000);
}

/**
 * @param op  { type, index } – type in easySoft-Schreibweise (I, Q, IA, QA, ID, M, MB, MW, MD, N, NB, NW, ND, CLOCK)
 * @param fw  Firmware-Stufe aus map.fwLevel()
 * @returns   { modbus, type } – modbus im Format von src/import/itf.js, type wie in der .itf (BIT, BYTE, WORD, LINT)
 */
function modbusAddress(op, fw) {
  const { type, index: n } = op;
  if (type === 'CLOCK') {
    if (!Number.isInteger(n) || n < 0 || n > 5) throw fail('badOperand', { text: `CLOCK.${n}` });
    return { modbus: { area: 'holding', fcRead: 3, register: 5000 + n, words: 1 }, type: 'WORD' };
  }
  if (type === 'SN' || type === 'RN') throw fail('device.errors.noModbus', { name: `${type}${n}` });
  if (!MAP.OPS[type]) throw fail('unknownType', { type });
  checkIndex(type, n, fw);
  switch (type) {
    case 'I': return { modbus: { area: 'discrete', fcRead: 2, address: n }, type: 'BIT' };
    case 'Q': return { modbus: { area: 'coil', fcRead: 1, address: n }, type: 'BIT' };
    case 'ID': return { modbus: { area: 'discrete', fcRead: 2, address: 3000 + n }, type: 'BIT' };
    case 'M': case 'N': {
      const base = wordBase(type, fw);
      return { modbus: { area: 'holding', fcRead: 3, register: base + Math.ceil(n / 16), bit: (n - 1) % 16, bits: 1 }, type: 'BIT' };
    }
    case 'MB': case 'NB': {
      const base = wordBase(type, fw);
      return { modbus: { area: 'holding', fcRead: 3, register: base + Math.ceil(n / 2), bit: n % 2 === 0 ? 8 : 0, bits: 8 }, type: 'BYTE' };
    }
    case 'MW': case 'NW':
      return { modbus: { area: 'holding', fcRead: 3, register: wordBase(type, fw) + n, words: 1 }, type: 'WORD' };
    case 'MD': case 'ND':
      return { modbus: { area: 'holding', fcRead: 3, register: wordBase(type, fw) + 2 * n - 1, words: 2, wordOrder: 'low-first' }, type: 'LINT' };
    case 'IA': case 'QA': {
      if (fw === FW.OLD) {
        // ältere Firmware: 16 Bit mit Vorzeichen; QA als Holding Register (Eaton-Map, nicht am Gerät geprüft)
        return type === 'IA'
          ? { modbus: { area: 'input', fcRead: 4, register: n, words: 1 }, type: 'INT' }
          : { modbus: { area: 'holding', fcRead: 3, register: n, words: 1 }, type: 'INT' };
      }
      const base = fw >= FW.V240 ? (type === 'IA' ? 42000 : 40000) : (type === 'IA' ? 6500 : 6000);
      // QA: easySoft exportiert "RI" (FC4); am Gerät gehen FC3 und FC4 (FW 2.46, 24.10.2026)
      return { modbus: { area: 'input', fcRead: 4, register: base + 2 * n - 1, words: 2, wordOrder: 'low-first' }, type: 'LINT' };
    }
  }
  throw fail('unknownType', { type });
}

module.exports = { modbusAddress };
