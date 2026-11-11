'use strict';
// Kiosk-Betrieb: Windows-Aufgabe für Autostart und Neustart nach Absturz (app/autostart.js). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../app/autostart');

test('Windows-Aufgabe: Start bei Anmeldung, jede Minute prüfen, keine zweite Instanz, ohne Zeitlimit', () => {
  const xml = A.taskXml('C:\Programme\easy4Visu\easy4Visu.exe', A.launchArgs('C:\app', true, 'D:\Daten & Co'), 'PC\Ralf');
  assert.match(xml, /<LogonTrigger>[\s\S]*<UserId>PC\Ralf<\/UserId>/);
  assert.match(xml, /<TimeTrigger>[\s\S]*<Interval>PT1M<\/Interval>/, 'ab jetzt jede Minute');
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/, 'läuft es, passiert nichts');
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/, 'kein Zeitlimit');
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/, 'ohne Administratorrechte');
  assert.match(xml, /--autostart --daten=&quot;D:\Daten &amp; Co&quot;/, 'Startoptionen, Sonderzeichen maskiert');
  assert.strictEqual(A.launchArgs('C:\dev\easy4VISU', false, ''), '"C:\dev\easy4VISU" --autostart', 'Entwicklung: electron.exe mit Programmordner');
});

test('absichtlich beendet: Aufgabe startet erst nach dem nächsten PC-Neustart wieder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-auto-'));
  assert.strictEqual(A.stoppedOnPurpose(dir), false);
  A.markStopped(dir);
  assert.strictEqual(A.stoppedOnPurpose(dir), true, 'seit dem letzten Start des PCs beendet');
  const before = (Date.now() - os.uptime() * 1000 - 60000) / 1000;
  fs.utimesSync(path.join(dir, 'beendet'), before, before);
  assert.strictEqual(A.stoppedOnPurpose(dir), false, 'vor dem letzten PC-Start beendet: wieder starten');
  A.markStopped(dir);
  A.clearStopped(dir);
  assert.strictEqual(A.stoppedOnPurpose(dir), false, 'von Hand gestartet: Merker weg');
});
