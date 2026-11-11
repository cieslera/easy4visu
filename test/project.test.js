'use strict';
// Eigene Bedienseiten (Editor): speichern, prüfen, anzeigen. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PageStore, cleanPages, screenRows } = require('../src/core/project');
const { suggestKind, kindsFor, resolvePage } = require('../src/core/pages');
const { AppApi } = require('../src/app/api');

const B = (...p) => path.join(__dirname, '..', 'beispiele', ...p);
// Elemente einer Seite ohne Rahmen; ohne Platz und Größe (für Vergleiche des Inhalts)
const els = (p) => p.items.filter((e) => e.kind !== 'frame');
const bare = (e) => { const o = Object.assign({}, e); for (const k of ['x', 'y', 'w', 'h', 'font']) delete o[k]; return o; };

test('Seiten speichern und wieder laden; Unsinn wird bereinigt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-pages-'));
  try {
    const store = new PageStore({ dir }).load();
    assert.deepStrictEqual(store.list(), []);
    store.save([{ id: 'p1', name: '  Halle  ', cards: [
      { id: 'c1', title: 'Pumpe', span: 6, elements: [
        { id: 'e1', kind: 'switch', dev: 'd1', name: 'Fern_Ein', label: '', unit: ' ', min: 'x', half: 1 },
        { id: 'e1', kind: 'unbekannt', dev: 'd1', name: 'MW3', max: '50' }, // doppelte id, falsche Art
        { kind: 'text', text: 'Hinweis', size: 'riesig', dev: 'weg' },
      ] },
      { id: 'c2', span: 5, elements: [] },
    ] }, { name: '' }]);
    const again = new PageStore({ dir }).load().list();
    assert.strictEqual(again.length, 2);
    assert.strictEqual(again[0].name, 'Halle');
    assert.strictEqual(again[1].name, 'Seite 2', 'leerer Name bekommt einen');
    const [a, b, c] = els(again[0]);
    assert.deepStrictEqual(bare(a), { id: 'e1', kind: 'switch', dev: 'd1', name: 'Fern_Ein' }, 'leere Angaben fallen weg');
    assert.notStrictEqual(b.id, 'e1', 'doppelte id ersetzt');
    assert.deepStrictEqual([b.kind, b.max], ['number', 50]);
    assert.deepStrictEqual(bare(c), { id: c.id, kind: 'text', text: 'Hinweis', size: 'normal' });
    // alte Seite (span von 12) -> Rahmen nebeneinander (span 6 = halbe Breite, unbekannt = 8 von 24 Spalten)
    const frames = again[0].items.filter((e) => e.kind === 'frame');
    assert.deepStrictEqual(frames.map((f) => [f.id, f.title, f.x, f.y, f.w]), [['c1', 'Pumpe', 0, 0, 950], ['c2', undefined, 970, 0, 630]]);
    assert.ok(frames[0].h >= 240, 'Höhe nach Inhalt geschätzt (mindestens 8 alte Reihen)');
    assert.deepStrictEqual(cleanPages('kaputt'), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('freie Elemente: Platz und Größe werden begrenzt, fehlende Größe = Standard, alte Seiten umgebrochen', () => {
  const [p] = cleanPages([{ id: 'p', name: 'S', items: [
    { id: 'a', kind: 'lamp', x: -5, y: 'x', w: 5, h: 99999 },
    { id: 'b', kind: 'gauge' },
    { id: 'c', kind: 'bar', orient: 'v', x: 12.4, y: 30 },
  ] }]);
  assert.deepStrictEqual(p.items.map((e) => [e.x, e.y, e.w, e.h]), [[0, 0, 20, 20000], [0, 0, 260, 260], [12, 30, 100, 240]]);
  assert.strictEqual(p.width, 1920, 'Seitenbreite Standard: Full HD');
  assert.strictEqual(cleanPages([{ name: 'x', width: 1280 }])[0].width, 1280);
  assert.strictEqual(cleanPages([{ name: 'x', width: 'x' }])[0].width, 1920, 'keine Zahl -> Standard');
  assert.strictEqual(p.height, 1080, 'alte Seite ohne Höhe: 16 : 9');
  assert.strictEqual(cleanPages([{ name: 'x', width: 1280 }])[0].height, 720);
  const [panel] = cleanPages([{ name: 'x', width: 800, height: 480, scroll: 1, start: true }]);
  assert.deepStrictEqual([panel.width, panel.height, panel.scroll, panel.start], [800, 480, true, true], 'Industriepanel 7"');
  assert.strictEqual(cleanPages([{ name: 'x', width: 99999, height: 10 }])[0].width, 3840, 'Grenzen');
  assert.strictEqual(cleanPages([{ name: 'a', start: true }, { name: 'b', start: true }]).filter((x) => x.start).length, 1, 'nur eine Startseite');
  assert.strictEqual(screenRows(1080), 34, '1080 px = 34 Reihen à 20 + 12');
  assert.strictEqual(screenRows(720), 23, '720 px: 23 Reihen (724 px) passen besser als 22 (692 px)');
  const [f] = cleanPages([{ name: 'x', items: [{ id: 'a', kind: 'text', font: 130 }, { id: 'b', kind: 'text', font: 100 }, { id: 'c', kind: 'text', font: 999 }] }]);
  assert.deepStrictEqual(f.items.map((e) => e.font), [130, undefined, 250], 'Schriftgröße je Element');
  const [old] = cleanPages([{ id: 'q', name: 'Alt', cards: [
    { id: 'a', span: 8, elements: [] }, { id: 'b', span: 6, elements: [] }, { id: 'c', span: 12, rows: 2, elements: [] },
  ] }]);
  const [fa, fb, fc] = old.items;
  assert.deepStrictEqual([fa.x, fb.x, fc.x, fc.w], [0, 0, 0, 1920], 'passt nicht daneben -> nächste Reihe');
  assert.ok(fb.y >= fa.y + fa.h, 'darunter, ohne Überlappung');
  assert.ok(fc.h >= 240, 'rows 2 -> mindestens 8 alte Reihen');
});

test('Vorschlag beim Ziehen einer Variablen auf die Seite', () => {
  const v = (o) => Object.assign({ type: 'BIT', writable: true, operand: 'M', index: 1 }, o);
  assert.strictEqual(suggestKind(v({ operand: 'Q', writable: false })), 'lamp', 'Ausgang -> Statusleuchte');
  assert.strictEqual(suggestKind(v({ operand: 'I', writable: true })), 'lamp', 'Eingang nie bedienbar');
  assert.strictEqual(suggestKind(v({})), 'switch', 'schreibbarer Merker -> Schalter');
  assert.strictEqual(suggestKind(v({ comment: '1 = Impuls' })), 'button');
  assert.strictEqual(suggestKind(v({ role: 'display' })), 'lamp', 'Vorschlag „Anzeige“ geht vor');
  assert.strictEqual(suggestKind(v({ type: 'WORD', operand: 'MW' })), 'setpoint', 'Merkerwort -> Sollwert');
  assert.strictEqual(suggestKind(v({ type: 'WORD', operand: 'IA', writable: false })), 'number');
  assert.strictEqual(suggestKind(v({ type: 'WORD', operand: 'CLOCK', index: null })), 'clock');
  assert.deepStrictEqual(kindsFor(v({ operand: 'Q', writable: false })), ['lamp', 'status']);
  assert.deepStrictEqual(kindsFor(v({})), ['lamp', 'status', 'switch', 'button']);
  assert.deepStrictEqual(kindsFor(v({ type: 'WORD', operand: 'IA', writable: false })), ['number', 'kpi', 'status', 'bar', 'gauge'], 'Analogwert: KPI-Kachel, Balken, Zeiger');
  assert.deepStrictEqual(kindsFor(v({ type: 'WORD', operand: 'MW' })), ['number', 'kpi', 'status', 'bar', 'gauge', 'setpoint', 'slider', 'choice'], 'Merkerwort: auch Schieberegler, Betriebsart');
});

test('KPI-Kachel, Betriebsart, Gerätekarte: Datenformat und Anzeige', () => {
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Betriebsart_P1', label: 'Betriebsart P1', operand: 'MW', index: 61, type: 'WORD', writable: true },
    { name: 'Lebenszeichen', label: 'Lebenszeichen', operand: 'MW', index: 90, type: 'WORD', writable: true },
  ] }];
  const [clean] = cleanPages([{ id: 'p', name: 'S', cards: [{ id: 'c', elements: [
    { id: 'a', kind: 'choice', dev: 'd1', name: 'Betriebsart_P1', opts: [{ v: 0, t: 'Aus' }, { v: '2', t: ' Auto ' }, { v: 'x', t: 'falsch' }] },
    { id: 'b', kind: 'choice', dev: 'd1', name: 'Betriebsart_P1', opts: [{ v: 1, t: 'nur einer' }] },
    { id: 'k', kind: 'kpi', dev: 'd1', name: 'Lebenszeichen', noAddr: 1 },
    { id: 'g', kind: 'device', dev: 'd1', name: 'Lebenszeichen' },
    { id: 'h', kind: 'device', dev: 'd1', name: '' },
    { id: 'x', kind: 'device', dev: 'weg', name: '' },
  ] }] }]);
  const list = els(clean);
  assert.deepStrictEqual(list[0].opts, [{ v: 0, t: 'Aus' }, { v: 2, t: 'Auto' }], 'ungültige Knöpfe fallen weg');
  assert.strictEqual(list[1].opts, undefined, 'weniger als zwei Knöpfe: Standard');
  assert.strictEqual(list[2].noAddr, true);
  const r = els(resolvePage(clean, devices));
  assert.deepStrictEqual(r[0].opts, [{ v: 0, t: 'Aus' }, { v: 2, t: 'Auto' }]);
  assert.deepStrictEqual(r[1].opts.map((o) => o.t), ['Aus', 'Hand', 'Automatik'], 'Standard Aus/Hand/Automatik');
  assert.deepStrictEqual([r[2].kind, r[2].noAddr, r[2].operand], ['kpi', true, 'MW90']);
  assert.deepStrictEqual([r[3].label, r[3].heartbeat, r[3].deps], ['NT1', 'Lebenszeichen', [{ dev: 'd1', name: 'Lebenszeichen' }]]);
  assert.deepStrictEqual([r[4].heartbeat, r[4].deps], [null, []], 'ohne Lebenszeichen');
  assert.strictEqual(r[5].missing, true, 'Gerät gelöscht');
});

test('Balken, Zeiger, Schieberegler: Skala aus der Bemerkung, sonst 0 … 100; senkrecht bleibt erhalten', () => {
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Nachlauf_Soll', label: 'Nachlauf Soll', operand: 'MW', index: 3, type: 'WORD', writable: true, comment: '0 ... 5999 Sekunden' },
    { name: 'IA1', label: 'Füllstand', operand: 'IA', index: 1, type: 'WORD', writable: false },
  ] }];
  const page = cleanPages([{ id: 'p', name: 'S', cards: [{ id: 'c', span: 4, elements: [
    { id: 'a', kind: 'bar', dev: 'd1', name: 'IA1', orient: 'v', max: 4095 },
    { id: 'b', kind: 'gauge', dev: 'd1', name: 'IA1', orient: 'quer' },
    { id: 'c', kind: 'slider', dev: 'd1', name: 'Nachlauf_Soll', step: 10 },
    { id: 'd', kind: 'slider', dev: 'd1', name: 'IA1' },
  ] }] }])[0];
  const [bar, gauge, slider, notWritable] = els(resolvePage(page, devices));
  assert.deepStrictEqual([bar.kind, bar.orient, bar.min, bar.max], ['bar', 'v', 0, 4095]);
  assert.deepStrictEqual([gauge.kind, gauge.orient, gauge.min, gauge.max], ['gauge', undefined, 0, 100]);
  assert.deepStrictEqual([slider.kind, slider.min, slider.max, slider.step, slider.unit], ['slider', 0, 5999, 10, 's']);
  assert.strictEqual(notWritable.kind, 'number', 'Analogwert kann kein Schieberegler sein');
});

test('Balken: Breite, Wert-Position, Skala; Zeiger: Striche außen – Unbekanntes fällt weg', () => {
  const devices = [{ id: 'd1', name: 'NT1', variables: [{ name: 'IA1', label: 'Füllstand', operand: 'IA', index: 1, type: 'WORD', writable: false }] }];
  const page = cleanPages([{ id: 'p', name: 'S', cards: [{ id: 'c', span: 4, elements: [
    { id: 'a', kind: 'bar', dev: 'd1', name: 'IA1', bw: 'l', valpos: 'bottom', ticks: 'off' },
    { id: 'b', kind: 'bar', dev: 'd1', name: 'IA1', bw: 'riesig', valpos: 'links', ticks: 'out' },
    { id: 'c', kind: 'gauge', dev: 'd1', name: 'IA1', ticks: 'out', bw: 'm' },
    { id: 'd', kind: 'gauge', dev: 'd1', name: 'IA1', ticks: 'off' },
  ] }] }])[0];
  const [a, b, c, d] = els(resolvePage(page, devices));
  assert.deepStrictEqual([a.bw, a.valpos, a.ticks], ['l', 'bottom', 'off']);
  assert.deepStrictEqual([b.bw, b.valpos, b.ticks], [undefined, undefined, undefined]);
  assert.deepStrictEqual([c.ticks, c.bw], ['out', undefined]);
  assert.strictEqual(d.ticks, undefined);
});

test('Seite anzeigen: Angaben aus der Variablen, eigene gehen vor, fehlende Variable markiert', () => {
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Nachlauf_Soll', label: 'Nachlauf Soll', operand: 'MW', index: 3, type: 'WORD', writable: true, comment: '0 ... 5999 Sekunden' },
    { name: 'Anlage', label: 'Anlage', operand: 'Q', index: 1, type: 'BIT', writable: false },
  ] }];
  const page = { id: 'p', name: 'Start', items: [
    { id: 'a', kind: 'setpoint', dev: 'd1', name: 'Nachlauf_Soll' },
    { id: 'b', kind: 'setpoint', dev: 'd1', name: 'Nachlauf_Soll', label: 'Soll', max: 100 },
    { id: 'c', kind: 'switch', dev: 'd1', name: 'Anlage' },
    { id: 'd', kind: 'lamp', dev: 'd1', name: 'Gibt_es_nicht' },
    { id: 'e', kind: 'text', text: 'Hallo' },
  ] };
  const r = resolvePage(page, devices);
  const [a, b, c, d, e] = els(r);
  assert.deepStrictEqual([a.label, a.unit, a.min, a.max, a.operand, a.deviceName], ['Nachlauf Soll', 's', 0, 5999, 'MW3', 'NT1']);
  assert.deepStrictEqual([b.label, b.max], ['Soll', 100]);
  assert.strictEqual(c.kind, 'lamp', 'Ausgang kann kein Schalter sein');
  assert.ok(d.missing);
  assert.strictEqual(e.text, 'Hallo');
  assert.deepStrictEqual(r.devices, ['d1']);
});

test('Programm-Schnittstelle: Seiten speichern, Element vorschlagen, Seite anzeigen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-api-'));
  const api = new AppApi({ dir });
  try {
    const d = await api.saveDevice({ name: 'NT1', protocol: 'modbus', enabled: false, settings: { host: '127.0.0.1' } });
    const pre = api.previewImport({ itf: B('mqtt-demo', 'easye4_mqtt_demo.itf'), st: [B('mqtt-demo', 'easye4_mqtt_demo.st')],
      symbols: [B('symbole', 'Symbolische_Namen_easye4_mqtt_demo_Main.csv')] }, null, d.id);
    await api.applyImport(d.id, pre.variables);
    const sw = api.suggestElement(d.id, 'Fern_Ein');
    assert.deepStrictEqual(sw, { kind: 'switch', dev: d.id, name: 'Fern_Ein' });
    assert.strictEqual(api.suggestElement(d.id, 'Anlage').kind, 'lamp');
    assert.throws(() => api.suggestElement(d.id, 'nix'), /nicht gefunden/);
    const saved = api.savePages([{ id: 'p1', name: 'Start', cards: [{ id: 'c1', title: 'Pumpe', span: 6,
      elements: [Object.assign({ id: 'e1' }, sw)] }] }]);
    assert.strictEqual(saved.length, 1);
    const view = api.viewPage('p1');
    assert.strictEqual(els(view)[0].label, 'Fern Ein');
    assert.deepStrictEqual([view.items[0].kind, view.items[0].title], ['frame', 'Pumpe'], 'Karte wurde zum Rahmen');
    assert.throws(() => api.viewPage('weg'), /nicht gefunden/);
    // nach Neustart noch da
    await api.stop();
    const api2 = new AppApi({ dir });
    assert.strictEqual(els(api2.listPages()[0])[0].name, 'Fern_Ein');
    await api2.stop();
  } finally {
    await api.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Teil 3b: Text mit Werten, Werteliste, Darstellung, Tipptaster', () => {
  const pages = cleanPages([{ id: 'p', name: 'S', cards: [{ id: 'c', span: 4, elements: [
    { id: 't', kind: 'text', text: 'Nachlauf {1} s, {2}', vars: [{ n: 1, dev: 'd1', name: 'Nachlauf_Soll', decimals: 9, unit: ' s ' }, { n: 'x' }, { n: 2, dev: 'd1', name: 'Weg' }] },
    { id: 's', kind: 'status', dev: 'd1', name: 'Nachlauf_Soll', show: 'text', icon: 'pump',
      map: [{ from: 0, text: 'Stopp', color: 'off' }, { from: 80, to: 100, text: 'hoch', color: 'warn', icon: 'BÖSE' }, { from: 'x', color: 'pink' }],
      other: { text: 'Unbekannt' } },
    { id: 'w', kind: 'switch', dev: 'd1', name: 'Fern_Ein', style: 'buttons', onText: 'Auto', offText: 'Hand' },
    { id: 'b', kind: 'button', dev: 'd1', name: 'Fern_Ein', mode: 'tip' },
  ] }] }]);
  const [t, s, w, b] = els(pages[0]);
  assert.deepStrictEqual(t.vars, [{ n: 1, dev: 'd1', name: 'Nachlauf_Soll', decimals: 6, unit: 's' }, { n: 2, dev: 'd1', name: 'Weg' }], 'Platzhalter geprüft');
  assert.deepStrictEqual(s.map, [{ from: 0, text: 'Stopp', color: 'off' }, { from: 80, to: 100, text: 'hoch', color: 'warn' }, { from: 0 }], 'Werteliste geprüft');
  assert.deepStrictEqual([s.show, s.icon, s.other], ['text', 'pump', { text: 'Unbekannt' }]);
  assert.deepStrictEqual([w.style, w.onText, w.offText, b.mode], ['buttons', 'Auto', 'Hand', 'tip']);

  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Nachlauf_Soll', label: 'Nachlauf Soll', operand: 'MW', index: 3, type: 'WORD', writable: true, comment: '0 ... 5999 Sekunden' },
    { name: 'Fern_Ein', label: 'Fern Ein', operand: 'M', index: 5, type: 'BIT', writable: true },
  ] }];
  const r = resolvePage(pages[0], devices);
  const [rt, rs, rw, rb] = els(r);
  assert.deepStrictEqual(rt.vars.map((x) => [x.label, x.unit, x.varUnit, !!x.missing]), [['Nachlauf Soll', 's', 's', false], ['Weg', undefined, undefined, true]]);
  assert.deepStrictEqual(rt.deps, [{ dev: 'd1', name: 'Nachlauf_Soll' }]);
  assert.deepStrictEqual([rs.kind, rs.map.length, rs.other.text], ['status', 3, 'Unbekannt']);
  assert.deepStrictEqual([rw.style, rw.onText, rb.mode, rb.writable], ['buttons', 'Auto', 'tip', true]);
  assert.deepStrictEqual(r.devices, ['d1']);
  assert.ok(kindsFor(devices[0].variables[0]).includes('status'));
});

test('Teil 2: Bild-Element, Seitenhintergrund, Bilder im Datenordner', () => {
  const { storeImage, imageFile } = require('../src/core/project');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-img-'));
  try {
    const src = path.join(dir, 'Logo.PNG');
    fs.writeFileSync(src, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const name = storeImage(dir, src);
    assert.match(name, /^[a-f0-9]{16}\.png$/);
    assert.strictEqual(storeImage(dir, src), name, 'gleiches Bild = gleiche Datei');
    assert.ok(imageFile(dir, name).type === 'image/png');
    assert.strictEqual(imageFile(dir, '../devices.json'), null, 'nichts außerhalb von bilder/');
    fs.writeFileSync(path.join(dir, 'x.exe'), 'x');
    assert.throws(() => storeImage(dir, path.join(dir, 'x.exe')), (e) => e.code === 'type');
    const [p] = cleanPages([{ name: 'S', bg: { img: name, fit: 'tile' }, cards: [{ id: 'c', elements: [
      { id: 'i', kind: 'image', img: name, fit: 'cover', alt: ' Firmenlogo ', dev: 'x', name: 'y' },
      { id: 'j', kind: 'image', img: '../böse.png', fit: 'quatsch' },
    ] }] }]);
    assert.deepStrictEqual(p.bg, { img: name, fit: 'tile' });
    assert.deepStrictEqual(bare(els(p)[0]), { id: 'i', kind: 'image', img: name, fit: 'cover', alt: 'Firmenlogo', states: true, dev: 'x', name: 'y' }, 'mit Variable = Statusbild');
    assert.deepStrictEqual(bare(els(p)[1]), { id: 'j', kind: 'image' }, 'ungültiger Name/Darstellung fällt weg');
    assert.deepStrictEqual(cleanPages([{ name: 'S', bg: { color: '#AABBCC' } }])[0].bg, { color: '#aabbcc' });
    assert.strictEqual(cleanPages([{ name: 'S', bg: { color: 'red' } }])[0].bg, undefined, 'nur #rrggbb');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Teil 3: Leisten-Vorlage und Funktionstasten', () => {
  const { cleanBars, defaultBars } = require('../src/core/project');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-bars-'));
  try {
    const store = new PageStore({ dir }).load();
    assert.deepStrictEqual(store.getBars(), defaultBars(), 'ohne Datei: Vorgabe A (oben + unten)');
    assert.ok(store.getBars().bottom.items.some((x) => x.type === 'fkey' && x.action === 'exit' && x.key === 'F12'), 'Taste „Verlassen“ (F12)');
    store.save([{ name: 'S', noBars: true }]);
    store.saveBars({ top: { on: false, items: [] }, left: { on: true, items: [{ type: 'fkey', action: 'write', dev: 'd', name: 'M10', key: 'F2', confirm: 1, label: ' Start ' }, { type: 'quatsch' }] } });
    const again = new PageStore({ dir }).load();
    assert.strictEqual(again.list()[0].noBars, true, 'Seite ohne Leisten bleibt');
    const b = again.getBars();
    assert.strictEqual(b.top.on, false);
    assert.deepStrictEqual(b.bottom, defaultBars().bottom, 'fehlende Leiste: Vorgabe');
    assert.deepStrictEqual(Object.assign({}, b.left.items[0], { id: 'x' }), { id: 'x', type: 'fkey', action: 'write', label: 'Start', key: 'F2', confirm: true, dev: 'd', name: 'M10', value: 1 });
    assert.strictEqual(b.left.items.length, 1, 'unbekannter Baustein fällt weg');
    const [p] = cleanPages([{ name: 'S', cards: [{ id: 'c', elements: [{ id: 'k', kind: 'fkey', action: 'page', page: 'p2', key: 'F13' }] }] }]);
    assert.deepStrictEqual(bare(els(p)[0]), { id: 'k', kind: 'fkey', action: 'page', page: 'p2' }, 'Funktionstaste als Element, F13 gibt es nicht');
    assert.strictEqual(cleanBars({ top: { on: true, items: [{ type: 'fkey', action: 'rm -rf' }] } }).top.items[0].action, 'page');
    // Logo mit eigenem Bild fürs dunkle Design (Ralf 08.11.2026); ungültiger Dateiname fällt weg
    const lg = cleanBars({ top: { on: true, items: [{ id: 'l', type: 'logo', img: '0123456789abcdef.svg', imgDark: 'fedcba9876543210.svg' }, { id: 'm', type: 'logo', img: '0123456789abcdef.svg', imgDark: '../x.svg' }] } }).top.items;
    assert.strictEqual(lg[0].imgDark, 'fedcba9876543210.svg');
    assert.strictEqual(lg[1].imgDark, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Trend: bis zu 4 Kurven, eigene Skala je Kurve, Bits 0 … 1, Zeitbereich und Höhe', () => {
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Druck', label: 'Netzdruck', operand: 'MW', index: 52, type: 'WORD', writable: true, comment: '0 ... 6 bar', userRecord: true },
    { name: 'P1', label: 'Pumpe 1', operand: 'Q', index: 1, type: 'BIT', writable: false },
  ] }];
  const [clean] = cleanPages([{ id: 'p', name: 'S', cards: [{ id: 'c', elements: [
    { id: 't', kind: 'trend', range: '8h', height: 'l', label: ' Verlauf ', series: [
      { dev: 'd1', name: 'Druck', color: 1, max: '10' }, { dev: 'd1', name: 'P1', color: 9 }, { dev: 'd1', name: 'weg' },
      { dev: 'd1', name: 'a' }, { dev: 'd1', name: 'b' }, { dev: 'd1', name: '' }] },
    { id: 'u', kind: 'trend', range: 'falsch' },
  ] }] }]);
  const [t, u] = els(clean);
  assert.strictEqual(t.series.length, 4, 'höchstens 4 Kurven');
  assert.deepStrictEqual(t.series[0], { dev: 'd1', name: 'Druck', color: 1, max: 10 });
  assert.strictEqual(t.series[1].color, undefined, 'ungültige Farbe fällt weg');
  assert.deepStrictEqual([t.range, t.height, t.label, u.range, u.series], ['8h', 'l', 'Verlauf', undefined, []]);
  const r = els(resolvePage(clean, devices))[0];
  const [druck, p1, weg] = r.series;
  assert.deepStrictEqual([druck.label, druck.unit, druck.min, druck.max, druck.recorded, druck.bit], ['Netzdruck', 'bar', 0, 10, true, false]);
  assert.deepStrictEqual([p1.bit, p1.min, p1.max, p1.color, p1.recorded], [true, 0, 1, 1, false]);
  assert.strictEqual(weg.missing, true);
  assert.deepStrictEqual(r.deps, [{ dev: 'd1', name: 'Druck' }, { dev: 'd1', name: 'P1' }]);
});

test('Umwandlung alter Karten: Rahmen an derselben Stelle, Elemente untereinander, halbe Breite nebeneinander', () => {
  const [p] = cleanPages([{ id: 'p', name: 'S', width: 1920, cards: [
    { id: 'c1', title: 'Pumpe', x: 0, y: 0, w: 8, h: 4, font: 120, tx: { title: 'T0001' }, elements: [
      { id: 'a', kind: 'lamp', dev: 'd', name: 'x', half: true }, { id: 'b', kind: 'number', dev: 'd', name: 'y', half: true },
      { id: 't', kind: 'trend', half: true }] },
    { id: 'c2', plain: true, x: 8, y: 2, w: 8, h: 4, elements: [{ id: 'q', kind: 'button', dev: 'd', name: 'z' }] },
  ] }]);
  const [frame, a, b, t, q] = p.items;
  assert.deepStrictEqual([frame.kind, frame.title, frame.x, frame.y, frame.w, frame.font], ['frame', 'Pumpe', 0, 0, 630, 120]);
  assert.ok(frame.h >= t.y + t.h - frame.y, 'Rahmen wächst mit dem Inhalt');
  assert.deepStrictEqual([a.y, b.y, a.x + a.w + 10, a.w], [50, 50, b.x, b.w], 'halbe Breite: nebeneinander');
  assert.deepStrictEqual([t.x, t.w, t.y >= b.y + b.h], [20, 590, true], 'Trend immer ganze Breite, darunter');
  assert.deepStrictEqual([a.font, a.half], [120, undefined], 'Schriftgröße der Karte geht auf die Elemente über');
  assert.deepStrictEqual([q.x, q.y, p.items.length], [640, 60, 5], 'Karte ohne Rahmen: kein Rahmen, Element an ihrer Stelle');
  assert.ok(p.items.every((e) => e.x % 10 === 0 && e.y % 10 === 0 && e.w % 10 === 0 && e.h % 10 === 0), 'alles im 10er-Raster');
});

test('Wechselbild und Leuchttaster: Datenformat und Anzeige', () => {
  const img = 'a1b2c3d4e5f60718.png';
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Status_P1', label: 'Status P1', operand: 'MW', index: 61, type: 'WORD', writable: true },
    { name: 'Start', label: 'Start', operand: 'M', index: 10, type: 'BIT', writable: true, comment: 'Impuls' },
    { name: 'Laeuft', label: 'Pumpe läuft', operand: 'Q', index: 1, type: 'BIT', writable: false },
  ] }];
  const [p] = cleanPages([{ id: 'p', name: 'S', items: [
    { id: 'w', kind: 'image', img, dev: 'd1', name: 'Status_P1', map: [{ from: 1, img }, { from: 2, to: 3, img: '../böse.png' }, { from: 'x' }] },
    { id: 'b', kind: 'button', dev: 'd1', name: 'Start', fb: { dev: 'd1', name: 'Laeuft' } },
    { id: 'c', kind: 'button', dev: 'd1', name: 'Start', fb: { dev: 'd1', name: '' } },
  ] }]);
  const [w, b, c] = p.items;
  assert.deepStrictEqual(w.map, [{ from: 1, img }, { from: 2, to: 3 }, { from: 0 }], 'ungültiges Bild fällt weg, Zeile bleibt (dort gilt das Grundbild)');
  assert.deepStrictEqual(b.fb, { dev: 'd1', name: 'Laeuft' });
  assert.strictEqual(c.fb, undefined, 'ohne Variable keine Rückmeldung');
  const [rw, rb] = resolvePage(p, devices).items;
  assert.deepStrictEqual([rw.varLabel, rw.operand, rw.deps], ['Status P1', 'MW61', [{ dev: 'd1', name: 'Status_P1' }]]);
  assert.deepStrictEqual([rb.fb.label, rb.deps.length], ['Pumpe läuft', 2], 'Rückmeldung zählt als Abhängigkeit (Taster leuchtet live)');
  const [gone] = resolvePage({ items: [{ id: 'x', kind: 'image', dev: 'd1', name: 'Weg' }] }, devices).items;
  assert.strictEqual(gone.missing, true);
});

test('Wechselbild: eigene Variable je Zeile (Störung) und Blinken', () => {
  const img = 'a1b2c3d4e5f60718.png';
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Laeuft', label: 'Pumpe läuft', operand: 'Q', index: 1, type: 'BIT', writable: false },
    { name: 'Stoer', label: 'Störung P1', operand: 'M', index: 20, type: 'BIT', writable: true },
  ] }];
  const [p] = cleanPages([{ id: 'p', name: 'S', items: [{ id: 'w', kind: 'image', img, dev: 'd1', name: 'Laeuft', map: [
    { from: 1, img, dev: 'd1', name: 'Stoer', blink: 1 },
    { from: 1, img, dev: 'd1', name: 'Laeuft' },
    { from: 1, img, dev: 'd1', name: 'Weg' },
  ] }] }]);
  const [w] = p.items;
  assert.deepStrictEqual(w.map, [{ from: 1, img, dev: 'd1', name: 'Stoer', blink: true }, { from: 1, img }, { from: 1, img, dev: 'd1', name: 'Weg' }],
    'eigene Variable nur, wenn sie von der des Bildes abweicht; blink als true');
  const [rw] = resolvePage(p, devices).items;
  assert.deepStrictEqual(rw.deps, [{ dev: 'd1', name: 'Laeuft' }, { dev: 'd1', name: 'Stoer' }], 'Störung wird mit beobachtet');
  assert.deepStrictEqual([rw.map[0].bit, rw.map[2].missing], [true, true], 'fehlende Variable: Zeile gilt nie');
  assert.strictEqual(p.items[0].map[2].missing, undefined, 'gespeicherte Seite bleibt unverändert');
});

test('Statusmeldung und Statustext: Zustände mit eigener Variable und Blinken', () => {
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Laeuft', label: 'Pumpe läuft', operand: 'Q', index: 1, type: 'BIT', writable: false },
    { name: 'Stoer', label: 'Störung P1', operand: 'M', index: 20, type: 'BIT', writable: true },
  ] }];
  const [p] = cleanPages([{ id: 'p', name: 'S', items: [{ id: 'l', kind: 'lamp', dev: 'd1', name: 'Laeuft', map: [
    { from: 1, dev: 'd1', name: 'Stoer', text: 'Störung', color: 'alarm', blink: true },
    { from: 1, dev: 'd1', name: 'Laeuft', text: 'Läuft' },
  ] }, { id: 'n', kind: 'number', dev: 'd1', name: 'Laeuft', map: [{ from: 1, dev: 'd1', name: 'Stoer', blink: true }] }] }]);
  const [l, n] = p.items;
  assert.deepStrictEqual(l.map, [{ from: 1, dev: 'd1', name: 'Stoer', text: 'Störung', color: 'alarm', blink: true }, { from: 1, text: 'Läuft' }]);
  assert.deepStrictEqual(n.map, [{ from: 1 }], 'Zahl: Werteliste ohne eigene Variable und Blinken');
  const [rl] = resolvePage(p, devices).items;
  assert.deepStrictEqual(rl.deps, [{ dev: 'd1', name: 'Laeuft' }, { dev: 'd1', name: 'Stoer' }]);
});

test('Taster: rastend und Leuchtfarbe werden gespeichert und ausgerechnet, Unbekanntes fällt weg', () => {
  const pages = cleanPages([{ id: 'p', name: 'S', items: [
    { id: 'a', kind: 'button', dev: 'd1', name: 'Fern_Ein', mode: 'toggle', fbColor: 'alarm', litText: 'black', x: 0, y: 0, w: 200, h: 120 },
    { id: 'b', kind: 'button', dev: 'd1', name: 'Fern_Ein', mode: 'quatsch', fbColor: 'pink', litText: 'lila', x: 0, y: 200, w: 200, h: 50 },
    { id: 'c', kind: 'lamp', dev: 'd1', name: 'Fern_Ein', fbColor: 'warn', x: 300, y: 0, w: 200, h: 40 },
  ] }]);
  const [a, b, c] = pages[0].items;
  assert.deepStrictEqual([a.mode, a.fbColor, a.litText, a.h], ['toggle', 'alarm', 'black', 120], 'rastend, rot, schwarze Schrift, höher gezogen');
  assert.deepStrictEqual([b.mode, b.fbColor, b.litText], [undefined, undefined, undefined], 'unbekannte Werte fallen weg (Impuls, Grün, passende Schrift)');
  assert.strictEqual(c.fbColor, undefined, 'Leuchtfarbe nur beim Taster');
  const devices = [{ id: 'd1', name: 'NT1', variables: [{ name: 'Fern_Ein', label: 'Fern Ein', operand: 'M', index: 5, type: 'BIT', writable: true }] }];
  const [ra] = resolvePage(pages[0], devices).items;
  assert.deepStrictEqual([ra.mode, ra.fbColor, ra.litText], ['toggle', 'alarm', 'black']);
});

test('Uhr: auf einem Teil der Uhr (CLOCK.1) zeigt das Element die ganze Uhr; Anzeige und Warnung werden gespeichert', () => {
  const pages = cleanPages([{ id: 'p', name: 'S', items: [
    { id: 'u', kind: 'clock', dev: 'd1', name: 'CLOCK.1', clockFmt: 'dt', clockWarn: true, x: 0, y: 0, w: 300, h: 80 },
    { id: 'v', kind: 'clock', dev: 'd1', name: 'CLOCK.1', clockFmt: 'quatsch', x: 0, y: 100, w: 300, h: 80 },
  ] }]);
  const [u, v] = pages[0].items;
  assert.deepStrictEqual([u.clockFmt, u.clockWarn, v.clockFmt, v.clockWarn], ['dt', true, undefined, undefined]);
  const clock = [0, 1, 2, 3, 4, 5].map((i) => ({ name: `CLOCK.${i}`, label: `Uhr ${i}`, operand: 'CLOCK', index: i, type: 'WORD' }));
  const r = resolvePage(pages[0], [{ id: 'd1', name: 'NT1', variables: clock }]);
  const ru = r.items[0];
  assert.strictEqual(ru.kind, 'clock', 'bleibt Uhr (nicht Zahl)');
  assert.deepStrictEqual(ru.clockParts, { 0: 'CLOCK.0', 1: 'CLOCK.1', 2: 'CLOCK.2', 3: 'CLOCK.3', 4: 'CLOCK.4', 5: 'CLOCK.5' });
  assert.strictEqual(ru.deps.length, 6, 'alle Teile werden beobachtet');
  assert.deepStrictEqual(kindsFor(clock[1]), ['clock', 'number']);
});

test('Uhr: nur die Minute in der Liste – ganze Uhr (CLOCK) wird bevorzugt, sobald es sie gibt', () => {
  const pages = cleanPages([{ id: 'p', name: 'S', items: [{ id: 'u', kind: 'clock', dev: 'd1', name: 'Uhr', x: 0, y: 0, w: 300, h: 80 }] }]);
  const minute = { name: 'Uhr', label: 'Uhr', operand: 'CLOCK', index: 1, type: 'WORD' };
  let r = resolvePage(pages[0], [{ id: 'd1', name: 'NT1', protocol: 'modbus', variables: [minute] }]).items[0];
  assert.deepStrictEqual([r.kind, r.clockParts, r.clockFull, r.protocol], ['clock', { 1: 'Uhr' }, undefined, 'modbus'], 'nur die Minute: unvollständig');
  r = resolvePage(pages[0], [{ id: 'd1', name: 'NT1', protocol: 'modbus', variables: [minute, { name: 'CLOCK', label: 'Uhr der easyE4', operand: 'CLOCK', index: null, type: 'WORD' }] }]).items[0];
  assert.strictEqual(r.clockFull, 'CLOCK', 'ganze Uhr ergänzt: wird benutzt');
  assert.ok(r.deps.some((x) => x.name === 'CLOCK'), 'und beobachtet');
});

test('Sichtbarkeit: wird geprüft, gespeichert und ihre Variable beobachtet', () => {
  const pages = cleanPages([{ id: 'p', name: 'S', items: [
    { id: 'a', kind: 'frame', x: 0, y: 0, w: 300, h: 300, vis: { dev: 'd', name: 'M12', op: 'off' } },
    { id: 'b', kind: 'text', text: 'x', x: 10, y: 10, w: 100, h: 30, vis: { dev: 'd', name: 'MW1', op: 'range', from: '5', to: 9 } },
    { id: 'c', kind: 'text', text: 'y', x: 10, y: 50, w: 100, h: 30, vis: { dev: 'd', name: '', op: 'on' } },
  ] }]);
  const [a, b, c] = pages[0].items;
  assert.deepStrictEqual(a.vis, { dev: 'd', name: 'M12', op: 'off' });
  assert.deepStrictEqual(b.vis, { dev: 'd', name: 'MW1', op: 'range', from: 5, to: 9 });
  assert.strictEqual(c.vis, undefined, 'ohne Variable: immer sichtbar');
  const r = resolvePage(pages[0], [{ id: 'd', name: 'NT1', variables: [{ name: 'M12', label: 'Störung', operand: 'M', index: 12, type: 'BIT' }] }]);
  assert.deepStrictEqual(r.items[0].deps, [{ dev: 'd', name: 'M12' }], 'Rahmen beobachtet die Variable');
  assert.strictEqual(r.items[1].vis.missing, true, 'fehlende Variable: bleibt sichtbar');
});

test('Beschriftung abschaltbar und Skala am Schieberegler (Ralf 08.11.2026)', () => {
  const devices = [{ id: 'd1', name: 'NT1', variables: [
    { name: 'Soll', label: 'Bandgeschwindigkeit', operand: 'MW', index: 3, type: 'WORD', writable: true },
    { name: 'M5', label: 'Quittieren', operand: 'M', index: 5, type: 'BIT', writable: true },
  ] }];
  const page = cleanPages([{ id: 'p', name: 'S', items: [
    { id: 'a', kind: 'slider', dev: 'd1', name: 'Soll', noLabel: true, ticks: 'off' },
    { id: 'b', kind: 'gauge', dev: 'd1', name: 'Soll', label: 'Eigener Text', noLabel: 1 },
    { id: 'c', kind: 'button', dev: 'd1', name: 'M5', noLabel: true },
    { id: 'd', kind: 'slider', dev: 'd1', name: 'Soll', ticks: 'quatsch' },
  ] }])[0];
  const raw = Object.fromEntries(page.items.map((e) => [e.id, e]));
  assert.deepStrictEqual([raw.a.noLabel, raw.a.ticks, raw.b.noLabel, raw.c.noLabel, raw.d.ticks], [true, 'off', true, undefined, undefined]);
  const [a, b, c, d] = els(resolvePage(page, devices));
  assert.deepStrictEqual([a.label, a.ariaLabel, a.noLabel], ['', 'Bandgeschwindigkeit', true], 'ohne Beschriftung, für Vorleseprogramme bleibt der Name');
  assert.deepStrictEqual([b.label, b.ariaLabel], ['', 'Eigener Text'], 'auch ein eigener Text wird nicht gezeigt');
  assert.strictEqual(c.label, 'Quittieren', 'Taster behält seine Aufschrift');
  assert.strictEqual(d.label, 'Bandgeschwindigkeit');
});

test('Lizenzen: LIZENZEN-DRITTER.txt ist aktuell und enthält jeden ausgelieferten Baustein, keine GPL', () => {
  const { build } = require('../tools/lizenzen');
  const { text, pkgs } = build();
  const file = fs.readFileSync(path.join(__dirname, '..', 'LIZENZEN-DRITTER.txt'), 'utf8');
  assert.strictEqual(file.replace(/\r\n/g, '\n'), text, 'Datei aktuell (sonst: npm run lizenzen)');
  assert.ok(pkgs.length > 10, 'Bausteine gefunden');
  for (const p of pkgs) {
    assert.ok(file.includes(`${p.name} ${p.version}`), `${p.name} steht drin`);
    assert.ok(!/GPL/i.test(p.license), `${p.name}: keine GPL-Lizenz (${p.license})`);
  }
  assert.ok(pkgs.some((p) => p.name === 'mqtt') && pkgs.some((p) => p.name.startsWith('@fontsource/')), 'MQTT und Schriften dabei');
  assert.ok(!pkgs.some((p) => ['electron-builder', 'aedes'].includes(p.name)), 'Werkzeuge zum Bauen/Testen nicht dabei');
});
