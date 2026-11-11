'use strict';
// Farbthema der Bedienseiten (Teil 4): Lesbarkeit, Ableiten, Prüfen, Speichern, Export/Import. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../src/shared/theme');
const { AppApi } = require('../src/app/api');

test('Kontrast nach WCAG und Vorschlag „besser lesbar“', () => {
  assert.strictEqual(Math.round(T.contrast('#000000', '#FFFFFF')), 21);
  assert.strictEqual(T.contrast('#777777', '#777777'), 1);
  const pale = '#7FB2FF'; // hellblau auf weiß: schlecht lesbar
  assert.ok(T.contrast(pale, '#FFFFFF') < 3);
  const better = T.fix(pale, '#FFFFFF', 4.5);
  assert.ok(T.contrast(better, '#FFFFFF') >= 4.5, 'Vorschlag ist lesbar');
  assert.notStrictEqual(better, '#000000', 'Farbton bleibt, nur dunkler');
  assert.strictEqual(T.fix('#1D5FD1', '#FFFFFF', 4.5), '#1D5FD1', 'lesbare Farbe bleibt');
});

test('alle Vorlagen sind gut lesbar (hell und dunkel)', () => {
  for (const [name, p] of Object.entries(T.PRESETS)) {
    for (const mode of ['light', 'dark']) {
      const bad = T.check(p[mode]).filter((x) => x.level !== 'ok');
      assert.deepStrictEqual(bad, [], `${name} ${mode}`);
    }
  }
});

test('Vorlage Leitstand: eigene Schrift für Überschriften und Werte', () => {
  const p = T.PRESETS.leitstand;
  assert.strictEqual(p.dark.bg, '#0B0F14');
  assert.strictEqual(p.font, 'leitstand');
  const t = T.clean(Object.assign({}, p));
  assert.strictEqual(t.font, 'leitstand', 'Schrift bleibt beim Speichern erhalten');
  const v = T.vars(t, 'dark');
  assert.match(v['--font'], /IBM Plex Sans/);
  assert.match(v['--font-display'], /Space Grotesk/);
  assert.match(v['--font-num'], /IBM Plex Sans/, 'Werte in der zarten Textschrift (Entscheidung 46)');
  assert.match(T.vars(Object.assign({}, T.DEFAULT, { font: 'inter' }), 'dark')['--font-num'], /Inter/, 'andere Themen: Werte in ihrer Textschrift');
});

test('aus einer Farbe ableiten: lesbar, Zustandsfarben bleiben', () => {
  for (const base of ['#E30613', '#FFD500', '#00A3E0', '#2D2D2D', '#7CFC00']) {
    const d = T.derive(base);
    for (const mode of ['light', 'dark']) {
      assert.deepStrictEqual(T.check(d[mode]).filter((x) => x.level !== 'ok'), [], `${base} ${mode}`);
    }
    assert.strictEqual(d.light.alarm, T.PRESETS.blue.light.alarm, 'Störung bleibt rot');
    assert.strictEqual(d.light.on, T.PRESETS.blue.light.on, 'Ein bleibt grün');
  }
});

test('Thema prüfen und CSS-Variablen ausrechnen', () => {
  const t = T.clean({ light: { accent: '#123456', bg: 'rot' }, radius: 'rund', font: 'inter', size: 'large', logo: 'javascript:alert(1)', extra: 1 });
  assert.strictEqual(t.light.accent, '#123456');
  assert.strictEqual(t.light.bg, T.DEFAULT.light.bg, 'ungültige Farbe -> Standard');
  assert.deepStrictEqual([t.radius, t.font, t.size, t.logo, t.extra], ['soft', 'inter', 'large', null, undefined]);
  assert.strictEqual(T.clean({ logo: 'data:image/png;base64,iVBORw0KGgo=' }).logo, 'data:image/png;base64,iVBORw0KGgo=');
  const v = T.vars(t, 'dark');
  assert.strictEqual(v['--accent'], t.dark.accent);
  assert.match(v['--font'], /Inter/);
  assert.strictEqual(v['--radius'], '14px');
  assert.ok(T.contrast(v['--on-accent'], t.light.accent) >= 4.5 || T.contrast(T.vars(t, 'light')['--on-accent'], t.light.accent) >= 4.5);
});

test('Programm: Thema speichern, Logo, Export und Import', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-theme-'));
  const api = new AppApi({ dir });
  try {
    assert.deepStrictEqual(api.getTheme(), T.clean(T.DEFAULT), 'ohne Datei: Standard');
    const saved = api.saveTheme(Object.assign({}, T.DEFAULT, T.derive('#E30613'), { font: 'atkinson' }));
    assert.strictEqual(new AppApi({ dir }).getTheme().font, 'atkinson', 'nach Neustart noch da');
    // Logo
    const png = path.join(dir, 'logo.png');
    fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
    assert.match(api.logoFromFile(png), /^data:image\/png;base64,/);
    fs.writeFileSync(path.join(dir, 'logo.gif'), 'x');
    assert.throws(() => api.logoFromFile(path.join(dir, 'logo.gif')), /PNG, JPG oder SVG/);
    fs.writeFileSync(path.join(dir, 'gross.png'), Buffer.alloc(1024 * 1024 + 1));
    assert.throws(() => api.logoFromFile(path.join(dir, 'gross.png')), /1 MB/);
    // Export -> Standard -> Import
    const file = path.join(dir, 'thema.json');
    api.exportTheme(file);
    api.saveTheme(T.DEFAULT);
    assert.deepStrictEqual(api.importTheme(file), saved);
    fs.writeFileSync(path.join(dir, 'falsch.json'), '{"devices":[]}');
    assert.throws(() => api.importTheme(path.join(dir, 'falsch.json')), /kein easy4Visu-Farbthema/);
  } finally {
    await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('eigene Vorlagen: speichern, gleicher Name ersetzt, löschen, Design bleibt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-preset-'));
  const api = new AppApi({ dir });
  try {
    assert.deepStrictEqual(api.getThemePresets(), []);
    assert.throws(() => api.saveThemePreset('  '), /Namen/);
    api.saveTheme(Object.assign({}, T.DEFAULT, T.derive('#E30613'), { font: 'inter' }));
    let list = api.saveThemePreset('Firmenrot');
    assert.strictEqual(list.length, 1);
    assert.deepStrictEqual([list[0].name, list[0].font, list[0].light.accent], ['Firmenrot', 'inter', api.getTheme().light.accent]);
    api.saveTheme(T.DEFAULT); // anderes Design: Vorlage bleibt
    assert.strictEqual(new AppApi({ dir }).getThemePresets()[0].name, 'Firmenrot', 'nach Neustart noch da');
    list = api.saveThemePreset('firmenrot'); // gleicher Name: ersetzen
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].font, 'plex');
    list = api.saveThemePreset('Zweite');
    assert.strictEqual(list.length, 2);
    list = api.deleteThemePreset(list[0].id);
    assert.deepStrictEqual(list.map((x) => x.name), ['Zweite']);
    assert.deepStrictEqual(api.getTheme(), T.clean(T.DEFAULT), 'Löschen ändert das Design nicht');
  } finally {
    await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Farbe „Bedienelemente“: darf fehlen (dann wie bisher), wird geprüft und gespeichert', () => {
  const TH = require('../src/shared/theme');
  const def = TH.clean({});
  assert.strictEqual(def.dark.control, undefined, 'Standard ohne eigene Farbe');
  assert.strictEqual(TH.vars(def, 'dark')['--control'], undefined, 'dann keine CSS-Variable (bisherige Flächen gelten)');
  const own = TH.clean({ light: { control: '#e8edf2' }, dark: { control: 'grün' } });
  assert.strictEqual(own.light.control, '#E8EDF2');
  assert.strictEqual(own.dark.control, undefined, 'ungültige Farbe fällt weg');
  assert.strictEqual(TH.vars(own, 'light')['--control'], '#E8EDF2');
  const ls = TH.clean(TH.PRESETS.leitstand);
  assert.ok(ls.dark.control && ls.dark.control !== ls.dark.surface, 'Leitstand: helleres Grau für Knöpfe');
  const c = TH.check(ls.dark).find((x) => x.role === 'control');
  assert.strictEqual(c.level, 'ok', 'Schrift auf den Knöpfen gut lesbar');
  assert.strictEqual(TH.check(TH.clean({ dark: { control: '#E7EDF3' } }).dark).find((x) => x.role === 'control').level, 'ok', 'helle Knöpfe: Schrift wird dunkel (seit 07.11.2026 automatisch)');
});

test('Tiefe „leicht“ und Schrift auf Bedienelementen passt sich an (Ralf 07.11.2026)', () => {
  const TH = require('../src/shared/theme');
  assert.strictEqual(TH.clean({}).depth, 'flat', 'ab Werk flach');
  assert.strictEqual(TH.clean({ depth: 'soft' }).depth, 'soft');
  assert.strictEqual(TH.clean({ depth: 'quatsch' }).depth, 'flat');
  const t = TH.clean({ depth: 'soft', light: { control: '#6B6B6B' }, dark: { control: '#9A9898' } });
  const vl = TH.vars(t, 'light');
  const vd = TH.vars(t, 'dark');
  assert.notStrictEqual(vl['--ctl-shadow'], 'none', 'Taster mit Tiefe');
  assert.notStrictEqual(vd['--frame-shadow'], 'none', 'Rahmen mit Schatten');
  assert.strictEqual(TH.vars(TH.clean({}), 'light')['--ctl-shadow'], 'none', 'flach: kein Schatten');
  // heller Taster im Dunkeln bekommt dunkle Schrift, dunkler Taster im Hellen helle Schrift – beide gut lesbar
  assert.ok(TH.contrast(vd['--on-control'], '#9A9898') >= 4.5, `dunkel: ${vd['--on-control']}`);
  assert.ok(TH.contrast(vl['--on-control'], '#6B6B6B') >= 4.5, `hell: ${vl['--on-control']}`);
  for (const mode of ['light', 'dark']) {
    const c = TH.check(t[mode]).find((x) => x.role === 'control');
    assert.strictEqual(c.level, 'ok', `Bewertung ${mode}: ${c.ratio}`);
  }
});
