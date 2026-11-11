'use strict';
// Demo-Modus: eingebauter Simulator statt echter easyE4. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DemoDriver } = require('../src/protocols/demo/driver');
const { AppApi } = require('../src/app/api');

const V = (name, operand, index, type, extra) => Object.assign({ name, operand, index, type }, extra || {});

test('Simulator: Messwerte bewegen sich im Bereich, Bits wechseln, Merker und Geschriebenes bleiben, Uhr = PC-Uhr', async () => {
  let now = Date.UTC(2026, 10, 6, 12, 0, 0);
  const d = new DemoDriver({ host: '192.168.1.10' }, {}, { now: () => now, alarmVars: new Set(['Stoerung']) });
  const vars = [V('Fuellstand', 'MW', 51, 'WORD', { userScale: { raw0: 0, val0: 0, raw1: 1000, val1: 100 } }), V('Temp', 'IA', 1, 'WORD'),
    V('Pumpe', 'Q', 1, 'BIT'), V('Fern', 'M', 5, 'BIT'), V('Stoerung', 'M', 12, 'BIT'), V('Uhr', 'CLOCK', null, 'WORD'), V('Minute', 'CLOCK', 1, 'WORD')];
  const seen = { Fuellstand: new Set(), Pumpe: new Set(), Stoerung: new Set() };
  for (let i = 0; i < 400; i++) {
    const r = await d.read(vars);
    assert.ok(r.values.Fuellstand >= 0 && r.values.Fuellstand <= 1000, `Füllstand im Rohbereich: ${r.values.Fuellstand}`);
    for (const k of Object.keys(seen)) seen[k].add(r.values[k]);
    assert.strictEqual(r.values.Fern, 0, 'Merker bleibt 0, bis jemand schaltet');
    now += 5000;
  }
  assert.ok(seen.Fuellstand.size > 20, 'Messwert bewegt sich');
  assert.deepStrictEqual([...seen.Pumpe].sort(), [0, 1], 'Ausgang wechselt');
  assert.deepStrictEqual([...seen.Stoerung].sort(), [0, 1], 'Meldung kommt und geht');
  assert.strictEqual(d.state, 'online');
  await d.write(V('Fern', 'M', 5, 'BIT'), true);
  await d.write(V('Fuellstand', 'MW', 51, 'WORD'), 777);
  const r = await d.read(vars);
  assert.deepStrictEqual([r.values.Fern, r.values.Fuellstand], [1, 777], 'Schalten und Sollwerte wirken');
  const t = new Date(now);
  assert.deepStrictEqual([r.values.Uhr.hour, r.values.Uhr.minute, r.values.Minute], [t.getHours(), t.getMinutes(), t.getMinutes()]);
});

test('Simulator: Werte passen zur Einheit und zur Umrechnung (Prozent ≤ 100, Temperaturen um 20 °C), Zähler zählen', async () => {
  let now = Date.UTC(2026, 10, 6, 12, 0, 0);
  const temp = V('Halle', 'MD', 41, 'LINT', { userUnit: '°C', userScale: { raw0: 0, val0: 0, raw1: 10, val1: 1 } });
  const d = new DemoDriver({ host: 'x' }, {}, { now: () => now, ranges: new Map([['Pegel', { min: 0, max: 5 }], ['Soll', { min: 0, max: 65535 }]]) });
  const vars = [V('Last', 'MW', 1, 'WORD', { userUnit: '%' }), temp, V('Druck', 'MW', 2, 'WORD', { userUnit: 'bar', userScale: { raw0: 0, val0: 0, raw1: 100, val1: 10 } }),
    V('Pegel', 'MW', 3, 'WORD'), V('Soll', 'MW', 4, 'WORD'), V('Energie', 'MD', 5, 'LINT', { userUnit: 'kWh' })];
  let first = null;
  let last = null;
  for (let i = 0; i < 300; i++) {
    const r = (await d.read(vars)).values;
    assert.ok(r.Last >= 0 && r.Last <= 100, `Prozent: ${r.Last}`);
    assert.ok(r.Halle >= 140 && r.Halle <= 260, `Temperatur (Rohwert, 10 = 1 °C): ${r.Halle}`);
    assert.ok(r.Druck >= 35 && r.Druck <= 85, `Druck (Rohwert, 100 = 10 bar): ${r.Druck}`);
    assert.ok(r.Pegel >= 0 && r.Pegel <= 5, `Bereich des Balkens: ${r.Pegel}`);
    assert.ok(r.Soll >= 0 && r.Soll <= 100, `riesiger Bereich wird nicht benutzt: ${r.Soll}`);
    if (first === null) first = r.Energie;
    last = r.Energie;
    now += 10000;
  }
  assert.ok(last > first, 'Zähler zählt hoch');
});

test('Simulator: Leuchttaster – Ein/Aus setzen und löschen die Rückmeldung, einzelner Taster schaltet um, Impuls fällt zurück', async () => {
  let now = Date.UTC(2026, 10, 6, 12, 0, 0);
  const links = new Map([
    ['Anl_Ein', [{ name: 'Laeuft', op: 'on' }]], ['Anl_Aus', [{ name: 'Laeuft', op: 'off' }]],
    ['Licht', [{ name: 'Lampe', op: 'toggle' }]], ['Hupe', [{ name: 'Hupt', op: 'follow' }]], ['Quit', [{ name: 'Stoer', op: 'clear' }]]]);
  const d = new DemoDriver({ host: 'x' }, {}, { now: () => now, links, pulses: new Set(['Anl_Ein', 'Anl_Aus', 'Licht', 'Quit']) });
  const vars = ['Anl_Ein', 'Anl_Aus', 'Laeuft', 'Licht', 'Lampe', 'Hupe', 'Hupt', 'Quit', 'Stoer'].map((n, i) => V(n, 'M', i + 1, 'BIT'));
  const read = async () => (await d.read(vars)).values;
  const press = async (n, x) => { await d.write(V(n, 'M', 0, 'BIT'), x === undefined ? 1 : x); return read(); };
  assert.strictEqual((await press('Anl_Ein')).Laeuft, 1, 'Ein setzt die Rückmeldung');
  now += 2000;
  assert.strictEqual((await read()).Anl_Ein, 0, 'Impuls fällt nach 1 s zurück');
  assert.strictEqual((await press('Anl_Aus')).Laeuft, 0, 'Aus löscht sie');
  const l0 = (await read()).Lampe;
  assert.strictEqual((await press('Licht')).Lampe, l0 ? 0 : 1, 'einzelner Taster schaltet um');
  now += 2000;
  assert.strictEqual((await press('Licht')).Lampe, l0, '… und wieder zurück');
  assert.strictEqual((await press('Hupe', 1)).Hupt, 1, 'tastend: leuchtet, solange gedrückt');
  assert.strictEqual((await press('Hupe', 0)).Hupt, 0);
  await d.write(V('Stoer', 'M', 9, 'BIT'), 1);
  assert.strictEqual((await press('Quit')).Stoer, 0, 'Quittieren löscht die Störung');
});

test('Programm im Demo-Modus: Regeln für Leuchttaster aus den Seiten (Partner Ein/Aus, Taster auf mehreren Seiten nur einmal)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-demo-'));
  const api = new AppApi({ dir, history: false, demo: true });
  const b = (name, fb, extra) => Object.assign({ kind: 'button', dev: 'd1', name, fb: fb ? { dev: 'd1', name: fb } : undefined }, extra || {});
  api.pages.pages = [{ items: [b('Anlage_Ein', 'Laeuft'), b('Anlage_Aus'), b('Licht', 'Lampe')] }, { items: [b('Licht', 'Lampe'), b('Quit', 'Stoer', { fbColor: 'alarm' }), b('Hupe', 'Hupt', { mode: 'tip' })] }];
  const l = api._demoLinks('d1');
  const ops = (n) => (l.get(n) || []).map((x) => `${x.op} ${x.name}`);
  assert.deepStrictEqual([ops('Anlage_Ein'), ops('Anlage_Aus'), ops('Licht'), ops('Quit'), ops('Hupe')],
    [['on Laeuft'], ['off Laeuft'], ['toggle Lampe'], ['clear Stoer'], ['follow Hupt']]);
  await api.stop();
});

test('Simulator: Auswahl und Zustände nur mit Werten aus ihrer Tabelle (Betriebsart steht, Torzustand wechselt)', async () => {
  let now = Date.UTC(2026, 10, 6, 12, 0, 0);
  const d = new DemoDriver({ host: 'x' }, {}, { now: () => now, controlVars: new Set(['Betriebsart']), enums: new Map([['Betriebsart', [0, 1, 2]], ['Tor', [0, 1, 2, 3]]]) });
  const vars = [V('Betriebsart', 'MW', 105, 'WORD'), V('Tor', 'MW', 7, 'WORD')];
  const ba = new Set();
  const tor = new Set();
  for (let i = 0; i < 200; i++) { const r = (await d.read(vars)).values; ba.add(r.Betriebsart); tor.add(r.Tor); now += 10000; }
  assert.deepStrictEqual([...ba], [2], 'Betriebsart steht auf einem Knopf-Wert');
  assert.deepStrictEqual([...tor].sort(), [0, 1, 2, 3], 'Torzustand wechselt durch die Tabelle');
  const api = new AppApi({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-demo-')), history: false, demo: true });
  api.pages.pages = [{ items: [{ kind: 'choice', dev: 'd1', name: 'BA', opts: [{ v: 2 }, { v: 0 }, { v: 1 }] },
    { kind: 'status', dev: 'd1', name: 'Tor', map: [{ from: 0 }, { from: 9, color: 'alarm' }, { from: 1 }, { from: 1, dev: 'd1', name: 'Fremd' }] }] }];
  const e = api._demoEnums('d1');
  assert.deepStrictEqual([e.get('BA'), e.get('Tor')], [[0, 1, 2], [0, 1]], 'aus den Seiten, ohne Störungszeilen und fremde Variablen');
  await api.stop();
});

test('Programm im Demo-Modus: „verbunden“ ohne Netzwerk, Werte kommen, Schreiben wirkt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-demo-'));
  const prep = new AppApi({ dir, history: false });
  const d = await prep.saveDevice({ name: 'NT1', protocol: 'modbus', interval: 100, settings: { host: '10.255.255.1', port: 502 } });
  await prep.addVariable(d.id, { operand: 'MW3', name: 'Soll', label: 'Soll' });
  await prep.addVariable(d.id, { operand: 'IA1', name: 'Temp', label: 'Temp' });
  await prep.stop();
  const api = new AppApi({ dir, history: false, demo: true });
  assert.strictEqual(api.isDemo(), 'copy', 'Demo mit Kopie des eigenen Projekts');
  assert.strictEqual(new AppApi({ dir, history: false, demo: true, demoKind: 'talwerk' }).isDemo(), 'talwerk');
  assert.strictEqual(new AppApi({ dir, history: false }).isDemo(), false);
  await api.setOnline(true);
  const until = async (fn) => { for (let i = 0; i < 50 && !fn(); i++) await new Promise((r) => setTimeout(r, 50)); return fn(); };
  assert.ok(await until(() => api.states.get(d.id) && api.states.get(d.id).state === 'online'), 'Gerät „verbunden“ (ohne echte easyE4)');
  assert.ok(await until(() => Number.isFinite(api.values.get(d.id, 'Temp') && api.values.get(d.id, 'Temp').value)), 'Werte kommen');
  await api.writeValue(d.id, 'Soll', 123);
  assert.ok(await until(() => api.values.get(d.id, 'Soll').value === 123), 'geschriebener Sollwert bleibt');
  await api.stop();
  const normal = new AppApi({ dir, history: false });
  assert.strictEqual(normal.isDemo(), false, 'ohne Demo-Start: normal');
  await normal.stop();
});

test('Simulator: Bedien-Variablen (Sollwert auf einer Seite) stehen fest, bis jemand sie ändert', async () => {
  let now = Date.UTC(2026, 10, 6, 12, 0, 0);
  const d = new DemoDriver({ host: 'x' }, {}, { now: () => now, controlVars: new Set(['Soll']) });
  const vars = [V('Soll', 'MW', 3, 'WORD'), V('Mess', 'MW', 4, 'WORD')];
  const soll = new Set();
  const mess = new Set();
  for (let i = 0; i < 50; i++) { const r = await d.read(vars); soll.add(r.values.Soll); mess.add(r.values.Mess); now += 10000; }
  assert.strictEqual(soll.size, 1, 'Sollwert steht');
  assert.ok(mess.size > 5, 'Messwert im Merkerwort bewegt sich');
});

test('Demo: Trends starten mit der letzten Stunde (vom Simulator nachgerechnet), nur aufgezeichnete Variablen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-demo-'));
  const prep = new AppApi({ dir, history: false });
  const d = await prep.saveDevice({ name: 'NT1', protocol: 'modbus', interval: 100, settings: { host: '10.255.255.1', port: 502 } });
  await prep.addVariable(d.id, { operand: 'IA1', name: 'Temp', label: 'Temp' });
  await prep.addVariable(d.id, { operand: 'IA2', name: 'Druck', label: 'Druck' });
  await prep.setRecord(d.id, 'Temp', true);
  await prep.stop();
  const api = new AppApi({ dir, demo: true });
  await api.setOnline(true);
  const now = Date.now();
  const [temp, druck] = api.history.query([{ dev: d.id, name: 'Temp' }, { dev: d.id, name: 'Druck' }], now - 3600000, now, 400);
  const pts = temp.points.filter((p) => p[1] !== null);
  assert.ok(pts.length > 100, `Kurve gefüllt (${pts.length} Punkte)`);
  assert.ok(pts[0][0] <= now - 55 * 60000, 'reicht fast eine Stunde zurück');
  assert.ok(new Set(pts.map((p) => p[1])).size > 10, 'Werte bewegen sich');
  assert.strictEqual(druck.points.length, 0, 'nicht aufgezeichnete Variable bleibt leer');
  assert.strictEqual(api._demoPrefill(), 0, 'nur einmal je Start');
  await api.stop();
});

test('Demo: Sammelstörung folgt den Meldungen ihres Geräts (Störungen und Warnungen)', async () => {
  let now = Date.UTC(2026, 10, 9, 12, 0, 0);
  const d = new DemoDriver({ host: 'x' }, {}, { now: () => now, alarmVars: new Set(['M1', 'M2']), sums: new Map([['Sammel', ['M1', 'M2']]]) });
  const vars = [V('M1', 'M', 1, 'BIT'), V('M2', 'M', 2, 'BIT'), V('Sammel', 'M', 36, 'BIT')];
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    const r = (await d.read(vars)).values;
    assert.strictEqual(r.Sammel, r.M1 || r.M2 ? 1 : 0, 'Sammelstörung = mindestens eine Meldung');
    if (r.Sammel) seen++;
    now += 10000;
  }
  assert.ok(seen > 0, 'Sammelstörung kommt auch vor');
  const api = new AppApi({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-demo-')), history: false, demo: true });
  const dev = await api.saveDevice({ name: 'NT1', protocol: 'modbus', settings: { host: '10.255.255.1', port: 502 } });
  for (const [n, op, i] of [['Sammelstoerung', 'M', 36], ['Meldung_K1', 'M', 1], ['Meldung_Info', 'M', 2]]) await api.addVariable(dev.id, { operand: `${op}${i}`, name: n, label: n });
  await api.saveAlarmDefs([{ dev: dev.id, name: 'Meldung_K1', text: 'K1', level: 'fault' }, { dev: dev.id, name: 'Meldung_Info', text: 'i', level: 'info' }]);
  assert.deepStrictEqual([...api._demoSums(dev.id)], [['Sammelstoerung', ['Meldung_K1']]], 'aus Namen und Meldungen, ohne Hinweise');
  await api.stop();
});
