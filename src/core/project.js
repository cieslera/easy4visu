'use strict';
/**
 * Selbst erstellte Bedienseiten (Editor). Gespeichert im Datenordner neben devices.json:
 *   pages.json   { version, pages: [Seite] }
 *
 * Seite:   { id, name, width, height (Bildschirmgröße in px, z. B. 1920 × 1080), scroll (Seite darf rollen),
 *            start (Startseite, höchstens eine), screen (Gruppe der Auswahl: pc | panel | tablet | custom),
 *            noBars (Leisten der Vorlage hier ausblenden),
 *            bg (Hintergrund: { color: '#rrggbb' } | { img, fit: 'cover' | 'contain' | 'tile' }; fehlt = Thema),
 *            items: [Element] }
 * Element: { id, kind, x, y, w, h (Platz auf der Seite in Bildpunkten, Raster 10 px), font? (Schriftgröße in %,
 *            fehlt = 100), dev, name, label?, unit?, min?, max?, step?, text?, size?, align?, vars?,
 *            show?, icon?, map?, other?, style?, onText?, offText?, mode? }
 *   Elemente liegen frei auf der Seite (Entscheidung 31.10.2026). Seiten aus der Zeit der Karten
 *   (cards: [{ title, x, y, w, h im 24er-Raster, plain, font, elements }]) wandelt toItems beim Laden um:
 *   jede Karte wird ein Rahmen, ihre Elemente stehen darin untereinander.
 *   kind  'lamp' | 'number' | 'clock' | 'switch' | 'button' | 'setpoint' | 'status' | 'bar' | 'gauge' | 'slider' | 'text'
 *         | 'image' | 'fkey' (Funktionstaste, Felder wie in den Leisten – siehe cleanFkey)
 *         | 'frame' (Rahmen: title, look 'line' (Standard) | 'fill' (eingefärbt) | 'title' (nur Überschrift);
 *           was ganz im Rahmen liegt, gehört dazu – beim Verschieben und Kopieren geht es mit)
 *         | 'kpi' (KPI-Kachel) | 'choice' (Betriebsart: Knöpfe, die je einen Wert schreiben) | 'device' (Gerätekarte)
 *   opts           Betriebsart: [{ v: Wert, t: Text }] (2–8 Knöpfe, Standard Aus 0 / Hand 1 / Automatik 2)
 *   noAddr         KPI-Kachel: Zeile mit Variablenname, Operand und Gerät ausblenden
 *   Gerätekarte    dev = Gerät, name = Lebenszeichen-Zähler (Merkerwort, darf leer sein)
 *   Sprachauswahl  kind 'lang': je Sprache des Projekts ein Knopf
 *   Meldungsliste  kind 'alarms', height 's' | 'l' (fehlt = mittel); zeigt offene Meldungen und den Verlauf
 *   Trend          series: [{ dev, name, color (0–4), min?, max?, label? }] (1–4 Kurven), range = Zeitbereich beim
 *                  Öffnen ('10m' | '1h' | '8h' | '1d' | '1w' | '1M', Standard 1h), height 's' | 'l' (fehlt = mittel)
 *   img + fit + alt  Bild: Dateiname im Ordner „bilder“ des Datenordners (imageName), fit 'contain' (einpassen,
 *                  Standard) | 'cover' (füllen) | 'none' (Originalgröße), alt = Beschreibung
 *   Statusbild     Bild mit states = true, dev/name und map: [{ from, to?, img, dev?, name?, blink? }] – die oberste
 *                  passende Zeile gilt, sonst img; eine Zeile mit eigener Variable (dev/name) prüft diese statt der des
 *                  Elements; blink = blinkt. Statusmeldung (lamp) und Statustext (status) haben dieselben Zeilen mit
 *                  text/color/icon statt img
 *   fb             Taster: Rückmelde-Variable { dev, name } – der Taster leuchtet, solange sie 1 ist (Leuchttaster)
 *   orient         Balken: 'v' = senkrecht (fehlt = waagerecht); Balken/Zeiger/Schieberegler nutzen min, max (step)
 *   bw, valpos     Balken: Breite 'm' | 'l' (fehlt = schmal); Wert 'top' | 'bottom' | 'side' | 'none' (fehlt: waagerecht oben,
 *                  senkrecht seitlich)
 *   ticks          Balken, Schieberegler: 'off' = keine Skalenstriche; Zeigerinstrument: 'out' = Striche und Zahlen
 *                  außen (fehlt = innen)
 *   noLabel        alle Elemente mit Variable außer Taster: keine Beschriftung (weder eigene noch Name der Variablen)
 *   text + vars    Text mit Werten: „Nachlauf {1} s“, vars: [{ n: 1, dev, name, decimals, unit, format }]
 *   map + other    Werteliste: [{ from, to?, text, color, icon }] (to fehlt = genau dieser Wert), other = „sonst“
 *                  color = Bedeutung: 'on' | 'off' | 'warn' | 'alarm' | 'accent' | 'neutral' (passt sich dem Thema an)
 *   show           Statusleuchte/Statustext: 'both' | 'symbol' | 'text';  icon = Symbol (app/renderer/symbols.js)
 *   style          Schalter: 'slider' | 'buttons', onText/offText eigene Texte
 *   mode           Taster: 'pulse' (sendet 1, Programm setzt zurück) | 'tip' (tastend: gedrückt = 1, losgelassen = 0)
 *                  | 'toggle' (rastend: 1. Druck = 1, 2. Druck = 0; leuchtet ohne fb mit der eigenen Variablen)
 *   clockFmt       Uhr: 'hms' (mit Sekunden) | 'dt' (Datum und Uhrzeit) | 'd' (nur Datum), fehlt = Uhrzeit hh:mm;
 *                  clockWarn = Warnzeichen, wenn die Uhr der easyE4 mehr als 1 Minute von der PC-Uhr abweicht
 *   vis            alle Elemente und Rahmen: { dev, name, op: 'on' | 'off' | 'range', from?, to? } = nur sichtbar, wenn die
 *                  Variable 1 / 0 ist bzw. im Bereich liegt (Rahmen: samt Inhalt); fehlt = immer sichtbar
 *   litText        Taster: Schrift im leuchtenden Zustand 'white' | 'black' (fehlt = passend zur Leuchtfarbe)
 *   fbColor        Taster: Leuchtfarbe 'warn' (Gelb) | 'alarm' (Rot) | 'blue' | 'white' (fehlt = Grün)
 *   dev   Geräte-id, name = Variable (Schlüssel wie in den Werten); bei 'text' beides leer
 *   Leere Angaben (label, unit, min, max, step) kommen aus der Variablen – so wirken Umbenennungen sofort.
 * Was die Seite tatsächlich zeigt, rechnet resolvePage in src/core/pages.js aus.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE_VERSION = 2; // 2: Elemente frei auf der Seite (items) statt Karten
const KINDS = new Set(['lamp', 'number', 'clock', 'switch', 'button', 'setpoint', 'status', 'bar', 'gauge', 'slider', 'text', 'image', 'fkey',
  'kpi', 'choice', 'device', 'trend', 'alarms', 'lang', 'frame']);
const GRID = 10; // Raster der Seite in Bildpunkten
const FRAME_LOOKS = new Set(['line', 'fill', 'title']);
// Standardgröße [Breite, Höhe] in Bildpunkten: neue Elemente und umgewandelte Karten
const SIZE = { lamp: [200, 40], status: [200, 40], switch: [240, 50], button: [200, 50], number: [200, 70], clock: [220, 70],
  setpoint: [260, 120], slider: [280, 90], bar: [280, 80], gauge: [260, 260], kpi: [220, 110], choice: [300, 90], device: [280, 90],
  trend: [600, 320], alarms: [600, 280], text: [300, 30], image: [200, 150], fkey: [160, 50], lang: [240, 50], frame: [320, 200] };
const TREND_RANGES = new Set(['10m', '1h', '8h', '1d', '1w', '1M']);
// Bilder liegen im Datenordner unter bilder/<Prüfsumme>.<Endung> (gleiches Bild = gleiche Datei)
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const imageName = (v) => (/^[a-f0-9]{16}\.(png|jpe?g|gif|webp|svg)$/.test(String(v || '')) ? String(v) : undefined);
const hexColor = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : undefined);
const COLORS = new Set(['on', 'off', 'warn', 'alarm', 'accent', 'neutral']);
// Leuchtfarbe des Tasters (fehlt = Grün 'on')
const FB_COLORS = new Set(['warn', 'alarm', 'blue', 'white']);
const SHOW = new Set(['both', 'symbol', 'text']);
const FORMATS = new Set(['datetime', 'date', 'time']);
const iconName = (v) => (/^[a-z0-9-]{1,30}$/.test(String(v || '')) ? String(v) : undefined);
const SPANS = [3, 4, 6, 8, 12];
const SIZES = new Set(['normal', 'title', 'hint']);

const str = (v, max) => (v === undefined || v === null ? '' : String(v)).slice(0, max || 200);
const id = (v) => (/^[A-Za-z0-9_-]{1,40}$/.test(String(v || '')) ? String(v) : newId());
const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Eintrag einer Werteliste: { text, color, icon } (+ from/to bei Zeilen) */
function cleanEntry(r, withRange) {
  const out = {};
  if (withRange) {
    out.from = num(r.from) === undefined ? 0 : num(r.from);
    if (num(r.to) !== undefined && num(r.to) !== out.from) out.to = num(r.to);
  }
  if (str(r.text).trim()) out.text = str(r.text, 120).trim();
  if (COLORS.has(r.color)) out.color = r.color;
  if (iconName(r.icon)) out.icon = iconName(r.icon);
  if (imageName(r.img)) out.img = r.img; // Wechselbild
  return out;
}

/** Zeile einer Zustandsliste: wie cleanEntry, dazu eigene Variable (nur wenn sie von der des Elements abweicht) und blink */
function stateEntry(r, dev, name) {
  const x = cleanEntry(r || {}, true);
  if (r && str(r.name).trim() && !(str(r.dev, 80) === dev && str(r.name, 120) === name)) { x.dev = str(r.dev, 80); x.name = str(r.name, 120); }
  if (r && r.blink) x.blink = true;
  return x;
}

/** Element prüfen und auf bekannte Felder beschränken */
/** Sichtbarkeit (wie in Galileo): nur sichtbar, wenn Variable dev/name 1 ist ('on'), 0 ist ('off') oder in from … to liegt ('range') */
function cleanVis(v) {
  if (!v || typeof v !== 'object' || !str(v.name).trim()) return undefined;
  const op = ['on', 'off', 'range'].includes(v.op) ? v.op : 'on';
  const out = { dev: str(v.dev, 80), name: str(v.name, 120), op };
  if (op === 'range') { out.from = num(v.from) === undefined ? 0 : num(v.from); if (num(v.to) !== undefined) out.to = num(v.to); }
  return out;
}

function cleanElement(e) {
  const kind = KINDS.has(e && e.kind) ? e.kind : 'number';
  const out = { id: id(e.id), kind };
  const vis = cleanVis(e.vis);
  if (vis) out.vis = vis;
  if (kind === 'text') {
    out.text = str(e.text, 2000);
    out.size = SIZES.has(e.size) ? e.size : 'normal';
    if (e.align === 'center' || e.align === 'right') out.align = e.align;
    const vars = (Array.isArray(e.vars) ? e.vars : []).slice(0, 20).filter((x) => x && Number.isInteger(Number(x.n)))
      .map((x) => {
        const v = { n: Number(x.n), dev: str(x.dev, 80), name: str(x.name, 120) };
        if (num(x.decimals) !== undefined) v.decimals = Math.max(0, Math.min(6, Math.round(num(x.decimals))));
        if (str(x.unit).trim()) v.unit = str(x.unit, 20).trim();
        if (FORMATS.has(x.format)) v.format = x.format;
        return v;
      });
    if (vars.length) out.vars = vars;
  } else if (kind === 'fkey') {
    cleanFkey(e, out); // Funktionstaste auf der Seite (wie in den Leisten)
  } else if (kind === 'frame') {
    if (str(e.title).trim()) out.title = str(e.title, 120).trim();
    if (FRAME_LOOKS.has(e.look) && e.look !== 'line') out.look = e.look;
  } else if (kind === 'lang') {
    if (str(e.label).trim()) out.label = str(e.label, 120).trim();
  } else if (kind === 'alarms') {
    if (e.height === 's' || e.height === 'l') out.height = e.height;
  } else if (kind === 'trend') {
    out.series = (Array.isArray(e.series) ? e.series : []).filter((x) => x && str(x.name).trim()).slice(0, 4).map((x) => {
      const s = { dev: str(x.dev, 80), name: str(x.name, 120) };
      if (Number.isInteger(num(x.color)) && num(x.color) >= 0 && num(x.color) <= 4) s.color = num(x.color);
      for (const k of ['min', 'max']) if (num(x[k]) !== undefined) s[k] = num(x[k]);
      if (str(x.label).trim()) s.label = str(x.label, 80).trim();
      return s;
    });
    if (TREND_RANGES.has(e.range) && e.range !== '1h') out.range = e.range;
    if (e.height === 's' || e.height === 'l') out.height = e.height;
    if (str(e.label).trim()) out.label = str(e.label, 120).trim();
  } else if (kind === 'image') {
    if (imageName(e.img)) out.img = e.img;
    if (e.fit === 'cover' || e.fit === 'none') out.fit = e.fit;
    if (str(e.alt).trim()) out.alt = str(e.alt, 200).trim();
    // Statusbild: Variable und je Zustand ein Bild
    if (e.states || str(e.name).trim()) out.states = true;
    if (str(e.name).trim()) {
      out.dev = str(e.dev, 80);
      out.name = str(e.name, 120);
      if (Array.isArray(e.map) && e.map.length) {
        out.map = e.map.slice(0, 30).map((r) => stateEntry(r, out.dev, out.name)); // Zeile ohne Bild: dort gilt das Grundbild
      }
      if (out.map && !out.map.length) delete out.map;
    }
  } else {
    if (SHOW.has(e.show) && e.show !== 'both') out.show = e.show;
    if (iconName(e.icon)) out.icon = iconName(e.icon);
    if (Array.isArray(e.map) && e.map.length) {
      // Statusmeldung, Statustext: Zeilen mit eigener Variable und Blinken
      out.map = e.map.slice(0, 30).map((r) => (kind === 'lamp' || kind === 'status' ? stateEntry(r, str(e.dev, 80), str(e.name, 120)) : cleanEntry(r || {}, true)));
    }
    if (e.other && typeof e.other === 'object') {
      const o = cleanEntry(e.other, false);
      if (Object.keys(o).length) out.other = o;
    }
    if (e.style === 'buttons') out.style = 'buttons';
    for (const k of ['onText', 'offText']) if (str(e[k]).trim()) out[k] = str(e[k], 60).trim();
    if (e.mode === 'tip' || e.mode === 'toggle') out.mode = e.mode;
    if (kind === 'button' && FB_COLORS.has(e.fbColor)) out.fbColor = e.fbColor;
    if (kind === 'button' && (e.litText === 'white' || e.litText === 'black')) out.litText = e.litText;
    if (kind === 'clock' && ['hms', 'dt', 'd'].includes(e.clockFmt)) out.clockFmt = e.clockFmt;
    if (kind === 'clock' && e.clockWarn) out.clockWarn = true;
    if (kind === 'button' && e.fb && str(e.fb.name).trim()) out.fb = { dev: str(e.fb.dev, 80), name: str(e.fb.name, 120) };
    if (e.orient === 'v') out.orient = 'v';
    if (kind === 'bar' && (e.bw === 'm' || e.bw === 'l')) out.bw = e.bw;
    if (kind === 'bar' && ['top', 'bottom', 'side', 'none'].includes(e.valpos)) out.valpos = e.valpos;
    if (((kind === 'bar' || kind === 'slider') && e.ticks === 'off') || (kind === 'gauge' && e.ticks === 'out')) out.ticks = e.ticks;
    if (kind !== 'button' && e.noLabel) out.noLabel = true;
    if (kind === 'kpi' && e.noAddr) out.noAddr = true;
    if (kind === 'choice' && Array.isArray(e.opts)) {
      const opts = e.opts.slice(0, 8).filter((o) => o && num(o.v) !== undefined).map((o) => ({ v: num(o.v), t: str(o.t, 40).trim() }));
      if (opts.length >= 2) out.opts = opts;
    }
    out.dev = str(e.dev, 80);
    out.name = str(e.name, 120);
    for (const k of ['label', 'unit']) if (str(e[k]).trim()) out[k] = str(e[k]).trim();
    for (const k of ['min', 'max', 'step']) if (num(e[k]) !== undefined) out[k] = num(e[k]);
  }
  // Platz auf der Seite (fehlt er, z. B. bei neuen Elementen: oben links in Standardgröße)
  const [dw, dh] = defaultSize(out);
  out.x = int(e.x, 0, 2 * SCREEN_MAX, 0);
  out.y = int(e.y, 0, 20000, 0);
  out.w = int(e.w, GRID * 2, 2 * SCREEN_MAX, dw);
  out.h = int(e.h, GRID * 2, 20000, dh);
  const font = int(e.font, FONT_MIN, FONT_MAX, 100);
  if (font !== 100) out.font = font;
  return out;
}

/** Standardgröße eines Elements in Bildpunkten (hängt bei Balken, Trend, Meldungsliste und Text von der Darstellung ab) */
function defaultSize(e) {
  const kind = SIZE[e && e.kind] ? e.kind : 'number';
  if (kind === 'bar' && e.orient === 'v') return [100, 240];
  if ((kind === 'trend' || kind === 'alarms') && e.height) return [SIZE[kind][0], SIZE[kind][1] + (e.height === 's' ? -100 : 120)];
  if (kind === 'text') {
    const lines = Math.max(1, String(e.text || '').split('\n').length);
    return [SIZE.text[0], Math.ceil(((e.size === 'title' ? 40 : 30) * lines) / GRID) * GRID];
  }
  return SIZE[kind].slice();
}

// ---------------------------------------------------------------- freies Raster
// 24 Spalten; eine Reihe = ROW_PX hoch, dazwischen GAP_PX Abstand (wie in app/renderer/styles.css .freegrid)
const COLS = 24;
// Bildschirmgröße in Pixeln: Editor und Bedienseite zeigen die Seite genau so, passend vergrößert/verkleinert
const SCREEN_MIN = 320;
const SCREEN_MAX = 3840;
const FONT_MIN = 60;
const FONT_MAX = 250;
const ROW_PX = 20;
const GAP_PX = 12;
const rowsFor = (px) => Math.max(2, Math.ceil((px + GAP_PX) / (ROW_PX + GAP_PX)));
const int = (v, a, b, d) => (Number.isFinite(Number(v)) ? Math.max(a, Math.min(b, Math.round(Number(v)))) : d);

/** ungefähre Höhe einer Karte in Pixeln (nur für die Umwandlung alter Seiten; der Editor misst danach genau) */
function estimatePx(card) {
  const EL = { lamp: 64, status: 64, switch: 64, button: 76, number: 90, clock: 90, setpoint: 150, slider: 110, gauge: 300, kpi: 110, choice: 100, device: 90, trend: 330, alarms: 300 };
  let px = 40 + (card.title ? 40 : 30);
  let half = 0;
  for (const e of card.elements) {
    const h = e.kind === 'text' ? (e.size === 'title' ? 46 : 34) * Math.max(1, String(e.text || '').split('\n').length)
      : e.kind === 'bar' ? (e.orient === 'v' ? 220 : 100) : EL[e.kind] || 70;
    if (e.half) half += h / 2;
    else px += h;
  }
  return px + half;
}

/** alte Seiten (Breite span von 12, Höhe rows) auf feste Plätze im 24er-Raster umrechnen – Reihenfolge bleibt */
function placeLegacy(cards) {
  let x = 0;
  let y = 0;
  let rowBottom = 0;
  for (const c of cards) {
    const w = (SPANS.includes(Number(c.span)) ? Number(c.span) : 4) * 2;
    const h = Math.max(rowsFor(estimatePx(c)), (Number(c.rows) || 1) * 4);
    if (x + w > COLS) { x = 0; y = rowBottom; }
    Object.assign(c, { x, y, w, h });
    rowBottom = Math.max(rowBottom, y + h);
    x += w;
  }
}

const snap = (v) => Math.round(v / GRID) * GRID;
const GROW = new Set(['trend', 'alarms', 'image', 'gauge']);

/**
 * Seite aus der Zeit der Karten umwandeln (Felder samt Textnummern tx bleiben, damit Übersetzungen erhalten bleiben):
 * jede Karte wird ein Rahmen an derselben Stelle (Karten „ohne Rahmen“: keiner), ihre Elemente stehen darin
 * untereinander in Standardhöhe, halbe Breite paarweise nebeneinander. Reicht die Karte nicht, wächst der Rahmen.
 */
function toItems(page) {
  const cards = (page.cards || []).map((c) => Object.assign({}, c, { elements: (c.elements || []).slice() }));
  if (cards.some((c) => c.w === undefined)) placeLegacy(cards);
  const width = int(page.width, SCREEN_MIN, SCREEN_MAX, 1920);
  const col = (width - (COLS - 1) * GAP_PX) / COLS;
  const frames = [];
  const items = [];
  for (const c of cards) {
    const w = int(c.w, 2, COLS, 8);
    const x = snap(int(c.x, 0, COLS - w, 0) * (col + GAP_PX));
    const y = snap(int(c.y, 0, 2000, 0) * (ROW_PX + GAP_PX));
    const fw = snap(w * col + (w - 1) * GAP_PX);
    const fh = snap(int(c.h, 2, 200, 6) * (ROW_PX + GAP_PX) - GAP_PX);
    const font = c.font && c.font !== 100 ? c.font : undefined;
    const pad = c.plain ? 0 : 20;
    const inner = fw - 2 * pad;
    let cy = y + (c.plain ? 0 : c.title ? 50 : 20);
    let half = null; // linkes Element einer halben Reihe
    for (const e of c.elements || []) {
      const [, dh] = defaultSize(e);
      const h = snap(dh * ((font || 100) / 100));
      const isHalf = e.half && e.kind !== 'trend' && e.kind !== 'alarms';
      const out = Object.assign({}, e, { y: cy, h, font });
      delete out.half;
      if (isHalf && half) {
        Object.assign(out, { x: half.x + half.w + GRID, w: half.w, y: half.y });
        cy = Math.max(cy, half.y + Math.max(half.h, h) + GRID);
        half = null;
      } else {
        if (half) { cy = half.y + half.h + GRID; out.y = cy; half = null; }
        Object.assign(out, { x: x + pad, w: isHalf ? snap((inner - GRID) / 2) : inner });
        if (isHalf) half = out; else cy += h + GRID;
      }
      if (!font) delete out.font;
      items.push(out);
    }
    if (half) cy = half.y + half.h + GRID;
    const fhFinal = Math.max(fh, snap(cy - y + 10));
    // Trend, Meldungsliste, Bild, Zeiger als letztes Element füllten früher die Karte: hier den Rest des Rahmens
    const last = items[items.length - 1];
    if (last && c.elements.length && last.id === c.elements[c.elements.length - 1].id && GROW.has(last.kind) && !c.elements[c.elements.length - 1].half) {
      last.h = Math.max(last.h, y + fhFinal - pad - last.y);
    }
    if (c.plain) continue;
    const frame = { id: c.id, kind: 'frame', x, y, w: fw, h: fhFinal };
    if (c.title) frame.title = c.title;
    if (c.tx) frame.tx = c.tx; // Nummer des Kartentitels in der Texttabelle
    if (font) frame.font = font;
    frames.push(frame);
  }
  const out = Object.assign({}, page, { items: frames.concat(items) }); // Rahmen zuerst = hinter den Elementen
  delete out.cards;
  return out;
}

function cleanPage(p, i) {
  if (p && p.cards && !p.items) p = toItems(p); // Seite aus der Zeit der Karten
  const width = int(p && p.width, SCREEN_MIN, SCREEN_MAX, 1920);
  // ältere Seiten hatten nur eine Breite: Höhe im Breitbild-Format 16 : 9
  const height = int(p && p.height, SCREEN_MIN, SCREEN_MAX, Math.round((width * 9) / 16));
  const items = ((p && p.items) || []).slice(0, 1000).filter((e) => e && typeof e === 'object').map(cleanElement);
  const out = { id: id(p && p.id), name: str(p && p.name, 80).trim() || `Seite ${i + 1}`, width, height, items };
  if (['pc', 'panel', 'tablet', 'phone', 'custom'].includes(p && p.screen)) out.screen = p.screen; // Gruppe in der Auswahlliste
  const bg = p && p.bg;
  if (bg && imageName(bg.img)) out.bg = { img: bg.img, fit: ['contain', 'tile'].includes(bg.fit) ? bg.fit : 'cover' };
  else if (bg && hexColor(bg.color)) out.bg = { color: hexColor(bg.color) };
  if (p && p.scroll) out.scroll = true;
  if (p && p.noBars) out.noBars = true; // Leisten der Vorlage auf dieser Seite ausblenden
  if (p && p.start) out.start = true;
  if (p && p.noWeb) out.noWeb = true; // nicht im Browser (Handy/Tablet) zeigen
  return out;
}

/** Liste prüfen: doppelte ids bekommen neue */
function cleanPages(pages) {
  const seen = new Set();
  const uniq = (o) => { if (seen.has(o.id)) o.id = newId(); seen.add(o.id); return o; };
  return (Array.isArray(pages) ? pages : []).slice(0, 200).map((p, i) => {
    const page = uniq(cleanPage(p, i));
    for (const e of page.items) uniq(e);
    return page;
  }).map((page, i, all) => { // höchstens eine Startseite
    if (page.start && all.findIndex((x) => x.start) !== i) delete page.start;
    return page;
  });
}

/**
 * Wie viele Rasterreihen hat der Bildschirm der Seite? Gerundet: die Reihen füllen den Bildschirm so genau wie möglich
 * (1080 px -> 34 Reihen = 1076 px, 720 px -> 23 Reihen = 724 px); die Bedienseite wird auf genau diese Reihen eingepasst.
 */
const screenRows = (height) => Math.max(2, Math.round((height + GAP_PX) / (ROW_PX + GAP_PX)));

// ---------------------------------------------------------------- Leisten (Vorlage für alle Seiten)
/**
 * Leisten: { top, bottom, left, right } je { on, items: [Baustein] }, gespeichert in pages.json (bars).
 * Baustein: { id, type, … }
 *   type  'logo' (img) | 'title' (Seitenname) | 'clock' (Datum/Uhrzeit des PCs) | 'conn' (Verbindung)
 *         | 'text' (text) | 'spacer' (freier Platz) | 'pagekeys' (je Seite eine Taste) | 'fkey' (Funktionstaste)
 * Funktionstaste (Baustein 'fkey' und Element kind 'fkey'): { label, action, page?, key?, confirm?, dev?, name?, value? }
 *   action  'page' (Seite öffnen) | 'back' | 'connect' (Verbinden/Trennen) | 'fullscreen' | 'theme' (Hell/Dunkel)
 *           | 'exit' (Bedienmodus verlassen) | 'write' (Wert value in Variable dev/name schreiben, z. B. Merker setzen)
 *   key     'F1' … 'F12' (Taste auf der Tastatur), confirm = vorher nachfragen
 */
const BAR_POS = ['top', 'bottom', 'left', 'right'];
const ITEM_TYPES = new Set(['logo', 'title', 'clock', 'conn', 'text', 'spacer', 'pagekeys', 'fkey', 'alarms', 'login', 'lang']);
const ACTIONS = new Set(['page', 'back', 'connect', 'fullscreen', 'theme', 'exit', 'write', 'login', 'quit', 'lang']);
const FKEYS = new Set(Array.from({ length: 12 }, (x, i) => `F${i + 1}`));

/** Felder einer Funktionstaste prüfen (gemeinsam für Baustein und Element) */
function cleanFkey(e, out) {
  out.action = ACTIONS.has(e.action) ? e.action : 'page';
  if (str(e.label).trim()) out.label = str(e.label, 60).trim();
  if (out.action === 'page' && str(e.page)) out.page = str(e.page, 80);
  if (FKEYS.has(e.key)) out.key = e.key;
  if (e.confirm) out.confirm = true;
  if (out.action === 'write') {
    out.dev = str(e.dev, 80);
    out.name = str(e.name, 120);
    out.value = num(e.value) === undefined ? 1 : num(e.value);
  }
  return out;
}

function defaultBars() {
  // Vorgabe A (docs/DESIGN.md 26): Kopfleiste oben, Funktionstasten unten
  return {
    top: { on: true, items: [{ id: 't1', type: 'logo' }, { id: 't2', type: 'title' }, { id: 't3', type: 'spacer' }, { id: 't6', type: 'alarms' }, { id: 't4', type: 'conn' }, { id: 't7', type: 'login' }, { id: 't5', type: 'clock' }] },
    bottom: { on: true, items: [{ id: 'b1', type: 'pagekeys' }, { id: 'b2', type: 'spacer' },
      { id: 'b3', type: 'fkey', action: 'fullscreen', key: 'F11' }, { id: 'b4', type: 'fkey', action: 'exit', key: 'F12' }] },
    left: { on: false, items: [] },
    right: { on: false, items: [] },
  };
}

function cleanBars(b) {
  const def = defaultBars();
  const out = {};
  for (const pos of BAR_POS) {
    const bar = b && b[pos];
    if (!bar || typeof bar !== 'object') { out[pos] = def[pos]; continue; }
    out[pos] = { on: !!bar.on, items: (Array.isArray(bar.items) ? bar.items : []).slice(0, 40).filter((x) => x && ITEM_TYPES.has(x.type)).map((x) => {
      const it = { id: id(x.id), type: x.type };
      if (x.type === 'logo' && imageName(x.img)) it.img = x.img;
      if (x.type === 'logo' && imageName(x.imgDark)) it.imgDark = x.imgDark; // freiwillig: Logo fürs dunkle Design
      if (x.type === 'text') it.text = str(x.text, 120);
      if (x.type === 'fkey') cleanFkey(x, it);
      return it;
    }) };
  }
  return out;
}

class PageStore {
  /** opts: { dir, texts (TextStore, optional): Texte stehen dann in der Texttabelle, in pages.json nur Nummern } */
  constructor(opts) {
    this.dir = (opts && opts.dir) || require('./devices').defaultDir();
    this.texts = (opts && opts.texts) || null;
    this.pages = [];
    this.bars = defaultBars();
  }

  get file() { return path.join(this.dir, 'pages.json'); }

  load() {
    const data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    if (Array.isArray(data.pages) && data.pages.some((p) => p && p.cards && !p.items)) {
      // Umbau 31.10.2026: Karten -> frei platzierte Elemente; die alte Datei bleibt als Sicherung liegen.
      // Vor dem Einsetzen der Texte umwandeln: die Plätze der Texttabelle gehören dann schon zu den Rahmen
      const backup = path.join(this.dir, 'pages-vor-umbau.json');
      if (!fs.existsSync(backup)) fs.copyFileSync(this.file, backup);
      data.pages = data.pages.map((p) => (p && p.cards && !p.items ? toItems(p) : p));
    }
    if (this.texts) {
      const { walkPages, walkBars } = require('./texts');
      if (data.pages) this.texts.fill(walkPages, data.pages);
      if (data.bars) this.texts.fill(walkBars, data.bars);
    }
    this.pages = cleanPages(data.pages);
    this.bars = data.bars ? cleanBars(data.bars) : defaultBars();
    return this;
  }

  getBars() { return JSON.parse(JSON.stringify(this.bars)); }

  /** Leisten-Vorlage ersetzen */
  saveBars(bars) {
    this.bars = cleanBars(bars);
    if (this.texts) this.texts.sync();
    this._write();
    return this.getBars();
  }

  _write() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    let pages = this.pages;
    let bars = this.bars;
    if (this.texts) {
      const { walkPages, walkBars } = require('./texts');
      pages = this.texts.strip(walkPages, pages);
      bars = this.texts.strip(walkBars, bars);
    }
    fs.writeFileSync(tmp, `${JSON.stringify({ version: FILE_VERSION, pages, bars }, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }

  list() { return JSON.parse(JSON.stringify(this.pages)); }

  /** nach Änderungen an der Texttabelle (z. B. andere Grundsprache): Texte neu einlesen bzw. Datei neu schreiben */
  reload() { return this.load(); }
  persist() { if (fs.existsSync(this.file)) this._write(); }

  get(pageId) { return this.pages.find((p) => p.id === pageId) || null; }

  /** ganze Liste ersetzen (der Editor schickt nach jeder Änderung alles) */
  save(pages) {
    this.pages = cleanPages(pages);
    if (this.texts) this.texts.sync();
    this._write();
    return this.list();
  }
}

/**
 * Bild in den Datenordner übernehmen (bilder/<Prüfsumme>.<Endung>); gibt den Dateinamen zurück.
 * Erlaubt: PNG, JPG, GIF, WebP, SVG bis 10 MB.
 */
function storeImage(dir, file) {
  const ext = path.extname(file).toLowerCase();
  if (!IMAGE_TYPES[ext]) throw Object.assign(new Error('type'), { code: 'type' });
  const buf = fs.readFileSync(file);
  if (buf.length > 10 * 1024 * 1024) throw Object.assign(new Error('size'), { code: 'size' });
  const name = `${require('node:crypto').createHash('sha256').update(buf).digest('hex').slice(0, 16)}${ext === '.jpeg' ? '.jpg' : ext}`;
  const target = path.join(dir, 'bilder', name);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buf);
  }
  return name;
}

/** Pfad und Typ eines gespeicherten Bildes (oder null) – nur gültige Namen, nichts außerhalb von bilder/ */
function imageFile(dir, name) {
  if (!imageName(name)) return null;
  const file = path.join(dir, 'bilder', name);
  return fs.existsSync(file) ? { file, type: IMAGE_TYPES[path.extname(name)] } : null;
}

module.exports = { PageStore, cleanPages, cleanBars, defaultBars, newId, screenRows, storeImage, imageFile, toItems, defaultSize, COLS, GRID };
