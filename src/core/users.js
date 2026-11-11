'use strict';
/**
 * Benutzer und Rollen (Version 1, Punkt 4). Datei: <Datenordner>/benutzer.json
 *
 * Rollen: 'viewer' (Beobachter: ansehen), 'operator' (Bediener: bedienen, quittieren),
 *         'setup' (Einrichter: alles – Editor, Geräte, Benutzer, Protokoll, Bedienmodus verlassen).
 * Die Anmeldung ist aktiv, sobald es einen Einrichter gibt; vorher ist alles offen (wie bisher).
 * Je Benutzer Passwort und/oder PIN (4–8 Ziffern). Gespeichert wird nur ein Prüfwert (scrypt mit Salz), nie das
 * Passwort selbst. Nach 5 Fehlversuchen ist die Anmeldung dieses Benutzers gesperrt: 1 Minute, nach jeder weiteren
 * Serie von 5 Fehlversuchen doppelt so lange (2, 4, 8 … höchstens 15 Minuten); eine erfolgreiche Anmeldung setzt das zurück.
 * Einstellungen: guestRole = Rolle ohne Anmeldung (Standard Beobachter), logoutMin = Abmelden nach Minuten ohne
 * Bedienung (0 = nie).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { t } = require('../i18n');

const ROLES = ['viewer', 'operator', 'setup'];
const RANK = { viewer: 0, operator: 1, setup: 2 };
const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;
const LOCK_MAX_MS = 15 * 60 * 1000;
const str = (v, max) => (v === undefined || v === null ? '' : String(v)).slice(0, max || 200);

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(secret), salt, 32).toString('hex');
  return { salt, hash };
}
function checkSecret(stored, secret) {
  if (!stored || !stored.salt || !stored.hash || secret === undefined || secret === null) return false;
  const a = Buffer.from(stored.hash, 'hex');
  const b = crypto.scryptSync(String(secret), stored.salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class Users {
  /** opts: { dir, now = () => Date.now() } */
  constructor(opts) {
    this.dir = opts.dir;
    this.now = opts.now || (() => Date.now());
    this.users = [];
    this.settings = { guestRole: 'viewer', logoutMin: 10 };
    this.fails = new Map(); // Benutzer-id -> { count, until }
    this.load();
  }

  get file() { return path.join(this.dir, 'benutzer.json'); }

  load() {
    const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    this.users = (Array.isArray(data.users) ? data.users : []).filter((u) => u && u.id && str(u.name).trim() && ROLES.includes(u.role));
    const s = data.settings || {};
    this.settings = { guestRole: ROLES.includes(s.guestRole) ? s.guestRole : 'viewer',
      logoutMin: Number.isFinite(Number(s.logoutMin)) ? Math.max(0, Math.min(240, Math.round(Number(s.logoutMin)))) : 10 };
    return this;
  }

  _write() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, users: this.users, settings: this.settings }, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** Anmeldung aktiv? (es gibt mindestens einen Einrichter) */
  active() { return this.users.some((u) => u.role === 'setup'); }

  /** öffentliche Liste: ohne Prüfwerte */
  list() {
    return this.users.map((u) => ({ id: u.id, name: u.name, role: u.role, hasPassword: !!u.pw, hasPin: !!u.pin }));
  }

  get(id) { return this.users.find((u) => u.id === id) || null; }

  _check(input, old) {
    const name = str(input.name, 40).trim();
    if (!name) throw new Error(t('users.errors.name'));
    if (this.users.some((u) => u.name.toLowerCase() === name.toLowerCase() && (!old || u.id !== old.id))) throw new Error(t('users.errors.nameTwice', { name }));
    if (!ROLES.includes(input.role)) throw new Error(t('users.errors.role'));
    const pw = input.password === undefined || input.password === null ? '' : String(input.password);
    const pin = input.pin === undefined || input.pin === null ? '' : String(input.pin).trim();
    if (pw && pw.length < 6) throw new Error(t('users.errors.passwordShort'));
    if (pin && !/^\d{4,8}$/.test(pin)) throw new Error(t('users.errors.pin'));
    return { name, pw, pin };
  }

  /** neuer Benutzer: { name, role, password?, pin? } – mindestens eins von beiden */
  add(input) {
    const { name, pw, pin } = this._check(input || {}, null);
    if (!pw && !pin) throw new Error(t('users.errors.noSecret'));
    const u = { id: crypto.randomUUID(), name, role: input.role, pw: pw ? hashSecret(pw) : null, pin: pin ? hashSecret(pin) : null, created: this.now() };
    this.users.push(u);
    this._write();
    return this.list().find((x) => x.id === u.id);
  }

  /** ändern: { name, role, password? (leer = bleibt), pin? (leer = bleibt), clearPin?, clearPassword? } */
  update(id, input) {
    const u = this.get(id);
    if (!u) throw new Error(t('users.errors.notFound'));
    const { name, pw, pin } = this._check(Object.assign({ name: u.name, role: u.role }, input), u);
    const role = input.role || u.role;
    if (u.role === 'setup' && role !== 'setup' && this.users.filter((x) => x.role === 'setup').length === 1) throw new Error(t('users.errors.lastSetup'));
    const next = Object.assign({}, u, { name, role });
    if (pw) next.pw = hashSecret(pw);
    if (pin) next.pin = hashSecret(pin);
    if (input.clearPin) next.pin = null;
    if (input.clearPassword) next.pw = null;
    if (!next.pw && !next.pin) throw new Error(t('users.errors.noSecret'));
    this.users[this.users.indexOf(u)] = next;
    this._write();
    return this.list().find((x) => x.id === id);
  }

  remove(id) {
    const u = this.get(id);
    if (!u) return false;
    if (u.role === 'setup' && this.users.filter((x) => x.role === 'setup').length === 1 && this.users.length > 1) {
      throw new Error(t('users.errors.lastSetup'));
    }
    this.users = this.users.filter((x) => x.id !== id);
    this.fails.delete(id);
    this._write();
    return true;
  }

  /** gewählte Sprache eines Benutzers merken */
  setLang(id, lang) {
    const u = this.get(id);
    if (!u) return false;
    if (lang) u.lang = String(lang).slice(0, 10); else delete u.lang;
    this._write();
    return true;
  }

  /** Notfall-Zugang: Passwort eines Benutzers neu setzen (nur nach Prüfung „Windows-Administrator“ durch den Aufrufer) */
  resetPassword(id, password) {
    const u = this.get(id);
    if (!u) throw new Error(t('users.errors.notFound'));
    if (!password || String(password).length < 6) throw new Error(t('users.errors.passwordShort'));
    u.pw = hashSecret(password);
    this.fails.delete(id);
    this._write();
    return true;
  }

  setSettings(s) {
    if (s && ROLES.includes(s.guestRole)) this.settings.guestRole = s.guestRole;
    if (s && Number.isFinite(Number(s.logoutMin))) this.settings.logoutMin = Math.max(0, Math.min(240, Math.round(Number(s.logoutMin))));
    this._write();
    return Object.assign({}, this.settings);
  }

  /**
   * Anmelden mit Passwort oder PIN. Ergebnis: { ok, user? } | { ok: false, locked: true, wait (s) } | { ok: false, left }
   */
  verify(id, secret) {
    const u = this.get(id);
    if (!u) return { ok: false, left: 0 };
    const f = this.fails.get(id) || { count: 0, until: 0, series: 0 };
    const now = this.now();
    if (f.until > now) return { ok: false, locked: true, wait: Math.ceil((f.until - now) / 1000) };
    if (checkSecret(u.pw, secret) || checkSecret(u.pin, secret)) {
      this.fails.delete(id);
      return { ok: true, user: { id: u.id, name: u.name, role: u.role } };
    }
    f.count = f.until && f.until <= now ? 1 : f.count + 1; // nach Ablauf der Sperre neu zählen
    f.until = 0;
    if (f.count >= MAX_FAILS) {
      const ms = Math.min(LOCK_MAX_MS, LOCK_MS * 2 ** (f.series || 0)); // jede weitere Serie: doppelt so lange
      f.series = (f.series || 0) + 1;
      f.until = now + ms;
      f.count = 0;
      this.fails.set(id, f);
      return { ok: false, locked: true, wait: ms / 1000, justLocked: true };
    }
    this.fails.set(id, f);
    return { ok: false, left: MAX_FAILS - f.count };
  }
}

module.exports = { Users, ROLES, RANK, MAX_FAILS, LOCK_MS, LOCK_MAX_MS };
