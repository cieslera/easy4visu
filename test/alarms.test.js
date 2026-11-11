'use strict';
// Meldungen (Version 1, Punkt 3): Festlegungen, kommt/geht, Quittieren mit Impuls, Verlauf. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Alarms, cleanDefs } = require('../src/core/alarms');
const { AppApi } = require('../src/app/api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-alarm-'));
const good = (value) => ({ value, quality: 'good' });

test('Festlegungen prüfen: ohne Variable weg, Stufe und „bei“ mit Standard, Quittier-Variable optional', () => {
  const d = cleanDefs([
    { dev: 'd', name: 'M24', text: ' Störung P2 ', level: 'warn', when: 0, extra: 1 },
    { dev: 'd', name: 'M25', level: 'falsch', when: 7 },
    { dev: '', name: 'M1' }, null,
  ]);
  assert.strictEqual(d.length, 2);
  assert.deepStrictEqual([d[0].text, d[0].level, d[0].when, d[0].extra], ['Störung P2', 'warn', 0, undefined]);
  assert.deepStrictEqual([d[1].level, d[1].when], ['fault', 1]);
});

test('Störung: kommt, geht, bleibt offen bis zur Quittung; Quittieren schreibt einen Impuls', async () => {
  const writes = [];
  let now = 1000;
  const a = new Alarms({ dir: tmp(), now: () => now, write: async (dev, name, v) => { writes.push([dev, name, v]); } });
  a.saveAckVars({ d: 'M2', '': 'x' });
  assert.deepStrictEqual(a.getAckVars(), { d: 'M2' }, 'Quittier-Merker je Gerät');
  a.saveDefs([{ id: 'p2', dev: 'd', name: 'M24', text: 'Störung Pumpe 2', level: 'fault' },
    { id: 'w', dev: 'd', name: 'M30', text: 'Füllstand niedrig', level: 'warn', when: 0 }]);
  assert.strictEqual(a.onValue('d', 'M24', good(false)), false, 'nicht gesetzt: nichts');
  assert.strictEqual(a.onValue('d', 'M24', { value: true, quality: 'stale' }), false, 'veralteter Wert zählt nicht');
  now = 2000; assert.strictEqual(a.onValue('d', 'M24', good(true)), true, 'kommt');
  assert.strictEqual(a.onValue('d', 'M24', good(true)), false, 'steht weiter an: kein zweiter Eintrag');
  now = 3000; a.onValue('d', 'M30', good(false)); // Warnung „bei 0“
  let act = a.active();
  assert.deepStrictEqual(act.map((x) => [x.text, x.canAck]), [['Störung Pumpe 2', true], ['Füllstand niedrig', false]], 'Störung zuerst');
  now = 4000; a.onValue('d', 'M24', good(false)); a.onValue('d', 'M30', good(true));
  act = a.active();
  assert.deepStrictEqual(act.map((x) => [x.text, x.gone]), [['Störung Pumpe 2', 4000]], 'Warnung erledigt, Störung „ging“ – noch offen');
  now = 5000;
  assert.strictEqual(await a.acknowledge('all'), 1);
  assert.deepStrictEqual(writes, [['d', 'M2', 1]], 'Impuls 1 (0 folgt nach 1 s)');
  assert.deepStrictEqual(a.active(), [], 'nach Quittung erledigt');
  const hist = a.history(10);
  assert.deepStrictEqual(hist.map((x) => [x.text, x.come, x.gone, x.ack]), [['Füllstand niedrig', 3000, 4000, 4000], ['Störung Pumpe 2', 2000, 4000, 5000]]);
  a.close();
});

test('Störung quittiert, während sie noch ansteht: bleibt bis „geht“ in der Liste', async () => {
  let now = 1;
  const a = new Alarms({ dir: tmp(), now: () => now });
  a.saveDefs([{ id: 'f', dev: 'd', name: 'M1', text: 'Not-Halt' }]);
  a.onValue('d', 'M1', good(1));
  const [e] = a.active();
  now = 2; assert.strictEqual(await a.acknowledge(e.id), 1);
  assert.strictEqual(await a.acknowledge(e.id), 0, 'zweimal quittieren: nichts mehr');
  assert.deepStrictEqual(a.active().map((x) => [x.ack, x.canAck]), [[2, false]], 'quittiert, steht noch an');
  now = 3; a.onValue('d', 'M1', good(0));
  assert.deepStrictEqual(a.active(), []);
  a.close();
});

test('Programm: Meldungen speichern, bei Verbindung auswerten, quittieren', async () => {
  const dir = tmp();
  const api = new AppApi({ dir, history: false });
  try {
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', settings: { host: '127.0.0.1', port: 1 } });
    await api.addVariable(d.id, { operand: 'M24', name: 'Al_Stoer_P2' });
    api.runtime.active = true; // ohne echtes Gerät: so tun, als wäre verbunden
    api.values.update(d.id, { values: { Al_Stoer_P2: true } });
    await api.saveAlarmDefs([{ dev: d.id, name: 'Al_Stoer_P2', text: 'Störung Pumpe 2' }]);
    assert.deepStrictEqual(api.alarmsActive().map((x) => x.text), ['Störung Pumpe 2'], 'steht beim Festlegen schon an');
    assert.strictEqual(api.getAlarmDefs()[0].level, 'fault');
    assert.strictEqual(new AppApi({ dir, history: false }).getAlarmDefs().length, 1, 'gespeichert');
    assert.strictEqual(await api.ackAlarm('all'), 1);
    api.values.update(d.id, { values: { Al_Stoer_P2: false } });
    assert.deepStrictEqual(api.alarmsActive(), []);
    api.runtime.active = false;
  } finally {
    await api.stop();
  }
});

test('ältere Datei mit Quittier-Variable je Meldung: wird zum Quittier-Merker des Geräts', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'meldungen.json'), JSON.stringify({ version: 1, alarms: [{ id: 'a', dev: 'd', name: 'M24', ack: { dev: 'd', name: 'M2' } }] }));
  const a = new Alarms({ dir });
  assert.deepStrictEqual(a.getAckVars(), { d: 'M2' });
  assert.strictEqual(a.getDefs()[0].ack, undefined);
});
