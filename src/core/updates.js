'use strict';
/**
 * Updates (Version 1.0.1, Ralf 25.11.2026): easy4Visu sucht beim Start und dann einmal täglich auf GitHub nach einer
 * neueren Version. Installiert wird nie von selbst – nur wenn ein Techniker „Herunterladen und installieren“ und danach
 * „Jetzt neu starten“ wählt (eine Anlagen-Visu darf nicht plötzlich neu starten).
 *
 * Die eigentliche Arbeit macht electron-updater (app/main.js reicht dessen autoUpdater herein): Release-Liste auf
 * GitHub, latest.yml mit Prüfsumme, Herunterladen, Setup still ausführen. Hier steht nur der Ablauf, die Einstellung
 * „Automatisch nach Updates suchen“ (Datei updates.json im Datenordner, ab Werk an) und der Stand für die Oberfläche.
 * Ohne updater (beim Entwickeln, in der Demo, in der UI-Prüfung) gibt es nur die Versionsanzeige.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const START_DELAY_MS = 30 * 1000;      // nach dem Start erst die Geräte verbinden lassen
const DAY_MS = 24 * 3600 * 1000;

/** Text der Release-Beschreibung ohne HTML (GitHub liefert sie als HTML) */
function plainNotes(notes) {
  if (!notes) return '';
  const text = Array.isArray(notes) ? notes.map((n) => (n && n.note) || '').join('\n\n') : String(notes);
  return text.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

class Updates extends EventEmitter {
  /** opts: { dir: Datenordner, version: installierte Version, updater: autoUpdater oder null, reason: warum ohne updater } */
  constructor(opts) {
    super();
    this.dir = opts.dir;
    this.version = opts.version;
    this.updater = opts.updater || null;
    this.reason = opts.reason || 'dev'; // 'dev' (nicht installiert) | 'demo'
    this.status = this.updater ? 'idle' : 'unsupported';
    this.available = null;   // { version, notes, date }
    this.percent = 0;
    this.error = null;
    this.manual = false;     // Suche vom Techniker ausgelöst (Fehler dann zeigen)
    this.lastCheck = null;
    this.timers = [];
    const u = this.updater;
    if (!u) return;
    u.on('checking-for-update', () => this._set({ status: 'checking', error: null }));
    u.on('update-available', (info) => this._set({ status: 'available', available: this._info(info) }));
    u.on('update-not-available', () => this._set({ status: 'none', available: null }));
    u.on('download-progress', (p) => this._set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0))) }));
    u.on('update-downloaded', (info) => this._set({ status: 'ready', percent: 100, available: this._info(info) }));
    u.on('error', (err) => this._failed(err));
  }

  _info(info) {
    const i = info || {};
    return { version: String(i.version || ''), notes: plainNotes(i.releaseNotes), date: i.releaseDate || null };
  }

  _failed(err) {
    // ohne Internet bei der automatischen Suche: still bleiben, beim nächsten Mal wieder versuchen
    const msg = (err && err.message) || String(err);
    if (this.manual || this.status === 'downloading') this._set({ status: 'error', error: msg });
    else this._set({ status: this.available ? 'available' : 'idle', error: null });
  }

  _set(patch) {
    Object.assign(this, patch);
    this.emit('state', this.state());
  }

  get _file() { return path.join(this.dir, 'updates.json'); }

  /** Einstellung „Automatisch nach Updates suchen“ (ab Werk an) */
  get auto() {
    try { return JSON.parse(fs.readFileSync(this._file, 'utf8')).auto !== false; } catch (e) { return true; }
  }

  setAuto(on) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this._file, `${JSON.stringify({ auto: !!on }, null, 2)}\n`, 'utf8');
    this.emit('state', this.state());
    return this.state();
  }

  state() {
    return { version: this.version, supported: !!this.updater, reason: this.updater ? null : this.reason, auto: this.auto,
      status: this.status, available: this.available, percent: this.percent, error: this.error, lastCheck: this.lastCheck };
  }

  /** Suche beim Start (nach kurzer Wartezeit) und danach einmal täglich – nur wenn eingeschaltet */
  start() {
    if (!this.updater) return;
    const tick = () => { if (this.auto) this.check(false).catch(() => {}); };
    this.timers.push(setTimeout(tick, START_DELAY_MS), setInterval(tick, DAY_MS));
  }

  stop() {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers = [];
  }

  /** nach einer neuen Version sehen; manual = vom Techniker ausgelöst (Fehler werden dann angezeigt) */
  async check(manual) {
    if (!this.updater) return this.state();
    if (['checking', 'downloading', 'ready'].includes(this.status)) return this.state();
    this.manual = !!manual;
    this.lastCheck = Date.now();
    try { await this.updater.checkForUpdates(); } catch (err) { if (this.status !== 'error') this._failed(err); }
    return this.state();
  }

  /** gefundene Version herunterladen (Prüfsumme prüft electron-updater) */
  async download() {
    if (!this.updater || !this.available) return this.state();
    if (['downloading', 'ready'].includes(this.status)) return this.state();
    this.manual = true;
    this._set({ status: 'downloading', percent: 0, error: null });
    try { await this.updater.downloadUpdate(); } catch (err) { if (this.status !== 'error') this._failed(err); }
    return this.state();
  }

  /** heruntergeladenes Setup still ausführen; easy4Visu beendet sich und startet danach von selbst neu */
  install() {
    if (!this.updater || this.status !== 'ready') throw new Error('not ready');
    this.stop();
    this.updater.quitAndInstall(true, true);
  }
}

module.exports = { Updates, plainNotes, START_DELAY_MS, DAY_MS };
