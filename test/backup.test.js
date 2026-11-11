'use strict';
// Projekt sichern und einspielen (Punkt 7). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { AppApi } = require('../src/app/api');
const BACKUP = require('../src/core/backup');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `easy4visu-sich-${n}-`));
// Windows-Verschlüsselung nachgestellt: jeder „PC“ hat seinen eigenen Schlüssel
const pc = (key) => ({
  protect: (text) => Buffer.from(`${key}:${text}`).toString('base64'),
  unprotect: (b64) => {
    const s = Buffer.from(b64, 'base64').toString('utf8');
    if (!s.startsWith(`${key}:`)) throw new Error('anderer PC');
    return s.slice(key.length + 1);
  },
});
// kleinstes gültiges PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Projekt mit zwei Geräten (eines mit Passwort), Seite mit Bild, Design, Meldung, Techniker Ralf */
async function project(dir, key) {
  const api = new AppApi(Object.assign({ dir, history: false }, pc(key)));
  const nt1 = await api.saveDevice({ name: 'NT1', protocol: 'json', interval: 1000, settings: { host: '192.168.1.10', user: 'admin' } }, { password: 'geheimA' });
  await api.saveDevice({ name: 'NT2', protocol: 'modbus', interval: 500, settings: { host: '192.168.1.11', port: 502 } });
  const pic = path.join(dir, 'bild.png');
  fs.writeFileSync(pic, PNG);
  const img = api.addImage(pic);
  api.savePages([{ id: 'p1', name: 'Übersicht', items: [{ id: 'i1', kind: 'image', img: img.name || img, x: 0, y: 0, w: 100, h: 100 }] }]);
  api.saveTheme({ font: 'leitstand', radius: 'soft' });
  await api.setWebOptions({ startPage: 'p1' }).catch(() => {});
  const ralf = api.userAdd({ name: 'Ralf', role: 'setup', password: 'test1234' });
  return { api, nt1, ralf };
}

test('sichern mit Kennwort, an einem anderen PC einspielen: alles da, Gerätepasswort neu verschlüsselt', async () => {
  const a = tmp('a');
  const { api, nt1 } = await project(a, 'pcA');
  const file = path.join(a, 'projekt.easy4visu');
  assert.throws(() => api.saveBackup(file, { password: 'abc' }), /mindestens 4 Zeichen/);
  const sum = api.saveBackup(file, { password: 'kennwort' });
  assert.deepStrictEqual(sum.devices.map((d) => d.name), ['NT1', 'NT2']);
  assert.strictEqual(sum.pages, 1);
  assert.strictEqual(sum.images, 1);
  assert.strictEqual(sum.users, 1);
  assert.strictEqual(sum.secrets, true);
  assert.strictEqual(sum.pcSecrets, false, 'von Hand: keine PC-verschlüsselten Passwörter');
  const raw = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  assert.ok(!raw.includes('geheimA'), 'Gerätepasswort nicht im Klartext');
  assert.ok(!raw.includes('test1234'), 'Benutzerpasswort nicht im Klartext');
  assert.match(api.auditQuery({}).map((r) => r.what).join('\n'), /Projekt gesichert: projekt\.easy4visu/);
  await api.stop();

  const b = tmp('b');
  const other = new AppApi(Object.assign({ dir: b, history: false }, pc('pcB')));
  const pre = other.backupPreview(file);
  assert.strictEqual(pre.devices.length, 2);
  await assert.rejects(() => other.restoreBackup(file, { password: 'falsch' }), /Kennwort .* stimmt nicht/);
  assert.strictEqual(other.listDevices().length, 0, 'bei falschem Kennwort nichts geändert');
  const r = await other.restoreBackup(file, { password: 'kennwort' });
  assert.strictEqual(r.secrets, true);
  assert.strictEqual(r.users, true);
  assert.deepStrictEqual(other.listDevices().map((d) => d.name).sort(), ['NT1', 'NT2']);
  assert.strictEqual(other.devices.getSecrets(nt1.id).password, 'geheimA');
  assert.strictEqual(other.listPages().length, 1);
  assert.strictEqual(other.getTheme().font, 'leitstand');
  assert.strictEqual(other.getWebOptions().startPage, 'p1');
  assert.strictEqual(fs.readdirSync(path.join(b, 'bilder')).length, 1);
  assert.ok(fs.readdirSync(path.join(b, 'Sicherungen')).some((n) => n.startsWith('vor-einspielen-')), 'vorher gesichert');
  assert.strictEqual(other.authState().user, null, 'Benutzer ersetzt: neu anmelden');
  const ralf = other.users.list().find((u) => u.name === 'Ralf');
  assert.strictEqual(other.login(ralf.id, 'test1234').ok, true);
  assert.match(other.auditQuery({}).map((r2) => r2.what).join('\n'), /Projekt eingespielt aus projekt\.easy4visu/);
  await other.stop();
  // neu gestartet: Passwort mit dem Schlüssel von PC B lesbar
  const again = new AppApi(Object.assign({ dir: b, history: false }, pc('pcB')));
  assert.strictEqual(again.devices.getSecrets(nt1.id).password, 'geheimA');
  await again.stop();
});

test('ohne Kennwort und ohne Benutzer: Passwörter fehlen, eigene Benutzer bleiben', async () => {
  const a = tmp('c');
  const { api, nt1 } = await project(a, 'pcA');
  const file = path.join(a, 'ohne.easy4visu');
  const sum = api.saveBackup(file, { users: false });
  assert.strictEqual(sum.secrets, false);
  assert.strictEqual(sum.users, null);
  await api.stop();
  const b = tmp('d');
  const other = new AppApi(Object.assign({ dir: b, history: false }, pc('pcB')));
  other.userAdd({ name: 'Anna', role: 'setup', password: 'anna1234' });
  const r = await other.restoreBackup(file, {});
  assert.strictEqual(r.users, false);
  assert.deepStrictEqual(other.usersList().map((u) => u.name), ['Anna']);
  assert.deepStrictEqual(other.devices.getSecrets(nt1.id), {});
  await other.stop();
});

test('fremde, beschädigte und neuere Dateien werden abgelehnt', async () => {
  const a = tmp('e');
  const api = new AppApi({ dir: a, history: false });
  const junk = path.join(a, 'x.easy4visu');
  fs.writeFileSync(junk, 'hallo');
  assert.throws(() => api.backupPreview(junk), /keine easy4Visu-Projektsicherung/);
  fs.writeFileSync(junk, zlib.gzipSync(JSON.stringify({ easy4visu: 'projekt', format: 99, app: '9.0.0', files: {} })));
  assert.throws(() => api.backupPreview(junk), /neueren easy4Visu \(9\.0\.0\)/);
  await assert.rejects(() => api.restoreBackup(junk, {}), /neueren/);
  assert.ok(!fs.existsSync(path.join(a, 'Sicherungen')), 'abgelehnt: auch keine Vorher-Sicherung');
  await api.stop();
});

test('tägliche Sicherung: höchstens einmal am Tag, letzte 7 bleiben, abschaltbar; am selben PC mit Passwörtern', async () => {
  const a = tmp('f');
  const { api, nt1 } = await project(a, 'pcA');
  const day = 24 * 3600 * 1000;
  const t0 = Date.now();
  assert.ok(api.runAutoBackup(t0));
  assert.strictEqual(api.runAutoBackup(t0 + 3600 * 1000), null, 'eine Stunde später: keine neue');
  for (let i = 1; i <= 9; i++) assert.ok(api.runAutoBackup(t0 + i * day));
  const autos = api.getBackupState().list.filter((x) => x.kind === 'auto');
  assert.strictEqual(autos.length, 7);
  assert.ok(autos[0].time > autos[6].time, 'neueste zuerst');
  const newest = autos[0].name;
  // Passwort ändern, dann die automatische Sicherung einspielen: altes Passwort wieder da (gleicher PC)
  await api.saveDevice(Object.assign(api.getDevice(nt1.id), { id: nt1.id }), { password: 'neu' });
  assert.strictEqual(api.devices.getSecrets(nt1.id).password, 'neu');
  assert.strictEqual(api.backupPreview(newest).pcSecrets, true);
  await api.restoreBackup(newest, {});
  assert.strictEqual(api.devices.getSecrets(nt1.id).password, 'geheimA');
  assert.strictEqual(api.authState().user, null, 'Benutzer aus der Sicherung: neu anmelden');
  api.login(api.users.list()[0].id, 'test1234');
  // abschalten
  assert.strictEqual(api.setBackupOptions({ auto: false }).auto, false);
  assert.strictEqual(api.runAutoBackup(t0 + 30 * day), null);
  await api.stop();
  // anderer PC: die Windows-verschlüsselten Passwörter sind dort nicht lesbar – nichts bricht
  const b = tmp('g');
  const other = new AppApi(Object.assign({ dir: b, history: false }, pc('pcB')));
  await other.restoreBackup(path.join(a, 'Sicherungen', newest), {});
  assert.deepStrictEqual(other.devices.getSecrets(nt1.id), {});
  await other.stop();
});

test('Namen im Ordner „Sicherungen“: nur einfache Dateinamen, kein Weg nach außen', () => {
  const a = tmp('h');
  fs.mkdirSync(path.join(a, BACKUP.AUTO_DIR));
  const api = new AppApi({ dir: a, history: false });
  assert.strictEqual(api._backupPath('../geheim.easy4visu'), '../geheim.easy4visu', 'kein Name aus dem Ordner – unverändert als Pfad');
  assert.throws(() => api.backupPreview('gibtsnicht.easy4visu'), /keine easy4Visu-Projektsicherung/);
});

test('Sicherung direkt auf ein Laufwerk (USB-Stick „D:\“): kein Anlegen eines vorhandenen Ordners', async () => {
  // Windows meldet bei mkdir auf ein Laufwerk selbst EPERM – nachgestellt: mkdir auf vorhandene Ordner schlägt fehl
  const a = tmp('usb');
  const { api } = await project(a, 'pcA');
  const orig = fs.mkdirSync;
  fs.mkdirSync = (p, o) => { if (fs.existsSync(p)) throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${p}'`), { code: 'EPERM' }); return orig(p, o); };
  try {
    const file = path.join(a, 'auf-dem-stick.easy4visu');
    api.saveBackup(file, {});
    assert.ok(fs.existsSync(file), 'gespeichert');
  } finally {
    fs.mkdirSync = orig;
    await api.stop();
  }
});
