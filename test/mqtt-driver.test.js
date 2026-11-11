'use strict';
// MQTT-Treiber gegen Broker + simulierte easyE4 (test/sim/mqtt-sim.js). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const sim = require('./sim/mqtt-sim');
const { createDriver } = require('../src/protocols');
const { certs, SKIP_TEXT } = require('./sim/certs');

const BASE = 'easye4/nt1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withSim(simOpts, settings, secrets, fn) {
  const s = await sim.start(Object.assign({ base: BASE }, simOpts));
  let drv = null;
  try {
    drv = createDriver(Object.assign({ protocol: 'mqtt', host: '127.0.0.1', port: s.port, baseTopic: BASE, timeout: 2000 }, settings), secrets);
    await fn(s, drv);
  } finally {
    if (drv) await drv.close();
    await s.stop();
  }
}

// warten, bis eine Bedingung erfüllt ist (höchstens 2 s)
async function until(cond) {
  for (let i = 0; i < 100 && !cond(); i++) await sleep(20);
  assert.ok(cond(), 'Bedingung nicht erfüllt');
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('zyklische Daten lesen (M001 = M1, true = 1)', () => withSim({ values: { M001: true, MW3: 42, MD6: -2, IA1: 512, Q1: false } }, {}, {}, async (s, drv) => {
  const states = [];
  drv.on('state', (st) => states.push(st));
  const r = await drv.read([{ name: 'M1' }, { name: 'MW3' }, { name: 'MD6' }, { name: 'IA01' }, { name: 'Q1' }, { name: 'MW9' }]);
  assert.deepStrictEqual(r.values, { M1: 1, MW3: 42, MD6: -2, IA01: 512, Q1: 0 });
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].name, 'MW9');
  assert.match(r.errors[0].text, /Zyklische Daten/);
  assert.strictEqual(drv.state, 'online');
  assert.deepStrictEqual(states, ['unknown', 'online'], 'erst „Broker ok, easyE4 unklar“, dann verbunden');
}));

test('neue Werte kommen als Ereignis', () => withSim({}, {}, {}, async (s, drv) => {
  await drv.read([{ name: 'MW3' }]);
  const seen = [];
  drv.on('values', (v) => { if (v.MW3 !== undefined) seen.push(v.MW3); });
  s.st.values.MW3 = 99;
  await until(() => seen.includes(99));
}));

test('schreiben: {"state":{…}} mit QoS 0, nicht beschreibbare Operanden abgelehnt', () => withSim({}, {}, {}, async (s, drv) => {
  await drv.write({ name: 'M5' }, true);
  await drv.write({ name: 'MW3' }, '17');
  await drv.write({ name: 'MD006' }, -5);
  await until(() => s.st.received.length === 3);
  assert.deepStrictEqual(s.st.received, [{ state: { M5: 1 } }, { state: { MW3: 17 } }, { state: { MD6: -5 } }]);
  // die easyE4 meldet den neuen Wert mit den nächsten zyklischen Daten zurück
  await until(() => drv.cache.get('MW3') === 17);
  assert.strictEqual((await drv.read([{ name: 'MW3' }])).values.MW3, 17);
  await assert.rejects(drv.write({ name: 'Q1' }, 1), /Ausgänge können über MQTT nicht geschrieben werden/);
  await assert.rejects(drv.write({ name: 'I05' }, 1), /reserviert/);
  await assert.rejects(drv.write({ name: 'ID25' }, 1), /reserviert/);
  await assert.rejects(drv.write({ name: 'M1' }, 2), /kein Bit-Wert/);
  await assert.rejects(drv.write({ name: 'MW1' }, 1.5), /ganze Zahl von -32768 bis 65535/);
  await assert.rejects(drv.write({ name: '2NW3' }, 1), /NET-Teilnehmer 2/);
  assert.strictEqual(s.st.received.length, 3, 'Abgelehntes wird gar nicht erst gesendet');
}));

test('RUN/STOP über Aktionen: jede mit eigener ID, Ergebnis nach IN_PROGRESS', () => withSim({}, {}, {}, async (s, drv) => {
  const r = await drv.setMode('STOP');
  assert.strictEqual(r.success, true);
  assert.strictEqual(s.st.state, 'STOP');
  await drv.setMode('run');
  assert.strictEqual(s.st.state, 'RUN');
  const ids = s.st.actions.map((a) => a.id);
  assert.strictEqual(new Set(ids).size, 2, 'jede Aktion hat eine eigene ID');
  const bad = await drv.action('Gibts_nicht');
  assert.strictEqual(bad.success, false);
  assert.strictEqual(bad.errorMsg, 'unknown operation');
  await assert.rejects(drv.setMode('PAUSE'), /RUN oder STOP/);
}));

test('easyE4 im STOP: keine Daten, verständliche Meldung', () => withSim({}, { timeout: 500 }, {}, async (s, drv) => {
  s.st.state = 'STOP';
  const r = await drv.read([{ name: 'MW3' }]);
  assert.deepStrictEqual(r.values, {});
  assert.match(r.errors[0].text, /easyE4 im RUN\?/);
  const tr = await drv.test();
  assert.strictEqual(tr.ok, true);
  assert.strictEqual(tr.warn, true);
  assert.match(tr.text, /keine Daten der easyE4/);
}));

test('Verbindungsabbruch der easyE4: Letzter Wille -> offline', () => withSim({}, {}, {}, async (s, drv) => {
  await drv.read([{ name: 'MW3' }]);
  assert.strictEqual(drv.state, 'online');
  s.dropDevice();
  await until(() => drv.state === 'offline');
  await assert.rejects(drv.read([{ name: 'MW3' }]), (err) => err.network === true && /connected = false/.test(err.message));
}));

test('Verbindung testen', () => withSim({}, {}, {}, async (s, drv) => {
  const r = await drv.test();
  assert.strictEqual(r.ok, true, r.text);
  assert.match(r.text, /^Verbindung OK – die easyE4 sendet \d+ Werte \(z\. B\. M1, M2, MW3, MD6\)$/);
}));

test('Anmeldung am Broker', async () => {
  await withSim({ user: 'visu', password: 'geheim' }, { user: 'visu' }, { password: 'geheim' }, async (s, drv) => {
    assert.strictEqual((await drv.read([{ name: 'MW3' }])).values.MW3, 42);
  });
  await withSim({ user: 'visu', password: 'geheim' }, { user: 'visu' }, { password: 'falsch' }, async (s, drv) => {
    await assert.rejects(drv.read([{ name: 'MW3' }]), (err) => err.auth === true && /Anmeldung am MQTT-Broker abgelehnt/.test(err.message));
    assert.strictEqual(drv.state, 'auth');
  });
});

test('Broker nicht erreichbar', async () => {
  const drv = createDriver({ protocol: 'mqtt', host: '127.0.0.1', port: await freePort(), baseTopic: BASE, timeout: 1000 });
  try {
    await assert.rejects(drv.read([{ name: 'MW3' }]), (err) => err.network === true && /MQTT-Broker 127\.0\.0\.1:\d+ nicht erreichbar/.test(err.message));
    assert.strictEqual(drv.state, 'offline');
    assert.strictEqual((await drv.test()).ok, false);
  } finally {
    await drv.close();
  }
});

test('Einstellungen prüfen', async () => {
  assert.strictEqual(createDriver({ protocol: 'mqtt', host: '', baseTopic: BASE }).problem, 'Adresse des MQTT-Brokers fehlt');
  assert.match(createDriver({ protocol: 'mqtt', host: 'x' }).problem, /Basis-Topic fehlt/);
  assert.match(createDriver({ protocol: 'mqtt', host: 'x', baseTopic: 'easye4/#' }).problem, /ungültig/);
  const d = createDriver({ protocol: 'mqtt', host: 'x', baseTopic: BASE, tls: true });
  assert.strictEqual(d.port, 8883);
  await d.close();
  await assert.rejects(d.read([{ name: 'MW1' }]), /Verbindung wurde beendet/);
});

const tlsCerts = certs();
test('Broker mit TLS (wie Port 8883 am Raspberry Pi)', { skip: tlsCerts ? false : SKIP_TEXT }, () =>
  withSim({ tls: tlsCerts.modern, user: 'visu', password: 'geheim' }, { tls: true, user: 'visu' }, { password: 'geheim' }, async (s, drv) => {
    assert.strictEqual((await drv.read([{ name: 'MW3' }])).values.MW3, 42);
  }));

test('eigene Topics statt Basis-Topic (wie „Einzeln“ im Node-RED-Paket)', () => withSim({}, {
  baseTopic: '', topics: { data: `${BASE}/data`, set: `${BASE}/set`, request: `${BASE}/actions/request`, response: `${BASE}/actions/response` },
}, {}, async (s, drv) => {
  assert.strictEqual(drv.problem, null);
  assert.strictEqual((await drv.read([{ name: 'MW3' }])).values.MW3, 42);
  await drv.write({ name: 'MW3' }, 5);
  await until(() => s.st.values.MW3 === 5);
  assert.strictEqual((await drv.setMode('STOP')).success, true);
  assert.match(createDriver({ protocol: 'mqtt', host: 'x', topics: { data: 'a/data' } }).problem, /alle vier Topics einzeln/);
}));

const ca = require('./sim/certs').caChain();
test('TLS mit CA-Zertifikat (ca.crt) wie beim Mosquitto: Broker wird geprüft', { skip: ca ? false : SKIP_TEXT }, async () => {
  try {
    const tlsOpts = { key: ca.key, cert: ca.cert };
    // richtige CA: verbindet
    await withSim({ tls: tlsOpts }, { caFile: ca.caFile }, {}, async (s, drv) => {
      assert.strictEqual(drv.tls, true, 'mit CA-Datei automatisch verschlüsselt');
      assert.strictEqual((await drv.read([{ name: 'MW3' }])).values.MW3, 42);
    });
    // fremde CA: abgelehnt, mit verständlicher Meldung
    await withSim({ tls: tlsOpts }, { caFile: ca.otherCaFile }, {}, async (s, drv) => {
      await assert.rejects(drv.read([{ name: 'MW3' }]), /passt nicht zur angegebenen CA-Datei/);
    });
    // Name/IP nicht im Zertifikat (Zertifikat gilt für 127.0.0.1, verbunden wird mit „localhost“)
    await withSim({ tls: tlsOpts }, { caFile: ca.caFile, host: 'localhost' }, {}, async (s, drv) => {
      await assert.rejects(drv.read([{ name: 'MW3' }]), /Adresse „localhost“ steht nicht im Zertifikat/);
    });
    assert.match(createDriver({ protocol: 'mqtt', host: 'x', baseTopic: BASE, caFile: 'C:/gibt/es/nicht.crt' }).problem, /nicht gefunden/);
  } finally {
    ca.cleanup();
  }
});

test('Broker erreichbar, easyE4 aus: nach kurzer Zeit „sendet nichts“ statt „noch keine Verbindung“', async () => {
  await withSim({ device: false }, { timeout: 500 }, {}, async (s, drv) => {
    const states = [];
    drv.on('state', (st) => states.push(st));
    await drv.read([{ name: 'M1' }]).catch(() => {});
    await until(() => drv.state === 'offline');
    assert.match(drv.stateText(), /sendet nichts/);
  });
});

test('Broker erst aus, dann an (Pi neu gestartet): Zustand wechselt von „Broker weg“ zu „Broker ok, easyE4 sendet nichts“', async () => {
  const free = await new Promise((r) => { const srv = net.createServer().listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => r(p)); }); });
  const drv = createDriver({ protocol: 'mqtt', host: '127.0.0.1', port: free, baseTopic: BASE, timeout: 500 }, {});
  const seen = [];
  drv.on('state', (st, detail) => seen.push(`${st}:${detail}`));
  let s = null;
  try {
    await drv.read([{ name: 'M1' }]).catch(() => {});
    assert.strictEqual(drv.state, 'offline', 'Broker weg');
    s = await sim.start({ base: BASE, port: free, device: false });
    await drv.read([{ name: 'M1' }]).catch(() => {});
    assert.ok(seen.includes('unknown:broker'), `Broker wieder da gemeldet: ${seen.join(', ')}`);
    await until(() => seen.includes('offline:nodata'));
    assert.match(drv.stateText(), /sendet nichts/);
  } finally {
    await drv.close();
    if (s) await s.stop();
  }
});
