'use strict';
/**
 * Geräteverwaltung: welche easyE4 es gibt, mit welchem Protokoll und welchen Variablen.
 *
 * Gespeichert in einem Datenordner (Standard: %APPDATA%\easy4visu):
 *   devices.json   Geräte mit Einstellungen und Variablen – ohne Passwörter
 *   secrets.json   Passwörter und API-Schlüssel getrennt davon. Über protect/unprotect verschlüsselt
 *                  (im fertigen Programm mit der Windows-Verschlüsselung von Electron); ohne diese Funktionen
 *                  stehen sie im Klartext und die Datei ist als "unprotected" markiert.
 *
 * Gerät: { id, name, protocol: 'modbus' | 'json' | 'mqtt', settings: {...}, interval: ms, enabled, variables: [...] }
 * Die Einstellungen je Protokoll stehen in src/protocols/<protokoll>/driver.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const { protocols } = require('../protocols');
const { t } = require('../i18n');

const FILE_VERSION = 1;
// Kleinstes Abfrageintervall je Protokoll (JSON-API: Webserver der easyE4 schonen)
const MIN_INTERVAL = { modbus: 100, json: 500, mqtt: 500 };
const DEFAULT_INTERVAL = 1000;
const SECRET_FIELDS = ['password', 'apikey'];

function defaultDir() {
  const base = process.env.APPDATA || path.join(require('node:os').homedir(), '.config');
  return path.join(base, 'easy4visu');
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

class DeviceStore extends EventEmitter {
  /**
   * @param opts { dir, protect(text) -> text, unprotect(text) -> text }
   */
  constructor(opts) {
    super();
    opts = opts || {};
    this.dir = opts.dir || defaultDir();
    this.protect = opts.protect || null;
    this.unprotect = opts.unprotect || null;
    this.devices = new Map();
    this.secrets = new Map();
  }

  get file() { return path.join(this.dir, 'devices.json'); }
  get secretFile() { return path.join(this.dir, 'secrets.json'); }

  /** Laden; fehlende Dateien = noch keine Geräte */
  load() {
    this.devices.clear();
    this.secrets.clear();
    if (fs.existsSync(this.file)) {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const d of data.devices || []) this.devices.set(d.id, this._normalize(d));
    }
    if (fs.existsSync(this.secretFile)) {
      const data = JSON.parse(fs.readFileSync(this.secretFile, 'utf8'));
      let entries = data.secrets || {};
      if (data.protected) {
        if (!this.unprotect) throw new Error(t('core.errors.secretsLocked'));
        entries = JSON.parse(this.unprotect(entries));
      }
      for (const [id, s] of Object.entries(entries)) this.secrets.set(id, s);
    }
    return this;
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const devices = [...this.devices.values()];
    writeAtomic(this.file, `${JSON.stringify({ version: FILE_VERSION, devices }, null, 2)}\n`);
    const plain = Object.fromEntries(this.secrets);
    const body = this.protect
      ? { version: FILE_VERSION, protected: true, secrets: this.protect(JSON.stringify(plain)) }
      : { version: FILE_VERSION, protected: false, unprotected: true, secrets: plain };
    writeAtomic(this.secretFile, `${JSON.stringify(body, null, 2)}\n`);
    this.emit('saved');
  }

  _normalize(d) {
    const protocol = d.protocol;
    const min = MIN_INTERVAL[protocol] || DEFAULT_INTERVAL;
    const iv = Number(d.interval);
    return {
      id: String(d.id),
      name: String(d.name || '').trim(),
      protocol,
      settings: Object.assign({}, d.settings),
      interval: Number.isFinite(iv) ? Math.max(min, Math.round(iv)) : DEFAULT_INTERVAL,
      enabled: d.enabled !== false,
      variables: Array.isArray(d.variables) ? d.variables.map((v) => Object.assign({}, v)) : [],
    };
  }

  /** Probleme eines Geräts (leere Liste = in Ordnung) */
  validate(d, ignoreId) {
    const problems = [];
    if (!d.name || !String(d.name).trim()) problems.push(t('core.errors.noName'));
    else if ([...this.devices.values()].some((x) => x.id !== ignoreId && x.name.toLowerCase() === String(d.name).trim().toLowerCase())) {
      problems.push(t('core.errors.nameTaken', { name: String(d.name).trim() }));
    }
    if (!protocols().includes(d.protocol)) problems.push(t('device.errors.unknownProtocol', { protocol: d.protocol }));
    const names = new Set();
    for (const v of d.variables || []) {
      if (!v || !v.name) { problems.push(t('core.errors.variableNoName')); continue; }
      if (names.has(v.name)) problems.push(t('core.errors.variableTwice', { name: v.name }));
      names.add(v.name);
    }
    return problems;
  }

  list() { return [...this.devices.values()]; }
  get(id) { return this.devices.get(id); }

  /** Gerät anlegen; secrets (Passwort, API-Schlüssel) werden getrennt gespeichert. Liefert das Gerät. */
  add(device, secrets) {
    const d = this._normalize(Object.assign({}, device, { id: device.id || crypto.randomUUID() }));
    for (const f of SECRET_FIELDS) delete d.settings[f]; // nie in devices.json
    const problems = this.validate(d);
    if (problems.length) throw Object.assign(new Error(problems.join('; ')), { problems });
    if (this.devices.has(d.id)) throw new Error(t('core.errors.idTaken', { id: d.id }));
    this.devices.set(d.id, d);
    if (secrets) this.setSecrets(d.id, secrets);
    this.emit('change', d.id);
    return d;
  }

  update(id, patch) {
    const old = this.devices.get(id);
    if (!old) throw new Error(t('core.errors.noDevice', { id }));
    const d = this._normalize(Object.assign({}, old, patch, { id, settings: Object.assign({}, old.settings, patch.settings) }));
    for (const f of SECRET_FIELDS) delete d.settings[f];
    const problems = this.validate(d, id);
    if (problems.length) throw Object.assign(new Error(problems.join('; ')), { problems });
    this.devices.set(id, d);
    this.emit('change', id);
    return d;
  }

  remove(id) {
    const ok = this.devices.delete(id);
    this.secrets.delete(id);
    if (ok) this.emit('change', id);
    return ok;
  }

  setSecrets(id, secrets) {
    const s = {};
    for (const f of SECRET_FIELDS) if (secrets && secrets[f] !== undefined && secrets[f] !== '') s[f] = String(secrets[f]);
    this.secrets.set(id, s);
  }
  getSecrets(id) { return Object.assign({}, this.secrets.get(id)); }

  /** Variablen eines Geräts ersetzen (z. B. nach dem Import einer .itf-Datei) */
  setVariables(id, variables) {
    return this.update(id, { variables });
  }
}

module.exports = { DeviceStore, MIN_INTERVAL, defaultDir };
