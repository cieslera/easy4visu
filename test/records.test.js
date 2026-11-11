'use strict';
// Aufzeichnungen als Tabelle (CSV) und Aufbewahrung. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppApi } = require('../src/app/api');
const RECORDS = require('../src/core/records');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `easy4visu-rec-${n}-`));
const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;
const T0 = new Date(2026, 10, 3, 10, 0, 0).getTime(); // 03.11.2026 10:00 Ortszeit
const lines = (csv) => csv.replace(/^﻿/, '').trim().split('\r\n');

/** Gerät mit Füllstand (umgerechnet, 1 Nachkomma), Pumpe (Bit) und einer nicht aufgezeichneten Variablen */
async function setup(dir) {
  const api = new AppApi({ dir });
  const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', interval: 500, settings: { host: '192.168.1.10', port: 502 } });
  await api.addVariable(d.id, { operand: 'MW1', name: 'MW1', label: 'Füllstand', userUnit: '%', userScale: { raw0: 0, val0: 0, raw1: 1000, val1: 100 }, userDecimals: 1 });
  await api.addVariable(d.id, { operand: 'M1', name: 'M1', label: 'Pumpe läuft' });
  await api.addVariable(d.id, { operand: 'MW2', name: 'MW2', label: 'Nicht aufgezeichnet' });
  await api.setRecord(d.id, 'MW1', true);
  await api.setRecord(d.id, 'M1', true);
  const keyOf = (n) => { const v = api.getDevice(d.id).variables.find((x) => x.name === n); return v.id !== undefined && v.id !== null ? String(v.id) : v.name; };
  return { api, dev: d.id, mw1: keyOf('MW1'), m1: keyOf('M1'), mw2: keyOf('MW2') };
}

test('Trends: Raster mit Momentanwert, in der Einheit, Lücke und alter Wert bleiben leer', async () => {
  const { api, dev, mw1, m1 } = await setup(tmp('a'));
  const h = api.history;
  h._push(dev, mw1, T0 - MIN, 100);             // vor dem Zeitraum: 10,0 %
  h._push(dev, mw1, T0 + 30 * 1000, 250);       // 10:00:30 25,0 %
  h._push(dev, mw1, T0 + 90 * 1000, null);      // 10:01:30 Gerät ausgefallen
  h._push(dev, mw1, T0 + 150 * 1000, 333);      // 10:02:30 wieder da
  h._push(dev, m1, T0, 1);
  h._push(dev, m1, T0 + 2 * MIN, 0);
  const st = api.recordsState();
  assert.deepStrictEqual(st.series.map((s) => s.label), ['Füllstand', 'Pumpe läuft'], 'nur aufgezeichnete Variablen');
  assert.strictEqual(st.series[1].bit, true, 'Merker M1 ist ein Bit');
  const spec = { series: [{ dev, name: mw1 }, { dev, name: m1 }], from: T0, to: T0 + 3 * MIN, step: MIN };
  assert.deepStrictEqual(api.trendCsvInfo(spec), { rows: 4, cols: 2, step: MIN, tooMany: false });
  const r = api.trendCsv(spec);
  assert.ok(r.csv.startsWith('﻿'), 'mit BOM für Excel');
  assert.deepStrictEqual(lines(r.csv), [
    'Zeit;Füllstand [%];Pumpe läuft',
    '03.11.2026 10:00:00;10,0;1',
    '03.11.2026 10:01:00;25,0;1',
    '03.11.2026 10:02:00;;0',
    '03.11.2026 10:03:00;33,3;0',
  ]);
  // länger als 2,5 min kein Wert: Aufzeichnung lief nicht → leer
  const late = lines(api.trendCsv(Object.assign({}, spec, { from: T0 + 10 * MIN, to: T0 + 10 * MIN + 1, step: MIN })).csv);
  assert.deepStrictEqual(late.slice(1), ['03.11.2026 10:10:00;;']);
  await api.stop();
});

test('Trends: jede Änderung, unveränderte Lebenszeichen fallen weg; „auto“ wählt passend', async () => {
  const { api, dev, mw1, m1, mw2 } = await setup(tmp('b'));
  const h = api.history;
  h._push(dev, mw1, T0, 100);
  h._push(dev, mw1, T0 + MIN, 100); // Lebenszeichen ohne Änderung
  h._push(dev, mw1, T0 + 2 * MIN, 120);
  const spec = { series: [{ dev, name: mw1 }, { dev, name: mw2 }], from: T0, to: T0 + 3 * MIN, step: 0 };
  assert.deepStrictEqual(lines(api.trendCsv(spec).csv), ['Zeit;Füllstand [%]', '03.11.2026 10:00:00;10,0', '03.11.2026 10:02:00;12,0'],
    'nicht aufgezeichnete Variable wird ignoriert');
  assert.strictEqual(api.trendCsv(Object.assign({}, spec, { step: 'auto' })).step, 0, 'wenige Werte: jede Änderung');
  assert.throws(() => api.trendCsv({ series: [{ dev, name: mw2 }], from: T0, to: T0 + MIN, step: 0 }), /mindestens eine aufgezeichnete Variable/);
  assert.throws(() => api.trendCsv({ series: [{ dev, name: mw1 }], from: T0, to: T0, step: 0 }), /Zeitraum stimmt nicht/);
  // 10 Jahre im 10-s-Raster: zu viele Zeilen für Excel
  const big = { series: [{ dev, name: m1 }], from: T0 - 3650 * DAY, to: T0, step: 10000 };
  assert.strictEqual(api.trendCsvInfo(big).tooMany, true);
  assert.throws(() => api.trendCsv(big), /Excel schafft höchstens/);
  assert.strictEqual(api.trendCsvInfo(Object.assign({}, big, { step: 'auto' })).step, 0, 'auto: kaum Werte → jede Änderung');
  // Zeilen je Raster: 1 Stunde im 1-min-Raster = 61 Zeilen (beide Enden), jede Änderung = Summe der Werte
  assert.strictEqual(RECORDS.estimateRows(T0, T0 + 3600000, MIN, []), 61);
  assert.strictEqual(RECORDS.estimateRows(T0, T0 + 3600000, 0, [5, 7]), 12);
  await api.stop();
});

test('Meldungsverlauf: Zeitraum, Art, Spalten', async () => {
  const { api, dev, m1 } = await setup(tmp('c'));
  await api.saveAlarmDefs([{ dev, name: m1, text: 'Pumpe Störung', level: 'fault' }, { dev, name: m1, text: 'Pumpe Hinweis', level: 'info' }]);
  const db = api.alarms._open();
  const defs = api.getAlarmDefs();
  const ins = db.prepare('INSERT INTO events (aid, dev, name, text, level, come, gone, ack) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run(defs[0].id, dev, m1, '', 'fault', T0, T0 + MIN, T0 + 2 * MIN);
  ins.run(defs[1].id, dev, m1, '', 'info', T0 + 5 * MIN, null, null);
  ins.run(defs[1].id, dev, m1, '', 'info', T0 - 10 * DAY, T0 - 10 * DAY + MIN, null);
  const all = api.alarmCsv({ from: T0 - DAY, to: T0 + DAY });
  assert.strictEqual(all.rows, 2);
  assert.deepStrictEqual(lines(all.csv), ['Meldung;Art;Gerät;Kommt;Geht;Quittiert',
    'Pumpe Störung;Störung;NT1;03.11.2026 10:00:00;03.11.2026 10:01:00;03.11.2026 10:02:00',
    'Pumpe Hinweis;Meldung;NT1;03.11.2026 10:05:00;;']);
  assert.strictEqual(api.alarmCsv({ from: T0 - DAY, to: T0 + DAY, level: 'fault' }).rows, 1);
  await api.stop();
});

test('Aufbewahrung: nur erlaubte Werte, kürzer löscht gleich, bleibt nach Neustart, steht im Bedienprotokoll', async () => {
  const dir = tmp('d');
  const { api, dev, mw1 } = await setup(dir);
  const now = Date.now();
  api.history._push(dev, mw1, now - 200 * DAY, 1);
  api.history._push(dev, mw1, now - DAY, 2);
  assert.strictEqual(api.recordsState().stats.trendOldest, now - 200 * DAY);
  assert.deepStrictEqual(api.setRetention({ trend: 123, alarm: 3650 }).retention, { trend: 365, alarm: 3650, audit: 365 }, '123 Tage gibt es nicht');
  const st = api.setRetention({ trend: 90 });
  assert.strictEqual(st.retention.trend, 90);
  assert.strictEqual(st.stats.trendOldest, now - DAY, 'älter als 3 Monate: gleich gelöscht');
  assert.match(api.auditQuery({}).map((r) => r.what).join('\n'), /Aufbewahrung Trends: 1 Jahr → 3 Monate/);
  await api.stop();
  const again = new AppApi({ dir });
  assert.strictEqual(again.history.retentionDays, 90);
  assert.strictEqual(again.alarms.retentionDays, 3650);
  await again.stop();
  assert.deepStrictEqual(RECORDS.cleanRetention({}), { trend: 365, alarm: 365, audit: 365 });
});

test('Rechte: Beobachter darf nichts, Bediener speichern, Aufbewahrung nur Techniker', async () => {
  const { api, dev, mw1 } = await setup(tmp('e'));
  const setupUser = api.userAdd({ name: 'Ralf', role: 'setup', password: 'test1234' });
  const op = api.userAdd({ name: 'Bodo', role: 'operator', password: 'bodo1234' });
  const viewer = api.userAdd({ name: 'Vera', role: 'viewer', password: 'vera1234' });
  const spec = { series: [{ dev, name: mw1 }], from: T0, to: T0 + MIN, step: MIN };
  api.logout();
  api.login(viewer.id, 'vera1234');
  assert.throws(() => api.recordsState());
  assert.throws(() => api.trendCsv(spec));
  api.logout();
  api.login(op.id, 'bodo1234');
  assert.ok(api.recordsState().series.length);
  assert.ok(api.trendCsv(spec).csv);
  assert.ok(api.alarmCsv({ from: T0, to: T0 + MIN }).csv);
  assert.throws(() => api.setRetention({ trend: 90 }));
  api.logout();
  api.login(setupUser.id, 'test1234');
  assert.strictEqual(api.setRetention({ trend: 90 }).retention.trend, 90);
  await api.stop();
});
