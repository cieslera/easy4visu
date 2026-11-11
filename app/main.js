'use strict';
/**
 * Electron-Hauptprozess: öffnet das Programmfenster und reicht die Programm-Schnittstelle (src/app/api.js)
 * sicher an die Oberfläche weiter. Die Oberfläche selbst hat keinen Zugriff auf Node.js oder Dateien.
 *
 * Start:  npm start
 * Umgebungsvariablen (nur für Tests): E4_DATA_DIR = eigener Datenordner, E4_UI_CHECK = Prüfskript
 * (tools/ui-check.js), E4_UI_CHECK_FILES = JSON mit Dateien, die der Datei-Dialog „auswählt“.
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, dialog, safeStorage, protocol, shell } = require('electron');
const { AppApi } = require('../src/app/api');
const autostart = require('./autostart');

app.setName('easy4Visu');
// Bilder der Seiten (Datenordner/bilder) zeigt die Oberfläche über e4img://bild/<Name> – nur diese Dateien
protocol.registerSchemesAsPrivileged([{ scheme: 'e4img', privileges: { standard: true, secure: true } }]);
// Datenordner: Startoption --daten="…" (z. B. für die Windows-Aufgabe), sonst E4_DATA_DIR (Tests), sonst %APPDATA%\easy4visu
const argData = (process.argv.find((a) => a.startsWith('--daten=')) || '').slice('--daten='.length).replace(/^"|"$/g, '');
if (argData) app.setPath('userData', path.resolve(argData));
else if (process.env.E4_DATA_DIR) app.setPath('userData', process.env.E4_DATA_DIR);
// Demo-Modus (Start mit --demo): eingebaute Simulatoren und eine KOPIE des Projekts in einem eigenen Ordner –
// das echte Projekt, seine Trends, Meldungen und das Bedienprotokoll bleiben unberührt; ohne --demo ist alles wie vorher
// --demo-talwerk: statt des eigenen Projekts das mitgelieferte „Demo Talwerk“ (Ralf 08.11.2026)
const demoTalwerk = process.argv.includes('--demo-talwerk');
const wantDemo = demoTalwerk || process.argv.includes('--demo');
const realData = app.getPath('userData');
/** Ordner des mitgelieferten Demoprojekts Talwerk (im Setup unter resources\demo\talwerk) */
const talwerkDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'demo', 'talwerk') : path.join(__dirname, '..', 'demo', 'talwerk'));
if (wantDemo) {
  const demoDir = path.join(require('node:os').tmpdir(), 'easy4visu-demo');
  fs.rmSync(demoDir, { recursive: true, force: true });
  fs.mkdirSync(demoDir, { recursive: true });
  const COPY = ['devices.json', 'pages.json', 'texte.json', 'theme.json', 'symbole.json', 'meldungen.json', 'benutzer.json', 'web.json',
    'start.json', 'aufzeichnung.json', 'fenster.json', 'bilder'];
  const from = demoTalwerk ? talwerkDir() : realData;
  for (const n of COPY) {
    if (demoTalwerk && n === 'benutzer.json') continue; // ohne Benutzer: in der Demo ist man Techniker
    const src = path.join(from, n);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(demoDir, n), { recursive: true });
  }
  app.setPath('userData', demoDir);
  // Merker im echten Ordner: solange die Demo läuft, startet die Windows-Aufgabe kein zweites easy4Visu
  try { fs.writeFileSync(path.join(realData, 'demo-laeuft'), String(process.pid)); } catch (e) { /* nur ein Schutz */ }
  process.on('exit', () => { try { fs.unlinkSync(path.join(realData, 'demo-laeuft')); } catch (e) { /* schon weg */ } });
}
const fromTask = process.argv.includes('--autostart');
// Start durch die Windows-Aufgabe, während die Demo läuft: nichts tun
if (fromTask && !wantDemo) {
  try {
    const pid = Number(fs.readFileSync(path.join(realData, 'demo-laeuft'), 'utf8'));
    if (pid && pid !== process.pid) { process.kill(pid, 0); app.quit(); process.exit(0); }
  } catch (e) { /* kein Merker oder Demo nicht mehr da: normal starten */ }
}
// Start durch die Windows-Aufgabe nach absichtlichem Beenden: erst nach dem nächsten PC-Neustart wieder
if (fromTask && autostart.stoppedOnPurpose(app.getPath('userData'))) { app.quit(); process.exit(0); }
if (!fromTask) autostart.clearStopped(app.getPath('userData'));
// nur ein easy4Visu je Datenordner; ein zweiter Start holt das vorhandene Fenster nach vorn
if (!process.env.E4_UI_CHECK && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
// UI-Prüfung: das Prüffenster liegt oft verdeckt hinter anderen Fenstern; Windows meldet es dann als „unsichtbar“ und
// Chromium übernimmt keine Größenänderungen mehr – deshalb die Verdeckungs-Erkennung abschalten (nur in der Prüfung)
if (process.env.E4_UI_CHECK) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
let quitting = false;
// Notfall-Zugang: Start mit --notfall; erlaubt nur, wenn easy4Visu als Windows-Administrator läuft
// („net session“ gelingt nur mit Administratorrechten)
const wantEmergency = process.argv.includes('--notfall');
function isWindowsAdmin() {
  if (process.platform !== 'win32') return false;
  try { require('node:child_process').execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true }); return true; } catch (e) { return false; }
}

const CALLS = ['texts', 'listDevices', 'getDevice', 'saveDevice', 'removeDevice', 'testConnection',
  'previewImport', 'applyImport', 'deviceValues', 'writeValue', 'addVariable', 'updateVariable', 'removeVariable', 'removeVariables', 'devicePage', 'assignVariables',
  'listPages', 'savePages', 'setRecord', 'historyQuery', 'getAlarmDefs', 'saveAlarmDefs', 'alarmsActive', 'alarmsHistory', 'ackAlarm', 'getAlarmAck', 'saveAlarmAck',
  'authState', 'login', 'logout', 'usersList', 'userAdd', 'userUpdate', 'userRemove', 'setAuthSettings', 'exitOperate', 'emergencyReset',
  'auditQuery', 'auditCsv', 'getStartOptions', 'setStartOptions',
  'textRows', 'setText', 'addLang', 'removeLang', 'setBaseLang', 'setLanguage', 'langState', 'clearTextCopies', 'getBars', 'saveBars', 'viewPage', 'suggestElement', 'setOnline', 'isOnline', 'isDemo', 'getTheme', 'saveTheme', 'getThemePresets', 'saveThemePreset', 'deleteThemePreset',
  'getWebState', 'setWebOptions', 'getBackupState', 'setBackupOptions', 'backupPreview', 'recordsState', 'trendCsvInfo', 'setRetention',
  'symbolsList', 'symbolUpdate', 'symbolRemove'];

let api = null;
let win = null;
let pendingMax = false; // Fenster soll beim ersten Zeigen maximiert werden
let winSt = null;       // gemerkte Fenstergröße (watchWinState)
let fsBusy = false;     // Vollbild wird gerade ein- oder ausgeschaltet: Größenänderungen dabei nicht merken

/**
 * Vollbild ganz nach vorn: Beim Start durch die Windows-Aufgabe gibt Windows dem Fenster oft nicht den Vordergrund,
 * dann bleibt die Taskleiste darüber, bis man einmal auf die Seite tippt. Deshalb liegt das Fenster so lange über
 * allem (auch der Taskleiste), bis es den Vordergrund bekommen hat.
 */
function toFront() {
  if (!win || process.env.E4_UI_CHECK) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.moveTop();
  win.focus();
  const release = () => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); };
  if (win.isFocused()) setTimeout(release, 500);
  else win.once('focus', () => setTimeout(release, 500));
}

/**
 * Fenstergröße merken (Datei fenster.json im Datenordner): beim nächsten Start wie zuletzt; beim allerersten Start
 * maximiert. Wichtig für den Start gleich im Vollbild: Verlässt man den Bedienmodus, kehrt Windows zu diesem Fenster
 * zurück – sonst wäre es das kleine Anfangsfenster.
 */
const winStateFile = () => path.join(app.getPath('userData'), 'fenster.json');
function loadWinState() {
  if (process.env.E4_UI_CHECK) return null;
  try {
    const s = JSON.parse(fs.readFileSync(winStateFile(), 'utf8'));
    const b = s.bounds;
    const ok = b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width >= 900 && b.height >= 600
      && require('electron').screen.getAllDisplays().some((d) => { const a = d.workArea; return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y; });
    return { maximized: s.maximized !== false, bounds: ok ? b : null };
  } catch (e) { return { maximized: true, bounds: null }; }
}
function watchWinState(w, first) {
  if (process.env.E4_UI_CHECK) return;
  const st = { maximized: first ? first.maximized : true, bounds: first && first.bounds };
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { fs.writeFileSync(winStateFile(), `${JSON.stringify(st)}\n`); } catch (e) { /* nicht wichtig */ } }, 500);
  };
  const track = () => {
    if (fsBusy || w.isDestroyed() || w.isFullScreen() || w.isMinimized()) return; // Vollbild und Taskleiste zählen nicht
    st.maximized = w.isMaximized();
    if (!st.maximized) st.bounds = w.getBounds();
    save();
  };
  for (const ev of ['maximize', 'unmaximize', 'resize', 'move']) w.on(ev, track);
  return st;
}

function createWindow() {
  const ws = loadWinState();
  win = new BrowserWindow(Object.assign({
    width: 1320, height: 880, minWidth: 900, minHeight: 600, title: 'easy4Visu', show: false,
    autoHideMenuBar: true, backgroundColor: '#EEF1F4', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  }, ws && ws.bounds ? ws.bounds : {}));
  winSt = watchWinState(win, ws);
  // keine fremden Seiten im Programmfenster
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // maximiert zeigen (maximize() zeigt das Fenster auch an), sonst in der gemerkten Größe. Kommt das Vollbild (Start gleich
  // im Bedienmodus) schon vorher, maximiert es zuerst – sonst hebt ein späteres maximize() das Vollbild wieder auf
  pendingMax = !!(ws && ws.maximized);
  win.once('ready-to-show', () => {
    if (process.env.E4_UI_CHECK) return;
    if (pendingMax) { pendingMax = false; win.maximize(); } else if (!win.isVisible()) win.show();
  });
  // Fenster abgestürzt oder hängt: neu laden (Stufe 1 der Selbstheilung; Stufe 2 = Windows-Aufgabe)
  win.webContents.on('render-process-gone', (e, details) => { if (details.reason !== 'clean-exit' && win && !win.isDestroyed()) win.reload(); });
  let hang = null;
  win.on('unresponsive', () => { clearTimeout(hang); hang = setTimeout(() => { if (win && !win.isDestroyed()) { win.webContents.forcefullyCrashRenderer(); win.reload(); } }, 15000); });
  win.on('responsive', () => clearTimeout(hang));
  // Schließen nur ohne Anmeldung oder als Einrichter; sonst fragt die Oberfläche nach der Anmeldung
  win.on('close', (e) => {
    if (quitting || process.env.E4_UI_CHECK || !api) return;
    if (api.users.active() && api.role() !== 'setup') { e.preventDefault(); send('e4:needLogin', 'quit'); return; }
    // kein Merker „beendet“: X, Alt+F4 oder Task-Manager gelten als Ausfall – mit Autostart kommt easy4Visu
    // nach höchstens 1 Minute wieder. Dauerhaft beenden nur über „easy4Visu beenden“ (app:quit).
    quitting = true;
  });
  win.on('closed', () => { win = null; });
  return win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

// Datei-Dialoge: Variablen-Import (.itf, .csv, .xls, ST-Programm als Textdatei) und CA-Zertifikat für MQTT
async function openFiles(kind) {
  if (process.env.E4_UI_CHECK_FILES) {
    // Prüfung: vorgegebene „Auswahl“; eine Liste wird der Reihe nach abgegeben (erster Dialog, zweiter Dialog …)
    const all = JSON.parse(process.env.E4_UI_CHECK_FILES);
    const pick = all[kind];
    if (!Array.isArray(pick)) return pick || null;
    const next = pick.shift();
    process.env.E4_UI_CHECK_FILES = JSON.stringify(all);
    return next || null;
  }
  if (kind === 'logo') {
    const r = await dialog.showOpenDialog(win, { title: 'Logo wählen', properties: ['openFile'],
      filters: [{ name: 'Bild (PNG, JPG, SVG)', extensions: ['png', 'jpg', 'jpeg', 'svg'] }] });
    return r.canceled ? null : r.filePaths[0];
  }
  if (kind === 'symbolFiles') {
    const r = await dialog.showOpenDialog(win, { title: 'Bilder für „Meine Symbole“', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Bild (PNG, JPG, GIF, WebP, SVG)', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }] });
    return r.canceled ? null : r.filePaths;
  }
  if (kind === 'symbolFolder') {
    const r = await dialog.showOpenDialog(win, { title: 'Ordner mit Bildern für „Meine Symbole“', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  }
  if (kind === 'image') {
    const r = await dialog.showOpenDialog(win, { title: 'Bild wählen', properties: ['openFile'],
      filters: [{ name: 'Bild (PNG, JPG, GIF, WebP, SVG)', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }] });
    return r.canceled ? null : r.filePaths[0];
  }
  if (kind === 'themeImport') {
    const r = await dialog.showOpenDialog(win, { title: 'Farbthema laden', properties: ['openFile'],
      filters: [{ name: 'easy4Visu-Farbthema', extensions: ['json'] }] });
    return r.canceled ? null : r.filePaths[0];
  }
  if (kind === 'textsExport') {
    const r = await dialog.showSaveDialog(win, { title: 'Texttabelle speichern', defaultPath: 'easy4visu-texte.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }, { name: 'CSV (Excel)', extensions: ['csv'] }] });
    return r.canceled ? null : r.filePath;
  }
  if (kind === 'textsImport') {
    const r = await dialog.showOpenDialog(win, { title: 'Texttabelle einlesen', properties: ['openFile'],
      filters: [{ name: 'Excel oder CSV', extensions: ['xlsx', 'csv'] }] });
    return r.canceled ? null : r.filePaths[0];
  }
  if (kind === 'auditExport') {
    const r = await dialog.showSaveDialog(win, { title: 'Bedienprotokoll speichern', defaultPath: `easy4visu-bedienprotokoll-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
    return r.canceled ? null : r.filePath;
  }
  if (kind === 'trendCsv' || kind === 'alarmCsv') {
    const name = kind === 'trendCsv' ? 'trends' : 'meldungen';
    const r = await dialog.showSaveDialog(win, { title: kind === 'trendCsv' ? 'Trends speichern' : 'Meldungsverlauf speichern',
      defaultPath: `easy4visu-${name}-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
    return r.canceled ? null : r.filePath;
  }
  if (kind === 'themeExport') {
    const r = await dialog.showSaveDialog(win, { title: 'Farbthema speichern', defaultPath: 'easy4visu-farbthema.json',
      filters: [{ name: 'easy4Visu-Farbthema', extensions: ['json'] }] });
    return r.canceled ? null : r.filePath;
  }
  if (kind === 'backupSave') {
    const r = await dialog.showSaveDialog(win, { title: 'Projekt sichern', defaultPath: `easy4visu-projekt-${new Date().toISOString().slice(0, 10)}.easy4visu`,
      filters: [{ name: 'easy4Visu-Projekt', extensions: ['easy4visu'] }] });
    return r.canceled ? null : r.filePath;
  }
  if (kind === 'backupOpen') {
    const r = await dialog.showOpenDialog(win, { title: 'Projekt einspielen', properties: ['openFile'], defaultPath: api ? api.getBackupState().folder : undefined,
      filters: [{ name: 'easy4Visu-Projekt', extensions: ['easy4visu'] }] });
    return r.canceled ? null : r.filePaths[0];
  }
  if (kind === 'ca') {
    const r = await dialog.showOpenDialog(win, { title: 'CA-Zertifikat wählen', properties: ['openFile'],
      filters: [{ name: 'Zertifikat', extensions: ['crt', 'pem', 'cer'] }, { name: 'Alle Dateien', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0];
  }
  const r = await dialog.showOpenDialog(win, { title: 'easySoft-Dateien wählen', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'easySoft-Dateien (.itf, .csv, .xls, ST-Programm als .txt)', extensions: ['itf', 'csv', 'xls', 'txt', 'st'] }, { name: 'Alle Dateien', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths.length) return null;
  const files = { itf: null, symbols: [], st: [], comments: [] };
  for (const f of r.filePaths) {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.itf') files.itf = f;
    else if (ext === '.csv') files.symbols.push(f);
    else if (ext === '.xls') files.comments.push(f);
    else files.st.push(f);
  }
  return files;
}

app.whenReady().then(async () => {
  // Passwörter mit der Windows-Verschlüsselung des angemeldeten Benutzers schützen
  const enc = safeStorage.isEncryptionAvailable();
  try {
    const emergency = wantEmergency && isWindowsAdmin();
    if (wantEmergency && !emergency) {
      dialog.showErrorBox('easy4Visu – Notfall-Zugang', 'Der Notfall-Zugang geht nur, wenn easy4Visu als Windows-Administrator gestartet wird (Rechtsklick → „Als Administrator ausführen“).');
    }
    api = new AppApi({
      emergency,
      dir: app.getPath('userData'),
      protect: enc ? (text) => safeStorage.encryptString(text).toString('base64') : null,
      unprotect: enc ? (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64')) : null,
      // Webserver für Handy/Tablet: liefert die Oberfläche aus diesem Ordner aus; E4_WEB_HOST nur für Tests (127.0.0.1)
      webRoot: path.join(__dirname, '..'),
      webHost: process.env.E4_WEB_HOST || null,
      autoBackup: !process.env.E4_UI_CHECK && !wantDemo, // tägliche Sicherung (nicht in der Prüfung, nicht in der Demo)
      demo: wantDemo,
      demoKind: demoTalwerk ? 'talwerk' : (wantDemo ? 'copy' : null),
    });
  } catch (err) {
    dialog.showErrorBox('easy4Visu', `Die gespeicherten Geräte konnten nicht geladen werden:\n${err.message}`);
    app.quit();
    return;
  }
  for (const name of CALLS) ipcMain.handle(`api:${name}`, (e, ...args) => api[name](...args));
  ipcMain.handle('dialog:openFiles', (e, kind) => openFiles(kind));
  // Bedienmodus: echtes Vollbild ohne Fensterrahmen (F11 oder Knopf)
  ipcMain.handle('window:fullscreen', () => {
    if (!win) return false;
    const on = !win.isFullScreen();
    if (on && pendingMax) { pendingMax = false; win.maximize(); } // erst maximieren: nach dem Verlassen wieder groß
    fsBusy = true;
    const done = () => setTimeout(() => { fsBusy = false; }, 300);
    const guard = setTimeout(() => { fsBusy = false; }, 3000);
    // Vollbild verlassen: so groß wie vorher gemerkt – Windows kehrt sonst manchmal zum kleinen Anfangsfenster zurück
    win.once(on ? 'enter-full-screen' : 'leave-full-screen', () => {
      clearTimeout(guard);
      if (!on && winSt && winSt.maximized && win && !win.isDestroyed()) win.maximize();
      done();
    });
    win.setFullScreen(on);
    if (on) toFront();
    else win.setAlwaysOnTop(false);
    return win.isFullScreen();
  });
  // Farbthema: Dateien liest/schreibt nur das Hauptprogramm, nach Auswahl im Datei-Dialog
  ipcMain.handle('theme:pickLogo', async () => { const f = await openFiles('logo'); return f ? api.logoFromFile(f) : null; });
  // „Meine Symbole“: Bilder bzw. ganzen Ordner einlesen (Unterordner = Gruppen); Recht prüft api.symbolsAdd
  ipcMain.handle('symbols:addFiles', async () => {
    const files = await openFiles('symbolFiles');
    return files && files.length ? api.symbolsAdd(files.map((file) => ({ file, group: '' }))) : null;
  });
  ipcMain.handle('symbols:addFolder', async () => {
    const dir = await openFiles('symbolFolder');
    return dir ? api.symbolsAdd(require('../src/core/symbols').scanFolder(dir)) : null;
  });
  ipcMain.handle('pages:pickImage', async () => { const f = await openFiles('image'); return f ? api.addImage(f) : null; });
  protocol.handle('e4img', (req) => {
    const img = api.imageFile(decodeURIComponent(new URL(req.url).pathname.replace(/^\//, '')));
    if (!img) return new Response('', { status: 404 });
    return new Response(fs.readFileSync(img.file), { headers: { 'content-type': img.type, 'cache-control': 'max-age=31536000' } });
  });
  // Bedienprotokoll als CSV: Recht prüft api.auditCsv (nur Einrichter)
  ipcMain.handle('audit:export', async (e, filter) => {
    const csv = api.auditCsv(filter);
    const f = await openFiles('auditExport');
    if (!f) return false;
    fs.writeFileSync(f, csv, 'utf8');
    return true;
  });
  // Kiosk-Betrieb: Autostart (Windows-Aufgabe) und Start-Optionen
  ipcMain.handle('kiosk:get', async () => Object.assign({ autostart: await autostart.isEnabled(), win: process.platform === 'win32' }, api.getStartOptions()));
  ipcMain.handle('kiosk:autostart', async (e, on) => {
    api._need('setup');
    if (wantDemo) throw new Error(require('../src/i18n').t('ui.demo.notInDemo'));
    if (on) await autostart.enable({ exe: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged, dataDir: app.getPath('userData') });
    else await autostart.disable();
    api._log({ kind: 'user', what: require('../src/i18n').t('users.log.autostart', { on: require('../src/i18n').t(on ? 'users.log.yes' : 'users.log.no') }) });
    return autostart.isEnabled();
  });
  // Demo-Modus ein/aus: easy4Visu startet neu (mit bzw. ohne --demo); nur Techniker
  // on: false = beenden, true = mit Kopie des eigenen Projekts, 'talwerk' = mitgeliefertes Demo Talwerk
  ipcMain.handle('demo:set', (e, on) => {
    api._need('setup');
    if (!on && !wantDemo) return false;
    if (on === 'talwerk' && !fs.existsSync(path.join(talwerkDir(), 'pages.json'))) throw new Error(require('../src/i18n').t('ui.demo.musterMissing'));
    if (on && !wantDemo) api._log({ kind: 'user', what: require('../src/i18n').t('ui.demo.logOn') });
    const args = process.argv.slice(1).filter((a) => a !== '--demo' && a !== '--demo-talwerk' && a !== '--autostart');
    if (on) args.push(on === 'talwerk' ? '--demo-talwerk' : '--demo');
    quitting = true;
    app.relaunch({ args });
    app.exit(0);
    return on;
  });
  // Lizenzen: eigene (MIT) und die der mitgelieferten Bausteine (für alle sichtbar, auch ohne Anmeldung)
  // Handbuch (PDF) im Standard-Programm öffnen; im Setup liegt es im Installationsordner
  ipcMain.handle('help:open', async () => {
    const file = app.isPackaged ? path.join(process.resourcesPath, '..', 'easy4Visu-Handbuch.pdf') : path.join(__dirname, '..', 'docs', 'handbuch', 'easy4Visu-Handbuch.pdf');
    if (!fs.existsSync(file)) throw new Error(require('../src/i18n').t('ui.app.helpMissing'));
    if (!process.env.E4_UI_CHECK) { const err = await shell.openPath(file); if (err) throw new Error(err); }
    return file;
  });
  ipcMain.handle('licenses:get', () => {
    // im Setup liegen die Texte im Installationsordner (neben easy4Visu.exe), beim Entwickeln im Projektordner
    const read = (...names) => {
      const dirs = app.isPackaged ? [path.join(process.resourcesPath, '..'), path.join(__dirname, '..')] : [path.join(__dirname, '..')];
      for (const d of dirs) for (const n of names) { try { return fs.readFileSync(path.join(d, n), 'utf8'); } catch (e) { /* nächster Ort */ } }
      return '';
    };
    return { own: read('LICENSE.easy4visu.txt', 'LICENSE'), third: read('LIZENZEN-DRITTER.txt'), version: app.getVersion() };
  });
  ipcMain.handle('app:quit', () => {
    api._need('setup');
    api.logQuit();
    quitting = true;
    autostart.markStopped(app.getPath('userData'));
    app.quit();
    return true;
  });
  // Texttabelle als Excel/CSV (Rechte prüft die Programm-Schnittstelle: nur Einrichter)
  ipcMain.handle('texts:export', async () => {
    const rows = api.exportTexts();
    const f = await openFiles('textsExport');
    if (!f) return false;
    const sheet = require('../src/core/sheet');
    if (/.csv$/i.test(f)) fs.writeFileSync(f, sheet.writeCsv(rows), 'utf8');
    else fs.writeFileSync(f, sheet.writeXlsx(rows, [10, 18, ...rows[0].slice(2).map(() => 45)]));
    return true;
  });
  ipcMain.handle('texts:import', async () => {
    api._need('setup');
    const f = await openFiles('textsImport');
    if (!f) return null;
    const sheet = require('../src/core/sheet');
    const rows = /.csv$/i.test(f) ? sheet.readCsv(fs.readFileSync(f, 'utf8')) : sheet.readXlsx(fs.readFileSync(f));
    return api.importTexts(rows);
  });
  // Aufzeichnungen als CSV: erst die Tabelle bauen (Fehler wie „zu viele Zeilen“ vor dem Dialog), dann speichern
  ipcMain.handle('records:trend', async (e, spec) => {
    const r = api.trendCsv(spec);
    const f = await openFiles('trendCsv');
    if (!f) return null;
    fs.writeFileSync(f, r.csv, 'utf8');
    return { file: path.basename(f), rows: r.rows };
  });
  ipcMain.handle('records:alarms', async (e, spec) => {
    const r = api.alarmCsv(spec);
    const f = await openFiles('alarmCsv');
    if (!f) return null;
    fs.writeFileSync(f, r.csv, 'utf8');
    return { file: path.basename(f), rows: r.rows };
  });
  // Projekt sichern/einspielen (Rechte prüft die Programm-Schnittstelle: nur Einrichter)
  ipcMain.handle('backup:save', async (e, o) => {
    api._need('setup');
    const f = await openFiles('backupSave');
    if (!f) return null;
    return { file: path.basename(f), summary: api.saveBackup(f, o) };
  });
  ipcMain.handle('backup:pick', async () => {
    api._need('setup');
    const f = await openFiles('backupOpen');
    if (!f) return null;
    return { file: f, name: path.basename(f), preview: api.backupPreview(f) };
  });
  ipcMain.handle('backup:restore', async (e, file, o) => {
    const r = await api.restoreBackup(file, o);
    // alles frisch: easy4Visu neu starten (in der Prüfung nur das Fenster neu laden)
    setTimeout(() => {
      if (process.env.E4_UI_CHECK) { if (win && !win.isDestroyed()) win.webContents.reload(); return; }
      quitting = true;
      app.relaunch();
      app.quit();
    }, 1500);
    return r;
  });
  // Neues, leeres Projekt: wie nach dem Einspielen neu starten (dabei werden die alten Aufzeichnungen beiseitegelegt)
  ipcMain.handle('project:new', async (e, o) => {
    const r = await api.newProject(o);
    setTimeout(() => {
      if (process.env.E4_UI_CHECK) { if (win && !win.isDestroyed()) win.webContents.reload(); return; }
      quitting = true;
      app.relaunch();
      app.quit();
    }, 1500);
    return r;
  });
  ipcMain.handle('backup:folder', async () => {
    api._need('setup');
    const dir = api.getBackupState().folder;
    fs.mkdirSync(dir, { recursive: true });
    if (!process.env.E4_UI_CHECK) await shell.openPath(dir);
    return true;
  });
  ipcMain.handle('theme:export', async () => { const f = await openFiles('themeExport'); return f ? api.exportTheme(f) : false; });
  ipcMain.handle('theme:import', async () => { const f = await openFiles('themeImport'); return f ? api.importTheme(f) : null; });
  api.on('values', (b) => send('e4:values', b));
  api.on('deviceState', (s) => send('e4:deviceState', s));
  api.on('deviceError', (s) => send('e4:deviceError', s));
  api.on('online', (on) => send('e4:online', on));
  api.on('seen', (m) => send('e4:seen', m));
  api.on('alarms', (list) => send('e4:alarms', list));
  api.on('auth', (s) => send('e4:auth', s));
  api.on('lang', (s) => send('e4:lang', s));
  api.on('web', (s) => send('e4:web', s));
  api.on('audit', () => send('e4:audit'));
  api.applyWeb().catch(() => {});
  if (api.getStartOptions().connectOnStart || wantDemo) api.autoConnect().catch(() => {}); // Demo: gleich „verbunden“
  await createWindow();
  if (process.env.E4_UI_CHECK) {
    try {
      await require(path.resolve(process.env.E4_UI_CHECK))(win);
      process.exitCode = 0;
    } catch (err) {
      console.error(`UI-Prüfung fehlgeschlagen: ${err.stack || err.message}`);
      process.exitCode = 1;
    }
    app.quit();
  }
});

let stopping = false;
app.on('before-quit', (e) => {
  if (stopping || !api) return;
  e.preventDefault();
  stopping = true;
  api.stop().finally(() => app.exit(process.exitCode || 0));
});
app.on('window-all-closed', () => app.quit());
