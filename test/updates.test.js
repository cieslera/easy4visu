'use strict';
// Updates (1.0.1): Suchen, Herunterladen, Installieren nur auf Wunsch, Einstellung, Fehler ohne Internet. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Updates, plainNotes } = require('../src/core/updates');
const autostart = require('../app/autostart');

/** nachgebauter autoUpdater von electron-updater: meldet dieselben Ereignisse */
class FakeUpdater extends EventEmitter {
  constructor(next) { super(); this.next = next; this.downloads = 0; this.installed = null; this.offline = false; }
  async checkForUpdates() {
    this.emit('checking-for-update');
    if (this.offline) { const err = new Error('net::ERR_INTERNET_DISCONNECTED'); this.emit('error', err); throw err; }
    if (this.next) this.emit('update-available', this.next);
    else this.emit('update-not-available', { version: '1.0.1' });
    return {};
  }
  async downloadUpdate() {
    this.downloads += 1;
    if (this.offline) { const err = new Error('download failed'); this.emit('error', err); throw err; }
    this.emit('download-progress', { percent: 42.4 });
    this.emit('update-downloaded', this.next);
    return [];
  }
  quitAndInstall(silent, runAfter) { this.installed = { silent, runAfter }; }
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-upd-'));
const NEXT = { version: '1.0.2', releaseNotes: '<h2>Neu</h2><ul><li>Web-App</li><li>Update-Suche</li></ul><p>A &amp; B</p>', releaseDate: '2026-11-26T10:00:00Z' };

test('Updates: ohne updater nur Versionsanzeige (Entwicklung, Demo)', async () => {
  const u = new Updates({ dir: tmp(), version: '1.0.1', updater: null, reason: 'demo' });
  const s = u.state();
  assert.strictEqual(s.version, '1.0.1');
  assert.strictEqual(s.supported, false);
  assert.strictEqual(s.reason, 'demo');
  assert.strictEqual(s.status, 'unsupported');
  assert.deepStrictEqual(await u.check(true), s);
  assert.throws(() => u.install());
  u.start(); // tut nichts
  assert.strictEqual(u.timers.length, 0);
});

test('Updates: neue Version finden, erst auf Wunsch herunterladen und installieren', async () => {
  const fake = new FakeUpdater(NEXT);
  const u = new Updates({ dir: tmp(), version: '1.0.1', updater: fake });
  const seen = [];
  u.on('state', (s) => seen.push(s.status));
  assert.strictEqual(u.state().auto, true, 'ab Werk an');
  const s1 = await u.check(true);
  assert.strictEqual(s1.status, 'available');
  assert.strictEqual(s1.available.version, '1.0.2');
  assert.strictEqual(s1.available.notes, 'Neu\n• Web-App\n• Update-Suche\nA & B');
  assert.ok(s1.lastCheck);
  assert.strictEqual(fake.downloads, 0, 'nichts von selbst herunterladen');
  assert.throws(() => u.install(), /not ready/);
  assert.strictEqual(fake.installed, null);
  const s2 = await u.download();
  assert.strictEqual(s2.status, 'ready');
  assert.strictEqual(s2.percent, 100);
  assert.ok(seen.includes('downloading'));
  // nochmal suchen oder laden, während es bereit ist: ändert nichts
  assert.strictEqual((await u.check(true)).status, 'ready');
  assert.strictEqual((await u.download()).status, 'ready');
  assert.strictEqual(fake.downloads, 1);
  u.install();
  assert.deepStrictEqual(fake.installed, { silent: true, runAfter: true }, 'Setup still ausführen und danach starten');
});

test('Updates: auf dem neuesten Stand', async () => {
  const u = new Updates({ dir: tmp(), version: '1.0.1', updater: new FakeUpdater(null) });
  const s = await u.check(true);
  assert.strictEqual(s.status, 'none');
  assert.strictEqual(s.available, null);
  assert.strictEqual((await u.download()).status, 'none', 'nichts zum Herunterladen');
});

test('Updates: ohne Internet – automatische Suche bleibt still, „Jetzt suchen“ zeigt den Fehler', async () => {
  const fake = new FakeUpdater(NEXT);
  fake.offline = true;
  const u = new Updates({ dir: tmp(), version: '1.0.1', updater: fake });
  const auto = await u.check(false);
  assert.strictEqual(auto.status, 'idle');
  assert.strictEqual(auto.error, null);
  const manual = await u.check(true);
  assert.strictEqual(manual.status, 'error');
  assert.match(manual.error, /INTERNET_DISCONNECTED/);
  // wieder online: neue Version gefunden; Herunterladen bricht ab → Fehler, Version bleibt zum erneuten Versuch
  fake.offline = false;
  assert.strictEqual((await u.check(true)).status, 'available');
  fake.offline = true;
  const d = await u.download();
  assert.strictEqual(d.status, 'error');
  assert.strictEqual(d.available.version, '1.0.2');
  fake.offline = false;
  assert.strictEqual((await u.download()).status, 'ready');
});

test('Updates: Einstellung „automatisch suchen“ wird gespeichert; Suche beim Start nur wenn an', async (t) => {
  const dir = tmp();
  const fake = new FakeUpdater(null);
  let calls = 0;
  fake.checkForUpdates = async () => { calls += 1; fake.emit('update-not-available', {}); };
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const u = new Updates({ dir, version: '1.0.1', updater: fake });
  u.setAuto(false);
  assert.strictEqual(new Updates({ dir, version: '1.0.1', updater: null }).state().auto, false, 'bleibt nach Neustart aus');
  u.start();
  t.mock.timers.tick(31 * 1000);
  assert.strictEqual(calls, 0, 'ausgeschaltet: keine Suche');
  u.setAuto(true);
  t.mock.timers.tick(24 * 3600 * 1000);
  await Promise.resolve();
  assert.strictEqual(calls, 1, 'eingeschaltet: einmal täglich');
  u.stop();
  t.mock.timers.tick(48 * 3600 * 1000);
  assert.strictEqual(calls, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'updates.json'), 'utf8')).auto, true);
});

test('Updates: Release-Text ohne HTML', () => {
  assert.strictEqual(plainNotes(null), '');
  assert.strictEqual(plainNotes('Zeile 1<br>Zeile 2'), 'Zeile 1\nZeile 2');
  assert.strictEqual(plainNotes([{ version: '1.0.2', note: '<p>a</p>' }, { note: 'b' }]), 'a\n\nb');
  assert.strictEqual(plainNotes('<script>x</script>&lt;b&gt;'), 'x<b>');
});

test('Autostart: während eines Updates startet die Windows-Aufgabe easy4Visu nicht, nach 5 Minuten wieder', () => {
  const dir = tmp();
  assert.strictEqual(autostart.updatingNow(dir), false);
  autostart.markUpdating(dir);
  assert.strictEqual(autostart.updatingNow(dir), true);
  assert.strictEqual(autostart.updatingNow(dir, Date.now() + autostart.UPDATE_PAUSE_MS + 1000), false, 'Setup gescheitert: Aufgabe startet wieder');
  autostart.clearUpdating(dir);
  assert.strictEqual(autostart.updatingNow(dir), false);
});
