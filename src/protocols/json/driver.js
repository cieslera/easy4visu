'use strict';
/**
 * JSON-API-Treiber (Schnittstelle siehe ../driver.js).
 * Abgeleitet aus easye4json.js (setupDevice) von node-red-contrib-easye4-json, ohne Node-RED.
 *
 * Einstellungen: { host, https = false (true = verschlüsselt), port (80 bzw. 443), auth = 'none' | 'basic' | 'bearer',
 *                  user, timeout = 3000 ms (HTTPS 8000 ms), gap = 50 ms (Pause zwischen Anfragen), verifyCert = false,
 *                  readPath = 'auto' | 'data' | 'adm' }
 * Geheimnisse:   { password, apikey }
 *
 * Den Webserver der easyE4 schonen: je Gerät nur eine Anfrage gleichzeitig (eine Warteschlange, auch wenn
 * mehrere Treiber auf dieselbe easyE4 zeigen), Pause zwischen Anfragen, wachsende Pause nach Fehlern,
 * gleiche Schreibaufträge werden zusammengefasst (der neueste Wert gewinnt).
 */

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const tls = require('node:tls');
const L = require('./lib');
const VARS = require('./variables');
const { createScheduler } = require('../scheduler');
const { Driver } = require('../driver');
const { t } = require('../../i18n');

function apiErrorText(code) {
  return L.ERROR_CODES.includes(code) ? t(`json.apiError.${code}`) : t('json.apiError.unknown', { code });
}

function errText(err) {
  if (err && err.e4) {
    const key = err.e4.key.includes('.') ? err.e4.key : `json.errors.${err.e4.key}`;
    return t(key, err.e4.args);
  }
  return err && err.message ? err.message : String(err);
}

function translated(err) {
  if (err && err.translated) return err;
  const e = new Error(errText(err));
  e.translated = true;
  if (err) for (const k of ['network', 'auth', 'statusCode', 'apiError', 'code']) if (err[k] !== undefined) e[k] = err[k];
  return e;
}

// ---------------------------------------------------------------------------------- gemeinsame Teile je easyE4

const schedulers = new Map();
function getScheduler(id) {
  let s = schedulers.get(id);
  if (!s) {
    s = { sched: createScheduler(), users: 0 };
    schedulers.set(id, s);
  }
  s.users++;
  return s.sched;
}
function releaseScheduler(id) {
  const s = schedulers.get(id);
  if (s && --s.users <= 0) schedulers.delete(id);
}

// Alte Verfahren zulassen: Node.js (OpenSSL) braucht dafür „@SECLEVEL=0“. Im Programmfenster (Electron, BoringSSL)
// gibt es das nicht (Fehler ERR_SSL_INVALID_COMMAND) – dort reicht „ALL“.
let legacy = null;
function legacyCiphers() {
  if (legacy) return legacy;
  try { tls.createSecureContext({ ciphers: 'DEFAULT:@SECLEVEL=0' }); legacy = 'DEFAULT:@SECLEVEL=0'; } catch (e) { legacy = 'ALL'; }
  return legacy;
}

// HTTP(S)-Agents: eine Verbindung je Gerät, ruhende Verbindung wird nach 15 s geschlossen
const agents = new Map();
function getAgent(key, protocol, verifyCert) {
  let a = agents.get(key);
  if (!a) {
    const base = { keepAlive: true, maxSockets: 1, maxFreeSockets: 1, timeout: 15000 };
    const agent = protocol === 'https'
      ? new https.Agent(Object.assign(base, verifyCert
        ? { rejectUnauthorized: true }
        // Ältere easyE4 (FW 1.x) sprechen nur TLS 1.0/1.1 mit alten Verfahren, die Node.js sonst ablehnt (EPROTO)
        : { rejectUnauthorized: false, minVersion: 'TLSv1', ciphers: legacyCiphers(),
          secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT }))
      : new http.Agent(base);
    a = { agent, users: 0 };
    agents.set(key, a);
  }
  a.users++;
  return a.agent;
}
function releaseAgent(key) {
  const a = agents.get(key);
  if (!a) return;
  if (--a.users <= 0) {
    a.agent.destroy();
    agents.delete(key);
  }
}

function clamp(v, min, max, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
}

// ---------------------------------------------------------------------------------- Treiber

class JsonDriver extends Driver {
  /** opts: { urgent: true } = vorne einreihen, ohne Fehlerpause (für „Verbindung testen“) */
  constructor(settings, secrets, opts) {
    super(settings, secrets);
    const s = this.settings;
    const sec = this.secrets;
    this.host = String(s.host || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    this.protocol = s.https === true ? 'https' : 'http';
    const defPort = this.protocol === 'https' ? 443 : 80;
    this.port = s.port === undefined || s.port === '' ? defPort : parseInt(s.port, 10);
    this.auth = ['none', 'basic', 'bearer'].includes(s.auth) ? s.auth : 'basic';
    this.user = String(s.user || '').trim();
    // HTTPS bei FW 1.x: der Verbindungsaufbau dauert auf dem Gerät spürbar (am Gerät mit FW 1.42 lief der erste
    // Versuch mit 3 s in ein Zeitlimit) – deshalb dort mehr Zeit
    this.timeout = clamp(s.timeout, 500, 30000, this.protocol === 'https' ? 8000 : 3000);
    this.gap = clamp(s.gap, 0, 5000, 50);
    this.verifyCert = s.verifyCert === true;
    this.urgent = !!(opts && opts.urgent);
    // Lesepfad: /api/get/adm für den Administrator, sonst /api/get/data (wie Eatons eigener Knoten)
    this.readPath = s.readPath === 'adm' || s.readPath === 'data' ? s.readPath
      : (this.auth === 'basic' && this.user.toLowerCase() === 'admin' ? 'adm' : 'data');

    if (!this.host) this.problem = t('json.errors.noHost');
    else if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) this.problem = t('json.errors.badPort');
    else if (this.auth === 'basic' && !this.user) this.problem = t('json.errors.noUser');
    else if (this.auth === 'bearer' && !String(sec.apikey || '').trim()) this.problem = t('json.errors.noApiKey');
    if (this.problem) return;

    this.headers = { Accept: 'application/json' };
    if (this.auth === 'basic') {
      this.headers.Authorization = `Basic ${Buffer.from(`${this.user}:${sec.password || ''}`).toString('base64')}`;
    } else if (this.auth === 'bearer') {
      this.headers.Authorization = `Bearer ${String(sec.apikey).trim()}`;
    }
    this.agentKey = [this.protocol, this.host, this.port, this.verifyCert].join('|');
    this.agent = getAgent(this.agentKey, this.protocol, this.verifyCert);
    this.schedId = `${this.host}:${this.port}`;
    this.sched = getScheduler(this.schedId);
    this.gapToken = {};
    this.sched.gaps.set(this.gapToken, this.gap);
  }

  _rawRequest(path) {
    return new Promise((resolve, reject) => {
      const lib = this.protocol === 'https' ? https : http;
      const req = lib.request({ host: this.host, port: this.port, path, method: 'GET', headers: this.headers,
        agent: this.agent, timeout: this.timeout }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', (err) => {
        err.reused = req.reusedSocket;
        reject(err);
      });
      req.end();
    });
  }

  // Eine Anfrage ausführen (läuft in der Warteschlange, immer nur eine gleichzeitig)
  _execute(path) {
    return this._rawRequest(path)
      .catch((err) => {
        // Die easyE4 hat eine ruhende Keep-Alive-Verbindung geschlossen: einmal neu verbinden
        if (err.reused && (err.code === 'ECONNRESET' || err.code === 'EPIPE' || /socket hang up/i.test(err.message))) {
          return this._rawRequest(path);
        }
        throw err;
      })
      .then((res) => {
        // 401 beim Lesen = Anmeldung falsch. 401 bei Schreib-/Admin-Befehlen = nur fehlende Rechte.
        this._setState(res.statusCode === 401 && path.startsWith('/api/get/') ? 'auth' : 'online');
        return res;
      }, (err) => {
        this._setState('offline', err.code || err.message);
        const code = String(err.code || '');
        const tls = this.protocol === 'https' && (code === 'EPROTO' || code.startsWith('ERR_SSL') ||
          /SSL|TLS|certificate|self.signed/i.test(`${code} ${err.message || ''}`));
        const e = new Error(t(tls ? 'json.errors.tls' : 'json.errors.network', { host: this.host, msg: err.code || err.message }));
        e.network = true;
        e.translated = true;
        e.code = err.code;
        throw e;
      });
  }

  /**
   * Anfrage stellen; Ergebnis { statusCode, body, json }. HTTP-Fehler werden zu Exceptions.
   * key: gleiches Ziel (z. B. "MW5"). Wartet schon ein Auftrag dafür, wird nur dessen Pfad ersetzt.
   */
  async request(path, key, urgent) {
    if (this.problem) throw new Error(this.problem);
    if (this.closed) throw new Error(t('json.errors.closed'));
    const enqueue = () => {
      const job = { key: key ? `${this.schedId}|${key}` : null, urgent: this.urgent || !!urgent, owner: this.gapToken };
      job.run = () => this._execute(path);
      return this.sched.add(job).catch((err) => {
        if (err.queueFull) throw new Error(t('json.errors.queueFull'));
        throw err;
      });
    };
    let res = await enqueue();
    // 503 = vorübergehend ausgelastet: einmal nach kurzer Pause wiederholen
    if (res.statusCode === 503) {
      await new Promise((r) => setTimeout(r, 500));
      res = await enqueue();
    }
    if (res.body && res.body.trim()) {
      try {
        res.json = JSON.parse(res.body);
      } catch (e) {
        res.json = undefined;
      }
    }
    if (res.statusCode !== 200 && res.statusCode !== 204) {
      let k = [400, 401, 403, 404, 501, 503].includes(res.statusCode) ? `json.http.${res.statusCode}` : 'json.http.other';
      if (res.statusCode === 401 && path.startsWith('/api/set/adm')) k = 'json.http.401adm';
      else if (res.statusCode === 401 && path.startsWith('/api/set/')) k = 'json.http.401set';
      const e = new Error(t(k, { code: res.statusCode }));
      e.statusCode = res.statusCode;
      e.translated = true;
      if (res.statusCode === 401 && path.startsWith('/api/get/')) e.auth = true;
      throw e;
    }
    return res;
  }

  /** Elemente lesen (auf mehrere Anfragen verteilt, max. 256 Zeichen je URL) -> ausgewertete Antwort */
  async readElements(elements) {
    const paths = L.chunkElements(elements, `/api/get/${this.readPath}?elm=`);
    const list = [];
    for (const p of paths) list.push(L.parseResponse((await this.request(p)).json));
    return L.mergeParsed(list);
  }

  async read(variables) {
    try {
      const values = {};
      const errors = [];
      const plan = VARS.planRead(variables);
      plan.errors.forEach((x) => errors.push({ name: x.name, code: 0, text: errText(x.err) }));
      const parsed = plan.elements.length ? await this.readElements(plan.elements) : { values: {}, errors: [] };
      const retry = [];
      for (const it of plan.items) {
        const v = VARS.pickValue(it, parsed);
        if (v !== undefined) values[it.key] = v;
        else if (it.elements[0].kind === 'range') retry.push(it); // Bereich abgelehnt: einzeln versuchen
        else errors.push(this._itemError(it, parsed));
      }
      if (retry.length) {
        const elements = retry.map((it) => L.single(it.target.type, it.target.index, it.target.net));
        retry.forEach((it, i) => { it.elements = [elements[i]]; });
        const p2 = await this.readElements(elements);
        for (const it of retry) {
          const v = VARS.pickValue(it, p2);
          if (v !== undefined) values[it.key] = v;
          else errors.push(this._itemError(it, p2));
        }
      }
      return { values, errors };
    } catch (err) {
      throw translated(err);
    }
  }

  _itemError(it, parsed) {
    const code = VARS.errorCode(it, parsed);
    return code !== undefined
      ? { name: it.key, code, text: apiErrorText(code) }
      : { name: it.key, code: 0, text: t('json.errors.noValue') };
  }

  async write(variable, value, opts) {
    try {
      const w = VARS.writePath(variable, value);
      const res = await this.request(w.path, opts && opts.noMerge ? null : w.key, true); // Schreiben vor wartende Abfragen
      // Fehler kommen mit Status 200 als [{"ERROR": 8}]
      const list = Array.isArray(res.json) ? res.json : res.json && typeof res.json === 'object' ? [res.json] : [];
      const bad = list.find((x) => x && x.ERROR !== undefined);
      if (bad) {
        const e = new Error(`${variable.name}: ${apiErrorText(Number(bad.ERROR))}`);
        e.apiError = Number(bad.ERROR);
        e.translated = true;
        throw e;
      }
    } catch (err) {
      throw translated(err);
    }
  }

  /** Uhr stellen (nur im Zustand STOP möglich) */
  async setClock(date) {
    try {
      const d = L.toDate(date);
      await this.request(L.datePath(d));
      await this.request(L.timePath(d));
    } catch (err) {
      throw translated(err);
    }
  }

  /** Betriebsart: 'RUN' oder 'STOP' */
  async setMode(mode) {
    const m = String(mode || '').toUpperCase();
    if (m !== 'RUN' && m !== 'STOP') throw new Error(t('json.errors.badMode'));
    try {
      await this.request(`/api/set/mode?op=state&v1=${m}`);
    } catch (err) {
      throw translated(err);
    }
  }

  /** „Verbindung testen“: liest Firmware, Betriebsart und Gerätename. Ergebnis { ok, text, info? } */
  async test() {
    if (this.problem) return { ok: false, text: this.problem };
    const tmp = new JsonDriver(this.settings, this.secrets, { urgent: true });
    try {
      const v = (await tmp.readElements([L.sys('VERSION'), L.sys('STATE'), L.sys('DEVNAME')])).values;
      const info = { name: v.DEVNAME, version: v.VERS, build: v.BUILD, state: v.STATE };
      const version = v.VERS !== undefined ? v.VERS + (v.BUILD !== undefined ? ` (Build ${v.BUILD})` : '') : '?';
      return { ok: true, info,
        text: t('json.test.ok', { name: v.DEVNAME !== undefined ? v.DEVNAME : '?', version, state: v.STATE !== undefined ? v.STATE : '?' }) };
    } catch (err) {
      return { ok: false, text: errText(err) };
    } finally {
      await tmp.close();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (!this.sched) return;
    this.sched.drop((job) => job.owner === this.gapToken, new Error(t('json.errors.closed')));
    this.sched.gaps.delete(this.gapToken);
    releaseScheduler(this.schedId);
    releaseAgent(this.agentKey);
  }
}

module.exports = { JsonDriver, legacyCiphers, _agents: agents, _schedulers: schedulers };
