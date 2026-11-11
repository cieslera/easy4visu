'use strict';
/**
 * Meldungen (Version 1, Punkt 3 / Stufe 4b).
 *
 * Festlegung (meldungen.json im Datenordner): { alarms: [{ id, dev, name, text, level, when }], ackVars: { Gerät: Variable } }
 *   dev + name   auslösende Variable (Bit, Schlüssel wie in den Werten)
 *   level        'fault' (Störung, muss quittiert werden) | 'warn' (Warnung) | 'info' (Meldung)
 *   when         1 = Meldung bei 1 (Standard), 0 = bei 0
 *   ackVars      je Gerät der Quittier-Merker in der Steuerung: beim Quittieren einer Störung dieses Geräts bekommt er
 *                einen kurzen Impuls (1, nach 1 s wieder 0); das Programm setzt damit seine gespeicherten Störungen zurück
 *
 * Ablauf (Protokoll in meldungen.sqlite, Aufbewahrung einstellbar, Standard 1 Jahr): je Auftreten ein Eintrag mit come (kommt), gone (geht),
 * ack (quittiert). Offen ist ein Eintrag, solange er ansteht oder – bei einer Störung – noch nicht quittiert ist.
 * Die Visu sieht Meldungen nur, solange sie verbunden ist; was beim Start noch offen ist, wird mit dem ersten
 * gültigen Wert geschlossen (Variable nicht mehr gesetzt) oder läuft weiter.
 */

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = ['fault', 'warn', 'info'];
const DAY_MS = 24 * 3600 * 1000;
const str = (v, max) => (v === undefined || v === null ? '' : String(v)).slice(0, max || 200);
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Festlegungen prüfen: unbekannte Felder weg, ohne Variable fällt der Eintrag weg */
function cleanDefs(list) {
  const out = [];
  const ids = new Set();
  for (const d of Array.isArray(list) ? list.slice(0, 2000) : []) {
    if (!d || !str(d.dev) || !str(d.name)) continue;
    let id = /^[A-Za-z0-9_-]{1,40}$/.test(String(d.id || '')) ? String(d.id) : newId();
    while (ids.has(id)) id = newId();
    ids.add(id);
    const e = { id, dev: str(d.dev, 80), name: str(d.name, 120), text: str(d.text, 200).trim(), level: LEVELS.includes(d.level) ? d.level : 'fault',
      when: Number(d.when) === 0 ? 0 : 1 };
    out.push(e);
  }
  return out;
}

function cleanAckVars(map) {
  const out = {};
  for (const [dev, name] of Object.entries(map && typeof map === 'object' ? map : {})) if (str(dev) && str(name)) out[str(dev, 80)] = str(name, 120);
  return out;
}

class Alarms {
  /**
   * opts: { dir, now = () => Date.now(), retentionDays = 365, write: async (dev, name, value) – Quittier-Impuls,
   *         labelOf: (dev, name) => Anzeige-Name der Variablen (für Meldungen ohne eigenen Text) }
   */
  constructor(opts) {
    this.labelOf = opts.labelOf || (() => '');
    this.dir = opts.dir;
    this.now = opts.now || (() => Date.now());
    this.retentionDays = opts.retentionDays || 365;
    this.write = opts.write || null;
    this.defs = [];
    this.ackVars = {}; // Gerät -> Quittier-Merker (Schlüssel wie in den Werten)
    this.byVar = new Map(); // "dev|name" -> [Festlegung]
    this.db = null;
    this.load();
  }

  get file() { return path.join(this.dir, 'meldungen.json'); }

  load() {
    const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    this._setDefs(cleanDefs(data.alarms));
    this.ackVars = cleanAckVars(data.ackVars);
    // ältere Dateien: Quittier-Variable je Meldung -> je Gerät
    for (const d of Array.isArray(data.alarms) ? data.alarms : []) {
      if (d && d.ack && str(d.ack.dev) && str(d.ack.name) && !this.ackVars[d.ack.dev]) this.ackVars[str(d.ack.dev, 80)] = str(d.ack.name, 120);
    }
    return this;
  }

  _setDefs(defs) {
    this.defs = defs;
    this.byVar = new Map();
    for (const d of defs) {
      const k = `${d.dev}|${d.name}`;
      if (!this.byVar.has(k)) this.byVar.set(k, []);
      this.byVar.get(k).push(d);
    }
  }

  getDefs() { return JSON.parse(JSON.stringify(this.defs)); }

  saveDefs(list) {
    this._setDefs(cleanDefs(list));
    this._write();
    return this.getDefs();
  }

  getAckVars() { return Object.assign({}, this.ackVars); }

  /** Quittier-Merker je Gerät: { Gerät: Variable } (leer = keiner) */
  saveAckVars(map) {
    this.ackVars = cleanAckVars(map);
    this._write();
    return this.getAckVars();
  }

  _write() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 2, alarms: this.defs, ackVars: this.ackVars }, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** Variablen, die Meldungen auslösen (zum Abfragen) */
  watched() { return [...this.byVar.keys()]; }

  _open() {
    if (this.db) return this.db;
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dir, 'meldungen.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, aid TEXT NOT NULL, dev TEXT, name TEXT, text TEXT, level TEXT,
        come INTEGER NOT NULL, gone INTEGER, ack INTEGER);
      CREATE INDEX IF NOT EXISTS events_open ON events (gone, ack);
      CREATE INDEX IF NOT EXISTS events_come ON events (come);
    `);
    return this.db;
  }

  _openEvent(aid) {
    return this._open().prepare('SELECT * FROM events WHERE aid = ? AND gone IS NULL ORDER BY come DESC LIMIT 1').get(aid);
  }

  /**
   * neuer Wert einer Variablen. Liefert true, wenn sich an den Meldungen etwas geändert hat.
   * entry: { value, quality } – nur gute Werte zählen (Ausfall ändert nichts: die Visu weiß dann nichts Neues).
   */
  onValue(dev, name, entry) {
    const defs = this.byVar.get(`${dev}|${name}`);
    if (!defs || !entry || entry.quality !== 'good') return false;
    const bit = entry.value === true || entry.value === 1 ? 1 : 0;
    let changed = false;
    for (const d of defs) {
      const active = bit === d.when;
      const open = this._openEvent(d.id);
      if (active && !open) {
        this._open().prepare('INSERT INTO events (aid, dev, name, text, level, come) VALUES (?, ?, ?, ?, ?, ?)')
          .run(d.id, d.dev, d.name, d.text, d.level, this.now());
        changed = true;
      } else if (!active && open) {
        // Warnung und Meldung brauchen keine Quittung: mit „geht“ erledigt
        this._open().prepare('UPDATE events SET gone = ?, ack = COALESCE(ack, CASE WHEN level = \'fault\' THEN NULL ELSE ? END) WHERE id = ?')
          .run(this.now(), this.now(), open.id);
        changed = true;
      }
    }
    return changed;
  }

  /** offene Meldungen: unquittierte Störungen zuerst, sonst neueste zuerst */
  active() {
    if (!this.db && !fs.existsSync(path.join(this.dir, 'meldungen.sqlite'))) return [];
    const rows = this._open().prepare(`SELECT * FROM events WHERE gone IS NULL OR (level = 'fault' AND ack IS NULL)
      ORDER BY (level = 'fault' AND ack IS NULL) DESC, come DESC LIMIT 500`).all();
    return rows.map((r) => this._row(r));
  }

  /** Verlauf: neueste zuerst */
  history(limit) {
    if (!this.db && !fs.existsSync(path.join(this.dir, 'meldungen.sqlite'))) return [];
    const n = Math.max(1, Math.min(2000, Number(limit) || 200));
    return this._open().prepare('SELECT * FROM events ORDER BY come DESC LIMIT ?').all(n).map((r) => this._row(r));
  }

  /** Meldungen, die im Zeitraum anstanden (älteste zuerst); level: 'fault' | 'warn' | 'info' oder leer = alle */
  range(from, to, level) {
    if (!this.db && !fs.existsSync(path.join(this.dir, 'meldungen.sqlite'))) return [];
    const lv = LEVELS.includes(level) ? level : null;
    return this._open().prepare(`SELECT * FROM events WHERE come <= ? AND (gone IS NULL OR gone >= ?) ${lv ? 'AND level = ?' : ''}
      ORDER BY come LIMIT 100000`).all(...[to, from].concat(lv ? [lv] : [])).map((r) => this._row(r));
  }

  /** Zeit des ältesten Eintrags (oder null) */
  oldest() {
    if (!this.db && !fs.existsSync(path.join(this.dir, 'meldungen.sqlite'))) return null;
    const r = this._open().prepare('SELECT MIN(come) AS t FROM events').get();
    return r && r.t !== null ? r.t : null;
  }

  _row(r) {
    const def = this.defs.find((d) => d.id === r.aid);
    return { id: r.id, aid: r.aid, dev: r.dev, name: r.name, text: (def && def.text) || r.text || this.labelOf(r.dev, r.name) || r.name, level: r.level,
      come: r.come, gone: r.gone, ack: r.ack, canAck: r.level === 'fault' && r.ack === null };
  }

  /**
   * quittieren: id = ein Eintrag, 'all' = alle offenen Störungen. Schreibt je Quittier-Variable einen Impuls.
   * Liefert die Zahl der quittierten Einträge.
   */
  async acknowledge(id) {
    if (!this.db && !fs.existsSync(path.join(this.dir, 'meldungen.sqlite'))) return 0;
    const db = this._open();
    const rows = id === 'all'
      ? db.prepare("SELECT * FROM events WHERE level = 'fault' AND ack IS NULL").all()
      : db.prepare("SELECT * FROM events WHERE id = ? AND level = 'fault' AND ack IS NULL").all(Number(id));
    if (!rows.length) return 0;
    const now = this.now();
    const st = db.prepare('UPDATE events SET ack = ? WHERE id = ?');
    for (const r of rows) st.run(now, r.id);
    // Quittier-Impuls je betroffenem Gerät (Quittier-Merker in der Steuerung)
    const targets = new Map();
    for (const r of rows) if (this.ackVars[r.dev]) targets.set(r.dev, { dev: r.dev, name: this.ackVars[r.dev] });
    if (this.write) {
      for (const t of targets.values()) {
        try {
          await this.write(t.dev, t.name, 1);
          setTimeout(() => { this.write(t.dev, t.name, 0).catch(() => {}); }, 1000).unref();
        } catch (e) { /* Quittung in der Visu gilt trotzdem; Fehler meldet die Oberfläche beim Schreiben */ }
      }
    }
    return rows.length;
  }

  prune() {
    if (!this.db && !fs.existsSync(path.join(this.dir, 'meldungen.sqlite'))) return 0;
    this._open();
    const limit = this.now() - this.retentionDays * DAY_MS;
    return Number(this.db.prepare('DELETE FROM events WHERE come < ? AND gone IS NOT NULL AND (ack IS NOT NULL OR level <> \'fault\')').run(limit).changes);
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

module.exports = { Alarms, cleanDefs, LEVELS };
