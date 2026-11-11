'use strict';
/**
 * Operanden der easyE4 in der Schreibweise von easySoft (siehe docs/ST-OPERANDEN.md).
 *
 *   parseOperand('MW3')   -> { net: null, type: 'MW', index: 3 }
 *   parseOperand('I01')   -> { net: null, type: 'I',  index: 1 }
 *   parseOperand('2NW3')  -> { net: 2,    type: 'NW', index: 3 }   NW3 von NET-Teilnehmer 2
 *   parseOperand('2SN01') -> { net: 2,    type: 'SN', index: 1 }   Sendebit an Teilnehmer 2
 *   parseOperand('CLOCK') -> { net: null, type: 'CLOCK', index: null }
 *
 * Gleichbedeutende Namen anderer Schnittstellen werden auf die easySoft-Namen gebracht:
 * AI -> IA, AO -> QA, O -> Q (JSON-API), UHR/RTC -> CLOCK.
 */

const ALIASES = { AI: 'IA', AO: 'QA', O: 'Q', UHR: 'CLOCK', RTC: 'CLOCK' };
const TYPES = ['I', 'Q', 'IA', 'QA', 'ID', 'M', 'MB', 'MW', 'MD', 'N', 'NB', 'NW', 'ND', 'SN', 'RN'];
const RE = /^([1-8])?(IA|QA|AI|AO|ID|MB|MW|MD|NB|NW|ND|SN|RN|I|Q|O|M|N)0*(\d+)$/;

/** Operanden-Arten, die schreibbar sind (Merker, NET-Merker des eigenen Geräts) */
const WRITABLE = new Set(['M', 'MB', 'MW', 'MD', 'N', 'NB', 'NW', 'ND']);
/** NET-Merker: können zu einem anderen NET-Teilnehmer gehören */
const NET_TYPES = new Set(['N', 'NB', 'NW', 'ND']);

/**
 * Gerätetasten P1 … P8 (Display-Tasten der easyE4: P1 = <, P2 = ∧, P3 = >, P4 = ∨, P5 = OK, P6 = ESC, P7 = DEL, P8 = ALT).
 * Gültige easySoft-Operanden, aber (noch) keine Variablen der Visu – ob sie über Modbus, Webserver oder MQTT lesbar
 * sind, ist nicht geprüft. Beim Einlesen werden sie ohne Warnung übergangen.
 */
const isDeviceKey = (text) => /^([1-8])?P0*[1-8]$/.test(String(text === undefined || text === null ? '' : text).trim().toUpperCase().replace(/s+/g, ''));

function normType(t) {
  const u = String(t || '').trim().toUpperCase();
  return ALIASES[u] || u;
}

function parseOperand(text) {
  const s = String(text === undefined || text === null ? '' : text).trim().toUpperCase().replace(/\s+/g, '');
  if (/^(CLOCK|UHR|RTC)$/.test(s)) return { net: null, type: 'CLOCK', index: null };
  const m = RE.exec(s);
  if (!m) return null;
  return { net: m[1] ? Number(m[1]) : null, type: normType(m[2]), index: parseInt(m[3], 10) };
}

/**
 * Operand einer Variablen. Reihenfolge: operand + index (Import), sonst operand oder name als Text.
 * net: NET-ID des Teilnehmers, dem der Operand gehört (null = das Gerät selbst).
 * Uhr aus der .itf: operand 'CLOCK', index 0..5 = Sekunde, Minute, Stunde, Tag, Monat, Jahr.
 */
function operandOf(v) {
  const net = Number.isInteger(v.net) ? v.net : null;
  if (v.operand) {
    const type = normType(v.operand);
    if (type === 'CLOCK') return { net: null, type, index: Number.isInteger(v.index) ? v.index : null };
    if (Number.isInteger(v.index) && TYPES.includes(type)) return { net, type, index: v.index };
  }
  const p = parseOperand(v.operand || v.name);
  if (p && p.net === null && net !== null) p.net = net;
  return p;
}

module.exports = { parseOperand, operandOf, normType, isDeviceKey, TYPES, WRITABLE, NET_TYPES };
