'use strict';
/**
 * Oberflächen-Prüfung: startet easy4Visu mit einem leeren Test-Datenordner und dem Modbus-Simulator,
 * klickt sich durch (Gerät anlegen, Verbindung testen, Variablen einlesen, Werte ansehen, Dunkel)
 * und speichert Bildschirmfotos. Echte Geräte und die eigenen Einstellungen bleiben unberührt.
 *
 *   node tools/ui-check.js [Ordner für die Bilder]
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- Aufruf mit node: Electron starten
if (require.main === module) {
  const { spawnSync } = require('node:child_process');
  const electron = require('electron'); // Pfad zur electron.exe
  const shots = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-shots-')));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-uidata-'));
  fs.mkdirSync(shots, { recursive: true });
  const r = spawnSync(electron, [ROOT], {
    stdio: 'inherit', timeout: 300000, // die Prüfung dauert knapp 2 Minuten
    env: Object.assign({}, process.env, { E4_UI_CHECK: __filename, E4_DATA_DIR: data, E4_UI_SHOTS: shots, E4_WEB_HOST: '127.0.0.1' }),
  });
  fs.rmSync(data, { recursive: true, force: true });
  console.log(r.status === 0 ? `UI-Prüfung OK – Bilder in ${shots}` : `UI-Prüfung fehlgeschlagen (Code ${r.status}, ${r.error || ''})`);
  process.exit(r.status === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- im Programm (von app/main.js aufgerufen)
module.exports = async function check(win) {
  const themeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-theme-'));
  const themeFiles = { logo: path.join(themeDir, 'logo.png'), file: path.join(themeDir, 'thema.json') };
  // Bild-Element und Seitenhintergrund: zwei kleine SVG-Bilder
  // Reihenfolge = Reihenfolge der Bild-Dialoge: Wechselbild (Pumpe läuft, Störung), Bild-Element, Seitenhintergrund
  const imgFiles = [path.join(themeDir, 'pumpe-gruen.svg'), path.join(themeDir, 'pumpe-rot.svg'), path.join(themeDir, 'firmenlogo.svg'), path.join(themeDir, 'halle.svg')];
  fs.writeFileSync(imgFiles[1], '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#C0392B"/></svg>');
  fs.writeFileSync(imgFiles[2], '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80"><rect width="240" height="80" rx="12" fill="#2f6f4f"/><text x="120" y="52" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif">LOGO</text></svg>');
  fs.writeFileSync(imgFiles[0], '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#1E7F4F"/></svg>');
  fs.writeFileSync(imgFiles[3], '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#c9d3dc"/><path d="M0 300 L200 120 L400 300 Z" fill="#b3c0cc"/></svg>');
  fs.writeFileSync(themeFiles.logo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVQ4y2Nk+M9Qz0ABYBw1YNSAUQNGDRguBgB8wwQRhP2VZQAAAABJRU5ErkJggg==', 'base64'));
  // „Meine Symbole“: ein Ordner mit einem Bild direkt darin und zwei im Unterordner „Pumpen“
  const symDir = path.join(themeDir, 'symbole');
  fs.mkdirSync(path.join(symDir, 'Pumpen'), { recursive: true });
  fs.writeFileSync(path.join(symDir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" rx="8" fill="#5B4BB7"/></svg>');
  fs.writeFileSync(path.join(symDir, 'Pumpen', 'pumpe-an.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#1E7F4F"/><path d="M50 15 L80 70 L20 70 Z" fill="#fff"/></svg>');
  fs.writeFileSync(path.join(symDir, 'Pumpen', 'pumpe-aus.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#8A939C"/><path d="M50 15 L80 70 L20 70 Z" fill="#fff"/></svg>');
  const sim = await require(path.join(ROOT, 'test', 'sim', 'modbus-sim.js')).start({ port: 0, fw: 246, mwTo: 30 }); // MD20 (MW39/40) nicht freigegeben
  sim.st.MW[3] = 3; // Nachlauf_Soll
  sim.st.MW[1] = 0b10001; // M1, M5
  sim.st.Q[1] = 1;
  const B = (...p) => path.join(ROOT, 'beispiele', ...p);
  process.env.E4_UI_CHECK_FILES = JSON.stringify({
    // erster Dialog: .itf + Symboltabelle (ohne Programm), zweiter Dialog („Weitere Dateien“): das ST-Programm
    import: [
      { itf: B('mqtt-demo', 'easye4_mqtt_demo.itf'), symbols: [B('symbole', 'Symbolische_Namen_easye4_mqtt_demo_Main.csv')], st: [] },
      { itf: null, symbols: [], st: [B('mqtt-demo', 'easye4_mqtt_demo.st')] },
    ],
    // Farbthema: Logo (kleines PNG), Export und Import über dieselbe Datei
    image: imgFiles.slice(), logo: themeFiles.logo, themeExport: themeFiles.file, themeImport: themeFiles.file, auditExport: path.join(themeDir, 'protokoll.csv'), textsExport: path.join(themeDir, 'texte.xlsx'), textsImport: path.join(themeDir, 'texte-import.csv'),
    backupSave: path.join(themeDir, 'projekt.easy4visu'), backupOpen: path.join(themeDir, 'projekt.easy4visu'),
    trendCsv: [path.join(themeDir, 'trend-element.csv'), path.join(themeDir, 'trends.csv')], alarmCsv: path.join(themeDir, 'meldungen.csv'),
    symbolFolder: symDir, symbolFiles: [[path.join(symDir, 'logo.svg')]],
  });
  const shots = process.env.E4_UI_SHOTS;
  let mq = null; // MQTT-Simulator (Broker ohne easyE4)
  const wc = win.webContents;
  // Fehler im Fenster (z. B. fehlende Funktion) mit ausgeben – sonst sieht man nur, dass etwas nicht erscheint
  wc.on('console-message', (ev, level, message) => { if (level >= 2) console.log('Fehler im Fenster:', message); });
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(selector, ms) {
    const end = Date.now() + (ms || 5000);
    while (Date.now() < end) {
      if (await js(`return !!document.querySelector(${JSON.stringify(selector)})`)) return;
      await sleep(100);
    }
    throw new Error(`nicht gefunden: ${selector}`);
  }
  const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type = (field, value) => js(`const el = document.querySelector('[data-field="${field}"]');
    el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true }));`);
  const text = (selector) => js(`const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.textContent : null`);
  async function shot(name) {
    await sleep(300);
    // Chromium meldet beim Foto gelegentlich „UnknownVizError“ (Fenster gerade nicht gezeichnet): kurz warten, nochmal
    let img = null;
    for (let i = 0; !img; i++) {
      try { img = await wc.capturePage(); } catch (e) { if (i >= 2 || !/Viz/.test(e.message)) throw e; await sleep(500); }
    }
    fs.writeFileSync(path.join(shots, `${name}.png`), img.toPNG());
  }
  const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
  const until = async (cond, msg, ms) => {
    const stop = Date.now() + (ms || 4000);
    while (Date.now() < stop) { if (await cond()) return; await sleep(100); }
    throw new Error(msg);
  };

  try {
    win.setSize(1320, 880);
    win.showInactive();
    await waitFor('.shell');
    await js(`localStorage.setItem('easy4visu.theme', 'light'); document.documentElement.dataset.theme = 'light'`);
    await shot('01-leer');
    // Vereinfachung: Menü in Arbeitsschritten (1–5) und „Verwaltung“; „Erste Schritte“ bei leerem Projekt
    const navOrder = await js(`return [...document.querySelectorAll('.sidenav .navitem, .sidenav .navsec')].filter((n) => !n.hidden).map((n) => n.dataset.test || 'verwaltung').join(',')`);
    expect(navOrder === 'nav-devices,nav-variables,nav-editor,nav-pages,nav-alarms,verwaltung,nav-users,nav-texts,nav-web,nav-records,nav-project,nav-options', `Menü-Reihenfolge: ${navOrder}`);
    expect(await js(`return [...document.querySelectorAll('.sidenav .navnum')].map((n) => n.textContent).join('')`) === '12345', 'Menü: Schritte 1–5 nummeriert');
    await waitFor('[data-test="first-steps"]');
    expect(await js(`return document.querySelector('[data-test="first-device"]').classList.contains('next') && document.querySelector('[data-test="first-page"]').disabled`), 'Erste Schritte: Gerät ist dran, Seite noch nicht');

    // Gerät anlegen
    await click('[data-test="add-device"]');
    await waitFor('[role="dialog"]');
    await type('name', 'Anlage NT1');
    await type('host', '127.0.0.1');
    await type('port', String(sim.port));
    await type('interval', '0,5');
    await click('[data-test="test"]');
    await waitFor('[data-test="result"]');
    const result = await text('[data-test="result"]');
    expect(/Verbindung OK – Uhr der easyE4/.test(result), `Verbindungstest: ${result}`);
    await shot('02-geraet-modbus');
    // die anderen Protokolle nur ansehen (dann zurück zu Modbus)
    await click('[data-protocol="json"]');
    await shot('03-geraet-json');
    await click('[data-protocol="mqtt"]');
    await shot('04-geraet-mqtt');
    await click('[data-protocol="modbus"]');
    expect(await js(`return document.querySelector('[data-field="host"]').value`) === '127.0.0.1', 'Eingaben bleiben beim Umschalten erhalten');
    await click('[data-test="save"]');
    await waitFor('[data-device]');
    // Sicherheit: nach Verbindungstest und Speichern ist nichts verbunden – erst nach „Verbinden“
    await sleep(800);
    expect(/nicht verbunden/.test(await text('[data-device] .chip')), 'nach dem Speichern nicht verbunden');
    const reqBefore = sim.st.requests.length;
    await sleep(1200);
    expect(sim.st.requests.length === reqBefore, 'nicht verbunden = keine Abfragen');
    await click('[data-test="online"]');
    await until(async () => /^verbunden$/.test((await text('[data-device] .chip')).trim()), 'Gerät ist verbunden', 5000);
    await until(async () => js(`return document.querySelector('[data-test="online-easye4"]').classList.contains('st-ok')`), 'oben: easyE4 grün');
    await until(async () => /Verbunden/.test(await text('#toast') || ''), 'Meldung „Verbunden“, sobald alles grün ist');
    expect(await js(`return !document.querySelector('[data-test="online-mqtt"]')`), 'ohne MQTT-Gerät kein MQTT-Lämpchen');
    expect((await text('[data-test="online-easye4"]')).trim() === 'easyE4', 'Lämpchen ohne weiteren Text');
    await shot('05-liste');

    // Menü: Geräte → Variablen (eigener Punkt) → Variablen einlesen
    expect(await js(`return [...document.querySelectorAll('.sidenav .navitem .navlabel')].map((b) => b.textContent).join('|')`) === 'Geräte|Variablen|Editor|Bedienseiten|Meldungen|Benutzer|Sprachen|Handy & Tablet|Aufzeichnungen|Projekt|Einstellungen',
      'Menü: Geräte, Variablen, Editor, Bedienseiten, Meldungen, dann Verwaltung');
    await click('[data-test="nav-variables"]');
    await waitFor('[data-test="import"]');
    await click('[data-test="import"]');
    await waitFor('[data-test="apply-import"]');
    expect(/Kein ST-Programm dabei/.test(await text('.panel .warnlist')), 'Hinweis: ST-Programm fehlt');
    await shot('06a-import-ohne-programm');
    await click('[data-test="add-files"]');
    await sleep(500);
    expect(/net|easye4_mqtt_demo\.st/.test(await text('.panel')), 'ST-Programm nachträglich dabei');
    expect(!/Kein ST-Programm dabei/.test(await text('.panel')), 'Hinweis verschwindet');
    expect(/33 Variablen gefunden/.test(await text('.panel .result')), 'Vorschau zeigt 33 Variablen');
    await shot('06-import');
    await click('[data-test="apply-import"]');
    // ab Werk: keine Schnell-Zuordnung, keine automatische Bedienseite
    await waitFor('[data-select-of="T02_Start"]');
    await sleep(300);
    expect(await js(`return !document.querySelector('[data-test="save-assign"]') && !document.querySelector('[data-test="assign"]')`),
      'Schnell-Zuordnung ab Werk aus');
    await click('[data-test="nav-pages"]');
    await waitFor('[data-test="no-pages"]');
    await shot('06e-bedienseiten-leer');
    await click('[data-test="nav-variables"]');
    await waitFor('[data-select-of="T02_Start"]');
    // mehrere Variablen ankreuzen und auf einmal löschen
    const count = () => js(`return document.querySelectorAll('[data-select-of]').length`);
    expect(await count() === 33, 'Liste hat 33 Variablen');
    expect(await js(`return document.querySelector('[data-test="delete-selected"]').disabled`), 'Löschen gesperrt ohne Auswahl');
    for (const n of ['T02_Start', 'T02_Ausgang']) await click(`[data-select-of="${n}"]`);
    expect(/2 ausgewählt/.test(await text('[data-test="sel-info"]')), 'Zähler zeigt 2 ausgewählt');
    await shot('06c-auswahl');
    await js(`window.confirm = () => true; document.querySelector('[data-test="delete-selected"]').click()`);
    const delEnd = Date.now() + 4000;
    while (Date.now() < delEnd && await count() !== 31) await sleep(100);
    expect(await count() === 31, 'zwei Variablen gelöscht');
    // „alle auswählen“ und wieder aufheben (nichts löschen)
    await click('[data-test="select-all"]');
    expect(/31 ausgewählt/.test(await text('[data-test="sel-info"]')), 'alle ausgewählt');
    await click('[data-test="select-all"]');
    expect(await js(`return document.querySelector('[data-test="delete-selected"]').disabled`), 'Auswahl aufgehoben');
    // Suche: blendet Zeilen aus; „alle auswählen“ gilt nur für die Treffer; ohne Treffer ein Hinweis
    const setSearch = (v) => js(`const t = document.querySelector('[data-test="var-list-search"]'); t.value = ${JSON.stringify(v)}; t.dispatchEvent(new Event('input', { bubbles: true }));`);
    const visibleRows = () => js(`return [...document.querySelectorAll('[data-var-row]')].filter((r) => !r.hidden).length`);
    await setSearch('nachlauf');
    const hits = await visibleRows();
    expect(hits > 0 && hits < 31, `Suche „nachlauf“ zeigt nur Treffer (${hits})`);
    await click('[data-test="select-all"]');
    expect(new RegExp(`${hits} ausgewählt`).test(await text('[data-test="sel-info"]')), 'alle auswählen = nur Treffer');
    await click('[data-test="select-all"]');
    await setSearch('gibtsnicht');
    expect(await visibleRows() === 0 && await js(`return !document.querySelector('[data-test="var-nohit"]').hidden`), 'kein Treffer: Hinweis');
    await shot('06d-suche');
    await setSearch('');
    expect(await visibleRows() === 31, 'Suche leer: alle wieder da');
    await click('[data-test="nav-web"]');
    await waitFor('[data-field="web-enabled"]');
    expect(await js(`return document.querySelector('[data-field="web-enabled"]').disabled`), 'Im Netzwerk bereitstellen: ohne Techniker gesperrt');
    await click('[data-test="nav-variables"]');
    await waitFor('[data-test="var-list-search"]');
    // Zusatzfunktionen in den Einstellungen einschalten
    await click('[data-test="nav-options"]');
    await waitFor('[data-field="autoPages"]');
    expect(/Demo mit meinem Projekt starten/.test(await text('[data-test="demo-toggle"]') || ''), 'Einstellungen: Knopf „Demo mit meinem Projekt starten“');
    expect(/Demo Talwerk ausprobieren/.test(await text('[data-test="demo-muster"]') || ''), 'Einstellungen: Knopf „Demo Talwerk ausprobieren“');
    expect(!(await js(`return !!document.getElementById('demoband')`)), 'ohne Demo: kein Band');
    // „Mit Windows starten“ (Test-Aufgabe easy4Visu-Test): Hinweis „Ja, alles einschalten“, danach alles wieder aus
    if (process.platform === 'win32' && process.env.E4_TASK_NAME) {
      await click('[data-field="autostart"]');
      await waitFor('[data-test="kiosk-all"]', 15000);
      await sleep(200);
      await shot('06e-alles-einschalten');
      await click('[data-test="kiosk-all-on"]');
      await until(() => js(`return !document.querySelector('[data-test="kiosk-all"]') && document.querySelector('[data-field="connectOnStart"]').checked && document.querySelector('[data-field="startOperate"]').checked`), '„Ja, alles einschalten“: verbinden und Bedienmodus an');
      for (const k of ['startOperate', 'connectOnStart', 'autostart']) {
        await click(`[data-field="${k}"]`);
        await until(() => js(`return !document.querySelector('[data-field="${k}"]').checked`), `${k} wieder aus`, 15000);
      }
      expect(!(await js(`return !!document.querySelector('[data-test="kiosk-all"]')`)), 'beim Ausschalten kein Hinweis');
    }
    await shot('06d-einstellungen');
    await click('[data-field="autoPages"]');
    await click('[data-field="quickAssign"]');
    await click('[data-field="commissioning"]');
    await click('[data-test="close-options"]');
    await waitFor('[data-test="assign"]');
    // „Uhr Ein“ (M3) wechselt laufend – wie ein Merker, den die Steuerung schreibt
    const blink = setInterval(() => { sim.st.MW[1] ^= 0b100; }, 700); // nicht im Takt der Abfrage (0,5 s)
    await click('[data-test="assign"]');
    await waitFor('[data-test="save-assign"]');
    const assignEnd = Date.now() + 8000;
    while (Date.now() < assignEnd && !/ändert sich/.test(await text('[data-assign-of="Uhr_Ein"]') || '')) await sleep(200);
    clearInterval(blink);
    sim.st.MW[1] &= ~0b100;
    expect(/ändert sich/.test(await text('[data-assign-of="Uhr_Ein"]')), 'Hinweis „ändert sich“ bei Uhr Ein');
    expect(await js(`return document.querySelector('[data-test="use-Fern_Ein-control"]').classList.contains('on')`), 'Fern Ein vorbelegt mit Bedienung (aus dem Programm)');
    await shot('06b-schnell-zuordnung');
    await click('[data-test="use-Uhr_Ein-hide"]');
    await click('[data-test="save-assign"]');
    await waitFor('[data-value-of="Nachlauf_Soll"]');
    await sleep(1500); // Werte kommen
    expect(await js(`return !document.querySelector('[data-test="save-assign"]')`), 'Zuordnung gespeichert und geschlossen');
    const soll = await text('[data-value-of="Nachlauf_Soll"]');
    expect(soll === '3', `Nachlauf_Soll zeigt ${soll}`);
    expect((await text('[data-value-of="Anlage"]')) === 'EIN', 'Anlage (Q1) = EIN');
    const md20 = await text('[data-value-of="Nachlauf_geprueft"]');
    expect(/nicht freigegeben/.test(md20), `MD20 zeigt den Grund: ${md20}`);
    await shot('07-variablen');
    // Filter „mit Namen“: Merker M2 (nur Operand) fehlt, Fern Ein ist dabei
    await js(`[...document.querySelectorAll('.listbar .seg button')][1].click()`);
    await waitFor('[data-select-of="Fern_Ein"]');
    expect(await js(`return !document.querySelector('[data-select-of="M2"]')`), 'Filter „mit Namen“ blendet M2 aus');
    await js(`[...document.querySelectorAll('.listbar .seg button')][0].click()`);
    await waitFor('[data-select-of="M2"]');
    // Wert ändert sich im Gerät -> Anzeige folgt
    sim.st.MW[3] = 42;
    await sleep(1500);
    expect((await text('[data-value-of="Nachlauf_Soll"]')) === '42', 'Live-Wert aktualisiert');

    // Variable von Hand anlegen
    await click('[data-test="add-var"]');
    await waitFor('[data-test="save-var"]');
    await type('operand', 'MW9');
    await type('varname', 'Testwert');
    await type('unit', 'bar');
    await js(`const s = document.querySelector('[data-field="role"]'); s.value = 'display'; s.dispatchEvent(new Event('change', { bubbles: true }));`);
    // Umrechnung: Rohwert 0 … 1000 = 0 … 10 bar, eine Nachkommastelle
    expect(await js(`return !!document.querySelector('[data-test="var-scale"]')`), 'Umrechnung im Variablen-Dialog');
    await type('scale-raw0', '0'); await type('scale-val0', '0'); await type('scale-raw1', '1000'); await type('scale-val1', '10'); await type('decimals', '1');
    await shot('08-variable-von-hand');
    await click('[data-test="save-var"]');
    await waitFor('[data-value-of="Testwert"]');
    sim.st.MW[9] = 250;
    await until(async () => (await text('[data-value-of="Testwert"]')) === '2,5', 'Variablenliste zeigt umgerechneten Wert 2,5');
    sim.st.MW[9] = 237;
    await until(async () => (await text('[data-value-of="Testwert"]')) === '2,4', 'Variablenliste rundet auf 1 Nachkommastelle (2,37 → 2,4)');
    sim.st.MW[9] = 17;

    // Bedienseite
    await click('[data-test="nav-pages"]');
    await waitFor('[data-el-of="Fern_Ein"]');
    await sleep(800);
    await shot('09-bedienseite');
    // Schalter: Fern_Ein (M5) ist EIN -> aus
    await click('[data-test="switch-Fern_Ein"]');
    await until(() => (sim.st.MW[1] & 0x10) === 0, 'Schalter Fern_Ein schreibt M5 = 0');
    await until(async () => /übernommen/.test(await text('[data-el-of="Fern_Ein"] .feedback') || ''), 'Rückmeldung „übernommen“');
    // Plus dreimal schnell: nur EIN Schreibbefehl mit dem letzten Wert
    const before = sim.st.requests.length;
    for (let i = 0; i < 3; i++) await click('[data-test="plus-Nachlauf_Soll"]');
    expect(sim.st.MW[3] === 42, 'Plus sendet nicht sofort');
    await until(() => sim.st.MW[3] === 45, `Nachlauf_Soll nach 3× Plus: ${sim.st.MW[3]}`, 3000);
    const writesMW3 = sim.st.requests.slice(before).filter((q) => (q.fc === 6 || q.fc === 16) && q.addr === 46003).length;
    expect(writesMW3 === 1, `3× Plus = 1 Schreibbefehl (waren ${writesMW3})`);
    // Eintippen + Enter
    await js(`const el = document.querySelector('[data-test="setpoint-Nachlauf_Soll"]'); el.focus(); el.value = '120';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
    await until(() => sim.st.MW[3] === 120, `Nachlauf_Soll eingetippt: ${sim.st.MW[3]}`);
    // gleich danach weitertippen: der Abschluss der Bestätigung (nach ~2,5 s) darf das Getippte nicht ersetzen
    await js(`const el = document.querySelector('[data-test="setpoint-Nachlauf_Soll"]'); el.focus(); el.value = '99';
      el.dispatchEvent(new Event('input', { bubbles: true })); return true`);
    await sleep(3500);
    expect(await js(`const el = document.querySelector('[data-test="setpoint-Nachlauf_Soll"]'); return el.value === '99' && el.dataset.dirty === '1' && document.activeElement === el`),
      'Sollwert: Getipptes bleibt stehen, Cursor bleibt im Feld');
    await js(`document.querySelector('[data-test="setpoint-Nachlauf_Soll"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true`);
    await until(() => js(`return document.querySelector('[data-test="setpoint-Nachlauf_Soll"]').value === '120'`), 'Esc: wieder der Wert der easyE4');
    expect(sim.st.MW[3] === 120, 'nichts gesendet');
    // Taster (Impuls): Zaehler_Reset (M7) -> 1
    await click('[data-test="button-Zaehler_Reset"]');
    await until(() => (sim.st.MW[1] & 0x40) !== 0, 'Taster Zaehler_Reset schreibt M7 = 1');
    await until(() => js(`return document.querySelector('[data-test="button-Zaehler_Reset"]').dataset.sent === 'true'`), 'Taster: gesendet', 2000);
    expect(!(await js(`return !!document.querySelector('[data-test="button-Zaehler_Reset"] .pressst')`)), 'Taster: kein Kreis und kein Haken mehr');
    await sleep(600);
    await shot('10-bedient');

    // ---------------------------------------------------------------- Editor
    // Ziehen & Ablegen wie mit der Maus (dieselben Ereignisse, die Electron beim Ziehen schickt)
    const dnd = (src, dst) => js(`const dt = new DataTransfer();
      const s = document.querySelector(${JSON.stringify(src)}), d = document.querySelector(${JSON.stringify(dst)});
      if (!s || !d) throw new Error('Ziehen: ' + (!s ? ${JSON.stringify(src)} : ${JSON.stringify(dst)}));
      s.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      d.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      d.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      s.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));`);
    const countOf = (sel) => js(`return document.querySelectorAll(${JSON.stringify(sel)}).length`);
    await click('[data-test="nav-editor"]');
    await waitFor('.editor [data-test="drop-new"]');
    await shot('20-editor-leer');
    await click('[data-test="panel-variables"]');
    await waitFor('[data-var="Fern_Ein"]');
    // Elemente liegen frei auf der Seite (Umbau 31.10.2026): Variable an eine Stelle der Seite ziehen (in Bildpunkten der Seite)
    const item = (name) => `#edcanvas [data-item]:has([data-el-of="${name}"])`;
    const itemIdOf = (name) => js(`const n = document.querySelector(${JSON.stringify(item(name))}); return n ? n.dataset.item : null`);
    const geo = (sel) => js(`const n = document.querySelector(${JSON.stringify(sel)}); return n ? ['left', 'top', 'width', 'height'].map((k) => parseFloat(n.style[k])).join(',') : ''`);
    const dropAt = (src, px, py) => js(`const dt = new DataTransfer(); const s = document.querySelector(${JSON.stringify(src)}); const g = document.querySelector('#edcanvas .freegrid');
      if (!s) throw new Error('Ziehen: ' + ${JSON.stringify(src)});
      const r = g.getBoundingClientRect(); const z = parseFloat(g.style.zoom) || 1; const x = r.left + ${px} * z + 1, y = r.top + ${py} * z + 1;
      s.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      g.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      g.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
      s.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));`);
    const zoom = await js(`return parseFloat(document.querySelector('#edcanvas .freegrid').style.zoom) || 1`);
    // Zeiger ziehen: an (fx, fy) relativ zum Element (0 … 1) anfassen, um dx/dy Bildpunkte der Seite bewegen, loslassen
    const pointerDrag = (sel, dx, dy, fx, fy) => js(`const g = document.querySelector(${JSON.stringify(sel)}); const r = g.getBoundingClientRect();
      const x = r.left + r.width * ${fx === undefined ? 0.5 : fx}, y = r.top + r.height * ${fy === undefined ? 0.5 : fy};
      g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + ${dx} * ${zoom} / 2, clientY: y + ${dy} * ${zoom} / 2 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + ${dx} * ${zoom}, clientY: y + ${dy} * ${zoom} }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + ${dx} * ${zoom}, clientY: y + ${dy} * ${zoom} }));`);
    const selectPage = () => js(`document.querySelector('#edcanvas .freegrid').click()`);
    await dropAt('[data-var="Fern_Ein"]', 40, 40);
    await waitFor(`${item('Fern_Ein')} .el-switch`);
    expect((await geo(item('Fern_Ein'))) === '40,40,240,50', `Schalter genau an der Stelle, Standardgröße: ${await geo(item('Fern_Ein'))}`);
    await dropAt('[data-var="Nachlauf_Soll"]', 40, 110);
    await waitFor(`${item('Nachlauf_Soll')} .el-setpoint`);
    await dropAt('[data-var="Anlage"]', 43, 252);
    await waitFor(`${item('Anlage')} .el-lamp`);
    expect((await geo(item('Anlage'))).startsWith('40,250,'), `rastet im 10er-Raster ein: ${await geo(item('Anlage'))}`);
    // Text aus der Bibliothek per Klick: landet auf einem freien Platz; Text eintippen, dann genau hinlegen (Platz eintippen)
    await click('[data-test="panel-elements"]');
    await selectPage();
    await click('[data-lib="text"]');
    await waitFor('[data-prop="text"]');
    await js(`const t = document.querySelector('[data-prop="text"]'); t.value = 'Pumpe läuft'; t.dispatchEvent(new Event('input', { bubbles: true }));`);
    await click('[data-test="align-center"]');
    await waitFor('.eltext.align-center');
    await until(async () => /Pumpe läuft/.test(await text('#edcanvas') || ''), 'Text erscheint auf der Seite');
    const geoField = (k, v) => js(`const i = document.querySelector('[data-test="geom-${k}"]'); i.value = '${v}'; i.dispatchEvent(new Event('change', { bubbles: true }))`);
    await geoField('x', 400);
    await until(async () => (await geo('#edcanvas [data-item]:has(.el-text)')).startsWith('400,'), 'Text: Platz eingetippt');
    // Rahmen „Pumpe“ um die drei Elemente: an (20, 20) ziehen, Überschrift, Höhe 300
    await dropAt('[data-lib="frame"]', 20, 20);
    await waitFor('[data-prop="frame-title"]');
    await js(`const t = document.querySelector('[data-prop="frame-title"]'); t.value = 'Pumpe'; t.dispatchEvent(new Event('input', { bubbles: true }));`);
    await geoField('h', 300);
    const frameSel = '#edcanvas [data-item].isframe';
    await until(async () => (await geo(frameSel)) === '20,20,320,300', `Rahmen 320 × 300 an (20, 20): ${await geo(frameSel)}`);
    expect(/Pumpe/.test(await text(`${frameSel} .frametitle`)), 'Rahmen mit Überschrift');
    // „Nur Überschrift“: im Editor gestrichelt sichtbar, auch wenn nicht gewählt; Überschrift in derselben Schrift
    const fontLine = await js(`return getComputedStyle(document.querySelector('${frameSel} .frametitle')).fontFamily`);
    const titlePos = () => js(`const t = document.querySelector('${frameSel} .frametitle').getBoundingClientRect(); const f = document.querySelector(frameSel).getBoundingClientRect(); return Math.round(t.left - f.left) + ',' + Math.round(t.top - f.top)`.replace('frameSel', JSON.stringify(frameSel)));
    const posLine = await titlePos();
    await click('[data-test="look-title"]');
    await selectPage();
    const titleFont = () => js(`return getComputedStyle(document.querySelector('${frameSel} .frametitle')).fontFamily`);
    await until(() => js(`const f = document.querySelector('${frameSel} > .frame'); return f.classList.contains('look-title') && getComputedStyle(f).outlineStyle === 'dashed'`), 'Rahmen „Nur Überschrift“ im Editor gestrichelt');
    const fontTitle = await titleFont();
    expect(fontTitle === fontLine, `Überschrift gleiche Schrift: ${fontLine} / ${fontTitle}`);
    expect((await titlePos()) === posLine, `Überschrift bleibt an ihrem Platz: ${posLine} / ${await titlePos()}`);
    await click('[data-test="undo"]');
    await click(frameSel);
    await shot('21-editor-rahmen');
    // Vereinfachung: 8 Elemente vorne, der Rest unter „Weitere Elemente“; Schriftgröße/Platz unter „Mehr Einstellungen“; ⓘ
    expect(await js(`return [...document.querySelectorAll('.edlib > div > .liblist > .libitem')].map((n) => n.dataset.lib).join()`) === 'number,lamp,switch,button,setpoint,simage,text,bar', 'Elementliste: die 8 häufigsten vorne');
    expect(await js(`return document.querySelectorAll('[data-test="lib-more"] .libitem').length`) === 12, 'Elementliste: 12 unter „Weitere Elemente“');
    expect(await js(`return !!document.querySelector('[data-test="more-settings"] [data-test="geom-x"]') && !!document.querySelector('[data-test="more-settings"] [data-test="font-100"]')`), 'Platz und Schriftgröße unter „Mehr Einstellungen“');
    const info = await js(`const b = document.querySelector('.edprops .infobtn'); if (!b) return 'kein ⓘ'; const r = b.parentElement.querySelector('.hintmore'); const was = r.hidden; b.click(); return was && !r.hidden ? 'ok' : 'klappt nicht auf'`);
    expect(info === 'ok', `ⓘ klappt den Rest des Hinweises auf: ${info}`);
    // Größe an der Ecke ziehen (+30 Bildpunkte breit), dann rückgängig
    const fernId = await itemIdOf('Fern_Ein');
    await click(item('Fern_Ein'));
    await pointerDrag(`[data-resize-of="${fernId}"]`, 30, 0, 0.5, 0.5);
    await until(async () => (await geo(item('Fern_Ein'))) === '40,40,270,50', `Breite an der Ecke gezogen: ${await geo(item('Fern_Ein'))}`);
    await click('[data-test="undo"]');
    await until(async () => (await geo(item('Fern_Ein'))) === '40,40,240,50', 'Größe rückgängig');
    // Rahmen verschieben: der Inhalt wandert mit; rückgängig
    await pointerDrag(frameSel, 0, 400, 0.9, 0.95);
    await until(async () => (await geo(frameSel)).startsWith('20,420,') && (await geo(item('Fern_Ein'))).startsWith('40,440,'), `Rahmen samt Inhalt verschoben: ${await geo(frameSel)} / ${await geo(item('Fern_Ein'))}`);
    expect((await geo('#edcanvas [data-item]:has(.el-text)')).startsWith('400,'), 'Text außerhalb des Rahmens bleibt');
    await shot('21a-rahmen-verschieben');
    await click('[data-test="undo"]');
    await until(async () => (await geo(frameSel)).startsWith('20,20,'), 'Verschieben rückgängig');
    // Rahmen halb unter ein anderes Element (Text) geschoben: geht nicht, springt zurück (Inhalt selbst stößt nirgends an)
    const [tx, ty] = (await geo('#edcanvas [data-item]:has(.el-text)')).split(',').map(Number);
    const fy = Math.max(0, ty - 100);
    await pointerDrag(frameSel, tx - 290 - 20, fy - 20, 0.9, 0.95);
    await until(async () => (await geo(frameSel)).startsWith('20,20,'), `Rahmen halb über einem Element: zurück ${await geo(frameSel)}`);
    await until(async () => /schon ein Element/.test(await text('#toast') || ''), 'Hinweis beim Rahmen „Dort liegt schon ein Element“');
    // Statusbild (200 × 150) nahe am Rand in einen leeren Rahmen gezogen: wird ganz hineingeschoben und gehört dazu
    const framesNow = await countOf('#edcanvas [data-item].isframe');
    await dropAt('[data-lib="frame"]', 600, 400);
    await until(async () => (await countOf('#edcanvas [data-item].isframe')) === framesNow + 1, 'zweiter Rahmen');
    const f2 = await js(`const n = [...document.querySelectorAll('#edcanvas [data-item].isframe')].find((x) => x.style.left === '600px'); return n ? n.dataset.item : ''`);
    expect(!!f2, 'zweiter Rahmen bei 600');
    const beforeImg = await countOf('#edcanvas [data-item]');
    await dropAt('[data-lib="simage"]', 880, 580);
    await until(async () => (await countOf('#edcanvas [data-item]')) === beforeImg + 1, 'Statusbild im Rahmen abgelegt');
    const inF = await js(`const f = document.querySelector('[data-item="${f2}"]'); const i = [...document.querySelectorAll('#edcanvas [data-item]')].find((x) => x.querySelector('.el-image') && parseInt(x.style.left) >= 600);
      if (!i) return 'kein Bild'; const n = (x, k) => parseInt(x.style[k]);
      return n(i, 'left') >= n(f, 'left') && n(i, 'top') >= n(f, 'top') && n(i, 'left') + n(i, 'width') <= n(f, 'left') + n(f, 'width') && n(i, 'top') + n(i, 'height') <= n(f, 'top') + n(f, 'height') ? 'ok' : [i.style.cssText, f.style.cssText].join(' / ')`);
    expect(inF === 'ok', `Statusbild ganz im Rahmen: ${inF}`);
    await click(`[data-item="${f2}"]`);
    await js(`window.confirm = () => true; document.querySelector('[data-test="delete-sel"]').click()`);
    await until(async () => (await countOf('#edcanvas [data-item]')) === beforeImg - 1, 'Rahmen samt Statusbild gelöscht');
    // auf ein anderes Element ziehen: geht nicht, springt zurück (Elemente überdecken sich nie)
    const undoBefore = await js(`return document.querySelector('[data-test="undo"]').disabled`);
    await pointerDrag(item('Anlage'), 0, -200, 0.5, 0.5);
    await until(async () => (await geo(item('Anlage'))).startsWith('40,250,'), `auf ein Element gezogen: zurück ${await geo(item('Anlage'))}`);
    await until(async () => /schon ein Element/.test(await text('#toast') || ''), 'Hinweis „Dort liegt schon ein Element“');
    expect(undoBefore === await js(`return document.querySelector('[data-test="undo"]').disabled`), 'kein Schritt „Rückgängig“ dazu');
    // Klick in der Elementliste, während ein Element im Rahmen gewählt ist: neues Element auf eine leere Stelle, nicht in den Rahmen
    await click(item('Fern_Ein'));
    const before8 = await countOf('#edcanvas [data-item]');
    await click('[data-test="panel-elements"]');
    await click('[data-lib="lamp"]');
    await until(async () => (await countOf('#edcanvas [data-item]')) === before8 + 1, 'Statusleuchte per Klick angelegt');
    const g8 = (await geo('#edcanvas [data-item].sel')).split(',').map(Number);
    const f8 = (await geo(frameSel)).split(',').map(Number);
    const r8 = await js(`const n = document.querySelector('#edcanvas [data-item].sel'); return [...document.querySelectorAll('#edcanvas [data-item]:not(.isframe)')].filter((o) => o !== n).some((o) => { const a = n.getBoundingClientRect(), b = o.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })`);
    expect(!(g8[0] >= f8[0] && g8[1] >= f8[1] && g8[0] + g8[2] <= f8[0] + f8[2] && g8[1] + g8[3] <= f8[1] + f8[3]) && !r8, `neues Element außerhalb des Rahmens, auf leerer Stelle: ${g8} / Rahmen ${f8}`);
    await click('[data-test="delete-sel"]');
    await until(async () => (await countOf('#edcanvas [data-item]')) === before8, 'Statusleuchte wieder gelöscht');
    await click('[data-test="panel-variables"]');
    // Hilfslinie: Element neben den Rahmen auf die Höhe des Schalters ziehen – rote Linie, rastet bündig ein
    await click('[data-test="panel-variables"]');
    await dropAt('[data-var="Uhr_Ein"]', 800, 300);
    await waitFor(item('Uhr_Ein'));
    const guideSeen = await js(`const n = document.querySelector(${JSON.stringify(item('Uhr_Ein'))}); const r = n.getBoundingClientRect(); const z = ${zoom};
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y - 258 * z }));
      const seen = !!document.querySelector('#edcanvas [data-test="guide"]');
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y - 258 * z }));
      return seen`);
    expect(guideSeen, 'rote Hilfslinie beim bündigen Ziehen');
    await until(async () => (await geo(item('Uhr_Ein'))).startsWith('800,40,'), `bündig mit dem Schalter oben: ${await geo(item('Uhr_Ein'))}`);
    expect(await js(`return !document.querySelector('#edcanvas [data-test="guide"]')`), 'Hilfslinie nach dem Loslassen weg');
    // einzelnes Element löschen, rückgängig; dann Ablegen und Verschieben zurücknehmen
    const itemsBefore = await countOf('#edcanvas [data-item]');
    await click(item('Uhr_Ein'));
    await click('[data-test="delete-sel"]');
    await until(async () => (await countOf('#edcanvas [data-item]')) === itemsBefore - 1, 'Element gelöscht');
    await click('[data-test="undo"]');
    await until(async () => (await countOf('#edcanvas [data-item]')) === itemsBefore, 'Löschen rückgängig');
    await click('[data-test="undo"]');
    await click('[data-test="undo"]');
    await until(async () => !(await js(`return !!document.querySelector(${JSON.stringify(item('Uhr_Ein'))})`)), 'Uhr Ein wieder weg');
    // mehrere Elemente: Schalter wählen, Statusleuchte dazu (Strg+Klick), rechts ausrichten, Pfeiltaste, rückgängig
    await click(item('Fern_Ein'));
    await js(`document.querySelector(${JSON.stringify(item('Anlage'))}).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
    await waitFor('[data-test="align-right"]');
    expect(/2 Elemente/.test(await text('.edprops h2')), 'zwei Elemente ausgewählt');
    expect((await countOf('#edcanvas [data-item].sel')) === 2, 'beide markiert');
    await click('[data-test="align-right"]');
    await until(async () => (await geo(item('Anlage'))).startsWith('80,250,'), `rechts ausgerichtet: ${await geo(item('Anlage'))}`);
    await js(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    await until(async () => (await geo(item('Anlage'))).startsWith('80,260,') && (await geo(item('Fern_Ein'))).startsWith('40,50,'), 'Pfeiltaste: beide 10 Bildpunkte tiefer');
    await shot('21b-mehrere-elemente');
    await click('[data-test="undo"]');
    await click('[data-test="undo"]');
    await until(async () => (await geo(item('Anlage'))).startsWith('40,250,'), 'Mehrfachauswahl rückgängig');
    // untereinander stehende Elemente oben/unten ausrichten: sie bleiben ein Stapel, nichts liegt übereinander (Test D2)
    await click(item('Fern_Ein'));
    await js(`document.querySelector(${JSON.stringify(item('Anlage'))}).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
    await waitFor('[data-test="align-top"]');
    await click('[data-test="align-top"]');
    await sleep(400);
    await click('[data-test="align-bottom"]');
    await sleep(400);
    expect((await geo(item('Anlage'))).startsWith('40,250,') && (await geo(item('Fern_Ein'))).startsWith('40,40,'), `Stapel bleibt beim Ausrichten: ${await geo(item('Fern_Ein'))} / ${await geo(item('Anlage'))}`);
    // weit nach unten ziehen: bleibt auf dem Bildschirm (nicht unter der Leiste), dann rückgängig
    await selectPage();
    await pointerDrag(item('Anlage'), 0, 3000, 0.5, 0.5);
    const low = (await geo(item('Anlage'))).split(',').map(Number);
    const screenH = Number(await js(`return document.querySelector('#edcanvas .freegrid').dataset.h`));
    expect(low[1] > 250 && low[1] + low[3] <= screenH, `bleibt auf dem Bildschirm: ${low} (Höhe ${screenH})`);
    await click('[data-test="undo"]');
    await until(async () => (await geo(item('Anlage'))).startsWith('40,250,'), 'nach unten ziehen rückgängig');
    // Rahmen aufziehen über die ganze Seite: alle gewählt
    await js(`const g = document.querySelector('#edcanvas .freegrid'); const r = g.getBoundingClientRect();
      g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.right - 4, clientY: r.bottom - 4 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 2, clientY: r.top + 2 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 2, clientY: r.top + 2 }));`);
    await until(async () => (await countOf('#edcanvas [data-item].sel')) === itemsBefore - 1, `Rahmen aufziehen wählt alles: ${await countOf('#edcanvas [data-item].sel')}`);
    await selectPage();
    // Darstellung ändern: Schalter -> Statusleuchte, rückgängig
    await click(item('Fern_Ein'));
    await waitFor('[data-test="kind-lamp"]');
    await click('[data-test="kind-lamp"]');
    await waitFor('.edel .el-lamp[data-el-of="Fern_Ein"]');
    await click('[data-test="undo"]');
    await waitFor('.edel .el-switch[data-el-of="Fern_Ein"]');
    // Kopieren und Löschen
    const before2 = await countOf('[data-edit-el]');
    await click(item('Fern_Ein'));
    await click('[data-test="duplicate"]');
    await until(async () => (await countOf('[data-edit-el]')) === before2 + 1, 'Element kopiert');
    await click('[data-test="delete-sel"]');
    await until(async () => (await countOf('[data-edit-el]')) === before2, 'Element gelöscht');
    // Schalter aus der Bibliothek, dann einen Eingang wählen: nur Anzeige möglich -> still als Statusmeldung, ohne Warnkasten
    await click('[data-test="panel-elements"]');
    await selectPage();
    await click('[data-lib="switch"]');
    await waitFor('[data-prop="variable"]');
    await js(`const s = document.querySelector('[data-prop="variable"]'); const o = [...s.options].find((x) => x.value.endsWith('|Hand_Ein'));
      if (!/nur Anzeige/.test(o.textContent)) throw new Error('Eingang nicht als „nur Anzeige“ markiert');
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));`);
    await waitFor('.edel .el-lamp[data-el-of="Hand_Ein"]');
    expect(await countOf('[data-test="only-display"]') === 0, 'kein Warnkasten „nur anzeigen“');
    await click('[data-test="delete-sel"]');
    await until(async () => (await countOf('[data-el-of="Hand_Ein"]')) === 0, 'Statusleuchte Hand Ein gelöscht');
    // Live-Wert im Editor
    expect(await js(`return document.querySelector('.edel [data-test="setpoint-Nachlauf_Soll"]').value`) === '120', 'Editor zeigt Live-Wert');
    await selectPage();
    await sleep(300);
    await shot('21-editor');
    // gespeichert?
    await until(async () => (await text('[data-test="save-state"]')) === 'gespeichert', 'Seite gespeichert');
    const saved = await js(`return (await window.e4.listPages())[0]`);
    const savedKinds = saved.items.map((e) => e.kind).join(',');
    expect(saved.name === 'Übersicht' && !saved.cards && saved.items[0].kind === 'frame' && saved.items[0].title === 'Pumpe' && savedKinds === 'frame,switch,setpoint,lamp,text',
      `gespeichert: ${JSON.stringify(saved)}`);
    // ---------------------------------------------------------------- Teil 3b
    const pickVar = (sel, name) => js(`const s = document.querySelector(${JSON.stringify(sel)});
      const o = [...s.options].find((x) => x.value.endsWith('|' + ${JSON.stringify(name)}));
      s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true }));`);
    const typeIn = (sel, value) => js(`const t = document.querySelector(${JSON.stringify(sel)}); t.value = ${JSON.stringify(value)};
      t.dispatchEvent(new Event('input', { bubbles: true }));`);
    const choose = (sel, value) => js(`const t = document.querySelector(${JSON.stringify(sel)}); t.value = ${JSON.stringify(value)};
      t.dispatchEvent(new Event('change', { bubbles: true }));`);
    // Statustext mit Werteliste: Nachlauf Soll (120) im Bereich 100…200 = „hoch“, Warnung
    await selectPage();
    await click('[data-lib="status"]');
    await waitFor('[data-prop="variable"]');
    await pickVar('[data-prop="variable"]', 'Nachlauf_Soll');
    await waitFor('[data-test="state-add"]');
    await click('[data-test="state-add"]');
    await waitFor('[data-test="state-0-from"]');
    await choose('[data-test="state-0-from"]', '100');
    await until(async () => js(`return document.querySelector('[data-test="state-0-from"]').value === '100'`), 'Zustand: Wert 100');
    await choose('[data-test="state-0-to"]', '200');
    await until(async () => js(`return document.querySelector('[data-test="state-0-to"]').value === '200'`), 'Zustand: bis 200');
    await typeIn('[data-test="state-0-text"]', 'hoch');
    await waitFor('[data-test="state-0-color"]');
    await choose('[data-test="state-0-color"]', 'warn');
    await until(async () => js(`const n = document.querySelector('.edel .el-status[data-el-of="Nachlauf_Soll"] .elvalue');
      return !!n && n.textContent === 'hoch' && n.classList.contains('c-warn')`), 'Statustext „hoch“ in Warnfarbe');
    await click('[data-test="symbol-tank"]');
    await waitFor('.edel .el-status[data-el-of="Nachlauf_Soll"] .elsym svg');
    // Text mit Wert: Platzhalter einfügen, Einheit s
    await click('.edel .el-text');
    await js(`document.querySelector('.edel:has(.el-text)').click()`);
    await waitFor('[data-prop="insert-var"]');
    await typeIn('[data-prop="text"]', 'Nachlauf: ');
    await pickVar('[data-prop="insert-var"]', 'Nachlauf_Soll');
    await waitFor('[data-prop="ph-1-unit"]');
    await typeIn('[data-prop="ph-1-unit"]', 's');
    await until(async () => /Nachlauf: 120 s/.test(await text('.edel .el-text') || ''), `Text mit Wert: ${await text('.edel .el-text')}`);
    // Statusmeldung Anlage: Zustände „ein“ / „aus“ sind vorgegeben; ein = „Läuft“ mit Pumpen-Symbol, blinkt
    await js(`document.querySelector('.edel:has(.el-lamp[data-el-of="Anlage"])').click()`);
    await waitFor('[data-test="state-0-text"]');
    expect(await js(`return document.querySelector('[data-test="state-0-bit-1"]').classList.contains('on') && document.querySelector('[data-test="state-1-bit-0"]').classList.contains('on')`),
      'Statusmeldung: Zustände ein / aus vorgegeben');
    await typeIn('[data-test="state-0-text"]', 'Läuft');
    await waitFor('[data-test="state-0-icon"]');
    await choose('[data-test="state-0-icon"]', 'pump');
    await until(async () => js(`const n = document.querySelector('.edel .el-lamp[data-el-of="Anlage"]');
      return !!n && /Läuft/.test(n.textContent) && !!n.querySelector('.elsym svg')`), 'Statusmeldung mit Text und Symbol');
    await js(`document.querySelector('[data-test="state-1-text"]').scrollIntoView({ block: 'center' })`);
    await sleep(300);
    await shot('22b-statusmeldung-zustaende');
    await click('[data-test="state-0-blink"]');
    await until(async () => js(`return !!document.querySelector('.edel .el-lamp[data-el-of="Anlage"] .elrow.blink')`), 'Statusmeldung blinkt');
    await click('[data-test="state-0-blink"]');
    await until(async () => js(`return !document.querySelector('.edel .el-lamp[data-el-of="Anlage"] .elrow.blink')`), 'Statusmeldung blinkt nicht mehr');
    // Schalter als Textknöpfe (danach rückgängig, die Prüfung unten nutzt den Schieber)
    await js(`document.querySelector('.edel:has(.el-switch[data-el-of="Fern_Ein"])').click()`);
    await click('[data-test="style-buttons"]');
    await waitFor('.edel .switchseg');
    await click('[data-test="undo"]');
    await waitFor('.edel [data-test="switch-Fern_Ein"]');
    // Tipptaster auf Automatik Frei (M8)
    await selectPage();
    await click('[data-lib="button"]');
    await waitFor('[data-prop="variable"]');
    await pickVar('[data-prop="variable"]', 'Automatik_Frei');
    await waitFor('[data-test="mode-tip"]');
    await click('[data-test="mode-tip"]');
    await until(async () => js(`return document.querySelector('[data-test="mode-tip"]').classList.contains('on') && !document.querySelector('[data-test="tip-warning"]')`), 'Tippen gewählt, ohne Warnkasten');
    await waitFor('[data-prop="button-fb"]');
    await choose('[data-prop="button-fb"]', await js(`return [...document.querySelector('[data-prop="button-fb"]').options].find((o) => o.value.endsWith('|Anlage')).value`));
    await until(() => js(`return document.querySelector('#edcanvas [data-test="button-Automatik_Frei"]').classList.contains('lit')`), 'Leuchttaster leuchtet (Q1 = 1)');
    // Leuchtfarbe Rot
    await click('[data-test="fbcolor-alarm"]');
    await until(() => js(`const b = document.querySelector('#edcanvas [data-test="button-Automatik_Frei"]'); return b.classList.contains('lit-alarm') && getComputedStyle(b).backgroundColor === 'rgb(217, 58, 58)'`), 'Leuchtfarbe Rot');
    expect(await js(`return document.querySelector('[data-test="fbcolor-alarm"]').getAttribute('aria-checked') === 'true'`), 'Farbe Rot markiert');
    expect(await js(`return document.querySelector('[data-test="littext-white"]').classList.contains('on')`), 'auf Rot: Schrift weiß vorgewählt');
    await click('[data-test="littext-black"]');
    await until(() => js(`return getComputedStyle(document.querySelector('#edcanvas [data-test="button-Automatik_Frei"]')).color === 'rgb(17, 17, 17)'`), 'Schrift beim Leuchten schwarz');
    // Art „rastend“ mit Erklärung, dann zurück auf „tastend“
    await click('[data-test="mode-toggle"]');
    await until(async () => /erster Druck = 1, zweiter Druck = 0/.test(await text('.edprops') || ''), 'rastend: Erklärung');
    await click('[data-test="mode-tip"]');
    await waitFor('[data-test="mode-tip"].on');
    // in der Höhe größer ziehen: der Knopf füllt den Platz
    const btnId = await itemIdOf('Automatik_Frei');
    const btnH0 = await js(`return document.querySelector('#edcanvas [data-test="button-Automatik_Frei"]').getBoundingClientRect().height`);
    await pointerDrag(`[data-resize-of="${btnId}"]`, 0, 60, 0.5, 0.5);
    await until(() => js(`const b = document.querySelector('#edcanvas [data-test="button-Automatik_Frei"]'); const it = b.closest('[data-item]');
      return b.getBoundingClientRect().height > ${btnH0} + 20 && Math.abs(b.getBoundingClientRect().height - it.getBoundingClientRect().height) < 4`), 'Taster in der Höhe gezogen: Knopf füllt den Platz');
    await click('[data-test="undo"]');
    await sleep(300);
    await shot('23-editor-3b');
    // Balken (senkrecht, Skala bis 200), Zeigerinstrument mit gelbem Bereich 100 … 200, Schieberegler – alle auf Nachlauf Soll (120)
    await selectPage();
    await click('[data-lib="bar"]');
    await waitFor('[data-prop="variable"]');
    await pickVar('[data-prop="variable"]', 'Nachlauf_Soll');
    await waitFor('[data-prop="max"]');
    await typeIn('[data-prop="max"]', '200');
    await click('[data-test="orient-v"]');
    await until(async () => js(`const f = document.querySelector('.edel .el-bar .bartrack.v .barfill'); return !!f && parseFloat(f.style.height) === 60`), 'Balken senkrecht bei 60 %')
      .catch(async (err) => { throw new Error(`${err.message}: ${await js(`const n = document.querySelector('.edel .el-bar') || document.querySelector('.edel.sel'); return n ? n.outerHTML.slice(0, 600) : 'kein Balken'`)}`); });
    // Skala mit runden Schritten (0 … 200 → 0, 50, 100, 150, 200 l), Breite „breit“, Wert oben (Entscheidung 46)
    await until(async () => (await js(`return [...document.querySelectorAll('.edel .el-bar .barticks.v .blabel')].map((x) => x.textContent).join('|')`)) === '0 s|50 s|100 s|150 s|200 s',
      'Balken-Skala 0 … 200 in 50er-Schritten, jede Zahl mit Einheit');
    await click('[data-test="barwidth-l"]');
    await click('[data-test="valpos-top"]');
    await until(async () => js(`return !!document.querySelector('.edel .el-bar .bartrack.v.bw-l') && !!document.querySelector('.edel .el-bar .barcol > .barval.top')`), 'Balken breit, Wert oben');
    // wird der Balken dafür zu breit, wächst das Element mit (nichts abgeschnitten)
    await click('[data-test="valpos-side"]');
    await until(async () => js(`const b = document.querySelector('.edel .el-bar'); return !!b && b.scrollWidth <= b.clientWidth + 1`), 'Balken breit + Wert seitlich passt ins Element');
    await click('[data-test="ticks-off"]');
    await until(async () => js(`return !document.querySelector('.edel .el-bar .barticks') && !!document.querySelector('.edel .el-bar .barscale.v')`), 'Skala abgeschaltet');
    await click('[data-test="ticks-on"]');
    await selectPage();
    await click('[data-lib="gauge"]');
    await waitFor('[data-prop="variable"]');
    await pickVar('[data-prop="variable"]', 'Nachlauf_Soll');
    await waitFor('[data-prop="max"]');
    await typeIn('[data-prop="max"]', '200');
    await click('[data-test="map-add"]');
    await waitFor('[data-map="r0-from"]');
    await typeIn('[data-map="r0-from"]', '100');
    await typeIn('[data-map="r0-to"]', '200');
    await choose('[data-map="r0-color"]', 'warn');
    await until(async () => js(`return !!document.querySelector('.edel .el-gauge .gzone.c-warn') && !!document.querySelector('.edel .el-gauge .gneedle.c-warn')`), 'Zeiger im gelben Bereich');
    await until(async () => js(`return document.querySelectorAll('.edel .el-gauge .gtick.major').length >= 5 && [...document.querySelectorAll('.edel .el-gauge .gscale')].some((x) => x.textContent === '100 s')`), 'Zeiger mit Hauptstrichen und Zahlen');
    await click('[data-test="gaugeticks-out"]');
    await until(async () => js(`return !!document.querySelector('.edel .el-gauge .elgauge.tout')`), 'Zeiger: Striche außen');
    // Wert überall gleich groß wie am Zeigerinstrument (Ralf, A1)
    const sizes = await js(`return ['.el-bar .barval .mono', '.el-gauge .gaugeval .mono'].map((q) => getComputedStyle(document.querySelector('.edel ' + q)).fontSize).join('|')`);
    if (sizes !== '26px|26px') throw new Error(`Wertgröße Balken|Zeiger: ${sizes}`);
    await selectPage();
    await click('[data-lib="slider"]');
    await waitFor('[data-prop="variable"]');
    await pickVar('[data-prop="variable"]', 'Nachlauf_Soll');
    await waitFor('[data-prop="max"]');
    await typeIn('[data-prop="max"]', '300');
    await waitFor('.edel [data-test="slider-Nachlauf_Soll"][max="300"]');
    await sleep(300);
    await shot('24-editor-balken-zeiger-regler');
    // Statusbild mit Bit-Variable: „ein“ und „aus“ sind schon vorgegeben, je mit „Bild wählen“
    await selectPage();
    await click('[data-lib="simage"]');
    await waitFor('[data-prop="image-var"]');
    await choose('[data-prop="image-var"]', await js(`return [...document.querySelector('[data-prop="image-var"]').options].find((o) => o.value.endsWith('|Anlage')).value`));
    await until(async () => js(`return !!document.querySelector('[data-test="state-0-bit-1"].on') && !!document.querySelector('[data-test="state-1-bit-0"].on')
      && document.querySelectorAll('.imgthumb.empty').length === 2`), 'Statusbild mit Bit: Zeilen ein / aus mit „Bild wählen“');
    await click('#edcanvas [data-item]:has(.el-image[data-el-of="Anlage"])');
    await click('[data-test="delete-sel"]');
    await until(async () => !(await js(`return !!document.querySelector('#edcanvas .el-image[data-el-of="Anlage"]')`)), 'Statusbild mit Bit wieder entfernt');
    // Statusbild: Variable Nachlauf Soll; bei 100 … 200 die grüne Pumpe, sonst (ohne Grundbild) nichts
    await selectPage();
    await click('[data-lib="simage"]');
    await waitFor('[data-prop="image-var"]');
    await choose('[data-prop="image-var"]', await js(`return [...document.querySelector('[data-prop="image-var"]').options].find((o) => o.value.endsWith('|Nachlauf_Soll')).value`));
    await waitFor('[data-test="state-add"]');
    await click('[data-test="state-add"]');
    await waitFor('[data-test="state-0-pick"]');
    await click('[data-test="state-0-pick"]');
    await waitFor('[data-test="state-0-pick"] img');
    await waitFor('[data-test="state-0-from"]');
    await choose('[data-test="state-0-from"]', '100');
    await waitFor('[data-test="state-0-to"]');
    await choose('[data-test="state-0-to"]', '200');
    const swapImg = () => js(`const n = document.querySelector('#edcanvas .el-image[data-el-of="Nachlauf_Soll"] img'); return n ? n.getAttribute('src') : ''`);
    await until(async () => /e4img/.test(await swapImg()), `Wechselbild: bei ${sim.st.MW[3]} das Bild für 100 … 200`, 5000);
    await sleep(300);
    await shot('24c-wechselbild');
    const mw3 = sim.st.MW[3];
    sim.st.MW[3] = 50;
    await until(async () => (await swapImg()) === '', 'Wechselbild: bei 50 kein Bild (kein Grundbild gewählt)', 5000);
    sim.st.MW[3] = mw3;
    await until(async () => /e4img/.test(await swapImg()), 'Wechselbild: Bild wieder da', 5000);
    // zweite Zeile mit eigener Variable (Anlage = Q1, ist 1) und „blinkt“: unten verliert sie, nach oben geschoben gewinnt sie
    const green = await swapImg();
    const blinks = () => js(`return !!document.querySelector('#edcanvas .el-image.blink[data-el-of="Nachlauf_Soll"]')`);
    await click('[data-test="state-add"]');
    await waitFor('[data-test="state-1-othervar"]');
    expect(!(await js(`return !!document.querySelector('[data-prop="state-1-var"]')`)), 'Zeile ohne eigene Variable: keine Auswahl, nur der Link');
    await click('[data-test="state-1-othervar"]');
    await waitFor('[data-prop="state-1-var"]');
    await choose('[data-prop="state-1-var"]', await js(`return [...document.querySelector('[data-prop="state-1-var"]').options].find((o) => o.value.endsWith('|Anlage')).value`));
    await until(async () => js(`return !!document.querySelector('[data-test="state-1-bit-1"].on')`), 'Bit-Variable: Zustand „ein“ statt Wert');
    await click('[data-test="state-1-pick"]');
    await waitFor('[data-test="state-1-pick"] img');
    await waitFor('[data-test="state-1-blink"]');
    await click('[data-test="state-1-blink"]');
    await sleep(400);
    expect((await swapImg()) === green && !(await blinks()), 'Wechselbild: obere Zeile gewinnt (grün, blinkt nicht)');
    await click('[data-test="state-1-up"]');
    await until(async () => (await swapImg()) !== green && /e4img/.test(await swapImg()) && (await blinks()), 'Wechselbild: Störung oben → rotes Bild, blinkt', 5000);
    expect(await js(`return document.querySelector('[data-prop="state-0-var"]').value.endsWith('|Anlage') && document.querySelector('[data-test="state-0-blink"]').checked`), 'Zeile mit Variable und Häkchen nach oben gewandert');
    await sleep(300);
    await shot('24d-wechselbild-stoerung');
    sim.st.Q[1] = 0;
    await until(async () => (await swapImg()) === green && !(await blinks()), 'Wechselbild: Störung weg → wieder grün, kein Blinken', 5000);
    sim.st.Q[1] = 1;
    await until(async () => blinks(), 'Wechselbild: Störung wieder da', 5000);
    await click('#edcanvas [data-item]:has(.el-image[data-el-of="Nachlauf_Soll"])');
    await click('[data-test="delete-sel"]');
    await until(async () => !(await js(`return !!document.querySelector('#edcanvas .el-image[data-el-of="Nachlauf_Soll"]')`)), 'Wechselbild wieder entfernt');
    // Version 1, Punkt 1: neuer Rahmen (per Klick auf einen freien Platz), darin KPI-Kachel, Betriebsart und Gerätekarte
    const framesBeforeV1 = await countOf('#edcanvas [data-item].isframe');
    await selectPage();
    await click('[data-lib="frame"]');
    await until(async () => (await countOf('#edcanvas [data-item].isframe')) === framesBeforeV1 + 1, 'neuer Rahmen für KPI-Kachel & Co.');
    await click('[data-lib="kpi"]');
    await waitFor('[data-prop="variable"]');
    await pickVar('[data-prop="variable"]', 'Nachlauf_Soll');
    await until(async () => /MW3/.test(await text('.edel .el-kpi .kpiaddr') || ''), 'KPI-Kachel: Zeile mit Operand');
    expect(/120/.test(await text('.edel .el-kpi .kpinum')), 'KPI-Kachel zeigt den Wert');
    await click('[data-lib="choice"]');
    await waitFor('[data-prop="variable"]');
    await pickVar('[data-prop="variable"]', 'Nachlauf_Soll');
    await waitFor('.edel .el-choice .choiceseg');
    expect((await text('.edel .el-choice .choiceseg')).replace(/\s+/g, '') === 'AusHandAutomatik', 'Betriebsart: Aus/Hand/Automatik');
    await click('[data-lib="device"]');
    await waitFor('[data-prop="device"]');
    await js(`const s = document.querySelector('[data-prop="device"]'); s.value = [...s.options].find((o) => o.value).value; s.dispatchEvent(new Event('change', { bubbles: true }));`);
    await until(async () => /MODBUS/.test(await text('.edel .el-device') || ''), 'Gerätekarte zeigt das Protokoll');
    await waitFor('[data-prop="heartbeat"]');
    await choose('[data-prop="heartbeat"]', await js(`return [...document.querySelector('[data-prop="heartbeat"]').options].find((o) => /MW3/.test(o.text)).value`));
    await until(async () => /♥ 120/.test(await text('.edel .el-device') || ''), 'Gerätekarte: Lebenszeichen-Zähler');
    await sleep(300);
    await shot('24b-kennwert-betriebsart-geraet');
    // Trend: Kurve über die Auswahl hinzufügen – Häkchen „aufzeichnen“ setzt sich von selbst
    await click('[data-lib="trend"]');
    await waitFor('[data-prop="trend-add"]');
    await choose('[data-prop="trend-add"]', await js(`return [...document.querySelector('[data-prop="trend-add"]').options].find((o) => o.text.endsWith('(MW3)')).value`));
    await until(async () => js(`const ds = await window.e4.listDevices(); const d = await window.e4.getDevice(ds[0].id);
      return d.variables.find((v) => v.name === 'Nachlauf_Soll').userRecord === true`), 'Trend: „aufzeichnen“ automatisch angehakt');
    await until(async () => /Nachlauf Soll/.test(await text('.edel .el-trend .trendlegend') || ''), 'Trend: Legende mit der Kurve');
    expect(!(await js(`return !!document.querySelector('.edprops .result.warn')`)), 'Trend: kein Hinweis „wird nicht aufgezeichnet“');
    // Meldungsliste
    await click('[data-lib="alarms"]');
    await waitFor('.edel .el-alarms');
    expect(/keine Meldungen/.test(await text('.edel .el-alarms')), 'Meldungsliste: noch keine Meldungen');
    // Ansehen: eigene Seite bedienen
    // Menüleiste einklappen und wieder ausklappen
    await click('[data-test="nav-toggle"]');
    await waitFor('.shell.navmini');
    await sleep(300);
    await shot('24a-menue-eingeklappt');
    // WYSIWYG: Lage und Größe des Schalters „Fern Ein“ auf der Seite (im Verhältnis zur Seitenbreite) im Editor merken
    const layout = (gridSel) => js(`const g = document.querySelector(${JSON.stringify(gridSel)}).getBoundingClientRect(); const s = document.querySelector(${JSON.stringify(gridSel)} + ' [data-el-of="Fern_Ein"]').closest('[data-item]').getBoundingClientRect();
      return { top: (s.top - g.top) / g.width, left: (s.left - g.left) / g.width, w: s.width / g.width, h: s.height / g.width }`);
    await sleep(500);
    const inEditor = await layout('#edcanvas .freegrid');
    // Raster ein/aus; „Hierher ziehen = neue Karte“ nur beim Ziehen sichtbar
    const rasterOn = () => js(`return document.querySelector('#edcanvas .freegrid').classList.contains('raster')`);
    const r0 = await rasterOn();
    await click('[data-test="raster-toggle"]');
    expect((await rasterOn()) === !r0, 'Raster umgeschaltet');
    await click('[data-test="raster-toggle"]');
    expect((await rasterOn()) === r0, 'Raster wieder wie vorher');
    expect(!(await js(`return !!document.querySelector('[data-test="drop-new"]')`)), 'kein großer Hinweis „hierher ziehen“, wenn schon Elemente da sind');
    // Punkte-Raster sichtbar, solange „Raster“ an ist; beim Ziehen zeigt ein gestrichelter Rahmen den Zielplatz
    const dots = () => js(`return getComputedStyle(document.querySelector('#edcanvas .freegrid'), '::before').backgroundImage`);
    expect(r0 && /radial-gradient/.test(await dots()), `Raster an: Punkte sichtbar (${await dots()})`);
    // alle Elemente liegen im 10er-Raster
    const offGrid = await js(`return [...document.querySelectorAll('#edcanvas [data-item]')].filter((n) => ['left', 'top', 'width', 'height'].some((k) => parseFloat(n.style[k]) % 10)).map((n) => n.style.cssText)`);
    expect(offGrid.length === 0, `Elemente außerhalb des Rasters: ${offGrid.join(' | ')}`);
    await click('[data-test="raster-toggle"]');
    expect((await dots()) === 'none', `Raster aus: keine Punkte (${await dots()})`);
    await click('[data-test="raster-toggle"]');
    // beim Ziehen folgt das Element dem Zeiger, die Anzeige oben zeigt den Platz
    const during = await js(`const n = document.querySelector(${JSON.stringify(item('Fern_Ein'))}); const r = n.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2; const left0 = n.style.left;
      n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + 400 * ${zoom}, clientY: y + 400 * ${zoom} }));
      const out = { moved: n.style.left !== left0, noInfo: !document.querySelector('[data-test="drag-info"]') };
      window.__up = () => window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 400 * ${zoom}, clientY: y + 400 * ${zoom} }));
      return out`);
    await shot('22b-ziehen');
    await js('window.__up()');
    expect(during.moved && during.noInfo, `beim Ziehen folgt das Element (ohne Platzanzeige): ${JSON.stringify(during)}`);
    await sleep(300);
    // nur zurücknehmen, wenn es wirklich verschoben wurde (auf einem anderen Element springt es von selbst zurück)
    if (!(await geo(item('Fern_Ein'))).startsWith('40,40,')) await click('[data-test="undo"]');
    await until(async () => (await geo(item('Fern_Ein'))).startsWith('40,40,'), 'Ziehen rückgängig');
    // Stufe 3c: Bildschirmrahmen, Bildschirmgröße aus der Liste, Karten unterhalb des Bildschirms, Schriftgröße je Karte
    expect(await js(`return !!document.querySelector('#edcanvas [data-test="screenframe"]')`), 'Bildschirmrahmen im Editor');
    await click('#edcanvas .freegrid');
    await waitFor('[data-test="screen-size"]');
    const pickScreen = (v) => js(`const s = document.querySelector('[data-test="screen-size"]'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true }))`);
    await pickScreen('panel:800x480');
    await waitFor('#edcanvas .freegrid[data-h="352"]'); // 480 − Leiste oben 56 − unten 72
    await waitFor('[data-test="offscreen-hint"]');
    // Elemente behalten Platz und Größe in Bildpunkten
    expect((await geo(item('Fern_Ein'))) === '40,40,240,50', `Schalter bei 800 px unverändert: ${await geo(item('Fern_Ein'))}`);
    expect(await js(`return !!document.querySelector('#edcanvas .fitem.outside')`), 'Element unterhalb des Bildschirms rot markiert');
    expect(/800 × 480/.test(await text('#edcanvas [data-test="screenframe"]')), 'Rahmen zeigt 800 × 480');
    await sleep(800);
    await shot('25-bildschirm-panel-7zoll');
    await click('[data-test="orient-port"]');
    await waitFor('#edcanvas .freegrid[data-w="480"]');
    await click('[data-test="page-scroll"]');
    await until(async () => js(`return !document.querySelector('[data-test="offscreen-hint"]')`), 'Seite darf rollen: kein Hinweis');
    await click('[data-test="undo"]'); await click('[data-test="undo"]'); await click('[data-test="undo"]');
    await waitFor('#edcanvas .freegrid[data-w="1920"]');
    // Handy: hochkant und rollend; Häkchen „Im Browser zeigen“ ist da und an
    await pickScreen('phone:844x390');
    await waitFor('#edcanvas .freegrid[data-w="390"]');
    expect(await js(`return document.querySelector('[data-test="page-scroll"]').checked`), 'Handy-Seite darf rollen');
    expect(await js(`const c = document.querySelector('[data-test="page-web"]'); return !!c && c.checked`), 'Häkchen „Im Browser zeigen“ an');
    await shot('25b-handy-seite');
    // Handy-Seite im Editor nicht riesig; Bildlauf bleibt stehen, wenn ein Element verschoben oder geändert wird
    expect(Number(await js(`return document.querySelector('#edcanvas .freegrid').style.zoom`)) <= 1.5, 'Handy-Seite im Editor höchstens 1,5-fach');
    await js(`const g = document.querySelector('#edcanvas .freegrid'); g.style.minHeight = '2400px'; return true`);
    await click(item('Fern_Ein'));
    await waitFor('[data-test="font-130"]');
    const scrollTo = await js(`const c = document.getElementById('edcanvas'); c.scrollTop = 200; return c.scrollTop`);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); return true`);
    await sleep(300);
    const afterNudge = await js(`return document.getElementById('edcanvas').scrollTop`);
    expect(scrollTo > 0 && Math.abs(afterNudge - scrollTo) <= 1, `Bildlauf bleibt beim Verschieben: ${scrollTo} → ${afterNudge}`);
    await click('[data-test="undo"]');
    await waitFor('#edcanvas .freegrid[data-w="390"]');
    await click('[data-test="undo"]');
    await waitFor('#edcanvas .freegrid[data-w="1920"]');
    expect(await js(`return !document.querySelector('[data-test="page-scroll"]').checked`), 'rückgängig: Seite rollt wieder nicht');
    await click(item('Fern_Ein'));
    await waitFor('[data-test="font-130"]');
    await click('[data-test="font-130"]');
    await waitFor(`${item('Fern_Ein')} > .element[style*="zoom"]`);
    expect(await js(`return document.querySelector(${JSON.stringify(item('Fern_Ein'))} + ' > .element').style.zoom === '1.3'`), 'Schriftgröße „Groß“ = 130 %');
    expect((await geo(item('Fern_Ein'))) === '40,40,240,50', 'Schriftgröße ändert Platz und Größe nicht');
    await shot('26-schrift-gross');
    await click('[data-test="undo"]');
    // Bedienseite bei eingeklapptem Menü: volle Breite (früher landete sie in der schmalen Menüspalte)
    await click('[data-test="preview"]');
    await waitFor('.shell.operate .pagegrid.freegrid [data-test="switch-Fern_Ein"]');
    await sleep(500);
    expect(await js(`return document.querySelector('main').getBoundingClientRect().width > window.innerWidth * 0.9`), 'Bedienseite nutzt die ganze Breite (Menü eingeklappt)');
    const fitAll = await js(`const g = document.querySelector('.shell.operate .freegrid'); const b = g.parentElement.getBoundingClientRect(); const r = g.getBoundingClientRect();
      return { fit: g.classList.contains('fitall'), h: g.style.height, ok: r.bottom <= b.bottom + 1 && r.right <= b.right + 1 }`);
    expect(fitAll.fit && fitAll.h === '952px' && fitAll.ok, `Bedienseite passt ganz auf den Bildschirm ${JSON.stringify(fitAll)}`);
    // Fenster kleiner und wieder größer: die Seite wächst wieder mit (Test E4)
    const zoomNow = () => js(`return parseFloat(document.querySelector('.shell.operate .freegrid').style.zoom) || 1`);
    const z1 = await zoomNow();
    // Größe bei jedem Versuch neu setzen und „resize“ selbst auslösen. Liegt das Prüffenster verdeckt (Windows meldet
    // es dann als „hidden“), übernimmt Chromium keine Größe – dann wird der Test übersprungen statt falsch zu scheitern.
    const hidden = async () => (await js('return document.visibilityState')) === 'hidden';
    const resizeTo = (w, hh, ok, msg) => until(async () => { win.setSize(w, hh); await js('window.dispatchEvent(new Event("resize"))'); return ok(); }, msg, 8000)
      .then(() => true, async (err) => {
        if (await hidden()) return false;
        throw new Error(`${err.message} ${JSON.stringify({ z1, z: await zoomNow(), size: win.getSize(), inner: await js('return [innerWidth, innerHeight]') })}`);
      });
    const small = await resizeTo(900, 600, async () => (await zoomNow()) < z1 * 0.85, 'Fenster kleiner: Seite kleiner');
    const big = await resizeTo(1320, 880, async () => Math.abs((await zoomNow()) - z1) < 0.02, 'Fenster wieder groß: Seite wieder groß');
    if (!small || !big) {
      console.log('Hinweis: Test E4 (Fenster kleiner/größer) übersprungen – das Prüffenster war verdeckt');
      win.setSize(1320, 880);
      await sleep(500);
    }
    const inPage = await layout('.shell.operate .freegrid');
    await click('[data-test="nav-toggle"]');
    await waitFor('.shell:not(.navmini)');
    const near = (a, b) => Math.abs(a - b) < 0.03;
    expect(near(inEditor.top, inPage.top) && near(inEditor.left, inPage.left) && near(inEditor.w, inPage.w) && near(inEditor.h, inPage.h),
      `Editor und Bedienseite gleich: Editor ${JSON.stringify(inEditor)} / Seite ${JSON.stringify(inPage)}`);
    // Bedienmodus: kein Menü, schmale Leiste mit „Bedienmodus verlassen“
    expect(await js(`return !!document.querySelector('.shell.operate') && getComputedStyle(document.querySelector('.sidenav')).display === 'none'`), 'Bedienmodus ohne Menü');
    expect(!!(await js(`return !!document.querySelector('[data-test="exit-operate"]')`)), 'Knopf „Bedienmodus verlassen“');
    await click('[data-test="switch-Fern_Ein"]');
    await until(() => (sim.st.MW[1] & 0x10) !== 0, 'eigene Seite: Schalter Fern_Ein schreibt M5 = 1');
    await sleep(600);
    // Tipptaster: solange gedrückt M8 = 1, beim Loslassen wieder 0
    expect((sim.st.MW[1] & 0x80) === 0, 'M8 vorher aus');
    await js(`document.querySelector('[data-test="button-Automatik_Frei"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))`);
    await until(() => (sim.st.MW[1] & 0x80) !== 0, 'Tipptaster gedrückt: M8 = 1');
    await sleep(400);
    expect((sim.st.MW[1] & 0x80) !== 0, 'M8 bleibt 1, solange gedrückt');
    await js(`window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))`);
    await until(() => (sim.st.MW[1] & 0x80) === 0, 'Tipptaster losgelassen: M8 = 0');
    // ganz kurz tippen: 1 und 0 kommen beide an (nicht zusammengefasst)
    const writesBefore = sim.st.requests.length;
    await js(`const b = document.querySelector('[data-test="button-Automatik_Frei"]');
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 })); window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));`);
    await sleep(600);
    const m8writes = sim.st.requests.slice(writesBefore).filter((q) => q.fc === 6 || q.fc === 16).length;
    expect(m8writes >= 2, `kurzes Tippen: 1 und 0 gesendet (${m8writes} Schreibbefehle)`);
    expect((sim.st.MW[1] & 0x80) === 0, 'nach kurzem Tippen wieder 0');
    // rastend (ohne Rückmeldung): 1. Druck = 1 und leuchtet rot, 2. Druck = 0 und dunkel
    const pagesBefore = await js(`return await window.e4.listPages()`);
    await js(`const ps = await window.e4.listPages(); for (const p of ps) for (const e of p.items) if (e.kind === 'button' && e.name === 'Automatik_Frei') { e.mode = 'toggle'; delete e.fb; }
      await window.e4.savePages(ps); return true`);
    await click('[data-page-tab^="auto:"]');
    await click('[data-page-tab]');
    await waitFor('.pagegrid [data-test="button-Automatik_Frei"][aria-pressed="false"]');
    await click('.pagegrid [data-test="button-Automatik_Frei"]');
    await until(() => (sim.st.MW[1] & 0x80) !== 0, 'rastend, 1. Druck: M8 = 1');
    await until(() => js(`const b = document.querySelector('.pagegrid [data-test="button-Automatik_Frei"]'); return b.getAttribute('aria-pressed') === 'true' && b.classList.contains('lit-alarm')`), 'rastend: leuchtet rot, solange M8 = 1');
    await sleep(1500);
    await click('.pagegrid [data-test="button-Automatik_Frei"]');
    await until(() => (sim.st.MW[1] & 0x80) === 0, 'rastend, 2. Druck: M8 = 0');
    await until(() => js(`return !document.querySelector('.pagegrid [data-test="button-Automatik_Frei"]').classList.contains('lit')`), 'rastend: wieder dunkel');
    await js(`await window.e4.savePages(${JSON.stringify(pagesBefore)}); return true`);
    await click('[data-page-tab^="auto:"]');
    await click('[data-page-tab]');
    await waitFor('.pagegrid [data-test="button-Automatik_Frei"]');
    await waitFor('.pagegrid .el-bar .barfill');
    await until(async () => /Nachlauf: 120 s/.test(await text('.pagegrid') || ''), 'Seite nach dem Zurückstellen wieder mit Werten');
    // Uhr: nur die Minute (CLOCK.1 aus der .itf) gewählt – das Element zeigt trotzdem Stunde:Minute; Datum + Zeit; Warnung bei Abweichung
    const clockAdd = async (extra) => js(`const ps = await window.e4.listPages(); const dev = (await window.e4.listDevices())[0].id;
      const v = (await window.e4.getDevice(dev)).variables.find((x) => x.operand === 'CLOCK' && x.index === 1); const key = v.id !== undefined && v.id !== null ? String(v.id) : v.name;
      const p = ps.find((x) => x.items.some((e) => e.name === 'Automatik_Frei')); p.items = p.items.filter((e) => e.id !== 'uhr1');
      p.items.push(Object.assign({ id: 'uhr1', kind: 'clock', dev, name: key, x: 1300, y: 900, w: 300, h: 80 }, ${JSON.stringify(extra)}));
      await window.e4.savePages(ps); return true`);
    await clockAdd({});
    await click('[data-page-tab^="auto:"]');
    await click('[data-page-tab]');
    const pad2 = (n) => String(n).padStart(2, '0');
    await until(async () => /^\d\d:\d\d$/.test(((await text('.pagegrid [data-eid="uhr1"] .bignum')) || '').trim()), `Uhr: Stunde:Minute (${await text('.pagegrid [data-eid="uhr1"] .bignum')})`);
    const nowHm = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
    expect([nowHm(), (() => { const d = new Date(Date.now() - 60000); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; })()].includes((await text('.pagegrid [data-eid="uhr1"] .bignum')).trim()), 'Uhr zeigt die Zeit der easyE4 (wie PC)');
    sim.st.clockOffset = 5 * 60000; // easyE4-Uhr 5 Minuten vor
    await clockAdd({ clockFmt: 'dt', clockWarn: true });
    await click('[data-page-tab^="auto:"]');
    await click('[data-page-tab]');
    await until(async () => /^\d\d\.\d\d\.\d{4} \d\d:\d\d/.test(((await text('.pagegrid [data-eid="uhr1"] .bignum')) || '').trim()), `Uhr: Datum und Zeit (${await text('.pagegrid [data-eid="uhr1"] .bignum')})`);
    await until(async () => js(`return !!document.querySelector('.pagegrid [data-eid="uhr1"] [data-test="clock-warn"]')`), 'Uhr 5 min vor: Warnzeichen');
    sim.st.clockOffset = 0;
    // Sichtbarkeit: Text nur wenn Fern_Ein (M5) = 1; Rahmen „nur wenn M5 = 0“ samt Inhalt
    await js(`const ps = await window.e4.listPages(); const dev = (await window.e4.listDevices())[0].id;
      const p = ps.find((x) => x.items.some((e) => e.name === 'Automatik_Frei'));
      p.items.push({ id: 'vis1', kind: 'text', text: 'Fern ist ein', size: 'normal', x: 1300, y: 760, w: 300, h: 40, vis: { dev, name: 'Fern_Ein', op: 'on' } });
      p.items.push({ id: 'visf', kind: 'frame', title: 'Nur bei Fern aus', x: 1640, y: 740, w: 260, h: 120, vis: { dev, name: 'Fern_Ein', op: 'off' } });
      p.items.push({ id: 'vis2', kind: 'text', text: 'im Rahmen', size: 'normal', x: 1660, y: 800, w: 200, h: 40 });
      await window.e4.savePages(ps); return true`);
    sim.st.MW[1] |= 0x10; // M5 = 1
    await click('[data-page-tab^="auto:"]');
    await click('[data-page-tab]');
    const visState = () => js(`const c = (id) => { const n = document.querySelector('.pagegrid [data-item="' + id + '"]'); return !n ? 'fehlt' : n.classList.contains('vishide') ? 'aus' : 'an'; }; return [c('vis1'), c('visf'), c('vis2')].join(',')`);
    await until(async () => (await visState()) === 'an,aus,aus', `Sichtbarkeit bei M5 = 1: Text an, Rahmen samt Inhalt aus (${await visState()})`);
    sim.st.MW[1] &= ~0x10; // M5 = 0
    await until(async () => (await visState()) === 'aus,an,an', `Sichtbarkeit bei M5 = 0: Text aus, Rahmen samt Inhalt an (${await visState()})`);
    expect(await js(`return getComputedStyle(document.querySelector('.pagegrid [data-item="vis1"]')).pointerEvents === 'none'`), 'ausgeblendet: nicht bedienbar');
    sim.st.MW[1] |= 0x10;
    await js(`await window.e4.savePages(${JSON.stringify(pagesBefore)}); return true`);
    await click('[data-page-tab^="auto:"]');
    await click('[data-page-tab]');
    await waitFor('.pagegrid .el-bar .barfill');
    await until(async () => /Nachlauf: 120 s/.test(await text('.pagegrid') || ''), 'Seite wieder ohne Uhr');
    await until(async () => /Läuft/.test(await text('.pagegrid [data-el-of="Anlage"]') || ''), `Bedienseite: Statusleuchte „Läuft“ (${await text('.pagegrid [data-el-of="Anlage"]')})`);
    expect(/Nachlauf: 120 s/.test(await text('.pagegrid')), 'Bedienseite: Text mit Wert');
    expect(await js(`return parseFloat(document.querySelector('.pagegrid .el-bar .barfill').style.height)`) === 60, 'Bedienseite: Balken 60 %');
    await shot('22-eigene-seite');
    // Schieberegler: Ziehen zeigt den Wert, gesendet wird beim Loslassen
    const sliderWrites = sim.st.requests.length;
    await js(`const s = document.querySelector('.pagegrid [data-test="slider-Nachlauf_Soll"]');
      s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      for (const v of ['150', '200', '250']) { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }`);
    await sleep(400);
    expect(sim.st.MW[3] === 120, 'beim Ziehen noch nichts gesendet');
    expect(/250/.test(await text('.pagegrid .el-slider .bignum')), 'Wert beim Ziehen sichtbar');
    await js(`const s = document.querySelector('.pagegrid [data-test="slider-Nachlauf_Soll"]'); s.dispatchEvent(new Event('change', { bubbles: true }));`);
    await until(() => sim.st.MW[3] === 250, 'Schieberegler schreibt beim Loslassen 250');
    const sliderMw3 = sim.st.requests.slice(sliderWrites).filter((q) => (q.fc === 6 || q.fc === 16) && q.addr === 46003).length;
    expect(sliderMw3 === 1, `Schieberegler: ein Schreibbefehl (waren ${sliderMw3})`);
    await until(async () => js(`return parseFloat(document.querySelector('.pagegrid .el-bar .barfill').style.height) === 100`), 'Balken folgt (250 > 200 = voll)');
    await js(`document.querySelector('.pagegrid .el-gauge').scrollIntoView({ block: 'center' })`);
    await sleep(400);
    await shot('22b-zeiger-regler');
    // Betriebsart: Klick auf „Automatik“ schreibt 2, der Knopf ist danach hervorgehoben
    await click('.pagegrid [data-test="choice-Nachlauf_Soll-2"]');
    await until(() => sim.st.MW[3] === 2, 'Betriebsart schreibt 2');
    await until(async () => js(`return document.querySelector('.pagegrid [data-test="choice-Nachlauf_Soll-2"]').classList.contains('on')`), 'Automatik hervorgehoben');
    expect(!/Wert (gerade eben|vor)/.test(await text('.pagegrid .el-device') || ''), 'Gerätekarte: kein „Wert gerade eben“ (verbunden reicht)');
    expect(/verbunden|online/i.test(await text('.pagegrid .el-device .devonline')), 'Gerätekarte: online');
    expect(/^127\.0\.0\.1:\d+$/.test((await text('.pagegrid .el-device .devinfo') || '').trim()), `Gerätekarte: nur IP und Port (${await text('.pagegrid .el-device .devinfo')})`);
    expect(!/JSON/.test(await js(`return document.body.innerText`)), 'nirgends „JSON“ zu sehen');
    const devAlign = await js(`const c = (s) => { const r = document.querySelector('.pagegrid .el-device ' + s).getBoundingClientRect(); return r.top + r.height / 2; };
      return Math.abs(c('.devname') - c('.devonline'))`);
    expect(devAlign < 4, `Gerätekarte: „verbunden“ auf Höhe des Namens (Abstand ${devAlign})`);
    await js(`document.querySelector('.pagegrid .el-device').scrollIntoView({ block: 'center' })`);
    await sleep(400);
    await shot('22c-kennwert-betriebsart-geraet');
    // Trend auf der Bedienseite: aufgezeichnete Werte als Kurve, Zeitbereich wechseln, blättern, Fadenkreuz
    await until(async () => js(`return !!document.querySelector('.pagegrid .el-trend path.tline')`), 'Trend zeichnet die Kurve', 15000);
    await click('.pagegrid [data-test="trend-range-10m"]');
    await until(async () => js(`return document.querySelector('.pagegrid [data-test="trend-range-10m"]').classList.contains('on') && !!document.querySelector('.pagegrid .el-trend path.tline')`), 'Trend: 10 min');
    await js(`const r = document.querySelector('.pagegrid .el-trend .thit'); const b = r.getBoundingClientRect();
      r.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.right - 4, clientY: b.top + 40 }));`);
    await until(async () => /Nachlauf Soll/.test(await text('.pagegrid .el-trend .trendtip') || ''), 'Trend: Fadenkreuz zeigt den Wert');
    await js(`document.querySelector('.pagegrid .el-trend').scrollIntoView({ block: 'center' })`);
    await sleep(400);
    await shot('22d-trend');
    await click('.pagegrid [data-test="trend-back"]');
    await until(async () => js(`return !document.querySelector('.pagegrid [data-test="trend-forward"]').disabled`), 'Trend: zurückgeblättert');
    await click('.pagegrid [data-test="trend-now"]');
    await until(async () => js(`return document.querySelector('.pagegrid [data-test="trend-forward"]').disabled`), 'Trend: wieder „Jetzt“');
    // Knopf am Trend: sichtbaren Zeitraum als Tabelle speichern
    await click('.pagegrid [data-test="trend-csv"]');
    await until(() => fs.existsSync(path.join(themeDir, 'trend-element.csv')), 'Trend: als CSV gespeichert');
    const tcsv = fs.readFileSync(path.join(themeDir, 'trend-element.csv'), 'utf8').split(String.fromCharCode(13, 10));
    expect(/^\uFEFFZeit;Nachlauf Soll/.test(tcsv[0]) && tcsv.length > 2, `Trend-CSV: Überschrift und Werte (${tcsv.slice(0, 3).join(' | ')})`);
    // Meldungen: „Anlage“ (Q1, steht auf 1) als Störung einrichten, Quittieren schreibt „Uhr Ein“ (M3)
    await click('[data-test="nav-alarms"]');
    await waitFor('[data-test="alarm-add"]');
    await click('[data-test="alarm-add"]');
    await waitFor('[data-test="alarm-var-0"]');
    const optEnd = (sel, end) => js(`return [...document.querySelector('${sel}').options].find((o) => o.value.endsWith('${end}')).value`);
    await choose('[data-test="alarm-var-0"]', await optEnd('[data-test="alarm-var-0"]', '|Anlage'));
    await until(async () => js(`return !!document.querySelector('[data-test="ack-missing"]')`), 'Warnung: kein Quittier-Merker');
    const ackSel = await js(`return document.querySelector('[data-ackvar]').dataset.ackvar`);
    await choose(`[data-ackvar="${ackSel}"]`, await js(`return [...document.querySelector('[data-ackvar]').options].find((o) => o.value === 'Uhr_Ein' || o.text.startsWith('Uhr Ein')).value`));
    await until(async () => !(await js(`return !!document.querySelector('[data-test="ack-missing"]')`)), 'Warnung weg, Quittier-Merker gesetzt');
    await typeIn('[data-test="alarm-text-0"]', 'Störung Anlage');
    await until(async () => (await text('[data-alarm-badge]')) === '1', 'Menü zeigt 1 offene Störung', 5000);
    await sleep(300);
    await shot('34-meldungen-einrichten');
    await click('[data-test="nav-pages"]');
    await waitFor('.pagegrid .el-alarms [data-alarm-row]').catch(async (err) => { throw new Error(err.message + ' ' + await js(`return JSON.stringify({ el: document.querySelectorAll('.pagegrid .el-alarms').length, page: (document.querySelector('.vtitle') || {}).textContent, txt: (document.querySelector('.pagegrid .el-alarms') || {}).textContent })`)); });
    expect(/Störung Anlage/.test(await text('.valarm.lv-fault') || ''), 'Meldungszeile in der Leiste zeigt die Störung');
    expect(/KOMMT/.test(await text('.pagegrid .el-alarms [data-alarm-row]')), 'Meldungsliste: KOMMT');
    await js(`document.querySelector('.pagegrid .el-alarms').scrollIntoView({ block: 'center' })`);
    await sleep(300);
    await shot('35-meldung-kommt');
    const ackWrites = sim.st.requests.length;
    await click('[data-test="alarm-line-ack"]');
    await until(async () => !(await js(`return !!document.querySelector('[data-test="alarm-line-ack"]')`)), 'quittiert: Knopf weg');
    await until(async () => /QUIT/.test(await text('.pagegrid .el-alarms [data-alarm-row]') || ''), 'Meldungsliste: QUIT (steht noch an)');
    await until(() => sim.st.requests.slice(ackWrites).filter((q) => q.fc === 5 || q.fc === 6 || q.fc === 15 || q.fc === 16).length >= 2, 'Quittier-Impuls: 1 und wieder 0 geschrieben', 4000);
    await click('.pagegrid [data-test="alarm-tab-history"]');
    await until(async () => /Störung Anlage/.test(await text('.pagegrid .el-alarms .alarmrows') || ''), 'Verlauf zeigt die Meldung');
    // langer Verlauf: die Liste darf sich nicht über Überschrift und Reiter schieben
    const headFree = await js(`const el = document.querySelector('.pagegrid .el-alarms'); const l = el.querySelector('.alarmrows'); const r = l.firstElementChild;
      for (let i = 0; i < 60; i++) l.append(r.cloneNode(true));
      const hd = el.querySelector('.alarmhead').getBoundingClientRect(), tb = el.querySelector('.alarmtabs').getBoundingClientRect();
      return hd.height >= tb.height - 1 && l.getBoundingClientRect().top >= hd.bottom - 1`);
    expect(headFree, 'langer Meldungsverlauf: Überschrift und Reiter bleiben frei');
    // weiter mit der automatischen Seite
    await click('[data-page-tab^="auto:"]');
    await waitFor('.pagegrid:not(.freegrid) [data-el-of="Fern_Ein"]');

    // Dunkel
    await js(`document.querySelectorAll('.topbar .seg button')[1].click()`);
    await sleep(300);
    await shot('11-bedienseite-dunkel');
    // Gerät nicht erreichbar -> grau, Bedienen gesperrt; in der Liste bleiben die Werte, als veraltet markiert
    await sim.stop();
    await until(async () => js(`return !!document.querySelector('.pagegrid.offline')`), 'Bedienseite wird bei Ausfall grau', 8000);
    expect(await js(`return document.querySelector('[data-test="switch-Fern_Ein"]').disabled`), 'Schalter gesperrt');
    await shot('12-offline');
    await click('[data-test="nav-variables"]'); // Bedienmodus: Menü ist ausgeblendet, aber per Klick erreichbar
    await waitFor('[data-value-of="Nachlauf_Soll"]');
    const isStale = async () => /stale/.test(await js(`return document.querySelector('[data-value-of="Nachlauf_Soll"]').className`));
    await until(isStale, 'Werte als veraltet markiert');
    expect(await js(`return document.querySelector('[data-test="online-easye4"]').classList.contains('st-bad')`), 'oben: easyE4 rot');
    // MQTT: Broker läuft, die easyE4 ist aus (sendet nichts) – darf nicht als verbunden gelten
    // Verbindung neu aufbauen, solange etwas nicht erreichbar ist: keine Meldung „Verbunden“
    await click('[data-test="online"]');
    await waitFor('[data-test="online-state"]');
    await click('[data-test="online"]');
    await waitFor('[data-test="online-easye4"]');
    await sleep(2500);
    expect(!/Verbunden/.test(await text('#toast') || ''), `keine Meldung „Verbunden“, solange nicht alles grün ist: ${await text('#toast')}`);
    mq = await require(path.join(ROOT, 'test', 'sim', 'mqtt-sim.js')).start({ base: 'easye4/aus', device: false });
    await js(`return window.e4.saveDevice({ name: 'MQTT aus', protocol: 'mqtt', settings: { host: '127.0.0.1', port: ${mq.port}, baseTopic: 'easye4/aus', tls: false, timeout: 1000 } })`);
    await click('[data-test="nav-devices"]');
    await until(async () => /sendet nichts/.test(await js(`return [...document.querySelectorAll('[data-device] .chip')].map((c) => c.textContent).join(' | ')`)),
      'MQTT ohne easyE4: „sendet nichts“', 8000);
    await until(async () => js(`return document.querySelector('[data-test="online-mqtt"]').classList.contains('st-ok')`), 'oben: MQTT grün (Broker läuft)');
    expect(await js(`return document.querySelector('[data-test="online-easye4"]').classList.contains('st-bad')`), 'oben: easyE4 rot');
    await shot('12a-mqtt-easye4-aus');
    await js(`const d = (await window.e4.listDevices()).find((x) => x.name === 'MQTT aus'); await window.e4.removeDevice(d.id);`);
    // zweites Gerät: Reiter zur Geräteauswahl in „Variablen“
    const second = await js(`return (await window.e4.saveDevice({ name: 'Halle 2', protocol: 'modbus', enabled: false, settings: { host: '127.0.0.2' } })).id`);
    await click('[data-test="nav-devices"]');
    await click('[data-test="nav-variables"]');
    await waitFor(`[data-tab-of="${second}"]`);
    expect(await js(`return document.querySelectorAll('[data-tab-of]').length`) === 2, 'zwei Geräte-Reiter');
    expect(await js(`return !!document.querySelector('[data-select-of="Fern_Ein"]')`), 'zuletzt gezeigtes Gerät bleibt gewählt');
    await click(`[data-tab-of="${second}"]`);
    await waitFor('.card.empty [data-test="import"], .card.empty .btn.primary');
    expect(await js(`return document.querySelector('[data-tab-of="${second}"]').classList.contains('on')`), 'Reiter Halle 2 gewählt');
    await shot('13-variablen-zwei-geraete');
    // Trennen: alles „nicht verbunden“, Bedienseite gesperrt mit Hinweis
    await click('[data-test="online"]');
    await until(async () => /nicht verbunden/.test(await text('[data-test="online-state"]')), 'oben: nicht verbunden');
    await click('[data-test="nav-pages"]');
    await waitFor('.pagegrid [data-test="switch-Fern_Ein"]');
    expect(await js(`return document.querySelector('[data-test="switch-Fern_Ein"]').disabled`), 'nicht verbunden: Schalter gesperrt');
    expect(await js(`return !document.querySelector('[data-test="page-offline"]') && !document.querySelector('.pagebar .chip')`), '„nicht verbunden“ nur einmal oben');
    expect(await js(`return getComputedStyle(document.querySelector('[data-test="online-state"]')).color`) !== await js(`return getComputedStyle(document.querySelector('.topbar .brand')).color`), 'oben rot hervorgehoben');
    await shot('14-nicht-verbunden');

    // ---------------------------------------------------------------- Teil 4: Farbthema
    await click('[data-test="nav-options"]');
    await waitFor('[data-test="open-design"]');
    await click('[data-test="open-design"]');
    await waitFor('[data-preset="orange"]');
    const previewVar = (mode, v) => js(`return document.querySelector('[data-preview="${mode}"]').style.getPropertyValue('${v}')`);
    await click('[data-preset="orange"]');
    await until(async () => (await previewVar('light', '--accent')) === '#B54708', 'Vorlage Orange in der Vorschau');
    expect(/gut/.test(await text('[data-badge="light-accent"]')), 'Akzent gut lesbar');
    // schlecht lesbare Farbe wählen: Hinweis und Vorschlag
    await js(`const c = document.querySelector('[data-color="light-accent"]'); c.value = '#ffe600';
      c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true }));`);
    await until(async () => /schlecht/.test(await text('[data-badge="light-accent"]') || ''), 'Gelb auf Weiß: schlecht lesbar');
    await click('[data-test="fix-light-accent"]');
    await until(async () => /gut/.test(await text('[data-badge="light-accent"]') || ''), 'Vorschlag macht es lesbar');
    // aus einer Farbe ableiten, Schrift, Größe, Ecken, Logo
    await js(`const c = document.querySelector('[data-test="derive-color"]'); c.value = '#e30613'; c.dispatchEvent(new Event('input', { bubbles: true }));`);
    await click('[data-test="derive"]');
    await until(async () => js(`return [...document.querySelectorAll('.readable')].every((n) => n.classList.contains('ok'))`), 'abgeleitetes Thema überall gut lesbar');
    await click('[data-test="font-atkinson"]');
    await click('[data-test="radius-round"]');
    await click('[data-test="logo-pick"]');
    await waitFor('.previewhead .themelogo');
    expect(/Atkinson/.test(await js(`return getComputedStyle(document.querySelector('[data-preview="dark"]')).fontFamily`)), 'Schrift Atkinson in der Vorschau');
    await sleep(500);
    await shot('30-design');
    // eigene Vorlage: speichern, andere Vorlage wählen, eigene wieder anwenden
    const myAccent = await previewVar('light', '--accent');
    await typeIn('[data-test="preset-name"]', 'Firmenrot');
    await click('[data-test="preset-save"]');
    await waitFor('[data-own-preset="Firmenrot"]');
    await click('[data-preset="blue"]');
    await until(async () => (await previewVar('light', '--accent')) === '#1D5FD1', 'Vorlage Blau gewählt');
    await click('[data-own-preset="Firmenrot"] .presetapply');
    await until(async () => (await previewVar('light', '--accent')) === myAccent, 'eigene Vorlage wieder angewendet');
    expect(/Atkinson/.test(await js(`return getComputedStyle(document.querySelector('[data-preview="light"]')).fontFamily`)), 'eigene Vorlage enthält die Schrift');
    await sleep(400);
    await shot('30a-eigene-vorlage');
    // Export, zurück zum Standard, Import
    await click('[data-test="theme-export"]');
    await until(() => fs.existsSync(themeFiles.file), 'Farbthema exportiert');
    await js(`window.confirm = () => true; document.querySelector('[data-test="theme-reset"]').click()`);
    await until(async () => (await previewVar('light', '--accent')) === '#1D5FD1', 'Standard wiederhergestellt');
    expect(!(await js(`return !!document.querySelector('.previewhead .themelogo')`)), 'Logo weg nach Standard');
    await click('[data-test="theme-import"]');
    await waitFor('.previewhead .themelogo');
    const imported = JSON.parse(fs.readFileSync(themeFiles.file, 'utf8')).theme;
    expect(imported.font === 'atkinson' && imported.radius === 'round', 'Export enthält Schrift und Ecken');
    await until(async () => (await previewVar('light', '--accent')) === imported.light.accent, 'Import übernommen');
    // Bedienseiten im Thema, mit Logo; das Programmfenster bleibt im Standard
    await sleep(500);
    await click('[data-test="nav-pages"]');
    await waitFor('main.themed .pagegrid');
    expect(!(await js(`return !!document.querySelector('.operatehead')`)), 'Bedienseite ohne kleines Logo oben');
    await js(`document.querySelectorAll('.topbar .seg button')[0].click()`); // Hell
    await sleep(400);
    expect(await js(`return document.querySelector('main').style.getPropertyValue('--accent')`) === imported.light.accent, 'Bedienseite im eigenen Thema');
    expect(!(await js(`return document.querySelector('.sidenav').closest('.themed')`)), 'Menü bleibt im Standard');
    await shot('31-bedienseite-thema');
    await js(`document.querySelectorAll('.topbar .seg button')[1].click()`);
    await sleep(400);
    expect(await js(`return document.querySelector('main').style.getPropertyValue('--accent')`) === imported.dark.accent, 'Dunkel: dunkle Farben des Themas');
    await shot('32-bedienseite-thema-dunkel');
    await js(`document.querySelectorAll('.topbar .seg button')[0].click()`);
    // Version 1: Vorlage „Leitstand“ (dunkel, Space Grotesk) und Wortmarke
    expect(await text('.topbar .wordmark .four') === '4', 'Wortmarke mit grüner Kachel „4“');
    await click('[data-test="exit-operate"]');
    await waitFor('.shell:not(.operate)');
    await click('[data-test="nav-options"]');
    await waitFor('[data-test="open-design"]');
    await click('[data-test="open-design"]');
    await waitFor('[data-preset="leitstand"]');
    await click('[data-preset="leitstand"]');
    await until(async () => (await previewVar('dark', '--accent')) === '#2DD4A0', 'Vorlage Leitstand in der Vorschau');
    expect((await previewVar('dark', '--control')) === '#26313D', 'Leitstand: eigene Farbe für Bedienelemente (helleres Grau)');
    expect(!!(await js(`return !!document.querySelector('[data-color="dark-control"]') && !!document.querySelector('[data-test="unset-control"]')`)), 'Design-Manager: Zeile „Bedienelemente“ mit „wie bisher“');
    expect(/Space Grotesk/.test(await previewVar('dark', '--font-display')), 'Leitstand: Space Grotesk für Werte');
    await click('[data-test="nav-pages"]');
    await waitFor('main.themed .pagegrid');
    await js(`document.querySelectorAll('.topbar .seg button')[1].click()`);
    await sleep(600);
    expect(await js(`return document.fonts.check('600 20px "Space Grotesk"')`), 'Schrift Space Grotesk geladen');
    await shot('33-leitstand-dunkel');
    await js(`document.querySelectorAll('.topbar .seg button')[0].click()`);
    // Teil 2: Element „Bild“ und Hintergrund der Seite
    await click('[data-test="exit-operate"]');
    await click('[data-test="nav-editor"]');
    await waitFor('#edcanvas .freegrid');
    // Bild per Klick: neues Element auf einem freien Platz
    await js(`document.querySelector('#edcanvas .freegrid').click()`);
    const itemsBeforeImg = await countOf('#edcanvas [data-item]');
    await click('[data-lib="image"]');
    await until(async () => (await countOf('#edcanvas [data-item]')) === itemsBeforeImg + 1, 'Bild per Klick als neues Element');
    await waitFor('[data-test="pick-image"]');
    await click('[data-test="pick-image"]');
    await waitFor('#edcanvas .el-image img');
    await until(() => js(`const i = document.querySelector('#edcanvas .el-image img'); return i.complete && i.naturalWidth > 0`), 'Bild geladen (e4img://)');
    await sleep(300);
    expect(await js(`const i = document.querySelector('#edcanvas .el-image'); const c = i.closest('[data-item]').getBoundingClientRect(); const r = i.getBoundingClientRect();
      return r.bottom <= c.bottom + 1 && r.height >= 40`), 'Bild füllt seinen Platz');
    await click('[data-test="fit-cover"]');
    await waitFor('#edcanvas .el-image.fit-cover');
    await click('#edcanvas .freegrid');
    await waitFor('[data-test="bg-theme"]');
    await click('[data-test="bg-color"]');
    await waitFor('#edcanvas [data-test="screenbg"]');
    expect(/rgb/.test(await js(`return getComputedStyle(document.querySelector('#edcanvas [data-test="screenbg"]')).backgroundColor`)), 'Hintergrund Farbe');
    await click('[data-test="bg-image"]');
    await until(() => js(`const b = document.querySelector('#edcanvas [data-test="screenbg"]'); return !!b && /e4img/.test(b.style.backgroundImage)`), 'Hintergrund Bild');
    await sleep(500);
    await shot('27-bild-und-hintergrund-editor');
    await click('[data-test="preview"]');
    await waitFor('.shell.operate .freegrid.hasbg .el-image img');
    expect(/e4img/.test(await js(`return document.querySelector('.shell.operate .freegrid').style.backgroundImage`)), 'Bedienseite mit Hintergrundbild');
    await sleep(500);
    await shot('28-bild-und-hintergrund-seite');
    await sleep(1500);
    await shot('28b-bild-und-hintergrund-seite');
    // Teil 3: Leisten (Vorlage A: oben + unten) ersetzen Programmleiste und Seitenreiter
    await waitFor('.shell.operate.barsmode .vbar-bottom .fkey.act-exit');
    expect(await js(`return getComputedStyle(document.querySelector('.topbar')).display === 'none'`), 'mit Leisten keine Programmleiste');
    expect(await js(`const g = document.querySelector('.shell.operate .freegrid'); const b = document.querySelector('.vbar-bottom').getBoundingClientRect(); return g.getBoundingClientRect().bottom <= b.top + 1`), 'Karten enden über der unteren Leiste');
    expect(/F1/.test(await text('.vbar-bottom .fkey.on')), 'offene Seite hervorgehoben, Taste F1');
    // rollende (lange) Seite: untere Leiste mit „Bedienmodus verlassen“ bleibt im Fenster sichtbar
    expect(await js(`document.querySelector('.screenbox').classList.add('scroll'); document.querySelector('.shell.operate .freegrid').style.minHeight = '4000px';
      await new Promise((r) => setTimeout(r, 100)); const b = document.querySelector('.vbar-bottom').getBoundingClientRect();
      const ok = b.bottom <= window.innerHeight + 1 && b.top > 0; document.querySelector('.screenbox').classList.remove('scroll'); document.querySelector('.shell.operate .freegrid').style.minHeight = ''; return ok`), 'lange Seite: untere Leiste bleibt sichtbar');
    await click('[data-test^="pagekey-auto:"]');
    await waitFor('.shell.operate:not(.barsmode) .pagegrid:not(.freegrid)');
    await click('[data-page-tab]');
    await waitFor('.shell.operate.barsmode .freegrid');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', bubbles: true }))`);
    await waitFor('.shell:not(.operate)');
    // Editor, Reiter „Leisten (Vorlage)“: Text oben einfügen, linke Leiste einschalten
    await click('[data-test="nav-editor"]');
    await waitFor('[data-test="bars-tab"]');
    // Funktionstaste als Element auf der Seite
    await click('#edcanvas .freegrid');
    await click('[data-lib="fkey"]');
    await waitFor('#edcanvas .el-fkey .fkey');
    await waitFor('[data-test="fkey-action"]');
    await click('[data-test="undo"]');
    await click('[data-test="bars-tab"]');
    await waitFor('#edcanvas .vbar.editbar');
    await click('[data-bar-lib="text"]');
    await waitFor('[data-prop="bar-text"]');
    await js(`const i = document.querySelector('[data-prop="bar-text"]'); i.value = 'Halle 1'; i.dispatchEvent(new Event('input', { bubbles: true }))`);
    await until(async () => /Halle 1/.test(await text('#edcanvas .vbar-top')), 'Text in der oberen Leiste');
    await click('#edcanvas .freegrid');
    await waitFor('[data-test="bar-on-left"]');
    await click('[data-test="bar-on-left"]');
    await waitFor('#edcanvas .vbar-left');
    await sleep(500);
    await shot('29-leisten-editor');
    await click('[data-test="preview"]');
    await waitFor('.shell.operate .vbar-left');
    expect(/Halle 1/.test(await text('.shell.operate .vbar-top')), 'Bedienseite: Text in der Leiste');
    await sleep(1200);
    await shot('29b-leisten-seite');

    // ---------------------------------------------------------------- Punkt 4: Anmeldung, Benutzer, Bedienprotokoll
    await click('[data-test="exit-operate"]');
    await waitFor('.shell:not(.operate) [data-test="nav-users"]');
    expect(!(await js(`return !!document.querySelector('[data-test="auth-chip"]')`)), 'ohne Benutzer: keine Anmeldung');
    await sleep(300); // Verlassen des Bedienmodus zeichnet noch einmal neu
    await click('[data-test="nav-users"]');
    await waitFor('[data-test="user-add"]', 8000);
    const fillUser = async (name, role, pw, pin) => {
      await click('[data-test="user-add"]');
      await waitFor('[data-test="user-dialog"]');
      await typeIn('[data-field="user-name"]', name);
      await choose('[data-field="user-role"]', role);
      if (pw) await typeIn('[data-field="user-password"]', pw);
      if (pin) await typeIn('[data-field="user-pin"]', pin);
      await click('[data-test="user-save"]');
      await until(async () => js(`return !document.querySelector('[data-test="user-dialog"]') && !!document.querySelector('[data-user-row="${name}"]')`), `Benutzer ${name} angelegt`);
    };
    await fillUser('Ralf', 'setup', 'geheim123', '4711');
    await until(async () => /Ralf · Techniker/.test(await text('[data-test="auth-chip"]') || ''), 'erster Techniker gleich angemeldet');
    expect(await js(`return !!document.querySelector('[data-test="second-setup"]')`), 'Empfehlung: zweiter Techniker');
    await fillUser('Schicht A', 'operator', '', '1234');
    await sleep(300);
    await shot('36-benutzer');
    // abmelden: nur noch Bedienseiten (Beobachter)
    await js(`window.confirm = () => true; document.querySelector('[data-test="auth-chip"]').click()`);
    await waitFor('.shell.operate');
    expect(await js(`return document.querySelector('[data-test="nav-editor"]').hidden`), 'Beobachter: kein Editor im Menü');
    // Leisten: „Verlassen“ und „easy4Visu beenden“ nur für den Techniker
    if (!(await js(`return !!document.querySelector('.shell.operate.barsmode')`))) await click('[data-page-tab]');
    await waitFor('.shell.operate.barsmode .vbar');
    expect(!(await js(`return !!document.querySelector('.vbar .fkey.act-exit, .vbar .fkey.act-quit')`)), 'Beobachter: kein „Verlassen“ und kein „Beenden“ in der Leiste');
    expect(await js(`return !!document.querySelector('.vbar .fkey.act-fullscreen')`), 'andere Tasten bleiben (Vollbild)');
    // Bedienmodus verlassen: verlangt Techniker; Fehlversuch, dann richtig
    await click('[data-test="exit-operate"]');
    await waitFor('[data-test="login-dialog"]');
    await click('[data-test="login-user-Ralf"]');
    await typeIn('[data-test="login-secret"]', 'falsch');
    await click('[data-test="login-ok"]');
    await until(async () => /noch 4 Versuche/.test(await text('[data-test="login-error"]') || ''), 'Fehlversuch gemeldet');
    await sleep(300);
    await shot('37-anmelden');
    await js(`const i = document.querySelector('[data-test="login-secret"]'); i.value = '4711'; document.querySelector('[data-test="login-ok"]').click()`);
    await until(async () => js(`return !document.querySelector('.shell.operate') && !!document.querySelector('[data-test="nav-audit"]')`), 'als Techniker angemeldet und Bedienmodus verlassen');
    await click('[data-test="nav-audit"]');
    await waitFor('[data-audit-kind="exitOperate"]');
    for (const k of ['user', 'login', 'logout', 'loginFail']) expect(await js(`return !!document.querySelector('[data-audit-kind="${k}"]')`), `Protokoll enthält ${k}`);
    await click('[data-test="audit-export"]');
    await until(() => fs.existsSync(path.join(themeDir, 'protokoll.csv')), 'Bedienprotokoll als CSV gespeichert');
    expect(/Bedienmodus verlassen/.test(fs.readFileSync(path.join(themeDir, 'protokoll.csv'), 'utf8')), 'CSV enthält die Einträge');
    await sleep(300);
    await shot('38-bedienprotokoll');
    // neuer Eintrag erscheint ohne Verlassen der Liste; Benutzer-Auswahl zeigt den ganzen Text
    expect(await js(`const s = document.querySelector('[data-test="audit-user"]'); return s.scrollWidth <= s.clientWidth + 1 && s.clientWidth >= 140`), 'Benutzer-Auswahl breit genug');
    const fails = await js(`return document.querySelectorAll('[data-audit-kind="loginFail"]').length`);
    await js(`const u = (await window.e4.authState()).users.find((x) => x.name === 'Ralf'); await window.e4.login(u.id, 'falsch'); return true`);
    await until(async () => (await js(`return document.querySelectorAll('[data-audit-kind="loginFail"]').length`)) > fails, 'Bedienprotokoll zeigt neuen Eintrag sofort');

    // ---------------------------------------------------------------- Punkt 6: Handy/Tablet im Browser
    // Einstellungsfenster: nur noch kleine Schalter, Projekt und Handy/Tablet haben eigene Seiten
    await click('[data-test="nav-options"]');
    await waitFor('[data-test="close-options"]');
    expect(!(await js(`return !!document.querySelector('#modal [data-test="web-options"], #modal [data-test="project-options"]')`)), 'Einstellungen ohne Projekt und Handy/Tablet');
    await click('[data-test="close-options"]');
    await click('[data-test="nav-web"]');
    await waitFor('[data-test="web-options"]');
    expect(/Handy & Tablet/.test(await text('main h1')), 'Seite „Handy & Tablet“');
    expect(!(await js(`return document.querySelector('[data-field="web-enabled"]').disabled`)), 'mit Techniker: einschaltbar');
    const webPort = await new Promise((res) => { const sv = require('node:net').createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => res(p)); }); });
    const webBase = `http://127.0.0.1:${webPort}`;
    await js(`document.querySelector('[data-test="web-port"]').value = '${webPort}'; document.querySelector('[data-test="web-port-save"]').click()`);
    await until(async () => (await js(`return document.querySelector('[data-test="web-port"]').value`)) === String(webPort), 'Port übernommen');
    await click('[data-field="web-enabled"]');
    await waitFor('[data-test="web-qr"] svg', 8000);
    expect(await text('[data-test="web-url"]') === webBase, 'Adresse zum Öffnen');
    // wie ein Handy: Seite holen und anmelden
    const webHtml = await fetch(`${webBase}/`);
    expect(webHtml.ok && /web\.js/.test(await webHtml.text()), 'Browser bekommt die Bedienoberfläche');
    const webLogin = await fetch(`${webBase}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-e4': '1' }, body: JSON.stringify({ args: ['Schicht A', '1234'] }) });
    expect((await webLogin.json()).result.ok === true, 'Anmeldung im Browser');
    await until(async () => /Schicht A/.test(await text('[data-test="web-clients"]') || ''), 'angemeldeter Browser erscheint am PC');
    expect(/Ralf · Techniker/.test(await text('[data-test="auth-chip"]') || ''), 'am PC bleibt Ralf angemeldet');
    expect(!/null|undefined/.test(await text('[data-test="web-options"]')), 'keine leeren Platzhalter im Netzwerk-Bereich');
    expect(await js(`return !!document.querySelector('[data-field="web-start"]') && !!document.querySelector('[data-field="web-start-tablet"]')`), 'Startseite Handy und Tablet');
    await js(`document.querySelector('[data-test="web-options"]').scrollIntoView()`);
    await shot('38b-netzwerk');
    await click('[data-field="web-enabled"]');
    await until(async () => !(await js(`return !!document.querySelector('[data-test="web-qr"]')`)), 'ausgeschaltet: keine Adresse mehr');

    // ---------------------------------------------------------------- Punkt 5: Texte und Sprachen
    await click('[data-test="nav-texts"]');
    await waitFor('[data-text-row]');
    await choose('[data-test="lang-add"]', 'en');
    await waitFor('th:nth-child(4)');
    const idOf = async (de) => js(`return [...document.querySelectorAll('[data-text-row]')].find((r) => [...r.querySelectorAll('input')].some((i) => i.value === ${JSON.stringify(de)})).dataset.textRow`);
    const pageId = await idOf('Übersicht');
    await js(`const i = document.querySelector('[data-text="${pageId}-en"]'); i.value = 'Overview'; i.dispatchEvent(new Event('change', { bubbles: true }))`);
    await until(async () => js(`return !document.querySelector('[data-text="${pageId}-en"]').classList.contains('missing')`), 'Übersetzung gespeichert');
    expect(/[0-9]+/.test(await text('[data-test="texts-missing"]')), 'Zähler „nur fehlende“');
    await sleep(300);
    expect(await js(`return !!document.querySelector('[data-test="lang-basebox"]') && !document.querySelector('[data-test="lang-basebox"]').open`), 'Grundsprache eingeklappt');
    expect(await js(`return !!document.querySelector('[data-test="lang-view"]')`), 'Auswahl „Anzeige testen in“');
    await shot('39-texte');
    // Excel-Export und wieder lesen
    await click('[data-test="texts-export"]');
    await until(() => fs.existsSync(path.join(themeDir, 'texte.xlsx')), 'Texttabelle als Excel gespeichert');
    const sheet = require(path.join(__dirname, '..', 'src', 'core', 'sheet.js'));
    const xrows = sheet.readXlsx(fs.readFileSync(path.join(themeDir, 'texte.xlsx')));
    expect(xrows[0].slice(0, 4).join('|') === 'ID|Hinweis|de|en', `Kopfzeile ID|Hinweis|de|en: ${xrows[0].join('|')}`);
    expect(xrows.some((r) => r[0] === pageId && r[3] === 'Overview'), 'Excel enthält die Übersetzung');
    // Import: eine Übersetzung mit falschem Platzhalter und eine neue Sprache (fr)
    const phRow = xrows.find((r) => (r[2] || '').includes('{1}'));
    const imp = [['ID', 'de', 'en', 'fr'], [pageId, '', '', 'Aperçu']];
    if (phRow) imp.push([phRow[0], '', 'without placeholder', '']);
    fs.writeFileSync(path.join(themeDir, 'texte-import.csv'), sheet.writeCsv(imp), 'utf8');
    await click('[data-test="texts-import"]');
    await waitFor('[data-test="texts-import-result"]');
    expect(/Français/.test(await text('[data-test="texts-import-result"]')), 'Import: neue Sprache Französisch');
    if (phRow) expect(/Platzhalter/.test(await text('[data-test="texts-import-result"]')), 'Import meldet abweichenden Platzhalter');
    await sleep(300);
    await shot('40-texte-import');
    // Bedienseite auf Englisch
    await js(`await window.e4.setLanguage('en')`);
    await click('[data-test="nav-pages"]');
    await until(async () => /Overview/.test(await text('.vbar') || ''), 'Bedienseite: Seiten-Taste auf Englisch');
    await until(async () => /Leave operating mode/.test(await text('[data-test="exit-operate"]') || ''), 'Programmtexte auf Englisch');
    await sleep(400);
    await shot('41-englisch');
    await js(`await window.e4.setLanguage('de')`);
    await until(async () => /Übersicht/.test(await text('.vbar') || ''), 'zurück auf Deutsch');

    // ---------------------------------------------------------------- Aufzeichnungen: Trends und Meldungen als CSV, Aufbewahrung
    await click('[data-test="nav-records"]');
    await waitFor('[data-test="rec-trend"]');
    expect(/Nachlauf Soll/.test(await text('[data-test="rec-trend"]')), 'Aufzeichnungen: aufgezeichnete Variable in der Liste');
    await click('[data-test="rec-range-today"]');
    await click('[data-test="rec-step-10000"]');
    await until(async () => /ca\. [\d.]+ Zeilen · 1 Spalte ·/.test(await text('[data-test="rec-info"]') || ''), 'Aufzeichnungen: Zeilen vorab gezählt');
    // Zeitraum der Meldungen ändern: Zeilen-Hinweis der Trends bleibt stehen (kein Flackern)
    await js(`document.querySelector('[data-test="rec-arange-today"]').click(); return true`);
    expect(/Zeilen/.test(await text('[data-test="rec-info"]') || ''), 'Aufzeichnungen: Zeilen-Hinweis flackert nicht');
    expect(await js(`return document.querySelector('[data-test="rec-save-alarms"]').classList.contains('primary')`), 'Aufzeichnungen: beide Speicher-Knöpfe gleich (blau)');
    await click('[data-test="rec-none"]');
    await click('[data-test="rec-save-trend"]');
    await until(async () => /mindestens eine/.test(await text('#toast') || ''), 'ohne Variable: Hinweis');
    await click('[data-test="rec-all"]');
    await click('[data-test="rec-range-custom"]');
    await waitFor('[data-field="rec-from"]');
    await sleep(300);
    await shot('44-aufzeichnungen');
    await click('[data-test="rec-save-trend"]');
    await until(() => fs.existsSync(path.join(themeDir, 'trends.csv')), 'Aufzeichnungen: Trends gespeichert');
    expect(/^\uFEFFZeit;Nachlauf Soll/.test(fs.readFileSync(path.join(themeDir, 'trends.csv'), 'utf8')), 'Trends-CSV: Überschrift');
    await click('[data-test="rec-save-alarms"]');
    await until(() => fs.existsSync(path.join(themeDir, 'meldungen.csv')), 'Aufzeichnungen: Meldungen gespeichert');
    expect(/^\uFEFFMeldung;Art;Gerät;Kommt;Geht;Quittiert/.test(fs.readFileSync(path.join(themeDir, 'meldungen.csv'), 'utf8')), 'Meldungs-CSV: Spalten');
    await js(`window.confirm = () => true; const s = document.querySelector('[data-field="rec-keep-trend"]'); s.value = '90'; s.dispatchEvent(new Event('change')); return true`);
    await until(async () => (await js(`return (await window.e4.recordsState()).retention.trend`)) === 90, 'Aufbewahrung Trends: 3 Monate');
    await js(`const s = document.querySelector('[data-field="rec-keep-trend"]'); s.value = '365'; s.dispatchEvent(new Event('change')); return true`);
    await until(async () => (await js(`return (await window.e4.recordsState()).retention.trend`)) === 365, 'Aufbewahrung zurück auf 1 Jahr');

    // ---------------------------------------------------------------- Meine Symbole: Bildersammlung im Editor
    await click('[data-test="nav-editor"]');
    await waitFor('#edcanvas .freegrid');
    const libWidth = await js(`return Math.round(document.querySelector('.edlib').getBoundingClientRect().width)`);
    await click('[data-test="panel-symbols"]');
    await waitFor('[data-test="sym-empty"]');
    expect(await js(`return Math.round(document.querySelector('.edlib').getBoundingClientRect().width)`) === libWidth, 'Symbole: linke Spalte bleibt gleich breit');
    expect(await js(`return [...document.querySelectorAll('.seg.edtabs button')].every((b) => b.scrollWidth <= b.clientWidth + 1)`), 'drei Reiter passen ohne Abschneiden');
    await click('[data-test="sym-add-folder"]');
    await until(async () => (await countOf('.sympanel [data-sym]')) === 3, 'Ordner eingelesen: 3 Symbole');
    expect(/3 Bilder übernommen/.test(await text('#toast') || ''), 'Meldung „3 Bilder übernommen“');
    expect(await js(`return [...document.querySelectorAll('.sympanel .symgroupname')].map((n) => n.textContent).join('|')`) === 'Allgemein|Pumpen', 'Gruppen: Allgemein, Pumpen');
    await js(`const s = document.querySelector('[data-test="sym-search"]'); s.value = 'aus'; s.dispatchEvent(new Event('input', { bubbles: true })); return true`);
    expect(await js(`return [...document.querySelectorAll('.sympanel .symitem')].filter((n) => !n.hidden).length`) === 1, 'Suche „aus“: ein Symbol');
    await js(`const s = document.querySelector('[data-test="sym-search"]'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); return true`);
    await sleep(300);
    await shot('46-meine-symbole');
    // erst auf eine freie Stelle der Seite klicken, dann das Symbol anklicken: neues Bild-Element genau dort
    const freeAt = await js(`const g = document.querySelector('#edcanvas .freegrid'); const r = g.getBoundingClientRect();
      for (let y = r.top + r.height / 2; y > r.top + 40; y -= 20) for (let x = r.left + 30; x < r.left + r.width / 2; x += 20) {
        const ok = [[0, 0], [90, 0], [0, 90], [90, 90]].every(([dx, dy]) => document.elementFromPoint(x + dx, y + dy) === g);
        if (ok) { g.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y, detail: 1 })); return { x, y }; } }
      return null`);
    expect(!!freeAt, 'freie Stelle auf der Seite gefunden');
    const symImg = await js(`return document.querySelector('.sympanel .symitem[data-sym-name="pumpe-an"]').dataset.sym`);
    const itemsBeforeSym = await countOf('#edcanvas [data-item]');
    await click('.sympanel .symitem[data-sym-name="pumpe-an"]');
    await until(async () => (await countOf('#edcanvas [data-item]')) === itemsBeforeSym + 1, 'Symbol angeklickt: neues Element');
    const symBox = await js(`const it = [...document.querySelectorAll('#edcanvas [data-item]')].find((n) => n.querySelector('.el-image img[src*="${symImg}"]'));
      const b = it.getBoundingClientRect(); return { x: b.left, y: b.top }`);
    expect(Math.abs(symBox.x - freeAt.x) < 20 && Math.abs(symBox.y - freeAt.y) < 20, `Symbol sitzt an der angeklickten Stelle (${JSON.stringify(freeAt)} → ${JSON.stringify(symBox)})`);
    await until(() => js(`return [...document.querySelectorAll('#edcanvas .el-image img')].some((i) => i.src.includes('${symImg}'))`), 'Element zeigt das Symbol');
    // „Bild ändern“ öffnet jetzt die Sammlung
    await click('[data-test="pick-image"]');
    await waitFor('[data-test="sym-pick"]');
    expect(await js(`return document.querySelector('[data-test="sym-pick"] .symitem.on').dataset.sym`) === symImg, 'Auswahl: aktuelles Bild markiert');
    expect(!!(await js(`return !!document.querySelector('[data-test="sym-pick-file"]')`)), 'Auswahl: „Andere Datei vom PC …“');
    await sleep(200);
    await shot('47-bild-waehlen');
    const otherImg = await js(`return document.querySelector('[data-test="sym-pick"] .symitem[data-sym-name="pumpe-aus"]').dataset.sym`);
    await click('[data-test="sym-pick"] .symitem[data-sym-name="pumpe-aus"]');
    await until(() => js(`return !document.querySelector('[data-test="sym-pick"]') && [...document.querySelectorAll('#edcanvas .el-image img')].some((i) => i.src.includes('${otherImg}'))`), 'anderes Symbol gewählt');
    // Rechtsklick: umbenennen und Gruppe ändern
    await js(`document.querySelector('.sympanel .symitem[data-sym-name="logo"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); return true`);
    await waitFor('[data-test="sym-edit"]');
    await typeIn('[data-field="sym-name"]', 'Firmenlogo');
    await typeIn('[data-field="sym-group"]', 'Pumpen');
    await sleep(200);
    await shot('48-symbol-aendern');
    await click('[data-test="sym-save"]');
    await until(async () => (await js(`return [...document.querySelectorAll('.sympanel .symgroupname')].map((n) => n.textContent).join('|')`)) === 'Pumpen', 'umbenannt und in Gruppe Pumpen');
    expect(!!(await js(`return !!document.querySelector('.sympanel .symitem[data-sym-name="firmenlogo"]')`)), 'neuer Name „Firmenlogo“');
    // dieselbe Datei noch einmal: nichts doppelt
    await click('[data-test="sym-add-files"]');
    await until(async () => /1 schon vorhanden/.test(await text('#toast') || ''), 'doppeltes Bild erkannt');
    expect(await countOf('.sympanel [data-sym]') === 3, 'weiterhin 3 Symbole');
    // aus der Sammlung entfernen: Element auf der Seite behält sein Bild
    await js(`window.confirm = () => true; document.querySelector('.sympanel .symitem[data-sym-name="pumpe-aus"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); return true`);
    await waitFor('[data-test="sym-remove"]');
    await click('[data-test="sym-remove"]');
    await until(async () => (await countOf('.sympanel [data-sym]')) === 2, 'Symbol entfernt');
    expect(await js(`return [...document.querySelectorAll('#edcanvas .el-image img')].some((i) => i.src.includes('${otherImg}') && i.complete && i.naturalWidth > 0)`), 'Seite behält das entfernte Bild');
    await click('[data-test="panel-elements"]');

    // ---------------------------------------------------------------- Punkt 7: Projekt sichern und einspielen
    await click('[data-test="nav-project"]');
    await waitFor('[data-test="project-options"]');
    expect(/Projekt/.test(await text('main h1')), 'Seite „Projekt“');
    expect(await js(`return document.querySelector('[data-field="backup-auto"]').checked`), 'tägliche Sicherung ab Werk an');
    await click('[data-test="backup-save"]');
    await waitFor('[data-test="backup-save-form"]');
    expect(await js(`return document.querySelector('[data-field="backup-users"]').checked && !document.querySelector('[data-field="backup-secrets"]').checked`), 'Benutzer an, Gerätepasswörter aus');
    await click('[data-field="backup-secrets"]');
    await waitFor('[data-field="backup-pw"]');
    await typeIn('[data-field="backup-pw"]', 'abcd');
    await typeIn('[data-field="backup-pw2"]', 'abce');
    await click('[data-test="backup-save-go"]');
    await until(async () => /verschieden/.test(await text('#toast') || ''), 'verschiedene Kennwörter: Hinweis');
    expect(!fs.existsSync(path.join(themeDir, 'projekt.easy4visu')), 'nichts gespeichert');
    await typeIn('[data-field="backup-pw2"]', 'abcd');
    await click('[data-test="backup-save-go"]');
    await until(() => fs.existsSync(path.join(themeDir, 'projekt.easy4visu')), 'Projekt gesichert');
    await js(`document.querySelector('[data-test="project-options"]').scrollIntoView()`);
    await sleep(300);
    await shot('42-projekt-gesichert');
    // etwas ändern, dann die Sicherung einspielen: der alte Stand ist wieder da
    const fontBefore = await js(`return (await window.e4.getTheme()).font`);
    await js(`const t = await window.e4.getTheme(); t.font = t.font === 'atkinson' ? 'inter' : 'atkinson'; await window.e4.saveTheme(t); return true`);
    await click('[data-test="backup-pick"]');
    await waitFor('[data-test="backup-preview"]');
    expect(/Geräte: Anlage NT1 \(\d+\)/.test(await text('[data-test="backup-preview"]')), `Vorschau nennt die Geräte: ${await text('[data-test="backup-preview"]')}`);
    await click('[data-field="backup-take-users"]'); // Benutzer behalten: Ralf bleibt angemeldet
    // Modbus-Gerät ohne Passwort: in der Datei sind keine Gerätepasswörter, also auch kein Kennwortfeld
    expect(!(await js(`return !!document.querySelector('[data-field="backup-restore-pw"]')`)), 'ohne Gerätepasswörter kein Kennwortfeld');
    await sleep(200);
    await shot('43-projekt-vorschau');
    await click('[data-test="backup-restore-go"]');
    await waitFor('[data-test="backup-restored"]');
    await sleep(2500); // Fenster lädt neu
    await until(async () => js(`return !!document.querySelector('[data-test="nav-options"]')`).catch(() => false), 'nach dem Einspielen wieder da', 10000);
    expect(await js(`return (await window.e4.getTheme()).font`) === fontBefore, 'Design wie in der Sicherung');
    expect(await js(`return (await window.e4.getBackupState()).list.some((x) => x.kind === 'before')`), 'vorher automatisch gesichert');
    expect(await js(`return /Projekt eingespielt/.test((await window.e4.auditQuery({ limit: 5 })).map((r) => r.what).join(' '))`), 'Eintrag im Bedienprotokoll');
  } finally {
    fs.rmSync(themeDir, { recursive: true, force: true });
    await sim.stop().catch(() => {});
    if (mq) await mq.stop().catch(() => {});
  }
};
