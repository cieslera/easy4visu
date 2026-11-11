'use strict';
/**
 * Skalierung einer Variablen: Rohwert aus der easyE4 -> Wert in der Einheit (linear über zwei Punkte).
 * Gespeichert an der Variablen als userScale = { raw0, val0, raw1, val1 } und userDecimals (Nachkommastellen).
 * Beispiel Drucksensor: Rohwert 0 = 0 bar, Rohwert 1000 = 5 bar.
 * Gespeichert, aufgezeichnet und geschrieben wird immer der Rohwert; umgerechnet wird nur für Anzeige und Eingabe.
 */

const num = (x) => (x === null || x === undefined || x === '' ? NaN : Number(String(x).replace(',', '.')));

/** gültige Skalierung { raw0, val0, raw1, val1 } oder null (fehlt, unvollständig oder raw0 = raw1) */
function cleanScale(s) {
  if (!s || typeof s !== 'object') return null;
  const o = { raw0: num(s.raw0), val0: num(s.val0), raw1: num(s.raw1), val1: num(s.val1) };
  if (!Object.values(o).every(Number.isFinite) || o.raw0 === o.raw1) return null;
  return o;
}

/** Nachkommastellen 0 … 6 oder undefined */
function cleanDecimals(d) {
  const n = num(d);
  return Number.isFinite(n) ? Math.max(0, Math.min(6, Math.round(n))) : undefined;
}

/** Umrechnung einer Variablen oder null (Bit-Variablen und Uhr nie) */
function scaleOf(v) {
  if (!v || String(v.type).toUpperCase() === 'BIT' || v.operand === 'CLOCK') return null;
  return cleanScale(v.userScale);
}

/** Rohwert -> Wert (auf 6 Stellen gerundet, damit keine 0,30000000000000004 entstehen) */
function toValue(s, raw) {
  if (!s || typeof raw !== 'number' || !Number.isFinite(raw)) return raw;
  const v = s.val0 + ((raw - s.raw0) * (s.val1 - s.val0)) / (s.raw1 - s.raw0);
  return Math.round(v * 1e6) / 1e6;
}

/** Wert -> Rohwert (ganze Zahl, die easyE4 kennt nur ganze Zahlen) */
function toRaw(s, value) {
  const n = num(value);
  if (!s || !Number.isFinite(n)) return value;
  if (s.val1 === s.val0) return Math.round(s.raw0);
  return Math.round(s.raw0 + ((n - s.val0) * (s.raw1 - s.raw0)) / (s.val1 - s.val0));
}

module.exports = { cleanScale, cleanDecimals, scaleOf, toValue, toRaw };
