'use strict';
// Handy/Tablet im Browser (Version 1, Punkt 6): Webserver, Anmeldung je Browser, Rechte, Datenstrom, QR-Code. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { AppApi } = require('../src/app/api');
const qr = require('../src/web/qr');

const ROOT = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

/** kleine HTTP-Hilfe: { status, headers, body (Text), json } */
function request(port, method, p, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    const body = o.body === undefined ? null : JSON.stringify(o.body);
    const req = http.request({ host: '127.0.0.1', port, method, path: p,
      headers: Object.assign({}, body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}, o.headers || {}) }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Aufruf wie aus web.js; cookie = Sitzung */
async function call(port, name, args, cookie) {
  const r = await request(port, 'POST', `/api/${name}`, { body: { args: args || [] }, headers: Object.assign({ 'x-e4': '1' }, cookie ? { cookie } : {}) });
  return r;
}
const cookieOf = (r) => String((r.headers['set-cookie'] || [])[0] || '').split(';')[0];

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-web-'));
  const api = new AppApi({ dir, history: false, webRoot: ROOT, webHost: '127.0.0.1' });
  const port = await freePort();
  return { dir, api, port };
}

test('QR-Code: richtige Größe, Suchmuster in drei Ecken, gleiches Muster wie geprüft', () => {
  const q = qr.encode('http://192.168.178.50:8080') // Fritz!Box-Standardnetz; Muster mit einem QR-Leser geprüft;
  assert.strictEqual(q.version, 2);
  assert.strictEqual(q.size, 25);
  // Suchmuster: äußerer Ring dunkel, dann hell, Kern dunkel
  for (const [x, y] of [[0, 0], [q.size - 7, 0], [0, q.size - 7]]) {
    assert.ok(q.dark(x, y) && q.dark(x + 6, y + 6) && !q.dark(x + 1, y + 1) && q.dark(x + 3, y + 3));
  }
  let bits = '';
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) bits += q.dark(x, y) ? '1' : '0';
  // Muster einmal mit einem unabhängigen QR-Leser (jsQR) geprüft – Änderungen am Verfahren fallen hier auf
  assert.strictEqual(crypto.createHash('sha256').update(bits).digest('hex'), '31898c9ccf51aa135e22c30dfc1c8773a574aceab186d77daf998526851c0788');
  assert.match(qr.svg('http://10.0.0.5:8080'), /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  assert.throws(() => qr.encode('x'.repeat(200)), /zu lang/);
});

test('Im Netzwerk bereitstellen: erst mit Techniker, Port prüfen, Adresse und QR-Code', async () => {
  const { api, port } = await setup();
  try {
    assert.strictEqual(api.getWebState().enabled, false);
    await assert.rejects(api.setWebOptions({ enabled: true, port }), /Techniker/);
    api.userAdd({ name: 'Ralf', role: 'setup', password: 'geheim123' });
    await assert.rejects(api.setWebOptions({ port: 70000 }), /Port/);
    const s = await api.setWebOptions({ enabled: true, port });
    assert.strictEqual(s.running, true);
    assert.deepStrictEqual(s.urls, [`http://127.0.0.1:${port}`]);
    assert.match(s.qr, /<svg/);
    assert.deepStrictEqual(s.clients, []);
    const html = await request(port, 'GET', '/');
    assert.strictEqual(html.status, 200);
    assert.match(html.body, /web\.js/);
    assert.match(html.headers['content-security-policy'], /default-src 'self'/);
    assert.strictEqual(html.headers['x-frame-options'], 'DENY');
    assert.strictEqual((await request(port, 'GET', '/app/renderer/app.js')).status, 200);
    assert.strictEqual((await request(port, 'GET', '/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2')).status, 200);
    // nur die freigegebenen Dateien – keine Projektdateien, nichts außerhalb
    assert.strictEqual((await request(port, 'GET', '/package.json')).status, 404);
    assert.strictEqual((await request(port, 'GET', '/app/main.js')).status, 404);
    assert.strictEqual((await request(port, 'GET', '/node_modules/@fontsource/inter/../../../package.json')).status, 404);
    // im Bedienprotokoll steht die Einstellung
    assert.ok(api.auditQuery({}).some((e) => /Im Netzwerk bereitstellen: ja/.test(e.what)));
    const off = await api.setWebOptions({ enabled: false });
    assert.strictEqual(off.running, false);
    await assert.rejects(request(port, 'GET', '/'));
  } finally { await api.stop(); }
});

test('Anmeldung im Browser: eigene Sitzung, Rechte je Rolle, PC bleibt unberührt, Protokoll mit „Browser“', async () => {
  const { api, port } = await setup();
  try {
    api.userAdd({ name: 'Ralf', role: 'setup', password: 'geheim123' }); // am PC gleich angemeldet
    api.userAdd({ name: 'Schicht A', role: 'operator', pin: '1234' });
    api.userAdd({ name: 'Gast', role: 'viewer', password: 'nurschauen' });
    await api.setWebOptions({ enabled: true, port });

    // ohne eigenen Kopf x-e4 (z. B. von einer fremden Seite): abgelehnt
    assert.strictEqual((await request(port, 'POST', '/api/authState', { body: { args: [] } })).status, 403);
    // ohne Anmeldung: nur Anmeldeseite
    const a0 = await call(port, 'authState');
    assert.strictEqual(a0.json.result.user, null);
    assert.strictEqual(a0.json.result.active, true);
    assert.strictEqual(a0.json.result.users, undefined); // keine Namensliste für Fremde
    assert.strictEqual((await call(port, 'listPages', ['current'])).status, 401);
    assert.strictEqual((await call(port, 'writeValue', ['x', 'M1', 1])).status, 401);
    assert.strictEqual((await request(port, 'GET', '/api/events')).status, 401);
    // nicht freigegebene Funktionen gibt es im Browser gar nicht
    assert.strictEqual((await call(port, 'saveDevice', [{}])).status, 404);
    assert.strictEqual((await call(port, 'setOnline', [true])).status, 404);
    assert.strictEqual((await call(port, 'usersList')).status, 404);

    // falscher Name / falsche PIN
    assert.strictEqual((await call(port, 'login', ['Niemand', '1234'])).json.result.ok, false);
    const wrong = await call(port, 'login', ['schicht a', '9999']);
    assert.strictEqual(wrong.json.result.ok, false);
    assert.strictEqual(wrong.json.result.left, 4);
    // richtig (Groß-/Kleinschreibung des Namens egal)
    const ok = await call(port, 'login', ['schicht a', '1234']);
    assert.strictEqual(ok.json.result.ok, true);
    const cookie = cookieOf(ok);
    assert.match(cookie, /^e4s=/);
    assert.match(String(ok.headers['set-cookie']), /HttpOnly/);
    assert.match(String(ok.headers['set-cookie']), /SameSite=Strict/);
    const a1 = (await call(port, 'authState', [], cookie)).json.result;
    assert.strictEqual(a1.user.name, 'Schicht A');
    assert.strictEqual(a1.role, 'operator');
    // am PC ist weiterhin Ralf angemeldet
    assert.strictEqual(api.authState().user.name, 'Ralf');
    assert.strictEqual(api.getWebState().clients[0].name, 'Schicht A');

    // Bediener darf schreiben (Gerät gibt es nicht → Fehler der Steuerung, aber kein „keine Berechtigung“)
    const w = (await call(port, 'writeValue', ['nichtda', 'M1', 1], cookie)).json;
    assert.strictEqual(w.ok, false);
    assert.notStrictEqual(w.code, 'denied');
    assert.strictEqual((await call(port, 'listPages', ['current'], cookie)).json.ok, true);
    assert.ok(api.auditQuery({}).some((e) => e.kind === 'login' && e.user === 'Schicht A' && /Browser 127\.0\.0\.1/.test(e.what)));

    // Beobachter: nur schauen
    const gast = cookieOf(await call(port, 'login', ['Gast', 'nurschauen']));
    const wg = (await call(port, 'writeValue', ['nichtda', 'M1', 1], gast)).json;
    assert.strictEqual(wg.code, 'denied');
    assert.strictEqual((await call(port, 'ackAlarm', ['all'], gast)).json.code, 'denied');

    // Abmelden: Sitzung weg, Cookie gelöscht
    const out = await call(port, 'logout', [], gast);
    assert.match(String(out.headers['set-cookie']), /Max-Age=0/);
    assert.strictEqual((await call(port, 'listPages', ['current'], gast)).status, 401);
    assert.ok(api.auditQuery({}).some((e) => e.kind === 'logout' && e.user === 'Gast'));
    assert.strictEqual(api.authState().user.name, 'Ralf');
    // am PC abmelden, während der Webserver läuft (war ein Fehler: Rechteprüfung beim Melden an das Fenster)
    assert.doesNotThrow(() => api.logout());
    assert.strictEqual((await call(port, 'authState', [], cookie)).json.result.user.name, 'Schicht A');
  } finally { await api.stop(); }
});

test('Browser: Sperre nach 5 Fehlversuchen, Abmelden nach Zeit, Benutzer am PC gelöscht', async () => {
  const { api, port } = await setup();
  try {
    api.userAdd({ name: 'Ralf', role: 'setup', password: 'geheim123' });
    const op = api.userAdd({ name: 'Schicht A', role: 'operator', pin: '1234' });
    await api.setWebOptions({ enabled: true, port });
    let r;
    for (let i = 0; i < 5; i++) r = (await call(port, 'login', ['Schicht A', '0000'])).json.result;
    assert.strictEqual(r.locked, true);
    assert.strictEqual((await call(port, 'login', ['Schicht A', '1234'])).json.result.ok, false); // gesperrt
    api.users.fails.clear();

    // Abmelden nach Zeit ohne Bedienung (Einstellung am PC)
    api.setAuthSettings({ logoutMin: 5 });
    const c1 = cookieOf(await call(port, 'login', ['Schicht A', '1234']));
    for (const s of api.web.sessions.values()) s.last = Date.now() - 6 * 60000;
    api.web._sweep();
    assert.strictEqual((await call(port, 'listPages', ['current'], c1)).status, 401);
    assert.ok(api.auditQuery({}).some((e) => e.kind === 'autoLogout' && e.user === 'Schicht A'));

    // Benutzer am PC gelöscht → Browser-Sitzung endet sofort; Rolle geändert → gilt sofort
    const c2 = cookieOf(await call(port, 'login', ['Schicht A', '1234']));
    api.userUpdate(op.id, { role: 'viewer' });
    assert.strictEqual((await call(port, 'authState', [], c2)).json.result.role, 'viewer');
    assert.strictEqual((await call(port, 'writeValue', ['x', 'M1', 1], c2)).json.code, 'denied');
    api.userRemove(op.id);
    assert.strictEqual((await call(port, 'listPages', ['current'], c2)).status, 401);
  } finally { await api.stop(); }
});

test('Browser: Datenstrom mit Werten und Meldungen, Sprache je Browser, Startseite im Browser', async () => {
  const { api, port } = await setup();
  try {
    api.userAdd({ name: 'Ralf', role: 'setup', password: 'geheim123' });
    api.userAdd({ name: 'Schicht A', role: 'operator', pin: '1234' });
    api.addLang('en');
    await api.savePages([{ id: 'p1', name: 'Übersicht', items: [] }, { id: 'handy', name: 'Handy', items: [] }]);
    await api.setWebOptions({ enabled: true, port, startPage: 'handy' });
    const cookie = cookieOf(await call(port, 'login', ['Schicht A', '1234']));
    assert.strictEqual((await call(port, 'authState', [], cookie)).json.result.startPage, 'handy');
    assert.strictEqual((await call(port, 'authState', [], cookie)).json.result.startPageTablet, null);
    await api.setWebOptions({ startPageTablet: 'p1' });
    assert.strictEqual((await call(port, 'authState', [], cookie)).json.result.startPageTablet, 'p1');
    assert.strictEqual(api.getWebOptions().startPage, 'handy', 'Startseite Handy bleibt');

    const got = [];
    const stream = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { cookie } }, (res) => {
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const type = (/^event: (.*)$/m.exec(block) || [])[1];
            const data = (/^data: (.*)$/m.exec(block) || [])[1];
            if (type) got.push({ type, data: JSON.parse(data) });
          }
        });
        resolve({ req, res });
      });
      req.on('error', reject);
    });
    const until = async (cond) => { const end = Date.now() + 3000; while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); assert.ok(cond()); };
    await until(() => got.some((x) => x.type === 'hello'));
    assert.strictEqual(api.getWebState().clients[0].connected, true);
    api.emit('values', { dev1: { M1: { value: 1, quality: 'good' } } });
    api.emit('alarms', []);
    await until(() => got.some((x) => x.type === 'values') && got.some((x) => x.type === 'alarms'));
    assert.deepStrictEqual(got.find((x) => x.type === 'values').data.dev1.M1.value, 1);

    // Sprache im Browser wählen: gilt für diesen Benutzer, der PC bleibt bei Deutsch
    const l = (await call(port, 'setLanguage', ['en'], cookie)).json.result;
    assert.strictEqual(l.lang, 'en');
    await until(() => got.some((x) => x.type === 'lang' && x.data.lang === 'en'));
    assert.strictEqual(api.langState().lang, 'de');
    stream.req.destroy();
  } finally { await api.stop(); }
});

test('Browser: Seiten mit „nicht im Browser zeigen“ fehlen dort, am PC bleiben sie; Handy-Größe wird gespeichert', async () => {
  const { api, port } = await setup();
  try {
    api.userAdd({ name: 'Ralf', role: 'setup', password: 'geheim123' });
    api.userAdd({ name: 'Schicht A', role: 'operator', pin: '1234' });
    const saved = await api.savePages([{ id: 'pc', name: 'Übersicht', items: [], noWeb: true },
      { id: 'handy', name: 'Handy', screen: 'phone', width: 390, height: 844, scroll: true, items: [] }]);
    assert.strictEqual(saved[0].noWeb, true);
    assert.strictEqual(saved[1].screen, 'phone');
    assert.strictEqual(saved[1].noWeb, undefined);
    await api.setWebOptions({ enabled: true, port });
    let audits = 0;
    api.on('audit', () => { audits += 1; });
    const cookie = cookieOf(await call(port, 'login', ['Schicht A', '1234']));
    assert.ok(audits > 0, 'Anmeldung im Browser meldet neuen Protokolleintrag (PC lädt die Liste nach)');
    const list = (await call(port, 'listPages', ['current'], cookie)).json.result;
    assert.deepStrictEqual(list.map((p) => p.id), ['handy']);
    assert.strictEqual((await call(port, 'viewPage', ['handy'], cookie)).json.result.id, 'handy');
    const hidden = await call(port, 'viewPage', ['pc'], cookie);
    assert.ok(hidden.json.error, 'versteckte Seite darf im Browser nicht aufgehen');
    // am PC sind beide Seiten da
    assert.strictEqual(api.listPages('current').length, 2);
    assert.strictEqual(api.viewPage('pc').id, 'pc');
  } finally { await api.stop(); }
});
