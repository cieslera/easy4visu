'use strict';
/**
 * Autostart und Neustart nach Absturz unter Windows (Version 1, Punkt 4 – Kiosk-Betrieb). Gehört zur Electron-Hülle;
 * auf dem Raspberry Pi (Version 2) übernimmt das ein Linux-Dienst.
 *
 * Eine Windows-Aufgabe „easy4Visu“ (Aufgabenplanung, nur für den angemeldeten Benutzer, keine Administratorrechte):
 *   - startet easy4Visu bei der Windows-Anmeldung
 *   - prüft ab dem Einschalten jede Minute (zweiter Auslöser, gilt sofort und nach jedem PC-Neustart): läuft easy4Visu noch? Wenn nicht (abgestürzt oder im Task-Manager beendet), startet sie es
 *     neu; läuft es, passiert nichts (eine zweite Instanz wird nicht gestartet)
 * Beendet ein Einrichter easy4Visu absichtlich über „easy4Visu beenden“, steht das in der Datei „beendet“ im Datenordner:
 * die Aufgabe startet es dann erst nach dem nächsten Neustart des PCs wieder (siehe stoppedOnPurpose). Fenster schließen
 * (X, Alt+F4) oder „Task beenden“ im Task-Manager gelten als Ausfall: easy4Visu kommt nach höchstens 1 Minute wieder.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Name der Windows-Aufgabe (E4_TASK_NAME nur für Tests, damit eine echte Aufgabe unberührt bleibt)
const TASK = process.env.E4_TASK_NAME || 'easy4Visu';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Aufgabe als XML (Windows-Aufgabenplanung) */
function taskXml(exe, args, user, start) {
  // Ortszeit ohne Zonenangabe (so erwartet es die Aufgabenplanung), eine Minute in der Vergangenheit
  const d = new Date((start || Date.now()) - 60000);
  const begin = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>easy4Visu starten und nach einem Absturz neu starten</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${esc(user)}</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <Enabled>true</Enabled>
      <StartBoundary>${begin}</StartBoundary>
      <Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowHardTerminate>true</AllowHardTerminate>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(exe)}</Command><Arguments>${esc(args)}</Arguments></Exec></Actions>
</Task>
`;
}

const run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') }));
});

/** Kommandozeile so, dass die Aufgabe dasselbe startet wie jetzt (fertiges Programm oder Entwicklung mit electron.exe) */
function launchArgs(appPath, packaged, dataDir) {
  const a = [];
  if (!packaged) a.push(`"${appPath}"`);
  a.push('--autostart');
  if (dataDir) a.push(`--daten="${dataDir}"`);
  return a.join(' ');
}

async function isEnabled() {
  if (process.platform !== 'win32') return false;
  return (await run('schtasks', ['/Query', '/TN', TASK])).ok;
}

/** einschalten: Aufgabe anlegen bzw. ersetzen */
async function enable({ exe, appPath, packaged, dataDir }) {
  if (process.platform !== 'win32') throw new Error('Autostart gibt es nur unter Windows.');
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`;
  const file = path.join(os.tmpdir(), `easy4visu-aufgabe-${process.pid}.xml`);
  fs.writeFileSync(file, `﻿${taskXml(exe, launchArgs(appPath, packaged, dataDir), user)}`, 'utf16le');
  try {
    const r = await run('schtasks', ['/Create', '/TN', TASK, '/XML', file, '/F']);
    if (!r.ok) throw new Error(`Windows-Aufgabe konnte nicht angelegt werden: ${r.err.trim()}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
  return true;
}

async function disable() {
  if (process.platform !== 'win32') return false;
  if (!(await isEnabled())) return true;
  const r = await run('schtasks', ['/Delete', '/TN', TASK, '/F']);
  if (!r.ok) throw new Error(`Windows-Aufgabe konnte nicht gelöscht werden: ${r.err.trim()}`);
  return true;
}

// ---------------------------------------------------------------- absichtlich beendet?
const stopFile = (dataDir) => path.join(dataDir, 'beendet');

/** beim absichtlichen Beenden (Einrichter): merken */
function markStopped(dataDir) {
  try { fs.writeFileSync(stopFile(dataDir), new Date().toISOString(), 'utf8'); } catch (e) { /* egal */ }
}
/** beim Start von Hand oder bei Anmeldung: Merker entfernen */
function clearStopped(dataDir) {
  try { fs.rmSync(stopFile(dataDir), { force: true }); } catch (e) { /* egal */ }
}
/** Start durch die Aufgabe: nach absichtlichem Beenden nicht wieder starten – bis der PC neu gestartet wurde */
function stoppedOnPurpose(dataDir) {
  try {
    const t = fs.statSync(stopFile(dataDir)).mtimeMs;
    const boot = Date.now() - os.uptime() * 1000;
    return t > boot;
  } catch (e) { return false; }
}

module.exports = { TASK, taskXml, launchArgs, isEnabled, enable, disable, markStopped, clearStopped, stoppedOnPurpose };
