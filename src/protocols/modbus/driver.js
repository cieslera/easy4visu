'use strict';
/**
 * Modbus-TCP-Treiber (Schnittstelle siehe ../driver.js).
 * Abgeleitet aus easye4mb.js (setupDevice) von node-red-contrib-easye4-modbus, ohne Node-RED.
 *
 * Einstellungen: { host, port = 502, unitId = 1, firmware = '240' | '140' | 'old', timeout = 2000 ms,
 *                  gap = 20 ms (Pause zwischen Anfragen), addressing = 'direct' | 'minus1', netId (1..8, optional) }
 *
 * Die easyE4 bedient höchstens zwei Modbus-TCP-Clients. Deshalb teilen sich alle Treiber mit derselben
 * Adresse:Port eine TCP-Verbindung und eine Warteschlange (nie zwei Anfragen gleichzeitig).
 */

const MB = require('./modbus-tcp');
const MAP = require('./map');
const { createScheduler } = require('../scheduler');
const VARS = require('./variables');
const { Driver, keyOf } = require('../driver');
const { t } = require('../../i18n');

// ---------------------------------------------------------------------------------- Texte

function excText(code, fc) {
  const write = [5, 6, 15, 16].includes(fc);
  if (code === 2 && write) return t('modbus.exception.2w');
  if ([1, 2, 3, 4, 6].includes(code)) return t(`modbus.exception.${code}`);
  return t('modbus.exception.other', { code });
}

function errText(err) {
  if (err && err.e4) {
    const key = err.e4.key.includes('.') ? err.e4.key : `modbus.errors.${err.e4.key}`;
    return t(key, err.e4.args);
  }
  if (err && err.exception) return excText(err.exception, err.fc);
  return err && err.message ? err.message : String(err);
}

/** Fehler mit übersetztem Text; Kennzeichen (network, exception) bleiben erhalten */
function translated(err) {
  if (err && err.translated) return err;
  const e = new Error(errText(err));
  e.translated = true;
  if (err) {
    for (const k of ['network', 'exception', 'fc', 'code']) if (err[k] !== undefined) e[k] = err[k];
  }
  return e;
}

const pad = (n) => String(n).padStart(2, '0');
const clockText = (c) => `${pad(c.day)}.${pad(c.month)}.${c.year} ${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`;

// ---------------------------------------------------------------------------------- gemeinsame Verbindung je easyE4

const links = new Map();
function getLink(host, port, timeout) {
  const id = `${host}:${port}`;
  let l = links.get(id);
  if (!l) {
    l = { client: new MB.ModbusTcpClient(host, port, { connectTimeout: timeout }), sched: createScheduler(), users: 0 };
    links.set(id, l);
  }
  l.users++;
  return { id, link: l };
}
function releaseLink(id) {
  const l = links.get(id);
  if (!l) return;
  l.users--;
  if (l.users <= 0) {
    l.client.close();
    links.delete(id);
  }
}

function clamp(v, min, max, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
}

// ---------------------------------------------------------------------------------- Treiber

class ModbusDriver extends Driver {
  /**
   * @param settings siehe oben
   * @param secrets  (Modbus hat keine Anmeldung)
   * @param opts     { urgent: true } = vorne einreihen, ohne Fehlerpause (für „Verbindung testen“)
   */
  constructor(settings, secrets, opts) {
    super(settings, secrets);
    const s = this.settings;
    this.host = String(s.host || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
    this.port = s.port === undefined || s.port === '' ? 502 : parseInt(s.port, 10);
    this.unitId = clamp(s.unitId, 0, 255, 1);
    this.timeout = clamp(s.timeout, 200, 30000, 2000);
    this.gap = clamp(s.gap, 0, 5000, 20);
    this.fw = MAP.fwLevel(s.firmware);
    // "direct" = Telegramm-Adresse = Register-Nr. (so arbeitet die easyE4, gemessen), "minus1" = Register-Nr. − 1
    this.addressing = s.addressing === 'minus1' ? 'minus1' : 'direct';
    this.urgent = !!(opts && opts.urgent);
    this.P = MB.builders(this.addressing === 'minus1' ? 1 : 0);
    // NET-ID des Geräts (optional): Operanden wie 1NW3 gelten dann als eigene
    this.netId = Number.isInteger(s.netId) ? s.netId : null;
    this.noGaps = false; // Anfragen nicht mehr über Lücken hinweg zusammenfassen

    if (!this.host) this.problem = t('modbus.errors.noHost');
    else if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) this.problem = t('modbus.errors.badPort');
    if (this.problem) return;

    const { id, link } = getLink(this.host, this.port, this.timeout);
    this.linkId = id;
    this.link = link;
    this.gapToken = {};
    link.sched.gaps.set(this.gapToken, this.gap);
  }

  // Eine Anfrage direkt senden (nur innerhalb eines Warteschlangen-Auftrags aufrufen)
  _send(pdu) {
    return this.link.client.request(this.unitId, pdu, this.timeout).then((res) => {
      this._setState('online');
      return res;
    }, (err) => {
      if (err.exception) {
        this._setState('online'); // die easyE4 hat geantwortet, nur nicht mit Daten
        throw err;
      }
      this._setState('offline', err.code || err.message);
      const e = new Error(t('modbus.errors.network', { host: `${this.host}:${this.port}`, msg: err.code || err.message }));
      e.network = true;
      e.translated = true;
      e.code = err.code;
      throw e;
    });
  }

  _readRaw(fc, addr, count) {
    return this._send(this.P.readPdu(fc, addr, count)).then((res) => MB.parseRead(fc, res, count));
  }

  // Auftrag einreihen. fn läuft ohne andere Anfragen dazwischen (z. B. Wort lesen + schreiben).
  _job(fn, key, urgent) {
    if (this.problem) return Promise.reject(new Error(this.problem));
    if (this.closed) return Promise.reject(new Error(t('modbus.errors.closed')));
    const k = key ? `${this.unitId}|${key}` : null;
    return this.link.sched.add({ key: k, urgent: this.urgent || !!urgent, owner: this.gapToken, run: fn })
      .catch((err) => {
        if (err.queueFull) throw new Error(t('modbus.errors.queueFull'));
        throw err;
      });
  }

  /** Lesepläne lesen. Liefert { values, errors: [{name, code, text}], requests } */
  async _readOps(ops) {
    const data = new Map();
    const errors = new Map();
    const requests = [];
    const store = (r, vals) => vals.forEach((v, i) => data.set(`${r.fc}|${r.addr + i}`, v));
    const inReq = (pt, r) => pt.fc === r.fc && pt.addr >= r.addr && pt.addr < r.addr + r.count;
    const readReq = async (r) => {
      const vals = await this._job(() => this._readRaw(r.fc, r.addr, r.count));
      requests.push(r);
      store(r, vals);
    };

    for (const r of MAP.planReads(ops, { noGaps: this.noGaps })) {
      try {
        await readReq(r);
      } catch (err) {
        if (!err.exception) throw err;
        // Lücken in zusammengefassten Anfragen sind offenbar nicht freigegeben: künftig ohne Lücken planen
        const wanted = new Set();
        ops.forEach((op) => op.parts.forEach((pt) => { if (inReq(pt, r)) wanted.add(pt.addr); }));
        if (wanted.size < r.count) this.noGaps = true;
        // Eine einzige nicht freigegebene Adresse lässt die ganze Anfrage scheitern:
        // dann jeden betroffenen Wert einzeln lesen, um den Schuldigen zu finden.
        const inside = ops.filter((op) => op.parts.some((pt) => inReq(pt, r)));
        if (r.count === 1 || inside.length <= 1) {
          inside.forEach((op) => errors.set(op.key, err.exception));
          continue;
        }
        for (const op of inside) {
          try {
            for (const s of MAP.planReads([op], { noGaps: true })) await readReq(s);
          } catch (e2) {
            if (!e2.exception) throw e2;
            errors.set(op.key, e2.exception);
          }
        }
      }
    }
    const okOps = ops.filter((op) => !errors.has(op.key));
    const res = MAP.decodeAll(okOps, data);
    const errs = [...errors.entries()].map(([name, code]) => ({ name, code, text: excText(code, 3) }));
    res.missing.forEach((name) => errs.push({ name, code: 0, text: t('modbus.errors.noValue') }));
    return { values: res.values, errors: errs, requests };
  }

  async read(variables) {
    const ops = [];
    const errors = [];
    const seen = new Set();
    for (const v of variables) {
      try {
        const op = VARS.readOp(v, this.fw, this.netId);
        if (seen.has(op.key)) continue;
        seen.add(op.key);
        ops.push(op);
      } catch (err) {
        errors.push({ name: keyOf(v), code: 0, text: errText(err) });
      }
    }
    if (ops.length === 0) return { values: {}, errors };
    try {
      const r = await this._readOps(ops);
      return { values: r.values, errors: errors.concat(r.errors) };
    } catch (err) {
      throw translated(err);
    }
  }

  // Schreibplan ausführen (Format: variables.writePlan)
  _writePlan(plan) {
    const rmwBit = (addr, bit, on) => this._readRaw(3, addr, 1).then((v) => {
      const w = on ? v[0] | (1 << bit) : v[0] & ~(1 << bit);
      return this._send(this.P.writeRegPdu(addr, w));
    });
    return this._job(() => {
      switch (plan.kind) {
        case 'coil':
          return this._send(this.P.writeCoilPdu(plan.addr, plan.value));
        case 'bit':
          // Merker-Bit = Bit im Merkerwort (so exportiert easySoft): Wort lesen, Bit ändern, Wort schreiben
          return rmwBit(plan.addr, plan.bit, plan.value);
        case 'reg':
          return this._send(this.P.writeRegPdu(plan.addr, plan.value));
        case 'regs':
          return this._send(this.P.writeRegsPdu(plan.addr, plan.values));
        case 'byte':
          // Byte = halbes Merkerwort: Wort lesen, Byte ersetzen, Wort schreiben
          return this._readRaw(3, plan.addr, 1).then((v) => {
            const w = plan.high ? (v[0] & 0x00ff) | (plan.value << 8) : (v[0] & 0xff00) | plan.value;
            return this._send(this.P.writeRegPdu(plan.addr, w));
          });
      }
      throw new Error(`plan ${plan.kind}`);
    }, plan.key, true); // Schreiben vor wartende Abfragen
  }

  async write(variable, value, opts) {
    try {
      const plan = VARS.writePlan(variable, value, this.fw, this.netId);
      if (opts && opts.noMerge) plan.key = null;
      await this._writePlan(plan);
    } catch (err) {
      throw translated(err);
    }
  }

  /** Uhr stellen (Register 5000..5005). Liest vorher das Jahr, um zwei- oder vierstellig zu schreiben. */
  async setClock(date) {
    try {
      const d = MAP.toDate(date);
      return await this._job(() => this._readRaw(3, 5005, 1).then((v) => {
        const regs = MAP.clockRegs(d, v[0] < 100);
        return this._send(this.P.writeRegsPdu(5000, regs)).then(() => regs);
      }), 'CLOCK');
    } catch (err) {
      throw translated(err);
    }
  }

  /**
   * „Verbindung testen“: liest die Uhr (oder MW1). Klappt das nicht, wird die andere Adressierung probiert.
   * Ergebnis: { ok, warn?, text, clock?, suggest?: { addressing } }
   */
  async test() {
    if (this.problem) return { ok: false, text: this.problem };
    const probe = async (addressing) => {
      const tmp = new ModbusDriver(Object.assign({}, this.settings, { addressing, gap: 0 }), {}, { urgent: true });
      try {
        const r = await tmp._readOps([MAP.clock(), VARS.readOp({ name: 'MW1' }, tmp.fw)]);
        // Uhr nur gelten lassen, wenn sie plausibel ist (bei falscher Adressierung liegt alles ein Register daneben)
        const c = r.values.CLOCK;
        const ok = c && c.month >= 1 && c.month <= 12 && c.day >= 1 && c.day <= 31 && c.hour < 24 &&
          c.minute < 60 && c.second < 60 && c.year >= 2000 && c.year <= 2099;
        return { clock: ok ? c : undefined, badClock: !!c && !ok, mw1: r.values.MW1 };
      } finally {
        await tmp.close();
      }
    };
    const usable = (r) => r.clock || (r.mw1 !== undefined && !r.badClock);
    const text = (r) => (r.clock ? t('modbus.test.okClock', { clock: clockText(r.clock) }) : t('modbus.test.okMw', { value: r.mw1 }));
    try {
      const r = await probe(this.addressing);
      if (usable(r)) return { ok: true, text: text(r), clock: r.clock };
      const other = this.addressing === 'direct' ? 'minus1' : 'direct';
      const r2 = await probe(other);
      if (usable(r2)) {
        return { ok: true, warn: true, suggest: { addressing: other }, clock: r2.clock,
          text: `${text(r2)} ${t('modbus.test.switched', { mode: t(`modbus.addressing.${other}`) })}` };
      }
      return { ok: true, warn: true, text: t('modbus.test.okNoData') };
    } catch (err) {
      return { ok: false, text: errText(err) };
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (!this.link) return;
    this.link.sched.drop((job) => job.owner === this.gapToken, new Error(t('modbus.errors.closed')));
    this.link.sched.gaps.delete(this.gapToken);
    releaseLink(this.linkId);
  }
}

module.exports = { ModbusDriver, errText, excText, _links: links };
