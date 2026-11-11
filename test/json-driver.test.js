'use strict';
// JSON-API-Treiber gegen den easyE4-Simulator (test/sim/json-sim.js). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const createSim = require('./sim/json-sim');
const { createDriver } = require('../src/protocols');
const { _agents, _schedulers } = require('../src/protocols/json/driver');
const { parseItf } = require('../src/import/itf');

const itf = (file) => parseItf(fs.readFileSync(path.join(__dirname, '..', 'beispiele', file), 'utf8')).variables;
const byName = (vars) => Object.fromEntries(vars.map((v) => [v.name, v]));

async function withSim(simOpts, settings, secrets, fn) {
  const sim = createSim(simOpts);
  const port = await sim.listen();
  const drv = createDriver(Object.assign({ protocol: 'json', host: '127.0.0.1', port, auth: 'none', gap: 0 }, settings), secrets);
  try {
    await fn(sim.st, drv, port);
  } finally {
    await drv.close();
    await sim.close();
  }
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('Operanden lesen: wenige Anfragen, Namen wie in easySoft (Q, IA)', () => withSim({}, {}, {}, async (st, drv) => {
  st.MW[3] = 42; st.MW[5] = 5; st.MW[6] = 6;
  st.M[2] = 1;
  st.MD[1] = -7;
  st.MB[2] = 200;
  st.I[1] = 1;
  st.O[2] = 1;
  st.AI[1] = 512;
  const states = [];
  drv.on('state', (s) => states.push(s));
  const r = await drv.read([{ name: 'MW3' }, { name: 'MW5' }, { name: 'MW6' }, { name: 'M1' }, { name: 'M2' },
    { name: 'MD1' }, { name: 'MB2' }, { name: 'I1' }, { name: 'Q2' }, { name: 'IA1' }, { name: 'Uhr', operand: 'CLOCK' }]);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.values, { MW3: 42, MW5: 5, MW6: 6, M1: 0, M2: 1, MD1: -7, MB2: 200, I1: 1, Q2: 1, IA1: 512,
    Uhr: { year: 2026, month: 10, day: 18, hour: 11, minute: 0, second: 0 } });
  assert.strictEqual(st.log.length, 1, 'alles in einer Anfrage');
  assert.match(st.log[0].url, /MW\(3,6\)/, 'MW3..MW6 als Bereich');
  assert.match(st.log[0].url, /M\(1,8\)/, 'Bit-Bereich auf ganze Bytes erweitert');
  assert.deepStrictEqual(states, ['online']);
}));

test('.itf-Variablen über die JSON-API lesen', () => withSim({}, {}, {}, async (st, drv) => {
  st.M[16] = 1;
  st.MB[4] = 0xab;
  st.MW[7] = 7;
  st.MD[6] = 123456;
  st.O[3] = 1;
  const r = await drv.read(itf('easye4mb-beispiel.itf'));
  assert.deepStrictEqual(r.errors, []);
  const v = r.values;
  assert.deepStrictEqual([v.M1, v.M16, v.MB4, v.MW7, v.MD6, v.Q3], [0, 1, 0xab, 7, 123456, 1]);
  assert.deepStrictEqual([v['CLOCK.0'], v['CLOCK.3'], v['CLOCK.4'], v['CLOCK.5']], [0, 18, 10, 2026]);
}));

test('Firmware 1.10 liefert Einzelwerte als BASE64', () => withSim({ fw: '1.10' }, {}, {}, async (st, drv) => {
  st.MW[3] = 4711;
  st.M[9] = 1;
  const r = await drv.read([{ name: 'MW3' }, { name: 'M9' }]);
  assert.deepStrictEqual(r.values, { MW3: 4711, M9: 1 });
}));

test('Bereich abgelehnt: Werte einzeln nachlesen, nur der fehlende meldet einen Fehler', () => withSim({}, {}, {}, async (st, drv) => {
  st.AI[47] = 3;
  // AI47 + AI49 -> Bereich AI(47,49); die easyE4 hat nur 48 Analogeingänge -> Fehler 7, dann einzeln
  const r = await drv.read([{ name: 'IA47' }, { name: 'IA49' }]);
  assert.deepStrictEqual(r.values, { IA47: 3 });
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].name, 'IA49');
  assert.strictEqual(r.errors[0].code, 8);
  assert.match(r.errors[0].text, /Nummer \(Index\) ungültig/);
}));

test('Schreiben mit Benutzer und Passwort', () => withSim({}, { auth: 'basic', user: 'testuser' }, { password: 'pw1' }, async (st, drv) => {
  await drv.write({ name: 'MW3' }, 42);
  assert.strictEqual(st.MW[3], 42);
  await drv.write({ name: 'M5' }, true);
  assert.strictEqual(st.M[5], 1);
  await drv.write(byName(itf('easye4mb-beispiel.itf')).MD6, -2);
  assert.strictEqual(st.MD[6], -2);
  await assert.rejects(drv.write({ name: 'Q1' }, 1), /Q ist über den Webserver nicht beschreibbar/);
  await assert.rejects(drv.write(byName(itf('easye4mb-beispiel.itf')).I1, 1), /„I1“ kann nicht geschrieben werden/);
  await assert.rejects(drv.write({ name: 'MB1' }, 300), /MB1: Wert muss zwischen 0 und 255/);
}));

test('Schreiben ohne Anmeldung: verständliche Meldung', () => withSim({}, {}, {}, async (st, drv) => {
  await assert.rejects(drv.write({ name: 'MW3' }, 1), /Keine Berechtigung \(401\)/);
  assert.strictEqual(drv.state, 'online', 'fehlende Schreibrechte heißen nicht, dass die Verbindung gestört ist');
}));

test('falsches Passwort: Zustand „Anmeldung abgelehnt“', () => withSim({}, { auth: 'basic', user: 'testuser' }, { password: 'falsch' }, async (st, drv) => {
  await assert.rejects(drv.read([{ name: 'MW1' }]), (err) => err.auth === true && /Anmeldung abgelehnt \(401\)/.test(err.message));
  assert.strictEqual(drv.state, 'auth');
  assert.strictEqual(drv.stateText(), 'Anmeldung abgelehnt');
}));

test('API-Schlüssel (Bearer) und Lesepfad für admin', async () => {
  await withSim({ anonymous: false }, { auth: 'bearer' }, { apikey: 'KEY123' }, async (st, drv) => {
    st.MW[1] = 1;
    assert.deepStrictEqual((await drv.read([{ name: 'MW1' }])).values, { MW1: 1 });
    assert.strictEqual(st.log[0].auth, 'Bearer KEY123');
  });
  await withSim({ anonymous: false }, { auth: 'basic', user: 'admin' }, { password: 'geheim' }, async (st, drv) => {
    await drv.read([{ name: 'MW1' }]);
    assert.match(st.log[0].url, /^\/api\/get\/adm\?/);
  });
});

test('easyE4 ausgelastet (503): einmal wiederholen', () => withSim({}, {}, {}, async (st, drv) => {
  st.busy503 = 1;
  st.MW[2] = 2;
  assert.deepStrictEqual((await drv.read([{ name: 'MW2' }])).values, { MW2: 2 });
  assert.strictEqual(st.log.length, 2, 'erste Anfrage mit 503, dann die Wiederholung');
}));

test('Webserver schonen: nie zwei Anfragen gleichzeitig, Schreibaufträge zusammengefasst', () =>
  withSim({}, { auth: 'basic', user: 'testuser' }, { password: 'pw1' }, async (st, drv) => {
    st.delay = 30;
    const jobs = [];
    for (let i = 1; i <= 10; i++) jobs.push(drv.write({ name: 'MW5' }, i));
    jobs.push(drv.read([{ name: 'MW1' }]), drv.read([{ name: 'MW2' }]));
    await Promise.all(jobs);
    assert.strictEqual(st.MW[5], 10, 'der neueste Wert gewinnt');
    const writes = st.log.filter((l) => l.url.startsWith('/api/set/op')).length;
    assert.ok(writes <= 2, `zu viele Schreibanfragen: ${writes}`);
    assert.strictEqual(st.maxActive, 1);
    assert.strictEqual(st.maxConns, 1);
  }));

test('Uhr stellen nur in STOP, Betriebsart umschalten', () => withSim({}, { auth: 'basic', user: 'testuser' }, { password: 'pw1' }, async (st, drv) => {
  const d = new Date(2026, 0, 2, 3, 4, 5);
  await assert.rejects(drv.setClock(d), /Nicht erlaubt \(403\)/);
  await drv.setMode('stop');
  assert.strictEqual(st.state, 'STOP');
  await drv.setClock(d);
  assert.strictEqual(st.date, '2026-01-02');
  assert.strictEqual(st.time, '03:04:05');
  await assert.rejects(drv.setMode('PAUSE'), /RUN oder STOP/);
}));

test('Verbindung testen', () => withSim({}, {}, {}, async (st, drv) => {
  const r = await drv.test();
  assert.deepStrictEqual(r.info, { name: 'easyE4', version: '1.20', build: '206', state: 'RUN' });
  assert.strictEqual(r.text, 'Verbindung OK – „easyE4“, Firmware 1.20 (Build 206), RUN');
}));

test('easyE4 nicht erreichbar', async () => {
  const drv = createDriver({ protocol: 'json', host: '127.0.0.1', port: await freePort(), auth: 'none', timeout: 500 });
  try {
    await assert.rejects(drv.read([{ name: 'MW1' }]), (err) => err.network === true && /nicht erreichbar/.test(err.message));
    assert.strictEqual(drv.state, 'offline');
    const r = await drv.test();
    assert.strictEqual(r.ok, false);
  } finally {
    await drv.close();
  }
});

test('Einstellungen prüfen, alles aufgeräumt', async () => {
  assert.strictEqual(createDriver({ protocol: 'json', host: '' }).problem, 'Adresse der easyE4 fehlt');
  assert.strictEqual(createDriver({ protocol: 'json', host: 'x', auth: 'basic' }).problem, 'Benutzername fehlt');
  assert.strictEqual(createDriver({ protocol: 'json', host: 'x', auth: 'bearer' }).problem, 'API-Schlüssel fehlt');
  const d = createDriver({ protocol: 'json', host: 'x', auth: 'none' });
  await d.close();
  await assert.rejects(d.read([{ name: 'MW1' }]), /Verbindung wurde beendet/);
  assert.strictEqual(_agents.size, 0);
  assert.strictEqual(_schedulers.size, 0);
});

// ---------------------------------------------------------------- HTTPS (Testzertifikate über openssl)

const certs = require('./sim/certs').certs();
const noOpenssl = certs ? false : require('./sim/certs').SKIP_TEXT;

async function withHttps(serverOpts, settings, fn, secrets) {
  const srv = https.createServer(serverOpts, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ SYSINFO: { STATE: 'RUN', VERS: '1.44', BUILD: '1', DEVNAME: 'alt' } }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  let drv = null;
  try {
    drv = createDriver(Object.assign({ protocol: 'json', host: '127.0.0.1', port: srv.address().port, auth: 'none' }, settings), secrets);
    await fn(drv);
  } finally {
    if (drv) await drv.close();
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
}

test('HTTPS mit selbst signiertem Zertifikat', { skip: noOpenssl }, async () => {
  await withHttps(certs.modern, { https: true }, async (drv) => {
    assert.strictEqual((await drv.test()).ok, true);
  });
  await withHttps(certs.modern, { https: true, verifyCert: true }, async (drv) => {
    const r = await drv.test();
    assert.strictEqual(r.ok, false);
    assert.match(r.text, /HTTPS-Verbindung zu 127\.0\.0\.1 gescheitert/);
  });
});

test('HTTPS wie bei FW 1.x: nur TLS 1.0, 1024-Bit-Schlüssel', { skip: noOpenssl }, () =>
  withHttps(Object.assign({ minVersion: 'TLSv1', maxVersion: 'TLSv1', ciphers: 'DEFAULT:@SECLEVEL=0' }, certs.old),
    { https: true, auth: 'bearer' }, async (drv) => {
      const r = await drv.test();
      assert.strictEqual(r.ok, true, r.text);
      assert.match(r.text, /Firmware 1\.44/);
    }, { apikey: 'abc' }));

test('NET-Merker anderer Teilnehmer (2NW3) direkt lesen, andere fremde Operanden nicht', () => withSim({}, {}, {}, async (st, drv) => {
  st.NW[2][3] = 2521;
  st.ND[2][3] = 7563;
  st.NW[0][3] = 1;
  const r = await drv.read([{ name: '2NW3' }, { name: '2ND3' }, { name: 'NW3' }, { name: '2IA1' }, { name: '2SN01' }]);
  assert.deepStrictEqual(r.values, { '2NW3': 2521, '2ND3': 7563, NW3: 1 });
  assert.match(st.log[0].url, /NW\(2;3\)/);
  assert.match(r.errors.find((e) => e.name === '2IA1').text, /gehört zum NET-Teilnehmer 2/);
  assert.match(r.errors.find((e) => e.name === '2SN01').text, /Unbekannter Operand „SN“/);
}));

test('alte Verschlüsselung: Einstellung wird von der eingebauten TLS-Bibliothek angenommen (Node.js und Electron)', () => {
  const tls = require('node:tls');
  const { legacyCiphers } = require('../src/protocols/json/driver');
  assert.doesNotThrow(() => tls.createSecureContext({ ciphers: legacyCiphers(), minVersion: 'TLSv1' }));
});
