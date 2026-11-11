'use strict';
// Mehrsprachigkeit (Version 1, Punkt 5): Texttabelle, Nummern statt Texte in pages.json, Sprachwechsel. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TextStore } = require('../src/core/texts');
const { AppApi } = require('../src/app/api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-texts-'));
const els = (p) => p.items.filter((e) => e.kind !== 'frame');

async function project() {
  const dir = tmp();
  const api = new AppApi({ dir, history: false });
  const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', settings: { host: '127.0.0.1', port: 1 } });
  await api.addVariable(d.id, { operand: 'MW3', name: 'Fuellstand', label: 'Füllstand Behälter' });
  await api.addVariable(d.id, { operand: 'M24', name: 'Al_P2' });
  return { dir, api, d };
}
const page = (devId, extra) => [{ id: 'p1', name: 'Pumpstation', items: [
  { id: 'c1', kind: 'frame', title: 'Behälter', x: 0, y: 0, w: 400, h: 300 },
  Object.assign({ id: 'e1', kind: 'number', dev: devId, name: 'Fuellstand', x: 20, y: 50 }, extra || {}),
  { id: 'e2', kind: 'text', text: 'Nachlauf {1} s', vars: [{ n: 1, dev: devId, name: 'Fuellstand' }], x: 20, y: 130 },
  { id: 'e3', kind: 'choice', dev: devId, name: 'Fuellstand', opts: [{ v: 0, t: 'Aus' }, { v: 1, t: 'Hand' }], x: 20, y: 170 },
] }];

test('Texttabelle: jeder Text bekommt eine Nummer; in pages.json stehen nur Nummern; Editor sieht weiter Texte', async () => {
  const { dir, api, d } = await project();
  try {
    api.savePages(page(d.id, { label: 'Füllstand' }));
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'pages.json'), 'utf8'));
    const el = els(file.pages[0]);
    assert.strictEqual(file.pages[0].name, undefined, 'Seitenname nur als Nummer');
    assert.match(file.pages[0].tx.name, /^T\d{4}$/);
    assert.ok(el[0].tx.label && el[0].label === undefined);
    assert.ok(el[2].opts[0].tx.t && el[2].opts[0].t === undefined, 'auch Betriebsart-Knöpfe');
    assert.strictEqual(els(api.listPages()[0])[0].label, 'Füllstand', 'Editor bekommt Texte');
    assert.ok(file.pages[0].items[0].tx.title, 'Rahmen-Überschrift als Nummer');
    const kinds = api.textRows().rows.map((r) => r.kind).sort();
    assert.deepStrictEqual(kinds, ['card', 'choice', 'choice', 'label', 'page', 'text', 'var']);
    // neu laden: gleich
    const api2 = new AppApi({ dir, history: false });
    assert.deepStrictEqual(api2.listPages(), api.listPages());
    await api2.stop();
  } finally { await api.stop(); }
});

test('Übersetzungen bleiben beim Ändern der Grundsprache, beim Verschieben und beim Kopieren; Unbenutztes fällt weg', async () => {
  const { api, d } = await project();
  try {
    api.addLang('en');
    api.savePages(page(d.id, { label: 'Füllstand' }));
    const rowOf = (text) => api.textRows().rows.find((r) => r.texts.de === text);
    api.setText(rowOf('Füllstand').id, 'en', 'Level');
    api.setText(rowOf('Pumpstation').id, 'en', 'Pump station');
    // Text der Grundsprache ändern: Nummer und Übersetzung bleiben
    const id = rowOf('Füllstand').id;
    api.savePages(page(d.id, { label: 'Füllstand Tank' }));
    assert.deepStrictEqual(api.textRows().rows.find((r) => r.id === id).texts, { de: 'Füllstand Tank', en: 'Level' });
    // Element an eine andere Stelle verschieben
    const p = api.listPages();
    Object.assign(els(p[0])[0], { x: 600, y: 400 });
    api.savePages(p);
    assert.strictEqual(api.textRows().rows.find((r) => r.id === id).texts.en, 'Level', 'verschoben: Übersetzung bleibt');
    // kopiertes Element: neue Nummer, Übersetzung übernommen
    const q = api.listPages();
    q[0].items.push(Object.assign({}, els(q[0])[0], { id: 'e9', y: 500 }));
    api.savePages(q);
    const copies = api.textRows().rows.filter((r) => r.texts.de === 'Füllstand Tank');
    assert.strictEqual(copies.length, 2);
    assert.ok(copies.every((r) => r.texts.en === 'Level'));
    // Element löschen: Text verschwindet aus der Tabelle
    const z = api.listPages();
    z[0].items.pop();
    api.savePages(z);
    assert.strictEqual(api.textRows().rows.filter((r) => r.texts.de === 'Füllstand Tank').length, 1);
  } finally { await api.stop(); }
});

test('Sprachwechsel: Bedienseite, Seitennamen, Variablen-Namen und Meldungen in der gewählten Sprache; fehlt die Übersetzung: Grundsprache; je Benutzer gemerkt', async () => {
  const { api, d } = await project();
  try {
    api.addLang('en');
    api.savePages(page(d.id));
    await api.saveAlarmDefs([{ id: 'a1', dev: d.id, name: 'Al_P2', text: 'Störung Pumpe 2' }]);
    const rows = api.textRows().rows;
    const id = (de) => rows.find((r) => r.texts.de === de).id;
    api.setText(id('Füllstand Behälter'), 'en', 'Tank level');
    api.setText(id('Pumpstation'), 'en', 'Pump station');
    api.setText(id('Störung Pumpe 2'), 'en', 'Pump 2 fault');
    assert.strictEqual(api.lang, 'de');
    api.setLanguage('en');
    assert.strictEqual(api.listPages('current')[0].name, 'Pump station');
    assert.strictEqual(api.listPages()[0].name, 'Pumpstation', 'Editor bleibt in der Grundsprache');
    const v = els(api.viewPage('p1'));
    assert.strictEqual(v[0].label, 'Tank level', 'Anzeige-Name der Variablen übersetzt');
    assert.strictEqual(v[2].opts[0].t, 'Aus', 'fehlende Übersetzung: Grundsprache');
    api.runtime.active = true;
    api.values.update(d.id, { values: { Al_P2: true } });
    assert.strictEqual(api.alarmsActive()[0].text, 'Pump 2 fault');
    api.runtime.active = false;
    assert.strictEqual(api.texts('en').lang, 'en');
    assert.strictEqual(api.texts('pl').lang, 'en', 'Programmtexte anderer Sprachen: Englisch');
    assert.throws(() => api.setLanguage('fr'), /not been added/, 'Fehlermeldung schon auf Englisch');
    // je Benutzer
    const ralf = api.userAdd({ name: 'Ralf', role: 'setup', password: 'geheim123' });
    api.setLanguage('de');
    api.logout();
    assert.strictEqual(api.lang, 'en', 'ohne Anmeldung: zuletzt ohne Anmeldung gewählt');
    api.login(ralf.id, 'geheim123');
    assert.strictEqual(api.lang, 'de', 'Ralf: Deutsch gemerkt');
  } finally { await api.stop(); }
});

test('Import: neue Sprachspalte, leere Zellen ändern nichts, unbekannte IDs und abweichende Platzhalter werden gemeldet', () => {
  const t = new TextStore({ dir: tmp() });
  t.sources = [(cb) => { cb({ a: 'Nachlauf {1} s' }, 'a', 'x', 'text'); cb({ b: 'Pumpe' }, 'b', 'y', 'label'); }];
  t.sync();
  const [r1, r2] = t.rows();
  const res = t.importRows([['ID', 'de', 'en', 'pl', 'Hinweis'], [r1.id, '', 'Run-on s', 'Wybieg {1} s', 'Text'], [r2.id, 'Pumpe', 'Pump', '', ''], ['T9999', 'x', 'y', '', '']]);
  assert.deepStrictEqual(t.langs, ['de', 'en', 'pl'], 'Spalte „pl“ = neue Sprache, „Hinweis“ ignoriert');
  assert.deepStrictEqual(res.unknown, ['T9999']);
  assert.deepStrictEqual(res.placeholders.map((p) => p.lang), ['en'], 'Platzhalter {1} fehlt in English');
  assert.strictEqual(t.get(r1.id, 'de'), 'Nachlauf {1} s', 'leere Zelle ändert nichts');
  assert.strictEqual(t.get(r2.id, 'pl'), 'Pumpe', 'fehlt: Grundsprache');
  assert.throws(() => t.importRows([['Nummer', 'de']]), /Spalte „ID“/);
  assert.deepStrictEqual(t.exportRows({ text: 'Text' })[0], ['ID', 'Hinweis', 'de', 'en', 'pl']);
  // Hinweis vor den Sprachen (wie exportiert) wird beim Einlesen ebenso ignoriert
  assert.strictEqual(t.importRows([['ID', 'Hinweis', 'de', 'en'], [r2.id, 'Beschriftung', 'Pumpe', 'Pump 1']]).changed, 1);
  // Grundsprache wechseln: fehlende Texte werden übernommen
  t.setBase('en');
  assert.strictEqual(t.base, 'en');
  assert.throws(() => t.removeLang('en'), /Grundsprache/);
  t.removeLang('pl');
  assert.deepStrictEqual(t.langs, ['de', 'en']);
});

test('Programmtexte: Englisch vollständig, gleiche Platzhalter wie Deutsch', () => {
  const de = require('../src/i18n/de.json');
  const en = require('../src/i18n/en.json');
  const problems = [];
  const ph = (s) => JSON.stringify([].concat(s).map((x) => (String(x).match(/__\w+?__|\{\d+\}/g) || []).sort()));
  const walk = (d, e, p) => {
    if (typeof d === 'string' || Array.isArray(d)) {
      if (e === undefined) problems.push(`fehlt in en.json: ${p}`);
      else if (ph(d) !== ph(e)) problems.push(`Platzhalter verschieden: ${p}`);
      return;
    }
    for (const k of Object.keys(d)) walk(d[k], e && e[k], `${p}.${k}`);
  };
  walk(de, en, '');
  assert.deepStrictEqual(problems, []);
});

test('Grundsprache wechseln füllt nichts auf; Editor zeigt Ersatztext, übernimmt ihn aber nicht; Kopien entfernen', async () => {
  const { api, d } = await project();
  try {
    api.addLang('en');
    api.savePages(page(d.id, { label: 'Füllstand' }));
    const row = (de) => api.textRows().rows.find((r) => r.texts.de === de);
    api.setText(row('Pumpstation').id, 'en', 'Pump station');
    api.setBaseLang('en');
    assert.strictEqual(row('Füllstand').texts.en, undefined, 'nicht aufgefüllt – bleibt „fehlt“');
    const p = api.listPages();
    assert.strictEqual(p[0].name, 'Pump station', 'Editor: Text der Grundsprache');
    assert.strictEqual(els(p[0])[0].label, 'Füllstand', 'Editor: ersatzweise Deutsch');
    api.savePages(p); // unverändert speichern
    assert.strictEqual(row('Füllstand').texts.en, undefined, 'Ersatztext wird nicht ins Englische übernommen');
    els(p[0])[0].label = 'Level';
    api.savePages(p);
    assert.strictEqual(row('Füllstand').texts.en, 'Level', 'eigene Eingabe landet in der Grundsprache');
    api.setBaseLang('de');
    api.setText(row('Füllstand').id, 'en', 'Füllstand'); // „Übersetzung“ = Kopie
    assert.strictEqual(api.clearTextCopies(), 1);
    assert.strictEqual(row('Füllstand').texts.en, undefined);
  } finally { await api.stop(); }
});

test('Umbau 31.10.2026: alte Seiten mit Karten werden umgewandelt, Sicherung bleibt, Übersetzungen bleiben', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'texte.json'), JSON.stringify({ base: 'de', langs: ['de', 'en'], next: 3,
    texts: { T0001: { de: 'Behälter', en: 'Tank' }, T0002: { de: 'Nachlauf', en: 'Run-on' } },
    kinds: { T0001: 'card', T0002: 'text' }, loc: { 'c:c1#title': 'T0001', 'e:e1#text': 'T0002' } }));
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify({ version: 1, pages: [{ id: 'p1', name: 'S', cards: [
    { id: 'c1', tx: { title: 'T0001' }, x: 0, y: 0, w: 8, h: 6, elements: [{ id: 'e1', kind: 'text', tx: { text: 'T0002' } }] }] }] }));
  const api = new AppApi({ dir, history: false });
  try {
    assert.ok(fs.existsSync(path.join(dir, 'pages-vor-umbau.json')), 'Sicherung der alten Datei');
    const [frame, text] = api.listPages()[0].items;
    assert.deepStrictEqual([frame.kind, frame.title, text.text], ['frame', 'Behälter', 'Nachlauf']);
    api.savePages(api.listPages());
    const rows = api.textRows().rows;
    assert.deepStrictEqual(rows.slice(0, 2).map((r) => [r.id, r.texts.en]), [['T0001', 'Tank'], ['T0002', 'Run-on']], 'gleiche Nummern, Übersetzungen da (T0003 = Seitenname)');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pages.json'), 'utf8')).version, 2);
  } finally { await api.stop(); }
});
