'use strict';
// Geräteverwaltung, Werte-Speicher und Laufzeit (Abfrage) – mit allen drei Simulatoren. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DeviceStore } = require('../src/core/devices');
const { ValueStore } = require('../src/core/values');
const { Runtime } = require('../src/core/runtime');
const { parseItf } = require('../src/import/itf');
const modbusSim = require('./sim/modbus-sim');
const createJsonSim = require('./sim/json-sim');
const mqttSim = require('./sim/mqtt-sim');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
  const end = Date.now() + (ms || 3000);
  while (!cond() && Date.now() < end) await sleep(20);
  assert.ok(cond(), 'Bedingung nicht erfüllt');
}
const dirs = [];
function tempDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-core-'));
  dirs.push(d);
  return d;
}
test.after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

test('Geräte speichern und laden; Passwörter getrennt', () => {
  const dir = tempDir();
  try {
    const s = new DeviceStore({ dir });
    const d = s.add({ name: 'NT1', protocol: 'json', settings: { host: '192.168.1.68', auth: 'basic', user: 'admin', password: 'nicht hier' },
      variables: [{ name: 'MW3' }] }, { password: 'geheim' });
    s.save();
    const text = fs.readFileSync(path.join(dir, 'devices.json'), 'utf8');
    assert.ok(!text.includes('geheim') && !text.includes('nicht hier'), 'kein Passwort in devices.json');
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).unprotected);

    const s2 = new DeviceStore({ dir }).load();
    assert.strictEqual(s2.list().length, 1);
    assert.strictEqual(s2.get(d.id).settings.host, '192.168.1.68');
    assert.strictEqual(s2.get(d.id).interval, 1000);
    assert.deepStrictEqual(s2.getSecrets(d.id), { password: 'geheim' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Passwörter verschlüsselt speichern (Verfahren wird übergeben)', () => {
  const dir = tempDir();
  try {
    const protect = (t) => Buffer.from(t).toString('base64');
    const unprotect = (t) => Buffer.from(t, 'base64').toString();
    const s = new DeviceStore({ dir, protect, unprotect });
    const d = s.add({ name: 'NT1', protocol: 'mqtt', settings: {} }, { password: 'geheim' });
    s.save();
    assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes('geheim'));
    assert.deepStrictEqual(new DeviceStore({ dir, protect, unprotect }).load().getSecrets(d.id), { password: 'geheim' });
    assert.throws(() => new DeviceStore({ dir }).load(), /verschlüsselt/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Geräte prüfen: Name, Protokoll, Intervall, doppelte Variablen', () => {
  const s = new DeviceStore({ dir: tempDir() });
  assert.throws(() => s.add({ name: '', protocol: 'modbus' }), /Namen für das Gerät/);
  assert.throws(() => s.add({ name: 'A', protocol: 'profibus' }), /Unbekanntes Protokoll/);
  assert.throws(() => s.add({ name: 'A', protocol: 'modbus', variables: [{ name: 'MW1' }, { name: 'MW1' }] }), /doppelt/);
  const a = s.add({ name: 'A', protocol: 'json', interval: 100 });
  assert.strictEqual(a.interval, 500, 'JSON-API: mindestens 0,5 s');
  assert.throws(() => s.add({ name: 'a', protocol: 'modbus' }), /gibt es schon/);
  const b = s.update(a.id, { name: 'B', interval: 2000 });
  assert.strictEqual(b.interval, 2000);
  assert.ok(s.remove(a.id));
  assert.strictEqual(s.list().length, 0);
});

test('Werte-Speicher: Qualität, veraltete Werte, Änderungs-Ereignisse', () => {
  const v = new ValueStore();
  const changes = [];
  v.on('change', (id, name, e) => changes.push(`${name}=${e.value}/${e.quality}`));
  v.update('d1', { values: { MW1: 1, MW2: 2 }, errors: [] });
  v.update('d1', { values: { MW1: 1, MW2: 3 }, errors: [{ name: 'MW9', text: 'nicht freigegeben' }] });
  v.markStale('d1', 'nicht erreichbar');
  assert.deepStrictEqual(changes, ['MW1=1/good', 'MW2=2/good', 'MW2=3/good', 'MW9=null/bad', 'MW1=1/stale', 'MW2=3/stale', 'MW9=null/stale']);
  assert.strictEqual(v.get('d1', 'MW2').value, 3, 'letzter Wert bleibt sichtbar');
  assert.strictEqual(v.snapshot('d1').MW1.error, 'nicht erreichbar');
});

test('Laufzeit: drei Geräte mit drei Protokollen gleichzeitig, schreiben, Ausfall und Wiederkehr', async () => {
  let mb = await modbusSim.start({ port: 0, fw: 246 });
  const js = createJsonSim();
  const jsPort = await js.listen();
  const mq = await mqttSim.start({ base: 'easye4/nt3', values: { MW3: 7, M1: true } });
  const devices = new DeviceStore({ dir: tempDir() });
  const values = new ValueStore();
  const rt = new Runtime(devices, values);
  const states = [];
  rt.on('state', (id, state) => states.push(`${devices.get(id).name}:${state}`));
  try {
    mb.st.MW[3] = 42;
    js.st.MW[3] = 43;
    const itfVars = parseItf(fs.readFileSync(path.join(__dirname, '..', 'beispiele', 'net-test', 'Netzwerk-net1.itf'), 'utf8')).variables
      .filter((v) => ['MW3', 'M1', 'NW3', 'CLOCK.5'].includes(v.name));
    const d1 = devices.add({ name: 'NT1', protocol: 'modbus', interval: 100, settings: { host: '127.0.0.1', port: mb.port, gap: 0 }, variables: itfVars });
    const d2 = devices.add({ name: 'NT2', protocol: 'json', interval: 500, settings: { host: '127.0.0.1', port: jsPort, auth: 'basic', user: 'testuser', gap: 0 },
      variables: [{ name: 'MW3' }, { name: 'MW5' }] }, { password: 'pw1' });
    const d3 = devices.add({ name: 'NT3', protocol: 'mqtt', interval: 500, settings: { host: '127.0.0.1', port: mq.port, baseTopic: 'easye4/nt3', timeout: 2000 },
      variables: [{ name: 'MW3' }, { name: 'M1' }] });
    devices.add({ name: 'aus', protocol: 'modbus', enabled: false, settings: { host: '127.0.0.1', port: 1 } });
    await rt.start();
    assert.strictEqual(rt.running.size, 3, 'ausgeschaltetes Gerät wird nicht abgefragt');

    await until(() => values.get(d1.id, 'MW3') && values.get(d1.id, 'MW3').value === 42);
    await until(() => values.get(d2.id, 'MW3') && values.get(d2.id, 'MW3').value === 43);
    await until(() => values.get(d3.id, 'MW3') && values.get(d3.id, 'MW3').value === 7);
    assert.strictEqual(values.get(d3.id, 'M1').value, 1);
    assert.strictEqual(values.get(d1.id, 'CLOCK.5').value, new Date().getFullYear());
    assert.ok(['NT1:online', 'NT2:online', 'NT3:online'].every((x) => states.includes(x)), states.join());

    // schreiben: Wert kommt beim nächsten Lesen zurück
    await rt.write(d1.id, 'MW3', 100);
    await until(() => values.get(d1.id, 'MW3').value === 100);
    await rt.write(d2.id, 'MW5', 55);
    await until(() => values.get(d2.id, 'MW5').value === 55);
    await rt.write(d3.id, 'MW3', 8);
    await until(() => values.get(d3.id, 'MW3').value === 8);
    await assert.rejects(rt.write(d1.id, 'Q1', 1), /kann nicht geschrieben werden/);

    // JSON-API: Abfragen höchstens alle 0,5 s
    const before = js.st.log.length;
    await sleep(1100);
    const reads = js.st.log.slice(before).filter((l) => l.url.startsWith('/api/get/')).length;
    assert.ok(reads <= 3, `JSON-API zu oft abgefragt: ${reads} in 1,1 s`);

    // Ausfall: Werte bleiben sichtbar, Qualität „veraltet“; danach wieder frisch
    await mb.stop();
    await until(() => values.get(d1.id, 'MW3').quality === 'stale', 5000);
    assert.strictEqual(values.get(d1.id, 'MW3').value, 100);
    assert.ok(states.includes('NT1:offline'));

    // die easyE4 ist wieder da (gleicher Port): Werte werden wieder frisch
    mb = await modbusSim.start({ port: d1.settings.port, fw: 246 });
    mb.st.MW[3] = 101;
    await until(() => values.get(d1.id, 'MW3').quality === 'good' && values.get(d1.id, 'MW3').value === 101, 15000);
    assert.strictEqual(rt.state(d1.id), 'online');
  } finally {
    await rt.stop();
    await mq.stop();
    await js.close();
    await mb.stop().catch(() => {});
  }
});

test('Warteschlange: Schreiben vor wartende Abfragen, mehrere Schreibbefehle in Reihenfolge', async () => {
  const { createScheduler } = require('../src/protocols/scheduler');
  const s = createScheduler();
  const order = [];
  const job = (name, urgent) => s.add({ urgent, run: () => new Promise((r) => setTimeout(() => { order.push(name); r(); }, 5)) });
  const all = [job('lesen1'), job('lesen2'), job('lesen3'), job('schreibenA', true), job('schreibenB', true)];
  await Promise.all(all);
  // lesen1 läuft schon, wenn die Schreibbefehle kommen; danach zuerst A, dann B, dann die übrigen Abfragen
  assert.deepStrictEqual(order, ['lesen1', 'schreibenA', 'schreibenB', 'lesen2', 'lesen3']);
});
