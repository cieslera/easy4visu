'use strict';
// Neues, leeres Projekt (Ralf 06.11.2026). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppApi } = require('../src/app/api');
const BACKUP = require('../src/core/backup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-neu-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Projekt mit Gerät, Seite mit Bild, Leiste mit Text, Design, Meldung, Startseite fürs Handy, Techniker Ralf (angemeldet) */
async function project(dir) {
  const api = new AppApi({ dir, history: false });
  const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', interval: 500, settings: { host: '192.168.1.11', port: 502 } });
  await api.addVariable(d.id, { operand: 'M5', name: 'Stoerung', label: 'Störung' });
  const pic = path.join(dir, 'bild.png');
  fs.writeFileSync(pic, PNG);
  const img = api.addImage(pic);
  api.savePages([{ id: 'p1', name: 'Übersicht', items: [{ id: 'i1', kind: 'image', img: img.name || img, x: 0, y: 0, w: 100, h: 100 }] }]);
  const bars = api.getBars();
  bars.top.on = true;
  bars.top.items = [{ type: 'text', text: 'Firma Muster' }];
  api.saveBars(bars);
  api.saveTheme({ font: 'leitstand', radius: 'soft' });
  await api.saveAlarmDefs([{ dev: d.id, name: 'Stoerung', text: 'Störung', level: 'fault', when: 1 }]);
  await api.setWebOptions({ startPage: 'p1' }).catch(() => {});
  const ralf = api.userAdd({ name: 'Ralf', role: 'setup', password: 'test1234' });
  api.login(ralf.id, 'test1234');
  return api;
}

test('Neues Projekt: vorher gesichert, Projekt leer, Benutzer und Design bleiben, alte Aufzeichnungen beim Neustart beiseite', async () => {
  const dir = tmp();
  const api = await project(dir);
  const r = await api.newProject({ keepDesign: true });
  assert.match(r.before, /^vor-neuem-projekt-.*\.easy4visu$/);
  // Sicherung enthält das alte Projekt und steht in der Liste („vor neuem Projekt“)
  const saved = BACKUP.summary(BACKUP.read(path.join(dir, 'Sicherungen', r.before)));
  assert.deepStrictEqual([saved.devices.length, saved.pages, saved.images], [1, 1, 1]);
  assert.strictEqual(api.getBackupState().list.find((x) => x.name === r.before).kind, 'before');
  // leer
  assert.deepStrictEqual([api.listDevices().length, api.listPages().length, api.alarms.defs.length], [0, 0, 0]);
  assert.ok(!fs.existsSync(path.join(dir, 'bilder')), 'Bilder gelöscht');
  // Benutzer, Design, Leiste mit ihrem Text bleiben; Handy-Startseite zeigt nicht mehr ins Leere
  assert.deepStrictEqual(api.usersList().map((u) => u.name), ['Ralf']);
  assert.strictEqual(api.getTheme().font, 'leitstand');
  assert.strictEqual(api.getBars('current').top.items[0].text, 'Firma Muster');
  assert.strictEqual(api.getWebOptions().startPage, '');
  // Aufzeichnungen sind noch offen: erst beim nächsten Start verschieben
  fs.writeFileSync(path.join(dir, 'verlauf.sqlite'), 'alt');
  await api.stop();
  assert.ok(fs.existsSync(path.join(dir, 'neues-projekt.json')));
  const again = new AppApi({ dir, history: false });
  const moved = fs.readdirSync(path.join(dir, 'Sicherungen')).find((n) => /^vor-neuem-projekt-.*-aufzeichnungen$/.test(n));
  assert.ok(moved, 'Ordner mit den alten Aufzeichnungen');
  const files = fs.readdirSync(path.join(dir, 'Sicherungen', moved));
  assert.ok(files.includes('verlauf.sqlite') && files.includes('protokoll.sqlite'), `verschoben: ${files.join(', ')}`);
  assert.ok(!fs.existsSync(path.join(dir, 'neues-projekt.json')), 'Merker weg');
  again.login(again._raw.usersList.call(again)[0].id, 'test1234');
  const log = again.auditQuery({ limit: 10 });
  assert.ok(log.some((x) => /Neues Projekt begonnen/.test(x.what)), 'neues Bedienprotokoll beginnt mit dem Hinweis');
  assert.ok(!log.some((x) => /Neues Projekt angelegt/.test(x.what)), 'alte Einträge liegen in der Sicherung');
  // das alte Projekt lässt sich wieder einspielen
  await again.restoreBackup(r.before, { users: true });
  assert.deepStrictEqual([again.listDevices().length, again.listPages().length], [1, 1]);
  await again.stop();
});

test('Neues Projekt ohne „Design behalten“: Standard-Design und leere Leisten; nur für Techniker', async () => {
  const dir = tmp();
  const api = await project(dir);
  const op = api.userAdd({ name: 'Bediener', role: 'operator', password: 'bedi1234' });
  api.login(op.id, 'bedi1234');
  await assert.rejects(async () => api.newProject({}), /Berechtigung/, 'Bediener darf nicht');
  api.login(api._raw.usersList.call(api).find((u) => u.name === 'Ralf').id, 'test1234');
  await api.newProject({ keepDesign: false });
  assert.notStrictEqual(api.getTheme().font, 'leitstand');
  assert.ok(!api.getBars('current').top.items.some((x) => x.text === 'Firma Muster'), 'Leisten wie ab Werk');
  assert.ok(api.getBars('current').top.items.some((x) => x.type === 'clock'));
  await api.stop();
});

test('Neues Projekt ohne „Benutzer behalten“: wie eine Neuinstallation – keine Anmeldung, Benutzer in der Sicherung', async () => {
  const dir = tmp();
  const api = await project(dir);
  const r = await api.newProject({ keepUsers: false });
  assert.strictEqual(r.keepUsers, false);
  assert.strictEqual(api.authState().active, false, 'keine Anmeldung mehr');
  assert.ok(!fs.existsSync(path.join(dir, 'benutzer.json')));
  assert.strictEqual(BACKUP.summary(BACKUP.read(path.join(dir, 'Sicherungen', r.before))).users, 1, 'Ralf steckt in der Sicherung');
  await api.stop();
});
