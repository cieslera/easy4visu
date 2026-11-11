'use strict';
/**
 * Aufzeichnung für Trends (Version 1, Punkt 2 / Stufe 4a) in einer eingebauten Datenbank (SQLite über node:sqlite,
 * kein Zusatzpaket). Datei: <Datenordner>/verlauf.sqlite
 *
 * Aufgezeichnet werden Variablen mit Häkchen „aufzeichnen“ (userRecord), solange easy4Visu verbunden ist:
 *   - bei jeder Änderung, aber je Variable höchstens alle minGap ms (JSON-API 1 s, sonst 250 ms); was dazwischen
 *     kommt, wird am Ende der Pause mit dem letzten Wert nachgetragen
 *   - ändert sich nichts, spätestens jede Minute (keepAlive), damit die Kurve bis „jetzt“ reicht
 *   - fällt das Gerät aus (Wert nicht mehr gut), einmal eine Lücke (v = NULL): die Kurve wird dort unterbrochen
 * Bits werden als 0/1 gespeichert. Ältere Werte als retentionDays (Standard 365) werden gelöscht.
 *
 * Abfrage (query): je Kurve höchstens etwa `points` Punkte. Liegen mehr Werte im Zeitraum, werden sie in Abschnitte
 * zusammengefasst (kleinster und größter Wert je Abschnitt), damit Spitzen sichtbar bleiben.
 */

const fs = require('node:fs');
const path = require('node:path');

const KEEP_ALIVE_MS = 60 * 1000;
const MIN_GAP = { json: 1000, modbus: 250, mqtt: 250 };
const DAY_MS = 24 * 3600 * 1000;

const toNum = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' && Number.isFinite(v) ? v : null);

class History {
  /**
   * opts: { dir (Datenordner) | file, retentionDays = 365, now = () => Date.now() (für Tests) }
   */
  constructor(opts) {
    this.file = opts.file || path.join(opts.dir, 'verlauf.sqlite');
    this.retentionDays = opts.retentionDays || 365;
    this.now = opts.now || (() => Date.now());
    this.db = null; // Datei erst öffnen, wenn wirklich etwas gespeichert oder gelesen wird
    this.sids = new Map();   // "dev|name" -> Reihen-Nr.
    this.state = new Map();  // "dev|name" -> { last: Zeit der letzten Speicherung, value, gap, pending, minGap }
    this.queue = [];         // gesammelte Einträge, einmal je Sekunde in einem Rutsch gespeichert
  }

  _open() {
    if (this.db) return this.db;
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS series (id INTEGER PRIMARY KEY, dev TEXT NOT NULL, name TEXT NOT NULL, UNIQUE (dev, name));
      CREATE TABLE IF NOT EXISTS samples (sid INTEGER NOT NULL, ts INTEGER NOT NULL, v REAL, PRIMARY KEY (sid, ts)) WITHOUT ROWID;
    `);
    this.stInsert = this.db.prepare('INSERT OR REPLACE INTO samples (sid, ts, v) VALUES (?, ?, ?)');
    this.stSeries = this.db.prepare('SELECT id FROM series WHERE dev = ? AND name = ?');
    this.stNewSeries = this.db.prepare('INSERT INTO series (dev, name) VALUES (?, ?)');
    return this.db;
  }

  _sid(dev, name) {
    const k = `${dev}|${name}`;
    let id = this.sids.get(k);
    if (id === undefined) {
      this._open();
      const row = this.stSeries.get(dev, name);
      id = row ? row.id : Number(this.stNewSeries.run(dev, name).lastInsertRowid);
      this.sids.set(k, id);
    }
    return id;
  }

  _push(dev, name, ts, v) {
    this.queue.push([this._sid(dev, name), ts, v]);
  }

  /**
   * neuer Wert einer aufgezeichneten Variablen. entry: { value, quality }; protocol bestimmt die kleinste Pause.
   */
  onValue(dev, name, entry, protocol) {
    const k = `${dev}|${name}`;
    const now = this.now();
    let s = this.state.get(k);
    if (!s) { s = { last: 0, value: undefined, gap: false, pending: false }; this.state.set(k, s); }
    s.minGap = MIN_GAP[protocol] || MIN_GAP.modbus;
    const v = entry && entry.quality === 'good' ? toNum(entry.value) : null;
    if (v === null) {
      // Ausfall oder ungültiger Wert: einmal Lücke eintragen
      if (!s.gap && s.last) { this._push(dev, name, now, null); s.gap = true; s.last = now; }
      s.pending = false;
      s.value = undefined;
      return;
    }
    s.gap = false;
    if (s.value === v && !s.pending) return;
    s.value = v;
    if (now - s.last >= s.minGap) { this._push(dev, name, now, v); s.last = now; s.pending = false; }
    else s.pending = true;
  }

  /** einmal je Sekunde: aufgeschobene Werte nachtragen, Lebenszeichen je Minute, alles speichern */
  tick() {
    const now = this.now();
    for (const [k, s] of this.state) {
      if (s.value === undefined) continue;
      const due = s.pending ? now - s.last >= s.minGap : now - s.last >= KEEP_ALIVE_MS;
      if (!due) continue;
      const i = k.indexOf('|');
      this._push(k.slice(0, i), k.slice(i + 1), now, s.value);
      s.last = now;
      s.pending = false;
    }
    this.flush();
  }

  flush() {
    if (!this.queue.length) return;
    const rows = this.queue;
    this.queue = [];
    this._open();
    this.db.exec('BEGIN');
    try {
      for (const r of rows) this.stInsert.run(r[0], r[1], r[2]);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Aufzeichnung einer Variablen beendet (Häkchen weg, getrennt): nächster Wert beginnt neu */
  forget(dev, name) {
    if (name === undefined) { for (const k of [...this.state.keys()]) if (k.startsWith(`${dev}|`)) this.state.delete(k); return; }
    this.state.delete(`${dev}|${name}`);
  }

  /** beim Trennen: Lücke für alle laufenden Kurven, damit nichts über die Pause hinweg verbunden wird */
  pause() {
    const now = this.now();
    for (const [k, s] of this.state) {
      if (s.gap || !s.last) continue; // schon Lücke oder noch nichts gespeichert
      const i = k.indexOf('|');
      const dev = k.slice(0, i);
      const name = k.slice(i + 1);
      if (s.pending && s.value !== undefined) this._push(dev, name, now - 1, s.value); // aufgeschobenen Wert noch sichern
      this._push(dev, name, now, null);
    }
    this.state.clear();
    this.flush();
  }

  /** alte Werte löschen */
  prune() {
    const limit = this.now() - this.retentionDays * DAY_MS;
    if (!this.db && !fs.existsSync(this.file)) return 0;
    this._open();
    return Number(this.db.prepare('DELETE FROM samples WHERE ts < ?').run(limit).changes);
  }

  /**
   * Kurven für einen Zeitraum. series: [{ dev, name }], from/to in ms, points = gewünschte Punkte je Kurve.
   * Ergebnis: [{ dev, name, points: [[ts, v]] | [[ts, min, max]] }] – v/min/max null = Lücke.
   * Dazu je Kurve der letzte Wert vor dem Zeitraum (damit die Linie am linken Rand beginnt).
   */
  query(series, from, to, points) {
    this.flush();
    if (!this.db && !fs.existsSync(this.file)) return (series || []).map((s) => ({ dev: s.dev, name: s.name, points: [] }));
    this._open();
    const n = Math.max(10, Math.min(4000, Math.round(points || 600)));
    const span = Math.max(1, to - from);
    const out = [];
    for (const s of series || []) {
      const row = this.stSeries.get(String(s.dev), String(s.name));
      if (!row) { out.push({ dev: s.dev, name: s.name, points: [] }); continue; }
      const sid = row.id;
      const before = this.db.prepare('SELECT ts, v FROM samples WHERE sid = ? AND ts < ? ORDER BY ts DESC LIMIT 1').get(sid, from);
      const count = this.db.prepare('SELECT COUNT(*) AS c FROM samples WHERE sid = ? AND ts BETWEEN ? AND ?').get(sid, from, to).c;
      let pts;
      if (count <= n * 2) {
        pts = this.db.prepare('SELECT ts, v FROM samples WHERE sid = ? AND ts BETWEEN ? AND ? ORDER BY ts').all(sid, from, to).map((r) => [r.ts, r.v]);
      } else {
        // Abschnitte: kleinster/größter Wert; ein Abschnitt nur mit Lücken bleibt Lücke
        pts = this.db.prepare(`SELECT CAST((ts - ?) * ? / ? AS INTEGER) AS b, MIN(ts) AS t, MIN(v) AS lo, MAX(v) AS hi, COUNT(v) AS c
          FROM samples WHERE sid = ? AND ts BETWEEN ? AND ? GROUP BY b ORDER BY b`).all(from, n, span, sid, from, to)
          .map((r) => (r.c ? [r.t, r.lo, r.hi] : [r.t, null, null]));
      }
      if (before && before.v !== null) pts.unshift([before.ts, before.v]);
      out.push({ dev: s.dev, name: s.name, points: pts });
    }
    return out;
  }

  _sidOf(dev, name) {
    this.flush();
    if (!this.db && !fs.existsSync(this.file)) return null;
    this._open();
    const row = this.stSeries.get(String(dev), String(name));
    return row ? row.id : null;
  }

  /** alle Werte einer Kurve im Zeitraum (für die Tabelle), vorneweg der letzte Wert davor: [[ts, v]] */
  raw(dev, name, from, to) {
    const sid = this._sidOf(dev, name);
    if (sid === null) return [];
    const before = this.db.prepare('SELECT ts, v FROM samples WHERE sid = ? AND ts < ? ORDER BY ts DESC LIMIT 1').get(sid, from);
    const rows = this.db.prepare('SELECT ts, v FROM samples WHERE sid = ? AND ts BETWEEN ? AND ? ORDER BY ts').all(sid, from, to).map((r) => [r.ts, r.v]);
    if (before) rows.unshift([before.ts, before.v]);
    return rows;
  }

  /** Zahl der Werte einer Kurve im Zeitraum */
  count(dev, name, from, to) {
    const sid = this._sidOf(dev, name);
    if (sid === null) return 0;
    return this.db.prepare('SELECT COUNT(*) AS c FROM samples WHERE sid = ? AND ts BETWEEN ? AND ?').get(sid, from, to).c;
  }

  /** Größe der Datei in Bytes und Zeit des ältesten Werts (oder null) */
  stats() {
    const size = (f) => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
    const bytes = size(this.file) + size(`${this.file}-wal`);
    if (!this.db && !fs.existsSync(this.file)) return { bytes: 0, oldest: null };
    this.flush();
    this._open();
    const r = this.db.prepare('SELECT MIN(ts) AS t FROM samples').get();
    return { bytes, oldest: r && r.t !== null ? r.t : null };
  }

  close() {
    if (!this.db) return;
    try { this.flush(); } catch (e) { /* beim Beenden egal */ }
    this.db.close();
    this.db = null;
    this.sids.clear();
  }
}

module.exports = { History, KEEP_ALIVE_MS, MIN_GAP };
