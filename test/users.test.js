'use strict';
// Benutzer, Anmeldung, Rechte, Bedienprotokoll (Version 1, Punkt 4). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Users } = require('../src/core/users');
const { AuditLog } = require('../src/core/audit');
const { AppApi } = require('../src/app/api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-users-'));

test('Benutzer: Passwort und PIN nur als Prüfwert, Regeln für Namen, PIN und letzten Techniker', () => {
  const dir = tmp();
  const u = new Users({ dir });
  assert.strictEqual(u.active(), false, 'ohne Techniker: Anmeldung aus');
  const ralf = u.add({ name: 'Ralf', role: 'setup', password: 'geheim123', pin: '4711' });
  assert.strictEqual(u.active(), true);
  const text = fs.readFileSync(path.join(dir, 'benutzer.json'), 'utf8');
  assert.ok(!text.includes('geheim123') && !text.includes('4711'), 'nichts im Klartext gespeichert');
  assert.throws(() => u.add({ name: 'ralf', role: 'operator', pin: '1234' }), /gibt es schon/);
  assert.throws(() => u.add({ name: 'A', role: 'operator', pin: '12' }), /4 bis 8 Ziffern/);
  assert.throws(() => u.add({ name: 'B', role: 'operator', password: 'kurz' }), /mindestens 6/);
  assert.throws(() => u.add({ name: 'C', role: 'operator' }), /Passwort oder eine PIN/);
  assert.throws(() => u.update(ralf.id, { role: 'operator' }), /letzte Techniker/);
  const schicht = u.add({ name: 'Schicht A', role: 'operator', pin: '1234' });
  assert.throws(() => u.remove(ralf.id), /letzte Techniker/);
  assert.deepStrictEqual(u.list().map((x) => [x.name, x.hasPassword, x.hasPin]), [['Ralf', true, true], ['Schicht A', false, true]]);
  assert.strictEqual(new Users({ dir }).verify(schicht.id, '1234').ok, true, 'nach Neuladen gleich');
});

test('Anmeldung: Passwort oder PIN; nach 5 Fehlversuchen 1 Minute gesperrt, danach wieder möglich', () => {
  let now = 0;
  const u = new Users({ dir: tmp(), now: () => now });
  const a = u.add({ name: 'A', role: 'setup', password: 'passwort1', pin: '24680' });
  assert.strictEqual(u.verify(a.id, 'passwort1').ok, true);
  assert.strictEqual(u.verify(a.id, '24680').ok, true);
  for (let i = 1; i <= 4; i++) assert.deepStrictEqual(u.verify(a.id, 'falsch'), { ok: false, left: 5 - i });
  const locked = u.verify(a.id, 'falsch');
  assert.strictEqual(locked.locked, true);
  assert.strictEqual(u.verify(a.id, 'passwort1').locked, true, 'gesperrt – auch das richtige Passwort');
  now = 59 * 1000;
  assert.strictEqual(u.verify(a.id, 'passwort1').locked, true);
  now = 61 * 1000;
  assert.strictEqual(u.verify(a.id, 'passwort1').ok, true, 'nach 1 Minute wieder offen');
});

test('Sperre wird mit jeder Serie von 5 Fehlversuchen länger (1, 2, 4 … höchstens 15 Minuten), Erfolg setzt zurück', () => {
  let now = 0;
  const u = new Users({ dir: tmp(), now: () => now });
  const a = u.add({ name: 'A', role: 'setup', pin: '1357' });
  const series = () => { let r; for (let i = 0; i < 5; i++) r = u.verify(a.id, '0000'); return r; };
  const waits = [];
  for (let k = 0; k < 6; k++) { const r = series(); waits.push(r.wait); now += r.wait * 1000 + 1; }
  assert.deepStrictEqual(waits, [60, 120, 240, 480, 900, 900]);
  assert.strictEqual(u.verify(a.id, '1357').ok, true);
  assert.strictEqual(series().wait, 60, 'nach erfolgreicher Anmeldung wieder 1 Minute');
});

test('Bedienprotokoll: Einträge, Filter, CSV für Excel; keine Funktion zum Ändern oder Löschen', () => {
  let now = Date.UTC(2026, 9, 30, 12);
  const log = new AuditLog({ dir: tmp(), now: () => now, retentionDays: 1 });
  log.add({ user: 'Ralf', kind: 'write', device: 'NT1', name: 'MW3', what: 'Nachlauf; Soll', old: 120, new: 250 });
  now += 1000;
  log.add({ user: 'Schicht A', kind: 'ack', device: 'NT1', name: 'M24', what: 'Störung "P2"' });
  assert.throws(() => log.add({ kind: 'falsch' }), /unbekannte Art/);
  assert.deepStrictEqual(log.query({}).map((r) => [r.user, r.kind, r.old, r.new]), [['Schicht A', 'ack', null, null], ['Ralf', 'write', '120', '250']]);
  assert.strictEqual(log.query({ user: 'Ralf' }).length, 1);
  const csv = log.csv({}, { kinds: { write: 'geschrieben', ack: 'quittiert' } });
  assert.ok(csv.startsWith('﻿Zeit;Benutzer;Art;'), 'Excel: BOM und Semikolon');
  assert.match(csv, /"Nachlauf; Soll";120;250/);
  assert.match(csv, /"Störung ""P2"""/);
  for (const k of ['update', 'delete', 'remove', 'clear']) assert.strictEqual(typeof log[k], 'undefined', `keine Funktion ${k}`);
  now += 2 * 24 * 3600 * 1000;
  assert.strictEqual(log.prune(), 2, 'nur die Aufbewahrungsfrist räumt auf');
  log.close();
});

test('Programm: Rechte je Rolle, erster Techniker angemeldet, Protokoll von An-/Abmeldung, Schreiben und Benutzern', async () => {
  const dir = tmp();
  const api = new AppApi({ dir, history: false });
  try {
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', settings: { host: '127.0.0.1', port: 1 } });
    await api.addVariable(d.id, { operand: 'MW3', name: 'Soll' });
    assert.strictEqual(api.role(), 'setup', 'ohne Techniker alles offen');
    const ralf = api.userAdd({ name: 'Ralf', role: 'setup', password: 'geheim123' });
    assert.deepStrictEqual(api.authState().user, { id: ralf.id, name: 'Ralf', role: 'setup' }, 'erster Techniker gleich angemeldet');
    const op = api.userAdd({ name: 'Schicht A', role: 'operator', pin: '1234' });
    api.logout();
    assert.strictEqual(api.role(), 'viewer', 'ohne Anmeldung: Beobachter');
    await assert.rejects(async () => api.writeValue(d.id, 'Soll', 1), /Berechtigung/);
    assert.throws(() => api.savePages([]), /Berechtigung/);
    assert.throws(() => api.auditQuery({}), /Berechtigung/);
    assert.deepStrictEqual(api.listDevices().map((x) => x.name), ['NT1'], 'ansehen geht');
    assert.strictEqual(api.login(op.id, '9999').ok, false);
    assert.strictEqual(api.login(op.id, '1234').ok, true);
    assert.strictEqual(api.role(), 'operator');
    api.runtime.write = async () => true; // ohne Gerät: Schreiben gelingt
    api.values.update(d.id, { values: { Soll: 120 } });
    await api.writeValue(d.id, 'Soll', 250);
    assert.throws(() => api.exitOperate(), /Berechtigung/, 'Bediener darf den Bedienmodus nicht verlassen');
    api.logout('timeout');
    api.login(ralf.id, 'geheim123');
    api.exitOperate();
    const kinds = api.auditQuery({}).reverse().map((r) => [r.kind, r.user, r.what && r.what.split(' ')[0], r.old, r.new]);
    assert.deepStrictEqual(kinds.map((k) => k[0]), ['user', 'login', 'user', 'logout', 'loginFail', 'login', 'write', 'autoLogout', 'login', 'exitOperate']);
    const w = api.auditQuery({}).find((r) => r.kind === 'write');
    assert.deepStrictEqual([w.user, w.device, w.name, w.old, w.new], ['Schicht A', 'NT1', 'Soll', '120', '250']);
    assert.throws(() => api.emergencyReset(ralf.id, 'neu123456'), /Berechtigung/, 'Notfall nur mit --notfall');
  } finally {
    await api.stop();
  }
});

test('Notfall-Zugang: Passwort neu setzen, steht im Protokoll', async () => {
  const dir = tmp();
  const api = new AppApi({ dir, history: false, emergency: true });
  try {
    const ralf = api.userAdd({ name: 'Ralf', role: 'setup', password: 'vergessen1' });
    api.logout();
    api.emergencyReset(ralf.id, 'neuesPasswort');
    assert.strictEqual(api.login(ralf.id, 'neuesPasswort').ok, true);
    assert.ok(api.auditQuery({}).some((r) => r.kind === 'emergency' && /Ralf/.test(r.what)));
  } finally {
    await api.stop();
  }
});
