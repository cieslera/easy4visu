'use strict';
// Variablen-Import: Symboltabelle, ST-Programm, Zusammenführen mit der .itf. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { decodeText } = require('../src/import/text');
const { parseSymbols } = require('../src/import/symbols');
const { parseSt } = require('../src/import/st');
const { parseItf } = require('../src/import/itf');
const { buildVariables, keepUserChanges, displayLabel } = require('../src/import/merge');
const { importFiles, applyToDevice } = require('../src/import');
const { DeviceStore } = require('../src/core/devices');
const modbusSim = require('./sim/modbus-sim');
const { createDriver } = require('../src/protocols');

const B = (...p) => path.join(__dirname, '..', 'beispiele', ...p);
const EXPORT = B('symbole', 'Symbolische_Namen_easye4_mqtt_demo_Main.csv');
const OWN = B('symbole', 'eigene-tabelle.csv');
const byKey = (list) => Object.fromEntries(list.map((o) => [o.key, o]));
const byOp = (vars) => Object.fromEntries(vars.map((v) => [`${v.operand}${v.index}`, v]));

test('Kodierung: UTF-16 ohne BOM (easySoft-Export), UTF-8 mit BOM, Windows-1252', () => {
  assert.ok(decodeText(fs.readFileSync(EXPORT)).startsWith('Symbolischer Name;Operand\r\n'));
  assert.strictEqual(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x41])), 'A');
  assert.strictEqual(decodeText(Buffer.from([0x47, 0x72, 0xfc, 0xdf])), 'Grüß');
  assert.strictEqual(decodeText(Buffer.from([0xff, 0xfe, 0x41, 0x00])), 'A');
});

test('Symboltabelle: easySoft-Export und selbst erstellte Datei ergeben dasselbe', () => {
  const a = parseSymbols(fs.readFileSync(EXPORT));
  const b = parseSymbols(fs.readFileSync(OWN));
  assert.deepStrictEqual(a.warnings, []);
  assert.strictEqual(a.symbols.length, 23);
  assert.deepStrictEqual(a.symbols, b.symbols);
  const s = Object.fromEntries(a.symbols.map((x) => [x.name, x]));
  assert.deepStrictEqual([s.Nachlauf_Soll.operand, s.Init_Kennung.operand, s.Anlage.operand, s.Hand_Ein.operand], ['MW3', 'MB7', 'Q1', 'I1']);
  const bad = parseSymbols('Symbolischer Name;Operand\nGut;M1\n1Falsch;M2\nOhneOperand;XY5\nGut;M3\nNetz;2NW3\n');
  assert.strictEqual(bad.symbols.length, 2);
  assert.strictEqual(bad.warnings.length, 3);
  assert.deepStrictEqual(bad.symbols[1], { name: 'Netz', operand: '2NW3', net: 2, type: 'NW', index: 3, comment: null });
});

test('ST-Programm (NET-Test): Kopftabelle, Kommentare, lesen/schreiben, Bausteine', () => {
  const r = parseSt(fs.readFileSync(B('net-test', 'net-test-nt1.st')));
  const o = byKey(r.operands);
  assert.deepStrictEqual(r.warnings, []);
  // Pins von T01 (I1 := T#500ms, Q1 => M3) sind keine Operanden
  assert.strictEqual(o.I1.reads, 1, 'I1 nur aus „Q01 := I01 OR M1“');
  assert.strictEqual(o.Q1.writes, 1, 'Q1 nur aus „Q01 := …“');
  assert.strictEqual(o.M3.writes, 1, 'M3 wird vom Baustein T01 geschrieben (Q1 => M3)');
  assert.strictEqual(o.M5.writes, 1, 'M5 vom Baustein PT01 (AC => M5)');
  assert.strictEqual(o.M1.reads, 1);
  assert.strictEqual(o.M1.writes, 0);
  // Namen und Bemerkungen aus der Kopftabelle, Kommentar hinter der Zeile, Kopien
  assert.strictEqual(o.MW3.tableName, 'Lebenszeichen');
  assert.strictEqual(o.MW3.tableNote, 'lesen (Sekunden seit Start)');
  assert.strictEqual(o.MW9.copyOf, 'IA5');
  assert.match(o.MW9.comment, /^0 \.\.\. 10 V/);
  assert.strictEqual(o.MW3.copyOf, null, 'MW3 wird mehrfach unterschiedlich beschrieben');
  // andere NET-Teilnehmer und Sende-/Empfangsbits
  assert.strictEqual(o['2NW3'].reads, 1);
  assert.strictEqual(o['2SN1'].writes, 1);
  assert.strictEqual(o.MW6.copyOf, '2NW3');
});

test('ST-Programm nur mit symbolischen Namen', () => {
  const symbols = parseSymbols(fs.readFileSync(EXPORT)).symbols;
  const r = parseSt(fs.readFileSync(B('symbole', 'symbol-demo.st')), { symbols });
  const o = byKey(r.operands);
  assert.deepStrictEqual(r.unknownNames, []);
  assert.strictEqual(o.Q1.writes, 1, 'Anlage := … ist Q01');
  assert.strictEqual(o.M12.writes, 1, 'T02_Ausgang ist M12 (Bausteinausgang Q1 => T02_Ausgang)');
  assert.strictEqual(o.MW3.writes, 0);
  assert.ok(o.MW3.reads > 0);
  assert.strictEqual(o.Q2.copyOf, 'M4', 'Stoermeldung := Sollwert_Fehler');
  // ohne Symboltabelle: verständlicher Hinweis
  const w = parseSt(fs.readFileSync(B('symbole', 'symbol-demo.st'))).warnings;
  assert.match(w[0], /symbolische Namen\? Dann die Symboltabelle \(CSV\) mit einlesen/);
});

test('Zusammenführen NET-Test: Namen, lesbare Anzeige, Vorschläge, NET-Partner', () => {
  const r = buildVariables({
    itf: parseItf(fs.readFileSync(B('net-test', 'Netzwerk-net1.itf'), 'utf8')).variables,
    st: parseSt(fs.readFileSync(B('net-test', 'net-test-nt1.st'))), netId: 1,
  });
  const v = byOp(r.variables);
  assert.strictEqual(r.variables.length, 98, 'genau die Variablen der .itf');
  assert.deepStrictEqual([v.MW3.name, v.MW3.label], ['Lebenszeichen', 'Lebenszeichen']);
  assert.deepStrictEqual([v.I1.name, v.I1.label], ['Taster_Ein', 'Taster Ein']);
  assert.deepStrictEqual([v.M14.name, v.M14.label], ['M14', 'Merker M14'], 'ohne Namen: automatisch');
  assert.strictEqual(v.CLOCK5.label, 'Uhr Jahr');
  assert.strictEqual(v.MW9.hint, '= IA5');
  assert.strictEqual(v.M1.role, 'control', 'Fern_Ein: laut Tabelle „schreiben“');
  assert.strictEqual(v.M14.role, 'control', 'M14: nur gelesen -> kommt von außen');
  assert.strictEqual(v.MW3.role, 'display');
  assert.strictEqual(v.M4.role, 'internal', 'Takt_vorher: laut Tabelle „intern“');
  assert.strictEqual(v.M993.role, null, 'nicht im Programm benutzt');
  assert.strictEqual(v.MW3.modbus.register, 46003);
  assert.strictEqual(v.IA2, undefined, 'IA2 steht nur in der Kommentar-Tabelle, nicht im Programm und nicht in der .itf');
  assert.deepStrictEqual(r.foreign.map((f) => f.operand), ['2N1', '2NW3', '2ND3']);
  assert.deepStrictEqual(r.info.map((f) => f.operand), ['2SN1', '2RN1']);
  assert.ok(!r.warnings.some((w) => /nicht in der \.itf/.test(w)));
});

test('Programm ohne Kommentare und ohne Symboltabelle: automatische Namen und Vorschläge', () => {
  const r = buildVariables({ st: parseSt('Q01 := I01 OR M1;\nMW7 := IA01;\nIF MW5 > 100 THEN M2 := TRUE; END_IF;') });
  const v = byOp(r.variables);
  assert.deepStrictEqual(r.variables.map((x) => x.label),
    ['Eingang I1', 'Ausgang Q1', 'Analogeingang IA1', 'Merker M1', 'Merker M2', 'Merkerwort MW5', 'Merkerwort MW7']);
  assert.strictEqual(v.M1.role, 'control');
  assert.strictEqual(v.MW5.role, 'control', 'Sollwert: wird vom Programm nur gelesen');
  assert.strictEqual(v.M2.role, 'display');
  assert.strictEqual(v.MW7.hint, '= IA1');
  assert.strictEqual(v.Q1.writable, false);
  assert.strictEqual(v.M1.writable, true);
});

test('Operand im Programm, aber nicht in der .itf (nicht freigegeben); doppelte Namen', () => {
  const itf = parseItf('Name\tType\tAddress\r\nMW003\tWORD\tR46003\r\n').variables;
  const st = parseSt('(* MW3  Wert\n   MW4  Wert *)\nMW4 := MW3 + 1;');
  const r = buildVariables({ itf, st });
  const v = byOp(r.variables);
  assert.strictEqual(v.MW4.notInItf, true);
  assert.ok(r.warnings.some((w) => /MW4 \(Wert_MW4\) steht im Programm, aber nicht in der \.itf/.test(w)));
  assert.strictEqual(v.MW3.name, 'Wert');
  assert.strictEqual(v.MW4.name, 'Wert_MW4');
  assert.strictEqual(displayLabel('Anlage__Anforderung_'), 'Anlage Anforderung');
});

test('echtes Projekt MQTT-Demo: Tabelle „Name  Operand  Richtung“, Vorschläge wie vom Programmierer', () => {
  const r = importFiles({ itf: B('mqtt-demo', 'easye4_mqtt_demo.itf'), symbols: [EXPORT], st: [B('mqtt-demo', 'easye4_mqtt_demo.st')] });
  const v = byOp(r.variables);
  const role = (...ops) => ops.map((o) => v[o].role);
  assert.deepStrictEqual(role('M5', 'M6', 'M7', 'M8', 'MW3'), ['control', 'control', 'control', 'control', 'control'], 'schreiben');
  assert.deepStrictEqual(role('M1', 'M3', 'M4', 'MD20', 'MD21', 'MD22'), Array(6).fill('display'), 'lesen');
  assert.deepStrictEqual(role('M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'MB7', 'MD23'), Array(8).fill('internal'), 'nur intern');
  assert.strictEqual(v.I2.comment, 'Taster am Geraet (Schliesser)', 'Fließtext „Taster I02 oder M6 …“ ist keine Tabellenzeile');
  assert.strictEqual(v.MW3.modbus.register, 46003);
  assert.deepStrictEqual(r.variables.filter((x) => x.notInItf).map((x) => x.name),
    ['Nachlauf_geprueft', 'Anzahl_Einschalt', 'Nachlauf_Ist', 'T02_Sollwert'], 'MD20–MD23 sind in easySoft nicht freigegeben');
});

test('dasselbe Programm ohne Tabelle und ohne Symbole: Bedienung aus dem Programmablauf erkannt', () => {
  const text = fs.readFileSync(B('mqtt-demo', 'easye4_mqtt_demo.st'), 'latin1').replace(/^\(\*[\s\S]*?\*\)/, '');
  const v = byOp(buildVariables({ st: parseSt(text) }).variables);
  // M5, M8: nur gelesen und gelöscht (:= FALSE); M6, M7: Impuls, das Programm setzt zurück; MW3: Standardwert 3
  assert.deepStrictEqual(['M5', 'M6', 'M7', 'M8', 'MW3'].map((o) => v[o].role), Array(5).fill('control'));
  // M4 setzt das Programm selbst auf TRUE/FALSE (Meldung), M1 kommt aus einem Ausdruck
  assert.deepStrictEqual(['M4', 'M1', 'MD21', 'Q1'].map((o) => v[o].role), Array(4).fill('display'));
  assert.strictEqual(v.M5.label, 'Merker M5');
});

test('erneut einlesen: eigene Änderungen bleiben, neue und entfernte werden gemeldet', () => {
  const old = [
    { id: 'a1', name: 'Wert', operand: 'MW', index: 3, label: 'Wert', userLabel: 'Füllstand', userUnit: '%' },
    { id: 'a2', name: 'Alt', operand: 'MW', index: 9, label: 'Alt' },
  ];
  const fresh = buildVariables({ st: parseSt('(* MW3  Lebenszeichen *)\nMW3 := MW3 + 1;\nQ01 := M1;') }).variables;
  const r = keepUserChanges(old, fresh);
  const v = byOp(r.variables);
  assert.deepStrictEqual([v.MW3.id, v.MW3.name, v.MW3.userLabel, v.MW3.userUnit], ['a1', 'Lebenszeichen', 'Füllstand', '%']);
  assert.deepStrictEqual(r.added.sort(), ['M1', 'Q1']);
  assert.deepStrictEqual(r.removed, ['Alt']);
});

test('Dateien einlesen, ins Gerät übernehmen und über Modbus lesen (Simulator FW 2.46)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-import-'));
  const s = await modbusSim.start({ port: 0, fw: 246, mwTo: 1022 });
  let drv = null;
  try {
    const r = importFiles({ itf: B('net-test', 'Netzwerk-net1.itf'), st: [B('net-test', 'net-test-nt1.st')], netId: 1 });
    const store = new DeviceStore({ dir });
    const d = store.add({ name: 'NT1', protocol: 'modbus', settings: { host: '127.0.0.1', port: s.port } });
    const res = applyToDevice(store, d.id, r);
    assert.strictEqual(res.added.length, 98);
    const vars = store.get(d.id).variables;
    s.st.MW[3] = 1983;
    s.st.MW[1] = 0b10; // M2 = Uhr_sync_Befehl
    drv = createDriver({ protocol: 'modbus', host: '127.0.0.1', port: s.port, gap: 0 });
    const v = await drv.read(vars.filter((x) => ['Lebenszeichen', 'Uhr_sync_Befehl', 'Fern_Ein'].includes(x.name)));
    assert.deepStrictEqual(v.values, { Lebenszeichen: 1983, Uhr_sync_Befehl: 1, Fern_Ein: 0 });
    await drv.write(vars.find((x) => x.name === 'Fern_Ein'), true);
    assert.strictEqual(s.st.MW[1], 0b11);
  } finally {
    if (drv) await drv.close();
    await s.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Prüfprogramm tools/import.js', () => {
  const { main } = require('../tools/import');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    assert.strictEqual(main(['--symbole', EXPORT, '--st', B('symbole', 'symbol-demo.st')]), 0);
    assert.strictEqual(main([]), 2);
  } finally {
    console.log = orig;
  }
  const out = lines.join('\n');
  assert.match(out, /23 Variablen/);
  assert.match(out, /Nachlauf Soll\s+Nachlauf_Soll\s+MW3\s+–\s+Bedienung\s+ja/);
});

test('Prüfung: passt die .itf zur Firmware des Geräts?', () => {
  const { itfFirmware, firmwareWarning } = require('../src/import/check');
  const vars = (file) => parseItf(fs.readFileSync(B(...file.split('/')), 'utf8')).variables;
  assert.strictEqual(itfFirmware(vars('net-test/Netzwerk-net1.itf')), '240');
  assert.strictEqual(itfFirmware(vars('net-test/Netzwerk-net2.itf')), '140');
  assert.strictEqual(itfFirmware(vars('test-netzwerk-nt1-fw246.itf')), '240');
  assert.strictEqual(itfFirmware(vars('easye4mb-beispiel.itf')), '140');
  assert.strictEqual(itfFirmware(vars('mqtt-demo/easye4_mqtt_demo.itf')), '240');
  // die .itf von NT1 (FW 2.46) beim Gerät NT2 (FW 1.4x) – so geschehen beim ersten Test am 26.10.2026
  assert.match(firmwareWarning(vars('net-test/Netzwerk-net1.itf'), '140'), /passt zu Firmware „2.40 oder neuer“, das Gerät ist auf „1.40 bis 2.3x“/);
  assert.strictEqual(firmwareWarning(vars('net-test/Netzwerk-net2.itf'), '140'), null);
  assert.match(firmwareWarning(vars('net-test/Netzwerk-net2.itf'), undefined), /passt zu Firmware „1.40 bis 2.3x“/);
  assert.strictEqual(firmwareWarning(vars('net-test/Netzwerk-net1.itf'), '240'), null);
});

test('Operanden-Kommentare aus easySoft (.xls, FUP/KOP) werden zu Anzeigenamen', () => {
  const { parseComments } = require('../src/import/comments');
  const r = parseComments(fs.readFileSync(B('symbole', 'Export Kommentare FUP.xls')));
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.deviceType, 'CV1SR2ER5CC2');
  assert.deepStrictEqual(r.comments.map((c) => [c.operand, c.text]), [['I1', 'Start Pumpe 1'], ['Q1', 'Pumpe 1']]);
  const v = byOp(buildVariables({ itf: parseItf('Name\tType\tAddress\r\nI01\tBIT\tMI1\r\nQ01\tBIT\tM1\r\nMW003\tWORD\tR46003\r\n').variables,
    comments: r.comments }).variables);
  assert.deepStrictEqual([v.I1.label, v.Q1.label, v.MW3.label], ['Start Pumpe 1', 'Pumpe 1', 'Merkerwort MW3']);
  assert.deepStrictEqual(v.I1.sources, ['itf', 'comments']);
  assert.strictEqual(v.I1.name, 'I1', 'interner Name bleibt der Operand (FUP kennt keine symbolischen Namen)');
});

test('Filter „mit Namen“: auch ohne .itf (MQTT, nur Symboltabelle/ST) – so gesehen am 26.10.2026', () => {
  const { hasRealName } = require('../src/core/pages');
  const r = importFiles({ itf: null, symbols: [B('symbole', 'Symbolische_Namen_easye4_mqtt_demo_Main.csv')],
    st: [B('mqtt-demo', 'easye4_mqtt_demo.st')] });
  const named = r.variables.filter(hasRealName).map((v) => v.name);
  assert.ok(named.includes('Hand_Ein') && named.includes('Fern_Ein') && named.includes('Nachlauf_Soll'), named.join(','));
  // automatische Namen zählen nicht
  assert.strictEqual(hasRealName({ name: 'MW3', operand: 'MW', index: 3, label: 'Merkerwort MW3', sources: ['itf'] }), false);
  assert.strictEqual(hasRealName({ name: 'CLOCK.5', operand: 'CLOCK', index: 5, label: 'Uhr Jahr', sources: ['itf'] }), false);
  // Name aus der Kommentar-Tabelle des ST-Programms („MW3  Lebenszeichen“), eigener Name, Kommentar
  assert.strictEqual(hasRealName({ name: 'MW3', operand: 'MW', index: 3, label: 'Lebenszeichen', sources: ['st'] }), true);
  assert.strictEqual(hasRealName({ name: 'MW3', operand: 'MW', index: 3, label: 'Merkerwort MW3', userLabel: 'Druck', sources: ['itf'] }), true);
  assert.strictEqual(hasRealName({ name: 'I1', operand: 'I', index: 1, label: 'Start Pumpe 1', sources: ['itf', 'comments'] }), true);
});

test('Gerätetasten P1 … P8 (Display-Tasten): beim Einlesen ohne Warnung übergangen, keine Variable', () => {
  const r = parseSymbols('Symbolischer Name;Operand\nLicht_Halle;P01\nLicht_Buero;P02\nTaste_ALT;P8\nNachlauf;MW3\nKaputt;P9\n');
  assert.deepStrictEqual(r.symbols.map((x) => x.name), ['Nachlauf'], 'nur MW3 wird Variable');
  assert.deepStrictEqual(r.warnings.length, 1, 'nur P9 (gibt es nicht) wird gemeldet');
  assert.match(r.warnings[0], /P9/);
});
