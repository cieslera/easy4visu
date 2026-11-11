'use strict';
// „Meine Symbole“: eigene Bildersammlung des Projekts. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppApi } = require('../src/app/api');
const SYMBOLS = require('../src/core/symbols');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `easy4visu-sym-${n}-`));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="${c}"/></svg>`;

/** Ordner wie beim Anwender: Bilder direkt darin und in Unterordnern */
function folder() {
  const root = tmp('src');
  const w = (rel, data) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
  w('logo.png', PNG);
  w('Pumpen/pumpe-an.svg', svg('green'));
  w('Pumpen/pumpe-aus.svg', svg('gray'));
  w('Pumpen/alt/pumpe-stoer.svg', svg('red')); // tiefer: zählt zur Gruppe „Pumpen“
  w('Ventile/ventil-auf.svg', svg('blue'));
  w('Ventile/liesmich.txt', 'kein Bild');
  w('.versteckt/geheim.svg', svg('black'));
  return root;
}

test('Ordner einlesen: Unterordner werden Gruppen, nur Bilder, versteckte nicht', () => {
  const list = SYMBOLS.scanFolder(folder()).map((x) => `${x.group}|${path.basename(x.file)}`);
  assert.deepStrictEqual(list, ['|logo.png', 'Pumpen|pumpe-stoer.svg', 'Pumpen|pumpe-an.svg', 'Pumpen|pumpe-aus.svg', 'Ventile|ventil-auf.svg']);
});

test('übernehmen, doppelte erkennen, umbenennen, entfernen – Bild bleibt für Seiten erhalten', async () => {
  const dir = tmp('a');
  const api = new AppApi({ dir, history: false });
  const r = api.symbolsAdd(SYMBOLS.scanFolder(folder()));
  assert.strictEqual(r.added, 5);
  assert.match(r.text, /5 Bilder übernommen/);
  const list = api.symbolsList();
  assert.deepStrictEqual(list.map((s) => `${s.group}|${s.name}`), ['|logo', 'Pumpen|pumpe-stoer', 'Pumpen|pumpe-an', 'Pumpen|pumpe-aus', 'Ventile|ventil-auf']);
  assert.ok(list.every((s) => fs.existsSync(path.join(dir, 'bilder', s.img))), 'Bilder liegen im Projekt');
  // dasselbe noch einmal: nichts doppelt
  const again = api.symbolsAdd(SYMBOLS.scanFolder(folder()));
  assert.strictEqual(again.added, 0);
  assert.strictEqual(again.known, 5);
  assert.match(again.text, /5 schon vorhanden/);
  // falsche Datei
  const bad = path.join(dir, 'x.txt');
  fs.writeFileSync(bad, 'nein');
  const f = api.symbolsAdd([{ file: bad, group: '' }]);
  assert.strictEqual(f.failed.length, 1);
  assert.match(f.text, /1 nicht übernommen \(x\.txt\)/);
  // umbenennen und Gruppe ändern
  const an = list.find((s) => s.name === 'pumpe-an');
  api.symbolUpdate(an.img, { name: '  Pumpe läuft ', group: 'Anlage' });
  assert.deepStrictEqual(api.symbolsList().find((s) => s.img === an.img), { img: an.img, name: 'Pumpe läuft', group: 'Anlage' });
  api.symbolUpdate(an.img, { name: '' });
  assert.strictEqual(api.symbolsList().find((s) => s.img === an.img).name, 'Pumpe läuft', 'leerer Name: bleibt');
  // entfernen: weg aus der Sammlung, Datei bleibt (Seiten benutzen sie vielleicht)
  api.symbolRemove(an.img);
  assert.ok(!api.symbolsList().some((s) => s.img === an.img));
  assert.ok(fs.existsSync(path.join(dir, 'bilder', an.img)));
  await api.stop();
});

test('Sammlung ist in der Projekt-Sicherung', async () => {
  const a = tmp('b');
  const api = new AppApi({ dir: a, history: false });
  api.symbolsAdd(SYMBOLS.scanFolder(folder()));
  const file = path.join(a, 'p.easy4visu');
  api.saveBackup(file, {});
  await api.stop();
  const b = tmp('c');
  const other = new AppApi({ dir: b, history: false });
  await other.restoreBackup(file, {});
  await other.stop();
  const again = new AppApi({ dir: b, history: false });
  assert.deepStrictEqual(again.symbolsList().map((s) => s.name), ['logo', 'pumpe-stoer', 'pumpe-an', 'pumpe-aus', 'ventil-auf']);
  await again.stop();
});

test('Rechte: Sammlung nur für Techniker', async () => {
  const api = new AppApi({ dir: tmp('d'), history: false });
  const s = api.userAdd({ name: 'Ralf', role: 'setup', password: 'test1234' });
  const op = api.userAdd({ name: 'Bodo', role: 'operator', password: 'bodo1234' });
  api.logout();
  api.login(op.id, 'bodo1234');
  assert.throws(() => api.symbolsList());
  assert.throws(() => api.symbolsAdd([]));
  api.logout();
  api.login(s.id, 'test1234');
  assert.deepStrictEqual(api.symbolsList(), []);
  await api.stop();
});
