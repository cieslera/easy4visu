'use strict';
/**
 * Aktuelle Werte aller Variablen aller Geräte (die „Variablenliste“ zur Laufzeit).
 *
 * Eintrag je Gerät + Variable: { value, ts (Zeitpunkt des Werts), quality, error, changes (Anzahl Änderungen) }
 *   quality 'good'   = frisch gelesen
 *           'bad'    = diese Variable ließ sich nicht lesen (error sagt warum)
 *           'stale'  = Gerät gerade nicht erreichbar; value ist der letzte bekannte Wert
 * Ereignis 'change' (deviceId, name, entry) nur, wenn sich Wert oder Qualität ändert.
 */

const EventEmitter = require('node:events');

const same = (a, b) => (a !== null && typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b);

class ValueStore extends EventEmitter {
  constructor() {
    super();
    this.data = new Map(); // deviceId -> Map(name -> entry)
  }

  _dev(deviceId) {
    if (!this.data.has(deviceId)) this.data.set(deviceId, new Map());
    return this.data.get(deviceId);
  }

  _put(deviceId, name, entry) {
    const m = this._dev(deviceId);
    const old = m.get(name);
    // zählen, wie oft sich ein frisch gelesener Wert geändert hat (Hinweis „ändert sich von selbst“)
    const changed = old && old.quality === 'good' && entry.quality === 'good' && !same(old.value, entry.value);
    entry.changes = (old && old.changes ? old.changes : 0) + (changed ? 1 : 0);
    m.set(name, entry);
    if (!old || !same(old.value, entry.value) || old.quality !== entry.quality || old.error !== entry.error) {
      this.emit('change', deviceId, name, entry);
    }
  }

  /** Ergebnis von driver.read() übernehmen */
  update(deviceId, result, ts) {
    const now = ts || Date.now();
    for (const [name, value] of Object.entries(result.values || {})) {
      this._put(deviceId, name, { value, ts: now, quality: 'good', error: null });
    }
    for (const e of result.errors || []) {
      const old = this._dev(deviceId).get(e.name);
      this._put(deviceId, e.name, { value: old ? old.value : null, ts: old ? old.ts : null, quality: 'bad', error: e.text });
    }
  }

  /** Gerät nicht erreichbar: alle Werte als veraltet markieren (Wert bleibt sichtbar) */
  markStale(deviceId, text) {
    for (const [name, old] of this._dev(deviceId)) {
      if (old.quality !== 'stale' || old.error !== text) this._put(deviceId, name, Object.assign({}, old, { quality: 'stale', error: text }));
    }
  }

  /** Variablen ohne bisherigen Eintrag anlegen (damit die Visu sie gleich als „noch kein Wert“ zeigt) */
  declare(deviceId, names) {
    const m = this._dev(deviceId);
    for (const n of names) if (!m.has(n)) m.set(n, { value: null, ts: null, quality: 'stale', error: null });
  }

  get(deviceId, name) {
    const m = this.data.get(deviceId);
    return m ? m.get(name) : undefined;
  }

  /** alles als einfaches Objekt: { deviceId: { name: entry } } */
  snapshot(deviceId) {
    const conv = (m) => Object.fromEntries([...m].map(([k, v]) => [k, Object.assign({}, v)]));
    if (deviceId !== undefined) return conv(this._dev(deviceId));
    return Object.fromEntries([...this.data].map(([id, m]) => [id, conv(m)]));
  }

  removeDevice(deviceId) { this.data.delete(deviceId); }
}

module.exports = { ValueStore };
