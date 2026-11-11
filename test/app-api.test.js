'use strict';
// Programm-Schnittstelle für die Oberfläche (ohne Fenster) gegen die Simulatoren. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppApi } = require('../src/app/api');
const modbusSim = require('./sim/modbus-sim');
const createJsonSim = require('./sim/json-sim');

const B = (...p) => path.join(__dirname, '..', 'beispiele', ...p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
  const end = Date.now() + (ms || 3000);
  while (!cond() && Date.now() < end) await sleep(20);
  assert.ok(cond(), 'Bedingung nicht erfüllt');
}

test('Gerät anlegen, testen, Variablen einlesen, Werte empfangen, schreiben', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const sim = await modbusSim.start({ port: 0, fw: 246 });
  const api = new AppApi({ dir });
  const batches = [];
  api.on('values', (b) => batches.push(b));
  try {
    await api.start();
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', interval: 200,
      settings: { host: '127.0.0.1', port: sim.port, gap: 0 } });
    assert.strictEqual(api.listDevices().length, 1);
    assert.strictEqual(d.variableCount, 0);

    const t = await api.testConnection({ protocol: 'modbus', settings: { host: '127.0.0.1', port: sim.port } });
    assert.strictEqual(t.ok, true);
    assert.match(t.text, /Uhr der easyE4/);
    assert.strictEqual((await api.testConnection({ protocol: 'modbus', settings: { host: '' } })).ok, false);

    const pre = api.previewImport({ itf: B('mqtt-demo', 'easye4_mqtt_demo.itf'),
      symbols: [B('symbole', 'Symbolische_Namen_easye4_mqtt_demo_Main.csv')], st: [B('mqtt-demo', 'easye4_mqtt_demo.st')] });
    assert.strictEqual(pre.variables.length, 33);
    assert.strictEqual(api.getDevice(d.id).variables.length, 0, 'Vorschau ändert nichts');
    const res = await api.applyImport(d.id, pre.variables);
    assert.strictEqual(res.added.length, 33);
    assert.strictEqual(api.listDevices()[0].variableCount, 33);

    sim.st.MW[3] = 7; // Nachlauf_Soll
    await until(() => api.deviceValues(d.id).Nachlauf_Soll && api.deviceValues(d.id).Nachlauf_Soll.value === 7);
    await until(() => batches.some((b) => b[d.id] && b[d.id].Nachlauf_Soll)); // gesammelt, höchstens alle 200 ms
    assert.strictEqual(api.listDevices()[0].state, 'online');

    await api.writeValue(d.id, 'Nachlauf_Soll', 12);
    assert.strictEqual(sim.st.MW[3], 12);

    // gespeichert: neu laden ergibt dasselbe
    await api.stop();
    const api2 = new AppApi({ dir });
    assert.strictEqual(api2.getDevice(d.id).variables.length, 33);
    assert.strictEqual(api2.listDevices()[0].name, 'NT1');
  } finally {
    await api.stop();
    await sim.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Passwörter: setzen, behalten, löschen – nie an die Oberfläche zurück', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const sim = createJsonSim({ anonymous: false });
  const port = await sim.listen();
  const api = new AppApi({ dir });
  try {
    const base = { name: 'NT2', protocol: 'json', enabled: false,
      settings: { host: '127.0.0.1', port, auth: 'basic', user: 'testuser', gap: 0 } };
    const d = await api.saveDevice(base, { password: 'pw1' });
    assert.deepStrictEqual(d.secrets, { password: true, apikey: false });
    assert.ok(!JSON.stringify(api.listDevices()).includes('pw1'), 'kein Passwort in der Liste');
    assert.ok(!JSON.stringify(api.getDevice(d.id)).includes('pw1'));
    assert.strictEqual(d.state, 'disabled');

    // Test mit dem gespeicherten Passwort (im Dialog leer gelassen)
    assert.strictEqual((await api.testConnection(Object.assign({ id: d.id }, base), {})).ok, true);
    // ändern ohne Passwort: bleibt erhalten
    await api.saveDevice(Object.assign({ id: d.id }, base, { name: 'NT2 neu' }), {});
    assert.deepStrictEqual(api.devices.getSecrets(d.id), { password: 'pw1' });
    // falsches Passwort im Dialog: Test scheitert verständlich
    const bad = await api.testConnection(Object.assign({ id: d.id }, base), { password: 'falsch' });
    assert.strictEqual(bad.ok, false);
    assert.match(bad.text, /Anmeldung abgelehnt/);
    // löschen
    await api.saveDevice(Object.assign({ id: d.id }, base), {}, ['password']);
    assert.deepStrictEqual(api.devices.getSecrets(d.id), {});
    await api.removeDevice(d.id);
    assert.strictEqual(api.listDevices().length, 0);
  } finally {
    await api.stop();
    await sim.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Texte für die Oberfläche', () => {
  const api = new AppApi({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-')) });
  const t = api.texts();
  assert.strictEqual(t.lang, 'de');
  assert.strictEqual(t.dict.ui.devices.title, 'Geräte');
  fs.rmSync(api.devices.dir, { recursive: true, force: true });
});

test('Variablen von Hand, eigene Angaben, automatische Bedienseite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const api = new AppApi({ dir });
  try {
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', enabled: false, settings: { host: '127.0.0.1' } });
    const v = await api.addVariable(d.id, { operand: 'mw03', name: 'Sollwert_Pumpe', label: '' });
    assert.deepStrictEqual([v.operand, v.index, v.type, v.writable, v.label], ['MW', 3, 'WORD', true, 'Sollwert Pumpe']);
    const q = await api.addVariable(d.id, { operand: 'Q01' });
    assert.deepStrictEqual([q.name, q.label, q.writable], ['Q1', 'Ausgang Q1', false]);
    await assert.rejects(api.addVariable(d.id, { operand: 'XY5' }), /kein Operand der easyE4/);
    await assert.rejects(api.addVariable(d.id, { operand: 'MW3', name: 'Doppelt' }), /MW3 gibt es schon als „Sollwert_Pumpe“/);
    await assert.rejects(api.addVariable(d.id, { operand: 'MW4', name: 'sollwert_pumpe' }), /doppelt/);

    await api.updateVariable(d.id, 'Sollwert_Pumpe', { userRole: 'control', userUnit: 'bar', userLabel: 'Druck Soll' });
    const page = api.devicePage(d.id);
    assert.deepStrictEqual(page.cards.map((c) => c.id), ['controls', 'states'], 'Q1 ohne Vorschlag: Ausgänge als Anzeige');
    const sp = page.cards[0].elements[0];
    assert.deepStrictEqual([sp.kind, sp.label, sp.unit, sp.min, sp.max], ['setpoint', 'Druck Soll', 'bar', 0, 65535]);
    await api.updateVariable(d.id, 'Sollwert_Pumpe', { userUnit: '' });
    assert.strictEqual(api.getDevice(d.id).variables[0].userUnit, undefined, 'leer = Angabe entfernt');

    // erneut einlesen: von Hand angelegte bleiben
    const pre = api.previewImport({ itf: B('mqtt-demo', 'easye4_mqtt_demo.itf') });
    const res = await api.applyImport(d.id, pre.variables);
    assert.ok(!res.removed.includes('Sollwert_Pumpe'));
    const names = api.getDevice(d.id).variables.map((x) => x.name);
    assert.ok(names.includes('Sollwert_Pumpe') && names.includes('MW3') === false, 'MW3 aus der .itf ersetzt die Hand-Variable mit gleichem Operanden');
    await api.removeVariable(d.id, 'Q1');
    assert.ok(!api.getDevice(d.id).variables.some((x) => x.name === 'Q1'));
    // Mehrfachauswahl: mehrere auf einmal löschen, unbekannte Namen stören nicht
    const before = api.getDevice(d.id).variables.length;
    assert.strictEqual(await api.removeVariables(d.id, ['Sollwert_Pumpe', 'I1', 'gibt_es_nicht']), 2);
    const left = api.getDevice(d.id).variables;
    assert.strictEqual(left.length, before - 2);
    assert.ok(!left.some((x) => x.name === 'Sollwert_Pumpe' || x.name === 'I1'));
  } finally {
    await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nur Symboltabelle eingelesen: Hinweis und Karte „Ohne Vorschlag“ (so geschehen am 26.10.2026)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const api = new AppApi({ dir });
  try {
    const d = await api.saveDevice({ name: 'MQTT-Demo', protocol: 'mqtt', enabled: false, settings: { host: 'x', baseTopic: 'easye4/1' } });
    const pre = api.previewImport({ symbols: [B('symbole', 'Symbolische_Namen_easye4_mqtt_demo_Main.csv')] }, null, d.id);
    assert.match(pre.warnings[0], /Kein ST-Programm dabei/);
    await api.applyImport(d.id, pre.variables);
    const page = api.devicePage(d.id);
    assert.deepStrictEqual(page.cards.map((c) => c.id), ['states', 'unassigned']);
    assert.strictEqual(page.unassignedCount, 19, 'Merker mit Namen erscheinen, nur zum Ansehen');
    assert.ok(page.cards[1].elements.every((e) => e.kind === 'lamp' || e.kind === 'number'));
    // Verwendung von Hand auf Bedienung -> Schalter
    await api.updateVariable(d.id, 'Fern_Ein', { userRole: 'control' });
    const p2 = api.devicePage(d.id);
    assert.strictEqual(p2.cards.find((c) => c.id === 'controls').elements[0].kind, 'switch');
    assert.strictEqual(p2.unassignedCount, 18);
  } finally {
    await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Modbus-Freigabe-Hinweise nur bei Modbus-Geräten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const api = new AppApi({ dir });
  try {
    const files = { itf: B('mqtt-demo', 'easye4_mqtt_demo.itf'), st: [B('mqtt-demo', 'easye4_mqtt_demo.st')] };
    const mq = await api.saveDevice({ name: 'MQ', protocol: 'mqtt', enabled: false, settings: { host: 'x', baseTopic: 'a/b' } });
    const mb = await api.saveDevice({ name: 'MB', protocol: 'modbus', enabled: false, settings: { host: 'x' } });
    assert.ok(!api.previewImport(files, null, mq.id).warnings.some((w) => /nicht in der \.itf/.test(w)));
    assert.strictEqual(api.previewImport(files, null, mb.id).warnings.filter((w) => /nicht in der \.itf/.test(w)).length, 4);
  } finally {
    await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Schnell-Zuordnung: mehrere Variablen auf einmal; „ändert sich“ wird gezählt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const sim = await modbusSim.start({ port: 0, fw: 246 });
  const api = new AppApi({ dir });
  try {
    await api.start();
    const d = await api.saveDevice({ name: 'FUP', protocol: 'modbus', interval: 100, settings: { host: '127.0.0.1', port: sim.port, gap: 0 } });
    const itf = 'Name\tType\tAddress\r\nM001_M016[1..16]\tBIT\tR46001.0\r\nMW003\tWORD\tR46003\r\n';
    const file = path.join(dir, 'fup.itf');
    fs.writeFileSync(file, itf);
    await api.applyImport(d.id, api.previewImport({ itf: file }, null, d.id).variables);
    assert.strictEqual(api.devicePage(d.id).cards.length, 0, 'ohne Namen und Vorschläge: nichts auf der Seite');
    // MW3 zählt hoch (Steuerung schreibt), M5 bleibt
    const timer = setInterval(() => { sim.st.MW[3]++; }, 150);
    await until(() => api.deviceValues(d.id).MW3 && api.deviceValues(d.id).MW3.changes >= 2, 4000);
    clearInterval(timer);
    assert.strictEqual(api.deviceValues(d.id).M5.changes, 0);
    await api.assignVariables(d.id, [
      { name: 'M5', userRole: 'control', userLabel: 'Pumpe ein' },
      { name: 'MW3', userRole: 'display', userLabel: 'Betriebsstunden' },
      { name: 'M6', userRole: 'internal', userLabel: 'Merker M6' },
    ]);
    const vars = Object.fromEntries(api.getDevice(d.id).variables.map((v) => [v.name, v]));
    assert.deepStrictEqual([vars.M5.userRole, vars.M5.userLabel, vars.MW3.userLabel], ['control', 'Pumpe ein', 'Betriebsstunden']);
    assert.strictEqual(vars.M6.userLabel, undefined, 'unveränderter Name wird nicht als eigener gespeichert');
    const page = api.devicePage(d.id);
    assert.deepStrictEqual(page.cards.map((c) => c.id), ['controls', 'values']);
    assert.deepStrictEqual(page.cards[0].elements.map((e) => [e.kind, e.label]), [['switch', 'Pumpe ein']]);
  } finally {
    await api.stop();
    await sim.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Sicherheit: beim Start nicht verbunden, erst auf Wunsch; Trennen sperrt das Schreiben', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const api = new AppApi({ dir });
  try {
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', settings: { host: '127.0.0.1', port: 1 } });
    assert.strictEqual(api.isOnline(), false);
    assert.strictEqual(api.listDevices()[0].state, 'idle', 'gespeichert, aber nicht verbunden');
    assert.strictEqual(api.runtime.running.size, 0, 'Speichern startet keine Abfrage');
    await assert.rejects(api.writeValue(d.id, 'MW3', 1), /Nicht verbunden/);
    const events = [];
    api.on('online', (on) => events.push(on));
    assert.strictEqual(await api.setOnline(true), true);
    assert.strictEqual(api.runtime.running.size, 1);
    assert.strictEqual(await api.setOnline(false), false);
    assert.strictEqual(api.runtime.running.size, 0);
    assert.strictEqual(api.listDevices()[0].state, 'idle');
    assert.deepStrictEqual(events, [true, false]);
  } finally {
    await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Umrechnung Rohwert → Einheit: Anzeige, Schreiben zurückgerechnet, Trend, Bereich der Bedienseite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-scale-'));
  const sim = await modbusSim.start({ port: 0, fw: 246 });
  const api = new AppApi({ dir, history: false });
  const batches = [];
  api.on('values', (b) => batches.push(b));
  try {
    await api.start();
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', interval: 200, settings: { host: '127.0.0.1', port: sim.port, gap: 0 } });
    const pre = api.previewImport({ itf: B('mqtt-demo', 'easye4_mqtt_demo.itf'),
      symbols: [B('symbole', 'Symbolische_Namen_easye4_mqtt_demo_Main.csv')], st: [B('mqtt-demo', 'easye4_mqtt_demo.st')] });
    await api.applyImport(d.id, pre.variables);
    // unvollständig oder gleiche Rohwerte: Fehler, nichts gespeichert
    await assert.rejects(api.updateVariable(d.id, 'Nachlauf_Soll', { userScale: { raw0: 0, val0: 0, raw1: '', val1: 5 } }), /Umrechnung/);
    await assert.rejects(api.updateVariable(d.id, 'Nachlauf_Soll', { userScale: { raw0: 5, val0: 0, raw1: 5, val1: 5 } }), /Umrechnung/);
    const v = await api.updateVariable(d.id, 'Nachlauf_Soll', { userUnit: 'bar', userScale: { raw0: '0', val0: '0', raw1: '1000', val1: '5' }, userDecimals: '2' });
    assert.deepStrictEqual(v.userScale, { raw0: 0, val0: 0, raw1: 1000, val1: 5 });
    assert.strictEqual(v.userDecimals, 2);

    sim.st.MW[3] = 500;
    await until(() => api.deviceValues(d.id).Nachlauf_Soll && api.deviceValues(d.id).Nachlauf_Soll.value === 2.5);
    await until(() => batches.some((b) => b[d.id] && b[d.id].Nachlauf_Soll && b[d.id].Nachlauf_Soll.value === 2.5));
    assert.strictEqual(api.values.get(d.id, 'Nachlauf_Soll').value, 500, 'gespeichert bleibt der Rohwert');

    await api.writeValue(d.id, 'Nachlauf_Soll', 1.25);
    assert.strictEqual(sim.st.MW[3], 250, 'an die easyE4 geht der Rohwert');
    await api.writeValue(d.id, 'Nachlauf_Soll', '0,5');
    assert.strictEqual(sim.st.MW[3], 100, 'Komma als Dezimalzeichen');

    // Trend: aufgezeichnete Rohwerte kommen umgerechnet; bei fallender Kennlinie bleibt min ≤ max
    api.history = { query: (series) => series.map((s) => ({ dev: s.dev, name: s.name, points: [[1, 200], [2, 400, 600], [3, null, null]] })) };
    const h = await api.historyQuery([{ dev: d.id, name: 'Nachlauf_Soll' }], 0, 10, 100);
    assert.deepStrictEqual(h[0].points, [[1, 1], [2, 2, 3], [3, null, null]]);
    await api.updateVariable(d.id, 'Nachlauf_Soll', { userScale: { raw0: 0, val0: 100, raw1: 1000, val1: 0 } });
    assert.deepStrictEqual((await api.historyQuery([{ dev: d.id, name: 'Nachlauf_Soll' }], 0, 10, 100))[0].points[1], [2, 40, 60]);
    api.history = null;

    // Bedienseite: Sollwert-Grenzen in der Einheit, Schrittweite aus den Nachkommastellen
    await api.updateVariable(d.id, 'Nachlauf_Soll', { userScale: { raw0: 0, val0: 0, raw1: 1000, val1: 5 } });
    await api.savePages([{ id: 'p', name: 'S', items: [{ id: 'e', kind: 'setpoint', dev: d.id, name: 'Nachlauf_Soll', x: 0, y: 0, w: 200, h: 80 }] }]);
    const el = api.viewPage('p').items[0];
    assert.strictEqual(el.decimals, 2);
    assert.strictEqual(el.step, 0.01);
    assert.strictEqual(el.unit, 'bar');
    assert.ok(el.max <= 327.67 + 1e-9 && el.max > 5, `Grenze in bar: ${el.max}`);

    // leer = Rohwert wie bisher
    await api.updateVariable(d.id, 'Nachlauf_Soll', { userScale: { raw0: '', val0: '', raw1: '', val1: '' }, userDecimals: '' });
    const plain = api.getDevice(d.id).variables.find((x) => x.name === 'Nachlauf_Soll');
    assert.strictEqual(plain.userScale, undefined);
    assert.strictEqual(plain.userDecimals, undefined);
    await until(() => api.deviceValues(d.id).Nachlauf_Soll.value === 100);
  } finally {
    await api.stop();
    await sim.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
