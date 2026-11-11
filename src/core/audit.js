'use strict';
/**
 * Bedienprotokoll (Version 1, Punkt 4). Datei: <Datenordner>/protokoll.sqlite
 *
 * Jeder Eintrag: Zeit, Benutzer, Art, Gerät, Variable, Beschreibung, alter und neuer Wert.
 * Arten: 'write' (Schreibbefehl), 'ack' (quittiert), 'login', 'logout', 'autoLogout', 'loginFail', 'locked',
 *        'user' (Benutzer angelegt/geändert/gelöscht, Einstellungen), 'exitOperate' (Bedienmodus verlassen),
 *        'emergency' (Notfall-Zugang), 'quit' (easy4Visu beendet).
 * Einträge können nicht geändert oder gelöscht werden – es gibt dafür keine Funktion. Nur die Aufbewahrungsfrist
 * (wie bei den Meldungen, Standard 1 Jahr) räumt alte Einträge auf.
 */

const fs = require('node:fs');
const path = require('node:path');

const KINDS = ['write', 'ack', 'login', 'logout', 'autoLogout', 'loginFail', 'locked', 'user', 'exitOperate', 'emergency', 'quit'];
const DAY_MS = 24 * 3600 * 1000;
const str = (v, max) => (v === undefined || v === null ? null : String(v).slice(0, max || 300));

class AuditLog {
  /** opts: { dir, now = () => Date.now(), retentionDays = 365 } */
  constructor(opts) {
    this.dir = opts.dir;
    this.now = opts.now || (() => Date.now());
    this.retentionDays = opts.retentionDays || 365;
    this.db = null;
  }

  get file() { return path.join(this.dir, 'protokoll.sqlite'); }

  _open() {
    if (this.db) return this.db;
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, user TEXT, kind TEXT NOT NULL,
        dev TEXT, device TEXT, name TEXT, what TEXT, old TEXT, new TEXT);
      CREATE INDEX IF NOT EXISTS log_ts ON log (ts);
    `);
    return this.db;
  }

  /** Eintrag hinzufügen: { user, kind, dev, device (Name), name (Variable), what, old, new } */
  add(e) {
    if (!e || !KINDS.includes(e.kind)) throw new Error(`Bedienprotokoll: unbekannte Art ${e && e.kind}`);
    const v = (x) => (x === undefined || x === null ? null : typeof x === 'boolean' ? (x ? '1' : '0') : String(x).slice(0, 100));
    this._open().prepare('INSERT INTO log (ts, user, kind, dev, device, name, what, old, new) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(this.now(), str(e.user, 80), e.kind, str(e.dev, 80), str(e.device, 80), str(e.name, 120), str(e.what, 300), v(e.old), v(e.new));
  }

  /** Einträge, neueste zuerst. filter: { from, to, user, limit } */
  query(filter) {
    if (!this.db && !fs.existsSync(this.file)) return [];
    const f = filter || {};
    const where = ['ts >= ?', 'ts <= ?'];
    const args = [Number(f.from) || 0, Number(f.to) || 8.64e15];
    if (f.user) { where.push('user = ?'); args.push(String(f.user)); }
    const limit = Math.max(1, Math.min(20000, Number(f.limit) || 1000));
    return this._open().prepare(`SELECT * FROM log WHERE ${where.join(' AND ')} ORDER BY ts DESC, id DESC LIMIT ${limit}`).all(...args)
      .map((r) => ({ id: r.id, ts: r.ts, user: r.user, kind: r.kind, dev: r.dev, device: r.device, name: r.name, what: r.what, old: r.old, new: r.new }));
  }

  /** CSV (Semikolon, UTF-8 mit BOM – öffnet sich in Excel richtig) */
  csv(filter, labels) {
    const L = labels || {};
    const q = (s) => {
      const x = s === null || s === undefined ? '' : String(s);
      return /[";\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    const head = ['Zeit', 'Benutzer', 'Art', 'Gerät', 'Variable', 'Beschreibung', 'alt', 'neu'].map((k) => (L.head && L.head[k]) || k);
    const rows = this.query(Object.assign({ limit: 20000 }, filter)).reverse().map((r) => [
      new Date(r.ts).toLocaleString('de-DE'), r.user || '', (L.kinds && L.kinds[r.kind]) || r.kind, r.device || '', r.name || '', r.what || '', r.old || '', r.new || '']);
    return `﻿${[head].concat(rows).map((r) => r.map(q).join(';')).join('\r\n')}\r\n`;
  }

  /** Zeit des ältesten Eintrags (oder null) */
  oldest() {
    if (!this.db && !fs.existsSync(this.file)) return null;
    const r = this._open().prepare('SELECT MIN(ts) AS t FROM log').get();
    return r && r.t !== null ? r.t : null;
  }

  prune() {
    if (!this.db && !fs.existsSync(this.file)) return 0;
    this._open();
    return Number(this.db.prepare('DELETE FROM log WHERE ts < ?').run(this.now() - this.retentionDays * DAY_MS).changes);
  }

  close() {
    if (this.db) { this.db.close(); this.db = null; }
  }
}

module.exports = { AuditLog, KINDS };
