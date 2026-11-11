'use strict';
/**
 * Gemeinsame Schnittstelle aller Protokolle (Modbus TCP, JSON-API, MQTT).
 * Jedes Protokoll liefert eine Klasse, die von Driver erbt. Der Rest des Programms
 * (Geräteverwaltung, Abfrage, Visu) kennt nur diese Schnittstelle.
 *
 *   const drv = createDriver({ protocol: 'modbus', host: '192.168.1.140' });
 *   drv.on('state', (state) => ...);              // 'unknown' | 'online' | 'offline' | 'auth'
 *   const r = await drv.read(variables);           // { values: { MW3: 42 }, errors: [{ name, code, text }] }
 *   await drv.write(variable, 5);                  // wirft einen Fehler mit deutschem Text, wenn es nicht geht
 *   const t = await drv.test();                    // { ok, text, ... } – für „Verbindung testen“, wirft nie
 *   await drv.close();
 *
 * Variablen: Format siehe docs/VARIABLEN.md (entsteht z. B. beim Import, src/import/itf.js):
 *   { name, operand, index, net?, type, writable, modbus? }
 * Schlüssel in den Ergebnissen ist variable.id, falls vorhanden, sonst variable.name.
 *
 * Fehler: read() wirft nur, wenn das ganze Gerät nicht erreichbar ist (err.network = true) oder die
 * Anmeldung scheitert (err.auth = true). Einzelne nicht lesbare Variablen stehen in errors.
 */

const EventEmitter = require('node:events');
const { t } = require('../i18n');

const STATES = ['unknown', 'online', 'offline', 'auth'];

function keyOf(variable) {
  return variable.id !== undefined && variable.id !== null ? String(variable.id) : String(variable.name);
}

class Driver extends EventEmitter {
  constructor(settings, secrets) {
    super();
    this.settings = Object.assign({}, settings);
    this.secrets = Object.assign({}, secrets);
    this.state = 'unknown';
    /** Text, wenn die Einstellungen unbrauchbar sind (z. B. keine Adresse); dann geht nichts. */
    this.problem = null;
    this.closed = false;
  }

  _setState(state, detail) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state, detail);
  }

  /** Text zum aktuellen Zustand, z. B. „verbunden“ */
  stateText() { return t(`device.state.${this.state}`); }

  async read() { throw new Error('read() fehlt'); }
  async write() { throw new Error('write() fehlt'); }
  async test() { throw new Error('test() fehlt'); }
  async close() { this.closed = true; }
}

module.exports = { Driver, keyOf, STATES };
