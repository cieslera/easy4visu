'use strict';
/**
 * Eingebauter Webserver: Bedienseiten auf Handy/Tablet im Browser (Version 1, Punkt 6). Reines Node.js, ohne Electron –
 * läuft später genauso auf dem Raspberry Pi (Version 1.1).
 *
 * - Ausgeliefert wird dieselbe Oberfläche wie im Programmfenster (app/renderer); window.e4 kommt dort aus web.js.
 * - Aufrufe: POST /api/<Name> mit { args: [...] }, nur die Funktionen aus WEB_CALLS.
 * - Meldungen vom Kern (Werte, Zustände, Meldungen …): GET /api/events als „Server-Sent Events“ (HTTP-Datenstrom).
 * - Anmeldung je Browser über ein Sitzungs-Cookie (HttpOnly, SameSite=Strict), unabhängig von der Anmeldung am PC.
 *   Ohne Anmeldung gibt es nur die Anmeldeseite.
 */

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// was ein Browser aufrufen darf; PUBLIC auch ohne Anmeldung (für die Anmeldeseite)
const PUBLIC = ['texts', 'authState', 'login', 'langState', 'getTheme'];
const WEB_CALLS = new Set([...PUBLIC, 'logout', 'setLanguage', 'listDevices', 'deviceValues', 'writeValue', 'listPages', 'getBars',
  'viewPage', 'devicePage', 'alarmsActive', 'alarmsHistory', 'ackAlarm', 'historyQuery', 'isOnline', 'isDemo']);
// zählen als „Bedienung“ (für „Abmelden nach Zeit ohne Bedienung“) – nicht die regelmäßigen Abfragen der Trends
const ACTIVE_CALLS = new Set(['writeValue', 'ackAlarm', 'setLanguage', 'viewPage', 'devicePage', 'alarmsHistory', 'listPages']);

const STATIC = {
  '/': ['app/renderer/web.html', 'text/html; charset=utf-8'],
  '/app/renderer/app.js': ['app/renderer/app.js', 'text/javascript; charset=utf-8'],
  '/app/renderer/web.js': ['app/renderer/web.js', 'text/javascript; charset=utf-8'],
  '/app/renderer/symbols.js': ['app/renderer/symbols.js', 'text/javascript; charset=utf-8'],
  '/app/renderer/styles.css': ['app/renderer/styles.css', 'text/css; charset=utf-8'],
  '/src/shared/theme.js': ['src/shared/theme.js', 'text/javascript; charset=utf-8'],
};
const FONT = /^\/node_modules\/@fontsource\/(atkinson-hyperlegible|ibm-plex-mono|ibm-plex-sans|inter|space-grotesk)\/files\/[a-z0-9-]+\.woff2$/;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; "
  + "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const COOKIE = 'e4s';
const MAX_BODY = 256 * 1024;
const MAX_SESSIONS = 50;
const PING_MS = 15000;
const IDLE_NO_STREAM_MS = 12 * 3600 * 1000; // Browser zu und nie wieder geöffnet: Sitzung nach 12 h vergessen

/** private Netzwerk-Adressen zuerst (das ist die, die im WLAN erreichbar ist) */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return [...new Set(out)].sort((a, b) => rank(a) - rank(b));
}

class WebServer {
  /** opts: { api: AppApi, root: Ordner mit app/ und src/, host: z. B. '127.0.0.1' für Tests (Standard: alle Netzwerke) } */
  constructor(opts) {
    this.api = opts.api;
    this.root = opts.root;
    this.host = opts.host || null;
    this.server = null;
    this.port = null;
    this.sessions = new Map(); // Sitzungsschlüssel -> { view, ip, since, last, streams: Set }
    this.loginTries = new Map(); // IP -> [Zeitpunkte] (gegen massenhaftes Raten fremder Namen)
    this.timer = null;
    const api = this.api;
    // Ereignisse des Kerns an alle angemeldeten Browser; Meldungen und Sprache je Browser in seiner Sprache
    api.on('values', (b) => this._broadcast('values', () => b));
    api.on('deviceState', (s) => this._broadcast('deviceState', () => s));
    api.on('online', (on) => this._broadcast('online', () => on));
    api.on('seen', (m) => this._broadcast('seen', () => m));
    api.on('alarms', () => this._broadcast('alarms', (s) => s.view.alarmsActive()));
    api.on('lang', () => this._broadcast('lang', (s) => s.view.langState()));
    api.on('auth', () => this._usersChanged());
  }

  get running() { return !!(this.server && this.server.listening); }

  urls() {
    if (!this.running) return [];
    const ips = this.host && this.host !== '0.0.0.0' ? [this.host] : lanAddresses();
    return ips.map((ip) => `http://${ip}:${this.port}`);
  }

  /** angemeldete Browser für die Einstellungen am PC */
  clients() {
    return [...this.sessions.values()].filter((s) => s.view.session)
      .map((s) => ({ name: s.view.session.name, role: s.view.session.role, ip: s.ip, since: s.since, connected: s.streams.size > 0 }));
  }

  start(port) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this._handle(req, res).catch((err) => this._send(res, 500, { ok: false, error: err.message }));
      });
      server.keepAliveTimeout = 5000;
      server.once('error', reject);
      server.listen(port, this.host || undefined, () => {
        server.removeListener('error', reject);
        server.on('error', () => {});
        this.server = server;
        this.port = server.address().port;
        this.timer = setInterval(() => this._sweep(), 10000);
        resolve(this.port);
      });
    });
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    for (const s of this.sessions.values()) for (const r of s.streams) r.end();
    this.sessions.clear();
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections && server.closeAllConnections(); });
  }

  // ------------------------------------------------------------------ Sitzungen

  _sessionOf(req) {
    const m = /(?:^|;\s*)e4s=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || '');
    const s = m && this.sessions.get(m[1]);
    return s ? Object.assign(s, { token: m[1] }) : null;
  }

  _end(token, reason) {
    const s = this.sessions.get(token);
    if (!s) return;
    if (reason) s.view.logout(reason);
    this.sessions.delete(token);
    for (const r of s.streams) { this._event(r, 'auth', s.view.authState()); r.end(); }
    this.api._webChanged();
  }

  /** Abmelden nach Zeit ohne Bedienung (Einstellung „Abmelden nach“ unter Benutzer) */
  _sweep() {
    const min = this.api.users.settings.logoutMin;
    const now = Date.now();
    for (const [token, s] of this.sessions) {
      if (min && now - s.last > min * 60000) this._end(token, 'timeout');
      else if (!s.streams.size && now - s.last > IDLE_NO_STREAM_MS) this._end(token, 'timeout');
    }
  }

  /** am PC Benutzer geändert/gelöscht oder letzten Einrichter entfernt */
  _usersChanged() {
    for (const [token, s] of this.sessions) {
      if (!s.view.refreshUser()) this._end(token);
      else for (const r of s.streams) this._event(r, 'auth', s.view.authState());
    }
    if (!this.api.users.active() && this.running) this.api.applyWeb().catch(() => {});
    this.api._webChanged();
  }

  // ------------------------------------------------------------------ Anfragen

  _send(res, status, body, headers) {
    if (res.headersSent) { res.end(); return; }
    const json = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, this._security(), headers || {}));
    res.end(json);
  }

  _security() {
    return { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
  }

  _ip(req) { return String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''); }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'GET' && (STATIC[p] || FONT.test(p))) return this._static(res, p);
    if (req.method === 'GET' && p === '/api/events') return this._events(req, res);
    if (req.method === 'GET' && p.startsWith('/bild/')) return this._image(req, res, decodeURIComponent(p.slice(6)));
    if (req.method === 'POST' && p.startsWith('/api/')) return this._call(req, res, p.slice(5));
    if (req.method === 'GET' && p === '/favicon.ico') { res.writeHead(204); res.end(); return undefined; }
    return this._send(res, 404, { ok: false, error: 'not found' });
  }

  _static(res, p) {
    const [file, type] = STATIC[p] || [p.slice(1), 'font/woff2'];
    let data;
    try { data = fs.readFileSync(path.join(this.root, file)); } catch (e) { return this._send(res, 404, { ok: false, error: 'not found' }); }
    // Schriften ändern sich nie; Programmteile nach einem Update sofort neu
    res.writeHead(200, Object.assign({ 'content-type': type, 'cache-control': type === 'font/woff2' ? 'max-age=31536000' : 'no-cache' }, this._security()));
    res.end(data);
    return undefined;
  }

  _image(req, res, name) {
    if (!this._sessionOf(req)) return this._send(res, 401, { ok: false, error: 'login' });
    const img = this.api.imageFile(name);
    if (!img) return this._send(res, 404, { ok: false, error: 'not found' });
    res.writeHead(200, Object.assign({ 'content-type': img.type, 'cache-control': 'private, max-age=86400' }, this._security()));
    res.end(fs.readFileSync(img.file));
    return undefined;
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const parts = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      req.on('error', reject);
    });
  }

  async _call(req, res, name) {
    // nur aus der eigenen Oberfläche: eigener Kopf „x-e4“ (fremde Seiten dürfen ihn ohne Erlaubnis nicht setzen)
    if (req.headers['x-e4'] !== '1') return this._send(res, 403, { ok: false, error: 'forbidden' });
    if (!WEB_CALLS.has(name)) return this._send(res, 404, { ok: false, error: 'not found' });
    let args;
    try { const body = JSON.parse((await this._readBody(req)) || '{}'); args = Array.isArray(body.args) ? body.args : []; } catch (e) {
      return this._send(res, 400, { ok: false, error: 'bad request' });
    }
    const s = this._sessionOf(req);
    if (name === 'login') return this._login(req, res, s, args);
    if (!s && !PUBLIC.includes(name)) return this._send(res, 401, { ok: false, error: 'login' });
    const view = s ? s.view : this.api.clientView({ ip: this._ip(req) });
    if (s && ACTIVE_CALLS.has(name)) s.last = Date.now();
    try {
      const result = await view[name](...args);
      if (name === 'logout' && s) { this._end(s.token); return this._send(res, 200, { ok: true, result }, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` }); }
      if (name === 'setLanguage' && s) for (const r of s.streams) this._event(r, 'lang', result);
      return this._send(res, 200, { ok: true, result: result === undefined ? null : result });
    } catch (err) {
      return this._send(res, 200, { ok: false, error: err.message, code: err.code || null });
    }
  }

  _login(req, res, old, args) {
    const ip = this._ip(req);
    const now = Date.now();
    const tries = (this.loginTries.get(ip) || []).filter((x) => now - x < 60000);
    tries.push(now);
    this.loginTries.set(ip, tries);
    if (tries.length > 20) return this._send(res, 200, { ok: true, result: { ok: false, locked: true, wait: 60, left: 0 } });
    if (old) this._end(old.token, 'logout');
    const view = this.api.clientView({ ip });
    const r = view.login(args[0], args[1]);
    if (!r.ok) return this._send(res, 200, { ok: true, result: r });
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.sessions.entries()].sort((a, b) => a[1].last - b[1].last)[0];
      this._end(oldest[0], 'timeout');
    }
    const token = crypto.randomBytes(24).toString('base64url');
    this.sessions.set(token, { view, ip, since: now, last: now, streams: new Set() });
    this.api._webChanged();
    return this._send(res, 200, { ok: true, result: r }, { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict` });
  }

  // ------------------------------------------------------------------ Datenstrom zum Browser

  _event(res, type, data) {
    try { res.write(`event: ${type}\ndata: ${JSON.stringify(data === undefined ? null : data)}\n\n`); } catch (e) { /* Verbindung schon weg */ }
  }

  _events(req, res) {
    const s = this._sessionOf(req);
    if (!s) return this._send(res, 401, { ok: false, error: 'login' });
    res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' }, this._security()));
    res.write('retry: 3000\n\n');
    this._event(res, 'hello', { online: this.api.isOnline() });
    s.streams.add(res);
    const ping = setInterval(() => this._event(res, 'ping', Date.now()), PING_MS);
    req.on('close', () => { clearInterval(ping); s.streams.delete(res); this.api._webChanged(); });
    this.api._webChanged();
    return undefined;
  }

  _broadcast(type, make) {
    for (const s of this.sessions.values()) {
      if (!s.streams.size || !s.view.session) continue;
      let data;
      try { data = make(s); } catch (e) { continue; }
      for (const r of s.streams) this._event(r, type, data);
    }
  }
}

module.exports = { WebServer, WEB_CALLS, PUBLIC, lanAddresses };
