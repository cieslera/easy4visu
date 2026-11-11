'use strict';
/**
 * Laufzeit: verbindet die Geräteverwaltung mit den Protokoll-Treibern und dem Werte-Speicher.
 *
 *   const rt = new Runtime(deviceStore, valueStore);
 *   rt.on('state', (deviceId, state, text) => ...);   // 'unknown' | 'online' | 'offline' | 'auth'
 *   await rt.start();                                  // verbinden: alle eingeschalteten Geräte abfragen
 *   rt.active                                          // verbunden? (sonst startet auch reload() nichts)
 *   await rt.write(deviceId, 'MW5', 2000);
 *   await rt.stop();
 *
 * Abfrage je Gerät: lesen, Werte übernehmen, warten bis das Intervall um ist, wieder lesen – nie zwei
 * Abfragen desselben Geräts gleichzeitig. Ist ein Gerät nicht erreichbar, bleiben die letzten Werte sichtbar
 * (Qualität 'stale'); die wachsende Fehlerpause steckt in der Warteschlange des Treibers.
 */

const EventEmitter = require('node:events');
const { createDriver } = require('../protocols');
const { t } = require('../i18n');

class DevicePoller extends EventEmitter {
  constructor(device, driver, values) {
    super();
    this.device = device;
    this.driver = driver;
    this.values = values;
    this.stopped = true;
    this.timer = null;
    this.busy = null;
    this.again = false;
    this.lastError = null;
    // MQTT: die easyE4 sendet selbst – neue Werte sofort übernehmen
    this.onValues = () => this.kick();
    driver.on('values', this.onValues);
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.values.declare(this.device.id, this.device.variables.map((v) => v.id || v.name));
    this._run();
  }

  async _poll() {
    const vars = this.device.variables;
    if (!vars.length) return;
    try {
      const r = await this.driver.read(vars);
      if (this.stopped) return;
      this.values.update(this.device.id, r);
      this.lastError = null;
      this.emit('polled', r);
    } catch (err) {
      if (this.stopped) return;
      this.values.markStale(this.device.id, err.message);
      if (err.message !== this.lastError) this.emit('error', err); // denselben Fehler nur einmal melden
      this.lastError = err.message;
    }
  }

  _run() {
    if (this.stopped || this.busy) return;
    clearTimeout(this.timer);
    const t0 = Date.now();
    this.busy = this._poll().finally(() => {
      this.busy = null;
      if (this.stopped) return;
      if (this.again) {
        this.again = false;
        return this._run();
      }
      this.timer = setTimeout(() => this._run(), Math.max(0, this.device.interval - (Date.now() - t0)));
    });
  }

  /** gleich (noch einmal) lesen, z. B. nach dem Schreiben */
  kick() {
    if (this.stopped) return;
    if (this.busy) this.again = true;
    else this._run();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.driver.off('values', this.onValues);
    if (this.busy) await this.busy.catch(() => {});
  }
}

class Runtime extends EventEmitter {
  /**
   * @param devices  DeviceStore
   * @param values   ValueStore
   */
  constructor(devices, values) {
    super();
    this.devices = devices;
    this.values = values;
    this.running = new Map(); // deviceId -> { driver, poller }
    this.active = false;
    // Demo-Modus: { alarmVars(deviceId) } – dann eingebaute Simulatoren statt der echten Geräte (src/protocols/demo)
    this.demo = null;
  }

  _startDevice(d) {
    const driver = this.demo
      ? new (require('../protocols/demo/driver').DemoDriver)(Object.assign({}, d.settings, { protocol: d.protocol }), {}, { alarmVars: this.demo.alarmVars(d.id), controlVars: this.demo.controlVars ? this.demo.controlVars(d.id) : null, ranges: this.demo.ranges ? this.demo.ranges(d.id) : null,
          pulses: this.demo.pulses ? this.demo.pulses(d.id) : null, links: this.demo.links ? this.demo.links(d.id) : null,
          enums: this.demo.enums ? this.demo.enums(d.id) : null, sums: this.demo.sums ? this.demo.sums(d.id) : null })
      : createDriver(Object.assign({}, d.settings, { protocol: d.protocol }), this.devices.getSecrets(d.id));
    const poller = new DevicePoller(d, driver, this.values);
    driver.on('state', (state, detail) => this.emit('state', d.id, state, driver.stateText(), detail));
    poller.on('error', (err) => this.emit('deviceError', d.id, err));
    poller.on('polled', () => this.emit('polled', d.id, Date.now())); // für „letzter Wert vor … s“ (Gerätekarte)
    this.running.set(d.id, { driver, poller });
    if (driver.problem) {
      this.emit('deviceError', d.id, new Error(driver.problem));
      return;
    }
    poller.start();
    // Ohne Variablen wird nichts abgefragt: dann einmal „Verbindung testen“, damit der Zustand stimmt
    if (!d.variables.length) {
      driver.test().then((r) => {
        if (this.running.get(d.id) === undefined || this.running.get(d.id).driver !== driver) return;
        // MQTT: Broker erreichbar, aber die easyE4 sendet nichts -> nicht erreichbar
        const ok = r.ok && !r.noData;
        const state = ok ? 'online' : (/Anmeldung|401/.test(r.text) ? 'auth' : 'offline');
        this.emit('state', d.id, state, ok ? t('device.state.online') : r.noData ? t('mqtt.state.noData') : r.text, r.noData ? 'nodata' : undefined);
      }, () => {});
    }
  }

  async start() {
    this.active = true;
    for (const d of this.devices.list()) if (d.enabled && !this.running.has(d.id)) this._startDevice(d);
  }

  async _stopDevice(id) {
    const r = this.running.get(id);
    if (!r) return;
    this.running.delete(id);
    await r.poller.stop();
    await r.driver.close();
  }

  async stop() {
    this.active = false;
    await Promise.all([...this.running.keys()].map((id) => this._stopDevice(id)));
  }

  /** Gerät nach geänderten Einstellungen neu starten (oder stoppen, wenn ausgeschaltet/gelöscht) */
  async reload(id) {
    await this._stopDevice(id);
    const d = this.devices.get(id);
    if (this.active && d && d.enabled) this._startDevice(d);
  }

  _running(id) {
    const r = this.running.get(id);
    if (!r) throw new Error(this.active ? t('core.errors.notRunning', { id }) : t('core.errors.notConnected'));
    return r;
  }

  state(id) {
    const r = this.running.get(id);
    return r ? r.driver.state : 'unknown';
  }

  /** Wert schreiben. name = Name einer Variablen des Geräts oder ein Operand (z. B. 'MW5'). */
  async write(id, name, value, opts) {
    const r = this._running(id);
    const d = this.devices.get(id);
    const v = d.variables.find((x) => x.name === name || x.id === name) || { name };
    await r.driver.write(v, value, opts);
    r.poller.kick();
  }

  /** „Verbindung testen“ für ein laufendes Gerät */
  test(id) {
    return this._running(id).driver.test();
  }
}

module.exports = { Runtime, DevicePoller };
