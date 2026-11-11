'use strict';
// Prüfprogramm tools/probe.js gegen die drei Simulatoren. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { main, firmwareLevel } = require('../tools/probe');
const modbusSim = require('./sim/modbus-sim');
const createJsonSim = require('./sim/json-sim');
const mqttSim = require('./sim/mqtt-sim');

// Ausgabe von main() mitschreiben statt anzeigen
async function run(args) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const code = await main(args);
    return { code, out: lines.join('\n') };
  } finally {
    console.log = orig;
  }
}

test('Firmware-Angabe', () => {
  assert.strictEqual(firmwareLevel('2.46'), '240');
  assert.strictEqual(firmwareLevel('1.44'), '140');
  assert.strictEqual(firmwareLevel('1.30'), 'old');
  assert.strictEqual(firmwareLevel(undefined), '240');
});

test('Modbus: .itf lesen und schreiben', async () => {
  const s = await modbusSim.start({ port: 0, fw: 246 });
  try {
    s.st.MW[3] = 42;
    const itf = path.join(__dirname, '..', 'beispiele', 'net-test', 'Netzwerk-net1.itf');
    const r = await run(['modbus', '127.0.0.1', '--port', String(s.port), '--fw', '2.46', '--itf', itf, '--write', 'MW5=2000']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /Verbindung OK – Uhr der easyE4/);
    assert.match(r.out, /MW3\s+42\s+Register 46003\n/);
    assert.match(r.out, /M1\s+\d\s+Register 46001\.0\n/, 'Bit 0 wird mit angezeigt');
    assert.match(r.out, /MB3\s+\d+\s+Register 46002\.0\n/);
    assert.match(r.out, /Geschrieben: MW5 = 2000/);
    assert.match(r.out, /MW5\s+2000/);
    assert.strictEqual(s.st.MW[5], 2000);
  } finally {
    await s.stop();
  }
});

test('JSON-API mit Benutzer und Passwort', async () => {
  const sim = createJsonSim();
  const port = await sim.listen();
  try {
    sim.st.MW[1] = 11;
    const r = await run(['json', '127.0.0.1', '--port', String(port), '--user', 'testuser', '--password', 'pw1', '--read', 'MW1, Q1, IA1']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /Firmware 1\.20/);
    assert.match(r.out, /MW1\s+11/);
  } finally {
    await sim.close();
  }
});

test('MQTT: alles anzeigen, was die easyE4 sendet', async () => {
  const s = await mqttSim.start({ base: 'easye4/nt1' });
  try {
    const r = await run(['mqtt', '127.0.0.1', '--port', String(s.port), '--base', 'easye4/nt1']);
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /MW3\s+42/);
    assert.match(r.out, /IA1\s+512/);
  } finally {
    await s.stop();
  }
});

test('Fehler verständlich, Hilfe', async () => {
  let r = await run(['modbus', '127.0.0.1', '--port', '1', '--timeout', '500']);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /nicht erreichbar/);
  r = await run(['mqtt', '127.0.0.1']);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /Basis-Topic fehlt/);
  r = await run([]);
  assert.strictEqual(r.code, 2);
  assert.match(r.out, /node tools\/probe\.js <protokoll> <adresse>/);
});
