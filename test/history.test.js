'use strict';
// Aufzeichnung für Trends (Version 1, Punkt 2): Speichern bei Änderung, Pausen je Protokoll, Lebenszeichen,
// Lücken, Abfrage mit Zusammenfassen, Aufräumen, Häkchen „aufzeichnen“ im Programm. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { History, KEEP_ALIVE_MS } = require('../src/core/history');
const { AppApi } = require('../src/app/api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-hist-'));
const good = (value) => ({ value, quality: 'good' });

function clockHistory(dir, opts) {
  let now = 1_000_000;
  const h = new History(Object.assign({ dir, now: () => now }, opts));
  return { h, at: (ms) => { now = ms; }, add: (ms) => { now += ms; }, get now() { return now; } };
}

test('speichert bei Änderung, höchstens alle 250 ms (JSON: 1 s), trägt den letzten Wert nach', () => {
  const c = clockHistory(tmp());
  const t0 = c.now;
  c.h.onValue('d', 'MW1', good(1), 'modbus');
  c.add(100); c.h.onValue('d', 'MW1', good(2), 'modbus'); // zu früh: aufgeschoben
  c.add(100); c.h.onValue('d', 'MW1', good(3), 'modbus');
  c.add(100); c.h.tick();                                   // 300 ms nach dem ersten: letzter Wert 3 nachgetragen
  c.h.onValue('j', 'MW1', good(5), 'json');
  c.add(500); c.h.onValue('j', 'MW1', good(6), 'json');
  c.add(400); c.h.tick();                                   // erst 900 ms: noch nicht
  c.add(200); c.h.tick();                                   // 1100 ms: jetzt 6
  const [m, j] = c.h.query([{ dev: 'd', name: 'MW1' }, { dev: 'j', name: 'MW1' }], t0 - 1, c.now + 1, 100);
  assert.deepStrictEqual(m.points, [[t0, 1], [t0 + 300, 3]]);
  assert.deepStrictEqual(j.points.map((p) => p[1]), [5, 6]);
  c.h.close();
});

test('ohne Änderung jede Minute ein Lebenszeichen; Bits als 0/1; Ausfall = Lücke', () => {
  const c = clockHistory(tmp());
  const t0 = c.now;
  c.h.onValue('d', 'M1', good(true), 'modbus');
  c.add(KEEP_ALIVE_MS - 1000); c.h.tick();
  assert.strictEqual(c.h.query([{ dev: 'd', name: 'M1' }], t0, c.now, 50)[0].points.length, 1, 'vor Ablauf nichts');
  c.add(1000); c.h.tick();
  c.add(5000); c.h.onValue('d', 'M1', { value: true, quality: 'stale' }, 'modbus');
  c.add(1000); c.h.onValue('d', 'M1', { value: true, quality: 'stale' }, 'modbus'); // nur einmal Lücke
  c.add(KEEP_ALIVE_MS * 2); c.h.tick(); // ohne gültigen Wert kein Lebenszeichen
  c.add(1000); c.h.onValue('d', 'M1', good(false), 'modbus');
  const pts = c.h.query([{ dev: 'd', name: 'M1' }], t0, c.now, 50)[0].points.map((p) => p[1]);
  assert.deepStrictEqual(pts, [1, 1, null, 0]);
  c.h.close();
});

test('viele Werte: je Abschnitt kleinster und größter Wert; Wert vor dem Zeitraum; Trennen = Lücke; Aufräumen', () => {
  const c = clockHistory(tmp(), { retentionDays: 1 });
  const t0 = c.now;
  for (let i = 0; i < 1000; i++) { c.h.onValue('d', 'MW2', good(i % 10 === 5 ? 100 : i % 7), 'modbus'); c.add(250); }
  c.h.flush();
  const q = c.h.query([{ dev: 'd', name: 'MW2' }], t0, c.now, 20)[0].points;
  assert.ok(q.length <= 21 && q.length >= 19, `etwa 20 Abschnitte (${q.length})`);
  assert.ok(q.every((p) => p.length === 3 && p[2] === 100), 'Spitzen (100) bleiben in jedem Abschnitt sichtbar');
  const later = c.h.query([{ dev: 'd', name: 'MW2' }], c.now + 10, c.now + 20, 20)[0].points;
  assert.strictEqual(later.length, 1, 'letzter Wert vor dem Zeitraum');
  c.h.pause();
  const last = c.h.query([{ dev: 'd', name: 'MW2' }], c.now - 1, c.now + 1, 20)[0].points;
  assert.strictEqual(last[last.length - 1][1], null, 'beim Trennen Lücke');
  c.add(2 * 24 * 3600 * 1000);
  assert.ok(c.h.prune() >= 1000, 'nach Ablauf gelöscht');
  assert.deepStrictEqual(c.h.query([{ dev: 'x', name: 'y' }], 0, c.now, 10), [{ dev: 'x', name: 'y', points: [] }], 'unbekannte Kurve');
  c.h.close();
});

test('Programm: Häkchen „aufzeichnen“ bleibt gespeichert, nur angehakte Variablen werden aufgezeichnet', async () => {
  const dir = tmp();
  const api = new AppApi({ dir });
  try {
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', settings: { host: '127.0.0.1', port: 1 } });
    await api.addVariable(d.id, { operand: 'MW3', name: 'Soll' });
    await api.addVariable(d.id, { operand: 'MW4', name: 'Ist' });
    await api.setRecord(d.id, 'Soll', true);
    assert.strictEqual(api.getDevice(d.id).variables.find((v) => v.name === 'Soll').userRecord, true);
    assert.ok(api.recorded.get(d.id).has('Soll') && !api.recorded.get(d.id).has('Ist'));
    api.runtime.active = true; // ohne echtes Gerät: so tun, als wäre verbunden
    api.values.update(d.id, { values: { Soll: 42, Ist: 7 } });
    api.runtime.active = false;
    const [soll, ist] = await api.historyQuery([{ dev: d.id, name: 'Soll' }, { dev: d.id, name: 'Ist' }], 0, Date.now() + 1000, 100);
    assert.deepStrictEqual(soll.points.map((p) => p[1]), [42]);
    assert.deepStrictEqual(ist.points, []);
    await api.setRecord(d.id, 'Soll', false);
    assert.strictEqual(api.getDevice(d.id).variables.find((v) => v.name === 'Soll').userRecord, undefined);
  } finally {
    await api.stop();
  }
});
