'use strict';
/**
 * MQTT-Treiber (Schnittstelle siehe ../driver.js), für easyE4 ab FW 2.40.
 * Topics und Regeln aus node-red-contrib-easye4-mqtt (easye4.js), ohne Node-RED.
 *
 * Einstellungen: { host (Broker), port (1883 bzw. 8883), tls = false, user,
 *                  caFile (CA-Zertifikat des Brokers, z. B. ca.crt – dann wird der Broker geprüft),
 *                  verifyCert = false (Broker auch ohne caFile gegen die Windows-Zertifikate prüfen),
 *                  baseTopic (z. B. 'easye4/1'), timeout = 5000 ms,
 *                  topics: { data, set, request, response } – nur, wenn in easySoft eigene Topics eingetragen sind
 *                  (easySoft: Publish topic = data, Subscribe topic = set, Actions subscribe topic = request,
 *                  Actions publish topic = response); fehlende Einträge werden aus baseTopic gebildet }
 * Geheimnisse:   { password }
 *
 * Anders als Modbus und JSON-API fragt MQTT nicht ab: Die easyE4 sendet zyklisch (nur im RUN und nur, was in
 * easySoft unter „Zyklische Daten“ steht). read() liefert deshalb die zuletzt empfangenen Werte; neue Werte
 * kommen zusätzlich als Ereignis 'values' ({ name: wert }).
 *
 *   <Basis>/data              {"state":{"reported":{"MW3":42,"connected":"true"}}}  (easyE4 -> wir)
 *   <Basis>/set               {"state":{"M5":1}}  – nur QoS 0                         (wir -> easyE4)
 *   <Basis>/actions/request   {"id","operation"}  – jede Aktion braucht eine eigene id
 *   <Basis>/actions/response  erst "IN_PROGRESS", später "SUCCEEDED" oder "FAILED"
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const mqtt = require('mqtt');
const { Driver, keyOf } = require('../driver');
const { operandOf } = require('../operand');
const { t } = require('../../i18n');

// Laut easyE4-Doku: höchstens 511 Zeichen, "+" und "#" nicht erlaubt
const validTopic = (s) => typeof s === 'string' && s.length > 0 && s.length <= 511 && !/[#+]/.test(s);

// Eindeutige Aktions-IDs (die easyE4 führt eine schon benutzte ID nicht erneut aus)
const ID_PREFIX = `e4v${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
let idCounter = 0;
const newActionId = () => `${ID_PREFIX}-${(++idCounter).toString(36)}`;

/** M1, m1 und M001 gelten als derselbe Operand; Aliasnamen bleiben, wie sie sind */
function normName(n) {
  const s = String(n).trim();
  const m = /^([A-Za-z]{1,2})0*(\d+)$/.exec(s);
  return m ? m[1].toUpperCase() + parseInt(m[2], 10) : s;
}

// Werte wie bei Modbus/JSON: Bits als 0/1
function normValue(v) {
  if (v === true || v === 'true') return 1;
  if (v === false || v === 'false') return 0;
  return v;
}

function fail(key, args) {
  const e = new Error(t(`mqtt.errors.${key}`, args));
  e.translated = true;
  return e;
}

const RANGES = {
  M: [0, 1], N: [0, 1], MB: [-128, 255], NB: [-128, 255], MW: [-32768, 65535], NW: [-32768, 65535],
  MD: [-2147483648, 4294967295], ND: [-2147483648, 4294967295],
};

/** Name und Wert für /set; wirft bei nicht beschreibbaren Operanden oder ungültigen Werten */
function writeEntry(v, value) {
  const op = operandOf(v);
  if (v.writable === false) throw new Error(t('device.errors.notWritable', { name: v.name }));
  if (op && op.net !== null) throw new Error(t('device.errors.otherNet', { name: v.name, net: op.net }));
  if (!op) return [String(v.operand || v.name), normValue(value)]; // Aliasname aus easySoft
  const name = `${op.type}${op.index}`;
  if (op.type === 'Q' || op.type === 'QA') throw fail('outputNotWritable', { name });
  if ((op.type === 'I' && op.index <= 16) || (op.type === 'IA' && op.index <= 4) || (op.type === 'ID' && op.index <= 25)) {
    throw fail('reserved', { name });
  }
  if (op.type === 'CLOCK' || op.type === 'SN' || op.type === 'RN') throw new Error(t('device.errors.notWritable', { name: v.name }));
  let x = value;
  if (typeof x === 'string') {
    const s = x.trim().toLowerCase();
    if (['true', 'ein', 'on'].includes(s)) x = 1;
    else if (['false', 'aus', 'off'].includes(s)) x = 0;
    else if (s !== '' && Number.isFinite(Number(s.replace(',', '.')))) x = Number(s.replace(',', '.'));
  }
  if (typeof x === 'boolean') x = x ? 1 : 0;
  const range = RANGES[op.type];
  if (range && range[1] === 1 && x !== 0 && x !== 1) throw fail('badBool', { name, value: String(value) });
  if (typeof x !== 'number' || !Number.isInteger(x) || (range && (x < range[0] || x > range[1]))) {
    throw fail('badNumber', { name, value: String(value), min: range ? range[0] : '…', max: range ? range[1] : '…' });
  }
  return [name, x];
}

class MqttDriver extends Driver {
  constructor(settings, secrets) {
    super(settings, secrets);
    const s = this.settings;
    this.host = String(s.host || '').trim().replace(/^mqtts?:\/\//i, '').replace(/\/+$/, '');
    this.caFile = String(s.caFile || '').trim();
    this.tls = s.tls === true || !!this.caFile;
    this.port = s.port === undefined || s.port === '' ? (this.tls ? 8883 : 1883) : parseInt(s.port, 10);
    this.user = String(s.user || '').trim();
    this.timeout = Math.min(Math.max(parseInt(s.timeout, 10) || 5000, 500), 60000);
    this.base = String(s.baseTopic || '').trim().replace(/\/+$/, '');
    const own = s.topics || {};
    const pick = (k, suffix) => (own[k] && String(own[k]).trim()) || (this.base ? `${this.base}/${suffix}` : '');
    this.topics = { data: pick('data', 'data'), set: pick('set', 'set'),
      request: pick('request', 'actions/request'), response: pick('response', 'actions/response') };
    this.cache = new Map(); // normalisierter Name -> Wert
    this.deviceConnected = null; // letzte connected-Meldung der easyE4
    this.pending = new Map(); // Aktions-ID -> { resolve, reject, timer, op }
    this.client = null;
    this.firstData = null;

    if (!this.host) this.problem = t('mqtt.errors.noHost');
    else if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) this.problem = t('mqtt.errors.badPort');
    else if (Object.values(this.topics).some((x) => !x)) this.problem = t('mqtt.errors.noBaseTopic');
    else if (this.caFile && !fs.existsSync(this.caFile)) this.problem = t('mqtt.errors.noCaFile', { file: this.caFile });
    else {
      const bad = Object.values(this.topics).find((x) => !validTopic(x));
      if (bad) this.problem = t('mqtt.errors.badTopic', { topic: bad });
    }
  }

  _netError(err) {
    const auth = err && (err.code === 4 || err.code === 5 || err.code === 134 || err.code === 135);
    const code = String((err && err.code) || '');
    // Zertifikat des Brokers passt nicht (falsche CA, abgelaufen, Name/IP nicht im Zertifikat)
    const cert = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|ERR_SSL|EPROTO/.test(code);
    this._setState(auth ? 'auth' : 'offline', code || (err && err.message));
    const host = `${this.host}:${this.port}`;
    const e = new Error(auth ? t('mqtt.errors.auth')
      : cert ? t(code === 'ERR_TLS_CERT_ALTNAME_INVALID' ? 'mqtt.errors.certName' : 'mqtt.errors.cert', { host, name: this.host, msg: code })
        : t('mqtt.errors.network', { host, msg: code || (err && err.message) || 'timeout' }));
    e.translated = true;
    if (auth) e.auth = true;
    else e.network = true;
    return e;
  }

  // Verbindung zum Broker aufbauen (einmal; danach verbindet MQTT.js bei Abbruch selbst neu)
  _connect() {
    if (this.problem) return Promise.reject(new Error(this.problem));
    if (this.closed) return Promise.reject(new Error(t('mqtt.errors.closed')));
    if (this.client && this.client.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const url = `${this.tls ? 'mqtts' : 'mqtt'}://${this.host}:${this.port}`;
      const c = mqtt.connect(url, {
        clientId: `easy4visu_${crypto.randomBytes(4).toString('hex')}`,
        username: this.user || undefined,
        password: this.secrets.password || undefined,
        protocolVersion: 4, clean: true, keepalive: 30,
        connectTimeout: this.timeout, reconnectPeriod: 5000,
        // mit CA-Datei: Broker prüfen (wie mosquitto mit cafile); ohne: nur verschlüsseln
        rejectUnauthorized: !!this.caFile || this.settings.verifyCert === true,
        ca: this.caFile ? fs.readFileSync(this.caFile) : undefined,
      });
      this.client = c;
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.connecting = null;
        if (err) {
          c.end(true);
          if (this.client === c) this.client = null;
          reject(this._netError(err));
        } else resolve();
      };
      const timer = setTimeout(() => done({ code: 'ETIMEDOUT' }), this.timeout);
      c.on('connect', () => {
        c.subscribe([this.topics.data, this.topics.response], { qos: 0 }, (err) => done(err || null));
        // (wieder) mit dem Broker verbunden: Broker ok, ob die easyE4 sendet, zeigt sich gleich
        this.gotData = false;
        if (this.state !== 'online') this._setState('unknown', 'broker');
        this._watchData();
      });
      c.on('error', (err) => done(err));
      c.on('close', () => { if (!this.closed && settled) this._setState('offline', 'broker'); });
      c.on('message', (topic, payload) => this._onMessage(topic, payload));
    });
    return this.connecting;
  }

  /**
   * Broker erreichbar, aber kommt auch etwas von der easyE4? Sendet sie nach dem Verbinden nichts
   * (ausgeschaltet, im STOP, nicht mit dem Broker verbunden), gilt sie als nicht erreichbar.
   */
  _watchData() {
    clearTimeout(this.dataTimer);
    this.dataTimer = setTimeout(() => {
      if (!this.closed && !this.gotData) this._setState('offline', 'nodata');
    }, this.timeout * 2);
  }

  /** Text zum Zustand; bei „keine Daten“ genauer als „nicht erreichbar“ */
  stateText() {
    if (this.state === 'offline' && this.stateDetail === 'nodata') return t('mqtt.state.noData');
    if (this.state === 'offline' && this.stateDetail === 'connected=false') return t('mqtt.state.deviceOff');
    if (this.state === 'unknown' && this.stateDetail === 'broker') return t('mqtt.state.waiting');
    return super.stateText();
  }

  /** auch melden, wenn nur der Grund wechselt (z. B. „Broker weg“ -> „easyE4 sendet nichts“) */
  _setState(state, detail) {
    if (state === this.state && detail === this.stateDetail) return;
    this.state = state;
    this.stateDetail = detail;
    this.emit('state', state, detail);
  }

  _onMessage(topic, payload) {
    let msg;
    try {
      msg = JSON.parse(payload.toString('utf8'));
    } catch (e) {
      return;
    }
    if (topic === this.topics.response) return this._onActionResponse(msg);
    const rep = msg && msg.state && msg.state.reported;
    if (!rep || typeof rep !== 'object') return;
    this.gotData = true;
    const values = {};
    for (const [k, v] of Object.entries(rep)) {
      if (k === 'connected') continue;
      const n = normName(k);
      this.cache.set(n, normValue(v));
      values[n] = normValue(v);
    }
    // connected = "false" ist der Letzte Wille der easyE4 (kommt bis ~90 s nach dem Abbruch)
    if (rep.connected !== undefined) this.deviceConnected = !(rep.connected === 'false' || rep.connected === false);
    else this.deviceConnected = true;
    this._setState(this.deviceConnected ? 'online' : 'offline', this.deviceConnected ? undefined : 'connected=false');
    if (Object.keys(values).length) {
      this.emit('values', values);
      if (this.firstData) this.firstData();
    }
  }

  // Auf die ersten Daten warten (nur beim ersten Lesen nach dem Verbinden)
  _waitFirstData() {
    if (this.cache.size || this.waitedOnce) return Promise.resolve();
    this.waitedOnce = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.firstData = null; resolve(); }, this.timeout);
      this.firstData = () => { clearTimeout(timer); this.firstData = null; resolve(); };
    });
  }

  async read(variables) {
    await this._connect();
    await this._waitFirstData();
    if (this.deviceConnected === false) {
      const e = new Error(t('mqtt.errors.deviceOffline'));
      e.network = true;
      e.translated = true;
      throw e;
    }
    const values = {};
    const errors = [];
    for (const v of variables) {
      const key = keyOf(v);
      const op = operandOf(v);
      if (op && op.net !== null) {
        errors.push({ name: key, code: 0, text: t('device.errors.otherNet', { name: v.name, net: op.net }) });
        continue;
      }
      const n = op && op.type !== 'CLOCK' ? `${op.type}${op.index}` : normName(v.operand || v.name);
      if (this.cache.has(n)) values[key] = this.cache.get(n);
      else errors.push({ name: key, code: 0, text: t('mqtt.errors.noData') });
    }
    return { values, errors };
  }

  async write(variable, value) {
    const [name, x] = writeEntry(variable, value);
    await this._connect();
    // Schreiben nur mit QoS 0 (die easyE4 verarbeitet nichts anderes), nie „retained“
    await this.client.publishAsync(this.topics.set, JSON.stringify({ state: { [name]: x } }), { qos: 0, retain: false });
  }

  _onActionResponse(r) {
    if (!r || r.id === undefined) return;
    const p = this.pending.get(r.id);
    if (!p) return; // fremde Antwort
    if (String(r.status).toUpperCase() === 'IN_PROGRESS') return; // Ergebnis folgt später
    this.pending.delete(r.id);
    clearTimeout(p.timer);
    const errorMsg = r.statusDetails && r.statusDetails.errorMsg;
    p.resolve({ id: r.id, status: r.status, success: r.status === 'SUCCEEDED', response: r.response, errorMsg });
  }

  /**
   * Aktion an die easyE4 senden und auf das Ergebnis warten.
   * operation: 'StartDevice', 'StopDevice', 'Get_FB_Config', 'Set_FB_Config', 'Save_FB_Const_Par', …
   * Ergebnis: { id, status, success, response, errorMsg }
   */
  async action(operation, params, waitMs) {
    await this._connect();
    const id = newActionId();
    const body = Object.assign({ id, operation }, params);
    const wait = waitMs || 30000;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(fail('actionTimeout', { op: operation, s: Math.round(wait / 1000) }));
      }, wait);
      this.pending.set(id, { resolve, reject, timer, op: operation });
    });
    // Befehle nie „retained“, sonst würden sie beim Wiederverbinden erneut ausgeführt
    await this.client.publishAsync(this.topics.request, JSON.stringify(body), { qos: 0, retain: false });
    return result;
  }

  /** Betriebsart: 'RUN' oder 'STOP' */
  async setMode(mode) {
    const m = String(mode || '').toUpperCase();
    if (m !== 'RUN' && m !== 'STOP') throw fail('badMode');
    const op = m === 'RUN' ? 'StartDevice' : 'StopDevice';
    const r = await this.action(op);
    if (!r.success) throw fail('actionFailed', { op, msg: r.errorMsg ? `: ${r.errorMsg}` : '' });
    return r;
  }

  /** „Verbindung testen“: Broker verbinden und auf Daten der easyE4 warten. Ergebnis { ok, warn?, text } */
  async test() {
    if (this.problem) return { ok: false, text: this.problem };
    const tmp = new MqttDriver(this.settings, this.secrets);
    try {
      await tmp._connect();
      await tmp._waitFirstData();
      if (tmp.deviceConnected === false) return { ok: true, warn: true, text: t('mqtt.test.offline') };
      if (!tmp.cache.size) return { ok: true, warn: true, noData: true, text: t('mqtt.test.noData', { s: Math.round(tmp.timeout / 1000) }) };
      const names = [...tmp.cache.keys()];
      return { ok: true, text: t('mqtt.test.ok', { n: names.length, sample: names.slice(0, 4).join(', ') }), names };
    } catch (err) {
      return { ok: false, text: err.message };
    } finally {
      await tmp.close();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(t('mqtt.errors.closed')));
    }
    this.pending.clear();
    clearTimeout(this.dataTimer);
    if (this.firstData) this.firstData();
    if (this.client) await this.client.endAsync(true).catch(() => {});
    this.client = null;
  }
}

module.exports = { MqttDriver, normName };
