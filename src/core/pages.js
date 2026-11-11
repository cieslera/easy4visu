'use strict';
/**
 * Bedienseiten. Bis zum Editor (Stufe 3, Teil 3) erzeugt easy4Visu je Gerät eine Seite automatisch aus den
 * Variablen und ihren Vorschlägen (docs/DESIGN.md):
 *   Anzeige + Bit   -> Statusleuchte          Anzeige + Zahl   -> Zahlenwert (mit Einheit)
 *   Bedienung + Bit -> Schalter, bei „Impuls“ in der Bemerkung -> Taster (sendet nur die 1, Programm setzt zurück)
 *   Bedienung + Zahl -> Sollwert mit Plus/Minus (Grenzen aus der Bemerkung, z. B. „0 ... 5999 Sekunden“)
 * „intern“ erscheint nicht. Eigene Angaben (userRole, userLabel, userUnit) gehen vor.
 *
 * Seite: { deviceId, title, cards: [{ id, title, elements: [{ kind, name, label, unit, min, max, step, mode }] }] }
 */

const { t } = require('../i18n');
const { scaleOf, toValue } = require('./scale');

const LIMITS = { BYTE: [0, 255], SINT: [-128, 127], WORD: [0, 65535], INT: [-32768, 32767], LINT: [-2147483648, 2147483647],
  DINT: [-2147483648, 2147483647], DWORD: [0, 4294967295], UDINT: [0, 4294967295] };
const UNITS = { sekunden: 's', sekunde: 's', s: 's', ms: 'ms', minuten: 'min', min: 'min', '%': '%', v: 'V', mv: 'mV',
  ma: 'mA', '°c': '°C', grad: '°C', l: 'l', bar: 'bar', hz: 'Hz' };
const DISPLAY_OPERANDS = new Set(['I', 'Q', 'IA', 'QA', 'ID']);

const keyOf = (v) => (v.id !== undefined && v.id !== null ? String(v.id) : String(v.name));
const roleOf = (v) => v.userRole || v.role || null;

/** Name aus Symboltabelle, Programm oder von Hand – nicht nur der Operand (wie bei einer reinen .itf) */
function hasRealName(v) {
  if (v.userLabel) return true;
  if (String(v.operand).toUpperCase() === 'CLOCK') return false;
  const op = `${Number.isInteger(v.net) ? v.net : ''}${v.operand}${v.index}`.toUpperCase();
  return (v.sources || []).includes('comments') || String(v.name).toUpperCase() !== op ||
    !String(v.label || '').toUpperCase().endsWith(`${v.operand}${v.index}`.toUpperCase()); // automatisch: „Merkerwort MW3“
}

/** „0 ... 5999 Sekunden“ -> { min: 0, max: 5999, unit: 's' } */
function rangeFrom(text) {
  const m = /(-?\d+(?:[.,]\d+)?)\s*(?:\.\.\.|…|–|bis)\s*(-?\d+(?:[.,]\d+)?)\s*([A-Za-zÄÖÜäöü°%]+)?/.exec(String(text || ''));
  if (!m) return null;
  const num = (s) => Number(s.replace(',', '.'));
  const unit = m[3] ? UNITS[m[3].toLowerCase()] : undefined;
  return { min: num(m[1]), max: num(m[2]), unit };
}

function elementFor(v) {
  let role = roleOf(v);
  let unassigned = false;
  // Ein-/Ausgänge und Analogwerte ohne Vorschlag: anzeigen. Merker ohne Vorschlag: nur, wenn sie einen echten Namen
  // haben (Symboltabelle, Programm, von Hand) – dann in der Karte „Ohne Vorschlag“, nur zum Ansehen
  if (!role && DISPLAY_OPERANDS.has(String(v.operand).toUpperCase())) role = 'display';
  if (!role && hasRealName(v)) {
    role = 'display';
    unassigned = true;
  }
  if (role !== 'display' && role !== 'control') return null;
  if (unassigned) {
    if (v.operand === 'CLOCK') return null;
    return { name: keyOf(v), label: v.userLabel || v.label || v.name, unassigned: true,
      kind: v.type === 'BIT' ? 'lamp' : 'number', unit: v.userUnit || '' };
  }
  if (v.operand === 'CLOCK' && v.index !== null && v.index !== undefined) return null; // einzelne Uhrfelder
  const base = { name: keyOf(v), label: v.userLabel || v.label || v.name };
  const bit = v.type === 'BIT';
  const range = rangeFrom(v.comment);
  const unit = v.userUnit || (range && range.unit) || '';
  if (v.operand === 'CLOCK') return Object.assign(base, { kind: 'clock' });
  if (role === 'display' || !v.writable) return Object.assign(base, bit ? { kind: 'lamp' } : { kind: 'number', unit });
  if (bit) return Object.assign(base, /impuls/i.test(v.comment || '') ? { kind: 'button', mode: 'pulse' } : { kind: 'switch' });
  const lim = LIMITS[String(v.type).toUpperCase()] || LIMITS.WORD;
  return Object.assign(base, { kind: 'setpoint', unit, step: 1,
    min: range ? Math.max(range.min, lim[0]) : lim[0], max: range ? Math.min(range.max, lim[1]) : lim[1] });
}

/** Seite für ein Gerät */
function autoPage(device) {
  const vars = device.variables || [];
  const cards = { controls: [], states: [], values: [], unassigned: [] };
  for (const v of vars) {
    const e = elementFor(v);
    if (!e) continue;
    if (e.unassigned) cards.unassigned.push(e);
    else if (e.kind === 'lamp') cards.states.push(e);
    else if (e.kind === 'number' || e.kind === 'clock') cards.values.push(e);
    else cards.controls.push(e);
  }
  return {
    deviceId: device.id,
    title: device.name,
    auto: true,
    unassignedCount: cards.unassigned.length,
    cards: Object.entries(cards).filter(([, list]) => list.length)
      .map(([id, elements]) => ({ id, title: t(`ui.page.cards.${id}`), elements })),
  };
}

// ---------------------------------------------------------------- selbst erstellte Seiten (Editor)

const isBit = (v) => v.type === 'BIT';
// Betriebsart: Standard-Knöpfe (Text aus der Sprachdatei)
const CHOICE_OPTS = [{ v: 0, k: 'off' }, { v: 1, k: 'manual' }, { v: 2, k: 'auto' }];
const isClockAll = (v) => v.operand === 'CLOCK' && (v.index === null || v.index === undefined);
const canWrite = (v) => !!v.writable && !DISPLAY_OPERANDS.has(String(v.operand).toUpperCase());

/** Darstellungen, die zu einer Variablen passen (bedienbare nur, wenn sie schreibbar ist) */
function kindsFor(v) {
  if (isClockAll(v)) return ['clock'];
  // ein Teil der Uhr (CLOCK.0 … CLOCK.5 aus der .itf): als Uhr zeigt das Element die ganze Uhr des Geräts
  if (v.operand === 'CLOCK') return ['clock', 'number'];
  if (isBit(v)) return canWrite(v) ? ['lamp', 'status', 'switch', 'button'] : ['lamp', 'status'];
  return canWrite(v) ? ['number', 'kpi', 'status', 'bar', 'gauge', 'setpoint', 'slider', 'choice'] : ['number', 'kpi', 'status', 'bar', 'gauge'];
}

/**
 * Vorschlag beim Ziehen einer Variablen auf die Seite: Ausgang -> Statusleuchte, schreibbarer Merker -> Schalter
 * (bei „Impuls“ Taster), Merkerwort -> Sollwert. Ein Vorschlag „Anzeige“ aus dem Import geht vor.
 */
function suggestKind(v) {
  const kinds = kindsFor(v);
  const role = roleOf(v);
  if (kinds.length === 1 || !canWrite(v) || role === 'display') return kinds[0];
  if (isBit(v)) return /impuls/i.test(v.comment || '') ? 'button' : 'switch';
  return 'setpoint';
}

/**
 * Bereich aus der Bemerkung („0 ... 1000“) – bei skalierter Variable gleich in der Einheit (0 … 5 bar); dazu
 * Nachkommastellen der Variablen (decimals) für Anzeige und Schrittweite
 */
function rangeOf(v) {
  const range = rangeFrom(v.comment);
  const s = scaleOf(v);
  if (!range || !s) return range;
  const a = toValue(s, range.min);
  const b = toValue(s, range.max);
  return Object.assign({}, range, { min: Math.min(a, b), max: Math.max(a, b) });
}
const decimalsOf = (v) => (v.userDecimals !== undefined ? v.userDecimals : undefined);

/** Standardwerte eines Elements aus der Variablen */
function defaultsFor(v, kind) {
  const range = rangeOf(v);
  const sc = scaleOf(v);
  const out = { kind, label: v.userLabel || v.label || v.name, unit: v.userUnit || (range && range.unit) || '' };
  if (kind === 'button') out.mode = 'pulse';
  if (kind === 'choice') out.opts = CHOICE_OPTS.map((o) => ({ v: o.v, t: t(`ui.choice.${o.k}`) }));
  const dec = decimalsOf(v);
  if (dec !== undefined) out.decimals = dec;
  const step = dec ? 10 ** -dec : 1;
  if (kind === 'setpoint') {
    let lim = LIMITS[String(v.type).toUpperCase()] || LIMITS.WORD;
    if (sc) { const a = toValue(sc, lim[0]); const b = toValue(sc, lim[1]); lim = [Math.min(a, b), Math.max(a, b)]; }
    Object.assign(out, { step, min: range ? Math.max(range.min, lim[0]) : lim[0], max: range ? Math.min(range.max, lim[1]) : lim[1] });
  }
  // Balken, Zeiger, Schieberegler brauchen eine sinnvolle Skala: Bereich aus der Bemerkung, sonst 0 … 100
  if (kind === 'bar' || kind === 'gauge' || kind === 'slider') {
    Object.assign(out, { min: range ? range.min : 0, max: range ? range.max : 100 });
    if (kind === 'slider') out.step = step;
  }
  return out;
}

/**
 * Seite zum Anzeigen ausrechnen: jedes Element mit Beschriftung, Einheit, Grenzen (eigene Angaben vor Variable).
 * devices: [{ id, name, variables }]. Ergebnis wie die Seite, Elemente zusätzlich mit { label, unit, min, max,
 * step, mode, kinds, operand, missing } und devices = benutzte Geräte-ids.
 */
function resolvePage(page, devices) {
  const byId = new Map((devices || []).map((d) => [d.id, d]));
  const used = new Set();
  const find = (dev, name) => { const d = byId.get(dev); return d ? (d.variables || []).find((x) => keyOf(x) === name) : null; };
  // Zustandsliste: Zeilen mit eigener Variable mit beobachten (deps); fehlt die Variable, gilt die Zeile nie
  const stateRows = (map, deps) => map.map((r) => {
    if (!r.name) return r;
    const rv = find(r.dev, r.name);
    if (!rv) return Object.assign({}, r, { missing: true });
    used.add(r.dev);
    if (!deps.some((d) => d.dev === r.dev && d.name === r.name)) deps.push({ dev: r.dev, name: r.name });
    return Object.assign({}, r, { bit: isBit(rv) });
  });
  const items = (page.items || []).map((e) => {
    if (e.kind === 'image' && e.name) {
      // Wechselbild: das Bild hängt vom Wert einer Variablen ab
      const v = find(e.dev, e.name);
      if (!v) return Object.assign({}, e, { missing: true, deps: [] });
      used.add(e.dev);
      const deps = [{ dev: e.dev, name: e.name }];
      return Object.assign({}, e, e.map ? { map: stateRows(e.map, deps) } : {}, { varLabel: v.userLabel || v.label || v.name, bit: isBit(v), deviceName: byId.get(e.dev).name,
        operand: `${Number.isInteger(v.net) ? v.net : ''}${v.operand}${v.index === null || v.index === undefined ? '' : v.index}`, deps });
    }
    if (e.kind === 'image' && e.states) return Object.assign({}, e, { deps: [] }); // Statusbild ohne Variable: noch nichts zu beobachten
    if (['image', 'fkey', 'alarms', 'lang', 'frame'].includes(e.kind)) return Object.assign({}, e, { deps: [] }); // Bild, Funktionstaste: ohne Anzeige-Variable
    if (e.kind === 'trend') {
      // Trend: bis zu 4 Kurven, je mit eigener Skala (aus der Bemerkung, sonst 0 … 100; Bit 0 … 1)
      const series = (e.series || []).map((x, i) => {
        const color = x.color === undefined ? i : x.color;
        const v = find(x.dev, x.name);
        if (!v) return Object.assign({ missing: true, label: x.label || x.name, color, min: 0, max: 1 }, x, { color });
        used.add(x.dev);
        const range = rangeOf(v);
        const bit = isBit(v);
        return Object.assign({}, x, { color, bit, label: x.label || v.userLabel || v.label || v.name, deviceName: byId.get(x.dev).name,
          unit: v.userUnit || (range && range.unit) || '', recorded: !!v.userRecord, decimals: decimalsOf(v),
          min: x.min !== undefined ? x.min : bit ? 0 : range ? range.min : 0, max: x.max !== undefined ? x.max : bit ? 1 : range ? range.max : 100 });
      });
      return Object.assign({}, e, { series, deps: series.filter((s) => !s.missing).map((s) => ({ dev: s.dev, name: s.name })) });
    }
    if (e.kind === 'device') {
      // Gerätekarte: Verbindung des Geräts, dazu auf Wunsch ein Lebenszeichen-Zähler (Merkerwort)
      const d = byId.get(e.dev);
      if (!d) return Object.assign({ missing: true, label: e.label || '', kinds: ['device'], deps: [] }, e);
      used.add(e.dev);
      const hb = e.name ? find(e.dev, e.name) : null;
      return Object.assign({}, e, { label: e.label || d.name, deviceName: d.name, kinds: ['device'],
        heartbeat: hb ? (hb.userLabel || hb.label || hb.name) : null, deps: hb ? [{ dev: e.dev, name: e.name }] : [] });
    }
    if (e.kind === 'text') {
      // Text mit Werten: Platzhalter {1}, {2} … mit Name, Einheit und Gerät der Variablen
      const vars = (e.vars || []).map((x) => {
        const v = find(x.dev, x.name);
        if (!v) return Object.assign({ missing: true, label: x.name }, x);
        used.add(x.dev);
        const range = rangeOf(v);
        return Object.assign({ label: v.userLabel || v.label || v.name, deviceName: byId.get(x.dev).name, clock: isClockAll(v),
          varUnit: v.userUnit || (range && range.unit) || '' }, decimalsOf(v) !== undefined ? { decimals: decimalsOf(v) } : {}, x);
      });
      return Object.assign({}, e, { vars, deps: vars.filter((x) => !x.missing).map((x) => ({ dev: x.dev, name: x.name })) });
    }
    const d = byId.get(e.dev);
    const v = find(e.dev, e.name);
    if (!v) return Object.assign({ label: e.label || e.name || '', missing: true, kinds: [e.kind], deps: [] }, e);
    used.add(e.dev);
    const kinds = kindsFor(v);
    const kind = kinds.includes(e.kind) ? e.kind : kinds[0];
    const out = Object.assign(defaultsFor(v, kind), { id: e.id, dev: e.dev, name: e.name, x: e.x, y: e.y, w: e.w, h: e.h, font: e.font, kinds,
      operand: `${Number.isInteger(v.net) ? v.net : ''}${v.operand}${v.operand === 'CLOCK' ? '.' : ''}${v.index === null || v.index === undefined ? '' : v.index}`,
      deviceName: d.name, varLabel: v.userLabel || v.label || v.name, varName: v.name });
    for (const k of ['label', 'unit', 'min', 'max', 'step']) if (e[k] !== undefined && e[k] !== '') out[k] = e[k];
    // Beschriftung ausgeschaltet (Ralf 08.11.2026): weder eigener Text noch Name der Variablen; Taster behalten ihren Text
    if (e.noLabel && kind !== 'button') { out.noLabel = true; out.ariaLabel = out.label; out.label = ''; }
    for (const k of ['show', 'icon', 'map', 'other', 'style', 'onText', 'offText', 'mode', 'fbColor', 'litText', 'clockFmt', 'clockWarn', 'orient', 'bw', 'valpos', 'ticks', 'opts', 'noAddr']) if (e[k] !== undefined) out[k] = e[k];
    out.writable = canWrite(v);
    out.deps = [{ dev: e.dev, name: e.name }];
    // Uhr: alle Teile der Uhr dieses Geräts (Sekunde … Jahr) – bzw. die ganze Uhr, wenn es sie als eine Variable gibt
    if (out.kind === 'clock' && !isClockAll(v)) {
      const parts = {};
      for (const x of d.variables || []) {
        if (x.operand === 'CLOCK' && Number.isInteger(Number(x.index)) && x.index !== null && parts[Number(x.index)] === undefined) parts[Number(x.index)] = keyOf(x);
      }
      out.clockParts = parts;
      for (const k of Object.values(parts)) if (k !== e.name) out.deps.push({ dev: e.dev, name: k });
      // gibt es die ganze Uhr als eine Variable (CLOCK), wird sie bevorzugt
      const full = (d.variables || []).find(isClockAll);
      if (full) { out.clockFull = keyOf(full); out.deps.push({ dev: e.dev, name: out.clockFull }); }
      out.protocol = d.protocol;
    }
    if ((out.kind === 'lamp' || out.kind === 'status') && out.map) out.map = stateRows(out.map, out.deps);
    // Leuchttaster: Rückmelde-Variable (leuchtet, solange sie 1 ist)
    if (out.kind === 'button' && e.fb && e.fb.name) {
      const fv = find(e.fb.dev, e.fb.name);
      out.fb = Object.assign({}, e.fb, fv ? { label: fv.userLabel || fv.label || fv.name } : { missing: true });
      if (fv) { used.add(e.fb.dev); out.deps.push({ dev: e.fb.dev, name: e.fb.name }); }
    }
    return out;
  });
  // Sichtbarkeit: Variable der Bedingung mit beobachten; fehlt sie, bleibt das Element sichtbar (missing)
  items.forEach((it, i) => {
    const vis = (page.items[i] || {}).vis;
    if (!vis || !vis.name) return;
    const v = find(vis.dev, vis.name);
    it.vis = Object.assign({}, vis, v ? { label: v.userLabel || v.label || v.name } : { missing: true });
    if (v) { used.add(vis.dev); it.deps = (it.deps || []).concat([{ dev: vis.dev, name: vis.name }]); }
  });
  return Object.assign({}, page, { items, devices: [...used] });
}

module.exports = { autoPage, elementFor, rangeFrom, hasRealName, kindsFor, suggestKind, defaultsFor, resolvePage };
