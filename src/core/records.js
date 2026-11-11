'use strict';
/**
 * Aufzeichnungen als Tabelle (CSV, öffnet sich in Excel): Trends und Meldungsverlauf. Dazu die Aufbewahrungsfristen.
 *
 * Trends: je Variable eine Spalte, Werte in ihrer Einheit (umgerechnet, mit den Nachkommastellen der Variablen).
 *   step = 0     eine Zeile je Änderung (Zeilen ohne Änderung fallen weg)
 *   step > 0     eine Zeile alle step ms; Wert = Momentanwert, also der zuletzt aufgezeichnete Wert zu diesem Zeitpunkt
 *   Leeres Feld: keine Aufzeichnung (Gerät ausgefallen, getrennt) oder der letzte Wert ist älter als STALE_MS
 *   (die Aufzeichnung schreibt spätestens jede Minute einen Wert; fehlt er, lief sie nicht).
 * Format: Semikolon, UTF-8 mit BOM; Deutsch mit Dezimalkomma und Zeit 03.11.2026 14:05:00, sonst Punkt und 2026-11-03 14:05:00.
 */

const { toValue } = require('./scale');

const STALE_MS = 150 * 1000;
const MAX_ROWS = 1000000; // Excel schafft 1 048 576 Zeilen
const STEPS = [0, 10000, 60000, 900000, 3600000];
const RETENTION_DAYS = [30, 90, 180, 365, 730, 1825, 3650];
const DEFAULT_RETENTION = { trend: 365, alarm: 365, audit: 365 };

const pad = (n) => String(n).padStart(2, '0');

/** Zeit als Text in Ortszeit */
function fmtTime(ts, lang) {
  const d = new Date(ts);
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return lang === 'de' ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${t}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${t}`;
}

/** Zahl als Text; decimals = feste Nachkommastellen oder undefined */
function fmtNum(v, decimals, lang) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  const s = decimals !== undefined ? v.toFixed(decimals) : String(Math.round(v * 1e6) / 1e6);
  return lang === 'de' ? s.replace('.', ',') : s;
}

function csvText(rows) {
  const q = (s) => {
    const x = s === null || s === undefined ? '' : String(s);
    return /[";\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  return `﻿${rows.map((r) => r.map(q).join(';')).join('\r\n')}\r\n`;
}

/** Zahl der Zeilen (ohne Überschrift); counts = Zahl der Werte je Spalte im Zeitraum */
function estimateRows(from, to, step, counts) {
  if (step > 0) return Math.max(0, Math.floor(to / step) - Math.ceil(from / step) + 1);
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * Tabelle für Trends. cols: [{ head, scale, decimals, samples: [[ts, v]] }] (samples aufsteigend, vorneweg der Wert vor from).
 * Liefert die Zeilen samt Überschrift.
 */
function trendRows(cols, from, to, step, lang, timeHead) {
  const rows = [[timeHead].concat(cols.map((c) => c.head))];
  const pos = cols.map(() => 0);
  // Wert einer Spalte zur Zeit t (Zeiger laufen nur vorwärts)
  const at = (ci, t) => {
    const s = cols[ci].samples;
    let i = pos[ci];
    while (i + 1 < s.length && s[i + 1][0] <= t) i++;
    pos[ci] = i;
    if (!s.length || s[i][0] > t || s[i][1] === null || t - s[i][0] > STALE_MS) return '';
    const c = cols[ci];
    return fmtNum(c.scale ? toValue(c.scale, s[i][1]) : s[i][1], c.decimals, lang);
  };
  if (step > 0) {
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) rows.push([fmtTime(t, lang)].concat(cols.map((c, ci) => at(ci, t))));
    return rows;
  }
  const times = new Set();
  for (const c of cols) for (const p of c.samples) if (p[0] >= from && p[0] <= to) times.add(p[0]);
  let last = null;
  for (const t of [...times].sort((a, b) => a - b)) {
    const vals = cols.map((c, ci) => at(ci, t));
    const key = vals.join('\u0001');
    if (key === last) continue; // nur Lebenszeichen, nichts geändert
    last = key;
    rows.push([fmtTime(t, lang)].concat(vals));
  }
  return rows;
}

/** Tabelle für den Meldungsverlauf. list: Einträge wie Alarms.range; L: { head: [...6], level: {fault, warn, info}, devName(id) } */
function alarmRows(list, lang, L) {
  const tm = (ts) => (ts === null || ts === undefined ? '' : fmtTime(ts, lang));
  return [L.head].concat(list.map((x) => [x.text, L.level[x.level] || x.level, L.devName(x.dev), tm(x.come), tm(x.gone), tm(x.ack)]));
}

/** Aufbewahrung prüfen: nur Werte aus RETENTION_DAYS, sonst der bisherige bzw. 1 Jahr */
function cleanRetention(o, old) {
  const base = Object.assign({}, DEFAULT_RETENTION, old || {});
  const out = {};
  for (const k of Object.keys(DEFAULT_RETENTION)) {
    const n = Number(o && o[k]);
    out[k] = RETENTION_DAYS.includes(n) ? n : RETENTION_DAYS.includes(Number(base[k])) ? Number(base[k]) : DEFAULT_RETENTION[k];
  }
  return out;
}

module.exports = { STALE_MS, MAX_ROWS, STEPS, RETENTION_DAYS, DEFAULT_RETENTION, fmtTime, fmtNum, csvText, estimateRows, trendRows, alarmRows, cleanRetention };
