'use strict';
/**
 * Variablen (Format siehe docs/VARIABLEN.md) -> Elemente der JSON-API.
 *
 * Die JSON-API kennt die Operanden unter etwas anderen Namen: Q = O, IA = AI, QA = AO.
 * Mehrere Variablen desselben Typs werden zu Bereichen zusammengefasst, z. B. MW3, MW5, MW6 -> MW(3,6).
 * So bleiben es wenige Anfragen – der Webserver der easyE4 soll geschont werden.
 * Die Uhr (CLOCK bzw. CLOCK.0..5 aus der .itf-Datei) wird über DATE und TIME gelesen.
 */

const L = require('./lib');
const { keyOf } = require('../driver');
const { operandOf } = require('../operand');

const JSON_NAMES = { Q: 'O', IA: 'AI', QA: 'AO' };
const CLOCK_FIELDS = ['second', 'minute', 'hour', 'day', 'month', 'year']; // Reihenfolge wie Register 5000..5005

// Zusammenfassen: höchstens so große Lücken und so lange Bereiche
const MAX_GAP = { bit: 8, other: 4 };
const MAX_SPAN = { bit: 128, other: 32 };

function fail(key, args) {
  const e = new Error(key);
  e.e4 = { key, args: args || {} };
  return e;
}

/**
 * Ziel einer Variablen: { type, index, net } (type im JSON-Namen) oder { clock: Feldnummer | null }.
 * NET-Merker anderer Teilnehmer (2NW3) liest die JSON-API direkt: NW(2;3). Andere Operanden fremder
 * Teilnehmer gehen nicht.
 */
function targetOf(v) {
  const op = operandOf(v);
  if (!op) throw fail('device.errors.noAddress', { name: v.name });
  if (op.type === 'CLOCK') return { clock: op.index };
  const type = L.apiType(JSON_NAMES[op.type] || op.type);
  const def = L.OPS[type];
  if (!def) throw fail('unknownType', { type: op.type });
  if (op.net !== null && !def.net) throw fail('device.errors.otherNet', { name: v.name, net: op.net });
  return { type, index: op.index, net: def.net ? (op.net === null ? 0 : op.net) : undefined };
}

/**
 * Leseplan: { elements, items } – items: [{ key, target, element }]
 * Ungültige Variablen landen in errors: [{ name, err }].
 */
function planRead(variables, opts) {
  const singles = !!(opts && opts.singles);
  const items = [];
  const errors = [];
  const groups = new Map();
  let clock = null;
  for (const v of variables) {
    const key = keyOf(v);
    let target;
    try {
      target = targetOf(v);
      if (target.type) L.single(target.type, target.index, target.net); // prüft Nummer und NET-ID
    } catch (err) {
      errors.push({ name: key, err });
      continue;
    }
    const item = { key, target };
    items.push(item);
    if (!target.type) {
      clock = clock || [L.sys('DATE'), L.sys('TIME')];
      item.elements = clock;
      continue;
    }
    const g = `${target.type}|${target.net}`;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(item);
  }

  const elements = clock ? clock.slice() : [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.target.index - b.target.index);
    const { type, net } = list[0].target;
    const kind = L.OPS[type].width === 'bit' ? 'bit' : 'other';
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const first = run[0].target.index;
      const last = run[run.length - 1].target.index;
      const e = first === last ? L.single(type, first, net) : L.range(type, first, last, net);
      elements.push(e);
      run.forEach((it) => { it.elements = [e]; });
      run = [];
    };
    for (const it of list) {
      const i = it.target.index;
      if (run.length) {
        const first = run[0].target.index;
        const last = run[run.length - 1].target.index;
        if (singles || i - last > MAX_GAP[kind] || i - first + 1 > MAX_SPAN[kind]) flush();
      }
      run.push(it);
    }
    flush();
  }
  return { elements, items, errors };
}

/** Uhr aus DATE ("2026-10-18" oder "18.10.2026") und TIME ("11:00:00") */
function parseClock(values) {
  const d = String(values.DATE === undefined ? '' : values.DATE).match(/\d+/g);
  const t = String(values.TIME === undefined ? '' : values.TIME).match(/\d+/g);
  if (!d || d.length < 3 || !t || t.length < 2) return undefined;
  const [a, b, c] = d.map(Number);
  const ymd = a > 31 ? { year: a, month: b, day: c } : { year: c, month: b, day: a };
  if (ymd.year < 100) ymd.year += 2000;
  return Object.assign(ymd, { hour: Number(t[0]), minute: Number(t[1]), second: t[2] !== undefined ? Number(t[2]) : 0 });
}

/** Wert einer Variablen aus der ausgewerteten Antwort; undefined = nicht enthalten */
function pickValue(item, parsed) {
  const tg = item.target;
  if (!tg.type) {
    const c = parseClock(parsed.values);
    if (!c || tg.clock === null || tg.clock === undefined) return c;
    return c[CLOCK_FIELDS[tg.clock]];
  }
  return parsed.values[L.keyOf(tg.type, tg.index, tg.net)];
}

/** Fehlercode der easyE4 für diese Variable (aus parsed.errors), sonst undefined */
function errorCode(item, parsed) {
  const tg = item.target;
  if (!tg.type) return undefined;
  const single = L.keyOf(tg.type, tg.index, tg.net);
  for (const x of parsed.errors) {
    if (x.key === single) return x.code;
    // Bereichsfehler: Schlüssel "MW3-8" bzw. "N(0;1)-8" (Anfang-Ende)
    const m = /^(.*\D)(\d+)(\)?)-(\d+)$/.exec(x.key);
    if (!m) continue;
    const start = Number(m[2]);
    if (m[1] + m[2] + m[3] === L.keyOf(tg.type, start, tg.net) && tg.index >= start && tg.index <= Number(m[4])) return x.code;
  }
  return undefined;
}

/** Schreibpfad für eine Variable */
function writePath(v, value) {
  if (v.writable === false) throw fail('device.errors.notWritable', { name: v.name });
  const tg = targetOf(v);
  if (!tg.type) throw fail('device.errors.notWritable', { name: v.name });
  return { path: L.writeOperandPath(tg.type, tg.index, tg.net, value), key: L.keyOf(tg.type, tg.index, tg.net) };
}

module.exports = { targetOf, planRead, pickValue, errorCode, parseClock, writePath, CLOCK_FIELDS };
