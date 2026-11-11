'use strict';
/**
 * Texttabelle für mehrsprachige Projekte (Version 1, Punkt 5). Datei: <Datenordner>/texte.json
 *
 * Jeder Projekttext (Seitenname, Kartentitel, Beschriftung, Text, Schalter-Texte, Betriebsart-Knöpfe, Wertelisten,
 * Funktionstasten, Leisten-Text, Meldungstext, Anzeige-Name einer benutzten Variablen) bekommt eine Nummer (T0001 …).
 * Die Nummer hängt an seinem Platz (z. B. „Element abc, Beschriftung“): So bleiben Übersetzungen erhalten, wenn ein
 * Element in eine andere Karte wandert oder der Text in der Grundsprache geändert wird. In pages.json stehen statt
 * der Texte nur die Nummern (Feld tx: { Feldname: Nummer }).
 *
 * Datei: { version, base: 'de', langs: ['de', 'en', …], texts: { T0001: { de, en, … } }, kinds: { T0001: 'page' },
 *          loc: { Platz: T0001 }, next: 2, guestLang }
 * Fehlt eine Übersetzung, gilt der Text der Grundsprache.
 */

const fs = require('node:fs');
const path = require('node:path');

const LANG_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
const ID_RE = /^T\d{4,}$/;
const PH_RE = /\{(\d+)\}/g;

// ---------------------------------------------------------------- wo stehen Texte?
/** cb(Objekt, Feld, Platz, Art) für jeden übersetzbaren Text eines Elements */
function walkElement(e, key, cb) {
  if (!e) return;
  if (e.kind === 'frame') { cb(e, 'title', key, 'card'); return; } // Rahmen: Überschrift
  if (e.kind === 'text') cb(e, 'text', key, 'text');
  else if (e.kind !== 'image') cb(e, 'label', key, e.kind === 'fkey' ? 'fkey' : 'label');
  if (e.kind === 'switch') { cb(e, 'onText', key, 'switch'); cb(e, 'offText', key, 'switch'); }
  (e.opts || []).forEach((o, i) => cb(o, 't', `${key}/o${i}`, 'choice'));
  (e.map || []).forEach((r, i) => cb(r, 'text', `${key}/m${i}`, 'map'));
  if (e.other) cb(e.other, 'text', `${key}/other`, 'map');
  (e.series || []).forEach((s, i) => cb(s, 'label', `${key}/s${i}`, 'label'));
}
function walkPages(pages, cb) {
  for (const p of pages || []) {
    cb(p, 'name', `p:${p.id}`, 'page');
    for (const e of p.items || []) walkElement(e, `e:${e.id}`, cb);
  }
}
function walkBars(bars, cb) {
  for (const pos of ['top', 'bottom', 'left', 'right']) {
    for (const it of (bars && bars[pos] && bars[pos].items) || []) {
      if (it.type === 'text') cb(it, 'text', `b:${it.id}`, 'bar');
      if (it.type === 'fkey') cb(it, 'label', `b:${it.id}`, 'fkey');
    }
  }
}
function walkAlarms(defs, cb) {
  for (const d of defs || []) cb(d, 'text', `a:${d.id}`, 'alarm');
}

// Platz eines Feldes: Felder eines Objekts unterscheiden (label, onText …)
const place = (key, field) => `${key}#${field}`;

class TextStore {
  /** opts: { dir } */
  constructor(opts) {
    this.dir = opts.dir;
    this.data = { version: 1, base: 'de', langs: ['de'], texts: {}, kinds: {}, loc: {}, next: 1, guestLang: null };
    this.sources = []; // Funktionen (cb) => …, die alle Texte des Projekts durchlaufen (siehe sync)
    this.load();
  }

  get file() { return path.join(this.dir, 'texte.json'); }

  load() {
    if (!fs.existsSync(this.file)) return this;
    const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    const langs = (Array.isArray(d.langs) ? d.langs : []).filter((l) => LANG_RE.test(l));
    const base = LANG_RE.test(d.base) ? d.base : 'de';
    this.data = { version: 1, base, langs: langs.includes(base) ? langs : [base].concat(langs), texts: {}, kinds: {}, loc: {},
      next: Number.isInteger(d.next) && d.next > 0 ? d.next : 1, guestLang: LANG_RE.test(d.guestLang) ? d.guestLang : null };
    for (const [id, t] of Object.entries(d.texts || {})) {
      if (!ID_RE.test(id) || !t || typeof t !== 'object') continue;
      this.data.texts[id] = {};
      for (const [l, s] of Object.entries(t)) if (LANG_RE.test(l) && typeof s === 'string') this.data.texts[id][l] = s.slice(0, 2000);
      if (d.kinds && typeof d.kinds[id] === 'string') this.data.kinds[id] = d.kinds[id];
    }
    for (const [k, id] of Object.entries(d.loc || {})) if (this.data.texts[id]) this.data.loc[k] = id;
    return this;
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get base() { return this.data.base; }
  get langs() { return this.data.langs.slice(); }

  _newId() {
    let id;
    do { id = `T${String(this.data.next++).padStart(4, '0')}`; } while (this.data.texts[id]);
    return id;
  }

  /** Nummer eines Platzes (oder null) */
  idAt(key, field) { return this.data.loc[place(key, field)] || null; }

  /** Text in einer Sprache; fehlt er, gilt die Grundsprache, sonst die erste vorhandene Sprache */
  get(id, lang) {
    const t = this.data.texts[id];
    if (!t) return '';
    return (lang && t[lang]) || t[this.data.base] || this._anyText(t);
  }

  _anyText(t) {
    for (const l of this.data.langs) if (t[l]) return t[l];
    return Object.values(t).find(Boolean) || '';
  }

  /**
   * Alle Texte des Projekts abgleichen: neue Plätze bekommen eine Nummer, geänderte Texte der Grundsprache werden
   * übernommen (Übersetzungen bleiben), Plätze, die es nicht mehr gibt, fallen weg. Gleicher Text an einem neuen
   * Platz (z. B. kopiertes Element) übernimmt die vorhandenen Übersetzungen.
   */
  sync() {
    const base = this.data.base;
    const used = new Set();
    const byText = new Map();
    for (const [id, t] of Object.entries(this.data.texts)) if (t[base] && !byText.has(t[base])) byText.set(t[base], id);
    let changed = false;
    const visit = (obj, field, key, kind) => {
      const text = obj && typeof obj[field] === 'string' ? obj[field].trim() : '';
      if (!text) return;
      const k = place(key, field);
      let id = this.data.loc[k];
      if (!id || used.has(k)) {
        id = this._newId();
        const same = byText.get(text);
        this.data.texts[id] = same ? Object.assign({}, this.data.texts[same]) : {};
        this.data.loc[k] = id;
        changed = true;
      }
      used.add(k);
      const t = this.data.texts[id];
      // fehlt der Text in der Grundsprache, zeigt der Editor ersatzweise eine andere Sprache – die nicht übernehmen
      const fallbackShown = !t[base] && text === this._anyText(t);
      if (t[base] !== text && !fallbackShown) { t[base] = text; changed = true; }
      if (this.data.kinds[id] !== kind) { this.data.kinds[id] = kind; changed = true; }
    };
    for (const src of this.sources) src(visit);
    // Aufräumen: Plätze und Texte, die nicht mehr vorkommen
    const keep = new Set();
    for (const [k, id] of Object.entries(this.data.loc)) {
      if (used.has(k)) keep.add(id);
      else { delete this.data.loc[k]; changed = true; }
    }
    for (const id of Object.keys(this.data.texts)) {
      if (!keep.has(id)) { delete this.data.texts[id]; delete this.data.kinds[id]; changed = true; }
    }
    if (changed) this.save();
    return changed;
  }

  // ---------------------------------------------------------------- Seiten in der Datei: nur Nummern
  /** Kopie zum Speichern: Texte weg, stattdessen tx: { Feld: Nummer } */
  strip(walk, data) {
    const copy = JSON.parse(JSON.stringify(data));
    walk(copy, (obj, field, key) => {
      if (!obj || typeof obj[field] !== 'string' || !obj[field].trim()) return;
      const id = this.idAt(key, field);
      if (!id) return; // (noch) ohne Nummer: Text bleibt stehen
      obj.tx = Object.assign({}, obj.tx, { [field]: id });
      delete obj[field];
    });
    return copy;
  }

  /** beim Laden: Nummern wieder durch den Text der Grundsprache ersetzen, Plätze merken */
  fill(walk, data) {
    walk(data, (obj, field, key) => {
      const id = obj && obj.tx && obj.tx[field];
      if (!id || !this.data.texts[id]) return;
      obj[field] = this.get(id, this.data.base);
      this.data.loc[place(key, field)] = id;
    });
    walk(data, (obj) => { if (obj && obj.tx) delete obj.tx; });
    return data;
  }

  /** Kopie in einer Sprache (Bedienseiten, Leisten) */
  localize(walk, data, lang) {
    const copy = JSON.parse(JSON.stringify(data));
    if (!lang || lang === this.data.base) return copy;
    walk(copy, (obj, field, key) => {
      const id = this.idAt(key, field);
      if (id && obj && typeof obj[field] === 'string') obj[field] = this.get(id, lang);
    });
    return copy;
  }

  // ---------------------------------------------------------------- Sprachen
  addLang(code) {
    if (!LANG_RE.test(code)) throw new Error(`Ungültiges Sprachkürzel: ${code}`);
    if (!this.data.langs.includes(code)) { this.data.langs.push(code); this.save(); }
    return this.langs;
  }

  removeLang(code) {
    if (code === this.data.base) throw new Error('Die Grundsprache kann nicht entfernt werden.');
    this.data.langs = this.data.langs.filter((l) => l !== code);
    for (const t of Object.values(this.data.texts)) delete t[code];
    if (this.data.guestLang === code) this.data.guestLang = null;
    this.save();
    return this.langs;
  }

  /**
   * Grundsprache wechseln (muss schon in der Liste sein). Es wird nichts aufgefüllt: fehlende Texte bleiben als fehlend
   * sichtbar; der Editor zeigt dort ersatzweise den Text einer anderen Sprache, übernimmt ihn aber nicht.
   */
  setBase(code) {
    if (!this.data.langs.includes(code)) throw new Error(`Sprache ${code} ist nicht im Projekt.`);
    this.data.base = code;
    this.save();
  }

  /** Übersetzungen entfernen, die genau dem Text der Grundsprache gleichen (meist nur Kopien) – Anzahl */
  clearCopies() {
    const base = this.data.base;
    let n = 0;
    for (const t of Object.values(this.data.texts)) {
      for (const l of Object.keys(t)) if (l !== base && t[base] && t[l] === t[base]) { delete t[l]; n++; }
    }
    if (n) this.save();
    return n;
  }

  /** einen Text ändern (Übersetzen in der Tabelle) */
  setText(id, lang, text) {
    if (!this.data.texts[id]) throw new Error(`Text ${id} gibt es nicht.`);
    if (!this.data.langs.includes(lang)) throw new Error(`Sprache ${lang} ist nicht im Projekt.`);
    const s = String(text === undefined || text === null ? '' : text).slice(0, 2000);
    if (!s.trim() && lang === this.data.base) throw new Error('Der Text der Grundsprache darf nicht leer sein.');
    if (s.trim()) this.data.texts[id][lang] = s; else delete this.data.texts[id][lang];
    this.save();
    return Object.assign({}, this.data.texts[id]);
  }

  /** Tabelle für die Oberfläche: [{ id, kind, texts: { de, en … } }] */
  rows() {
    return Object.keys(this.data.texts).sort().map((id) => ({ id, kind: this.data.kinds[id] || '', texts: Object.assign({}, this.data.texts[id]) }));
  }

  /** Platzhalter {1}, {2} … eines Textes (sortiert) */
  static placeholders(s) { return [...String(s || '').matchAll(PH_RE)].map((m) => Number(m[1])).sort((a, b) => a - b).join(','); }

  /**
   * Tabelle übernehmen (aus CSV/Excel): Kopfzeile ID; de; en; …, andere Spalten werden ignoriert. Neue Sprachspalten
   * kommen dazu. Leere Zellen ändern nichts. Ergebnis: { changed, langsAdded, unknown: [ids], placeholders: [{ id, lang }] }
   */
  importRows(table) {
    const head = (table[0] || []).map((h) => String(h || '').trim());
    const idCol = head.findIndex((h) => h.toUpperCase() === 'ID');
    if (idCol < 0) throw new Error('Die Tabelle braucht eine Spalte „ID“.');
    const langCols = head.map((h, i) => [h, i]).filter(([h]) => LANG_RE.test(h));
    const r = { changed: 0, langsAdded: [], unknown: [], placeholders: [] };
    for (const [l] of langCols) if (!this.data.langs.includes(l)) { this.data.langs.push(l); r.langsAdded.push(l); }
    for (const row of table.slice(1)) {
      const id = String(row[idCol] || '').trim();
      if (!id) continue;
      const t = this.data.texts[id];
      if (!t) { r.unknown.push(id); continue; }
      for (const [l, i] of langCols) {
        const s = row[i] === undefined || row[i] === null ? '' : String(row[i]);
        if (!s.trim()) continue;
        if (t[l] !== s) { t[l] = s; r.changed++; }
      }
      const ph = TextStore.placeholders(t[this.data.base]);
      for (const l of this.data.langs) if (t[l] && TextStore.placeholders(t[l]) !== ph) r.placeholders.push({ id, lang: l, text: t[l], base: t[this.data.base] });
    }
    this.save();
    return r;
  }

  /** Tabelle zum Ausgeben: Kopfzeile ID, Hinweis (Art), Sprachen – neue Sprachen kommen einfach rechts dazu */
  exportRows(kindNames) {
    const langs = this.langs;
    const rows = [['ID', 'Hinweis', ...langs]];
    for (const r of this.rows()) rows.push([r.id, (kindNames && kindNames[r.kind]) || r.kind, ...langs.map((l) => r.texts[l] || '')]);
    return rows;
  }

  get guestLang() { return this.data.guestLang; }
  setGuestLang(code) {
    this.data.guestLang = LANG_RE.test(code) ? code : null;
    this.save();
  }
}

module.exports = { TextStore, walkPages, walkBars, walkAlarms, walkElement, LANG_RE };
