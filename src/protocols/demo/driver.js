'use strict';
/**
 * Demo-Modus: eingebauter Simulator statt einer echten easyE4 (Ralf 06.11.2026). Gleiche Schnittstelle wie die
 * Protokoll-Treiber (siehe ../driver.js), aber ohne Netzwerk – jede Variable bekommt einen glaubwürdigen Wert:
 *   - Messwerte (Wort/Doppelwort, auch Merkerworte, solange niemand sie beschrieben hat): langsame Schwingung mit etwas
 *     Rauschen, je Variable eigener Takt, in einem glaubwürdigen Bereich der Anzeige: nach der Einheit (% 0 … 100,
 *     °C 15 … 25, bar 4 … 8 …), sonst nach Balken/Zeiger/Sollwert auf einer Seite (opts.ranges), sonst 0 … 100;
 *     danach über die Umrechnung (userScale) in den Rohwert der easyE4
 *   - Zähler (kWh, h): zählen langsam hoch
 *   - Ein-/Ausgänge (Bits): wechseln gemächlich (je Variable eigener Takt)
 *   - Merker-Bits und beschriebene Werte: bleiben, wie zuletzt geschrieben (Schalter, Sollwerte wirken)
 *   - Meldungs-Bits (opts.alarmVars): meist 0, alle 10 … 25 Minuten kommt eine Meldung für eine halbe Minute
 *   - Auswahl und Zustände mit Wertetabelle (opts.enums: Betriebsart 0/1/2, Torzustand 0 … 3): nur Werte aus der Tabelle –
 *     bedienbare stehen fest (meist die letzte Wahl, z. B. „Automatik“), angezeigte wechseln alle 1 … 3 Minuten
 *   - Bedien-Variablen (opts.controlVars: auf einer Seite als Sollwert, Schieberegler, Betriebsart, Schalter, Taster):
 *     stehen fest, bis jemand sie ändert
 *   - Uhr (CLOCK bzw. CLOCK.0 … CLOCK.5): die PC-Uhr
 *   - Rückmeldungen der Taster (opts.links, aus den Seiten): was sonst das easyE4-Programm tut – „Ein“/„Auf“ setzt die
 *     Rückmeldung, „Aus“/„Zu“ löscht sie, ein einzelner Taster schaltet sie um, tastend/rastend folgt sie dem Taster,
 *     „Quittieren“ löscht eine Störung für eine Minute; Impuls-Taster (opts.pulses) fallen nach 1 s auf 0 zurück
 *   - Sammelmeldungen (opts.sums, z. B. „Sammelstoerung“): 1, solange eine der zugehörigen Meldungen ansteht – wie es das
 *     easyE4-Programm macht (Ralf 09.11.2026: sonst zeigte die Lampe „alles gut“ trotz Störung)
 */

const { Driver, keyOf } = require('../driver');
const { WRITABLE } = require('../operand');
const { scaleOf, toRaw } = require('../../core/scale');

// gleichbleibende Zahl 0 … 1 je Name (damit jede Variable ihren eigenen Takt behält)
function hash01(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
const CLOCK_FIELDS = ['second', 'minute', 'hour', 'day', 'month', 'year'];
// glaubwürdiger Anzeigebereich je Einheit (klein geschrieben, ohne Leerzeichen)
const UNIT_RANGES = { '%': [0, 100], '°c': [15, 25], 'c': [15, 25], 'k': [288, 298], '°f': [60, 78], 'bar': [4, 8], 'mbar': [900, 1100],
  'pa': [0, 500], 'kw': [0, 10], 'w': [0, 2000], 'v': [0, 10], 'ma': [4, 20], 'a': [0, 16], 'hz': [0, 50], 'rpm': [0, 1500],
  'u/min': [0, 1500], 's': [0, 60], 'min': [0, 60], 'stk': [0, 500], 'm³/h': [0, 50], 'l/min': [0, 100], 'mm': [0, 1000],
  'm': [0, 10], 'lux': [0, 800], '%rh': [35, 65], 'ppm': [400, 1200] };
const COUNTER_UNITS = new Set(['kwh', 'mwh', 'wh', 'h', 'm³', 'l']);

class DemoDriver extends Driver {
  /** opts: { alarmVars, controlVars, pulses: Sets von Variablen-Schlüsseln, sums: Map Schlüssel -> [Meldungs-Schlüssel], ranges: Map Schlüssel -> { min, max },
   *  enums: Map Schlüssel -> [erlaubte Werte],
   *  links: Map Schlüssel -> [{ name, op: 'on' | 'off' | 'toggle' | 'follow' | 'clear' }], now(): Zeit in ms (für Tests) } */
  constructor(settings, secrets, opts) {
    super(settings, secrets);
    this.opts = opts || {};
    this.written = new Map(); // Schlüssel -> geschriebener Wert
    this.until = new Map(); // Schlüssel -> Zeit, ab der der geschriebene Wert wieder vergessen wird
    this.last = new Map(); // zuletzt gelesene Werte (für „umschalten“)
    this.now = this.opts.now || (() => Date.now());
    this.t0 = this.now(); // Zähler zählen ab Start der Demo
  }

  stateText() { return this.state === 'online' ? 'Demo' : super.stateText(); }

  /** Wert einer Variablen zur Zeit t (ms) */
  valueOf(v, t) {
    const key = keyOf(v);
    const op = String(v.operand || '').toUpperCase();
    if (this.until.has(key) && t >= this.until.get(key)) { this.written.delete(key); this.until.delete(key); }
    if (this.written.has(key)) return this.written.get(key);
    if (op === 'CLOCK') {
      const d = new Date(t);
      const c = { second: d.getSeconds(), minute: d.getMinutes(), hour: d.getHours(), day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
      return v.index === null || v.index === undefined ? c : c[CLOCK_FIELDS[v.index]];
    }
    const r = hash01(`${this.settings.host || ''}|${key}`);
    const secs = t / 1000;
    if (v.type === 'BIT') {
      const sum = this.opts.sums && this.opts.sums.get(key);
      if (sum) return sum.some((k) => Number(this.valueOf({ name: k, type: 'BIT', operand: '' }, t))) ? 1 : 0;
      if (this.opts.alarmVars && this.opts.alarmVars.has(key)) {
        // Meldung: alle 10 … 25 Minuten für 30 Sekunden
        const period = 600 + Math.round(r * 900);
        return (secs + r * period) % period < 30 ? 1 : 0;
      }
      if (WRITABLE.has(op) || (this.opts.controlVars && this.opts.controlVars.has(key))) return 0; // Merker: bis jemand schaltet
      const period = 40 + Math.round(r * 80);
      return (secs + r * period) % period < period * (0.35 + r * 0.4) ? 1 : 0;
    }
    // Auswahl / Zustand mit Wertetabelle
    const list = this.opts.enums && this.opts.enums.get(key);
    if (list && list.length) {
      if (this.opts.controlVars && this.opts.controlVars.has(key)) return list[Math.min(list.length - 1, Math.round(list.length * 0.6))];
      const period = 60 + r * 120;
      return list[Math.floor(secs / period + r * list.length) % list.length];
    }
    // Messwert: erst in der Anzeige-Einheit, dann in den Rohwert umrechnen
    const sc = scaleOf(v);
    const raw = (x) => (sc ? toRaw(sc, x) : Math.round(x));
    const unit = String(v.userUnit || v.unit || '').trim().toLowerCase().replace(/\s+/g, '');
    if (COUNTER_UNITS.has(unit)) return raw(Math.round(200 + r * 4800) + Math.floor((t - this.t0) / 1000 / (30 + r * 60))); // Zähler
    const page = this.opts.ranges && this.opts.ranges.get(key);
    const [lo, hi] = UNIT_RANGES[unit] || (page && Number.isFinite(page.min) && Number.isFinite(page.max) && page.max > page.min && page.max - page.min <= 10000 ? [page.min, page.max] : [0, 100]);
    const span = hi - lo;
    if (this.opts.controlVars && this.opts.controlVars.has(key)) return raw(lo + span * (0.3 + 0.4 * r)); // Sollwert: steht
    // ruhige Hauptwelle (8 … 25 min) plus kleine Schwankung (1,6 … 5 min) – sieht im 10-min- wie im 1-h-Trend echt aus
    // (Ralf 09.11.2026: vorher 2 … 10 min, im Stundentrend unnatürlich zackig)
    const period = 480 + r * 1020;
    const wave = Math.sin((2 * Math.PI * secs) / period + r * 6.28) * 0.25 + Math.sin((2 * Math.PI * secs) / (period / 5) + r * 3.1) * 0.06;
    const noise = (hash01(`${key}|${Math.floor(secs)}`) - 0.5) * 0.01;
    return raw(lo + span * (0.5 + wave + noise));
  }

  async read(variables) {
    if (this.closed) throw Object.assign(new Error('Demo beendet'), { network: true });
    const t = this.now();
    const values = {};
    for (const v of variables) { const k = keyOf(v); values[k] = this.valueOf(v, t); this.last.set(k, values[k]); }
    this._setState('online');
    return { values, errors: [] };
  }

  async write(variable, value) {
    const key = keyOf(variable);
    const val = value === true ? 1 : value === false ? 0 : value;
    const t = this.now();
    this.written.set(key, val);
    this.until.delete(key);
    if (this.opts.pulses && this.opts.pulses.has(key) && Number(val) === 1) this.until.set(key, t + 1000);
    const set = (name, x, ms) => { this.written.set(name, x); if (ms) this.until.set(name, t + ms); else this.until.delete(name); this.last.set(name, x); };
    for (const l of (this.opts.links && this.opts.links.get(key)) || []) {
      if (l.op === 'follow') set(l.name, Number(val) ? 1 : 0);
      else if (!Number(val)) continue;
      else if (l.op === 'on') set(l.name, 1);
      else if (l.op === 'off') set(l.name, 0);
      else if (l.op === 'toggle') set(l.name, Number(this.written.has(l.name) ? this.written.get(l.name) : this.last.get(l.name)) ? 0 : 1);
      else if (l.op === 'clear') set(l.name, 0, 60000);
    }
    this.emit('values');
  }

  async test() { return { ok: true, text: 'Demo – simulierte easyE4' }; }
}

module.exports = { DemoDriver, hash01 };
