'use strict';
/**
 * „Meine Symbole“: eigene Bildersammlung des Projekts (Datei symbole.json im Datenordner, Bilder im Ordner „bilder“).
 *   { symbols: [{ img: '<Name in bilder/>', name: 'pumpe-an', group: 'Pumpen' }] }
 * Beim Einlesen werden die Bilder einmal kopiert (storeImage); Unterordner werden zu Gruppen, Bilder direkt im gewählten
 * Ordner landen in der Gruppe '' („Allgemein“). Entfernen nimmt ein Bild nur aus der Sammlung – Seiten, die es benutzen,
 * behalten es. Die Datei ist in der Projekt-Sicherung enthalten.
 */

const fs = require('node:fs');
const path = require('node:path');
const { storeImage, imageFile } = require('./project');

const FILE = 'symbole.json';
const MAX_SYMBOLS = 2000;
const MAX_SCAN = 1000;       // höchstens so viele Bilder je Ordner-Einlesen
const MAX_DEPTH = 4;         // Unterordner-Tiefe beim Einlesen
const EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

const cleanText = (v, max) => String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const nameOf = (file) => cleanText(path.basename(file, path.extname(file)), 60) || 'Bild';

function list(dir) {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); } catch (e) { data = null; }
  const out = [];
  const seen = new Set();
  for (const s of (data && Array.isArray(data.symbols) ? data.symbols : [])) {
    if (!s || seen.has(s.img) || !imageFile(dir, s.img)) continue; // Bild fehlt: nicht anzeigen
    seen.add(s.img);
    out.push({ img: s.img, name: cleanText(s.name, 60) || 'Bild', group: cleanText(s.group, 40) });
  }
  return out;
}

function save(dir, symbols) {
  const file = path.join(dir, FILE);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({ symbols }, null, 2)}\n`, 'utf8');
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * Bilder aus einem Ordner sammeln: [{ file, group }]. Gruppe = erster Unterordner unter root ('' direkt in root).
 * Versteckte Ordner/Dateien (Punkt am Anfang) werden übersprungen.
 */
function scanFolder(root) {
  const out = [];
  const walk = (d, depth, group) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    for (const en of entries) {
      if (out.length >= MAX_SCAN || en.name.startsWith('.')) continue;
      const p = path.join(d, en.name);
      if (en.isDirectory()) { if (depth < MAX_DEPTH) walk(p, depth + 1, depth === 0 ? cleanText(en.name, 40) : group); }
      else if (en.isFile() && EXT.has(path.extname(en.name).toLowerCase())) out.push({ file: p, group });
    }
  };
  walk(root, 0, '');
  return out;
}

/**
 * Bilder übernehmen. entries: [{ file, group }]. Schon vorhandene Bilder (gleicher Inhalt) bleiben, wie sie sind.
 * Liefert { added, known, failed: [{ file, code: 'type' | 'size' | 'read' }], symbols }.
 */
function add(dir, entries) {
  const symbols = list(dir);
  const have = new Set(symbols.map((s) => s.img));
  const r = { added: 0, known: 0, failed: [] };
  for (const en of entries) {
    if (symbols.length >= MAX_SYMBOLS) { r.failed.push({ file: en.file, code: 'full' }); continue; }
    let img;
    try { img = storeImage(dir, en.file); } catch (e) { r.failed.push({ file: en.file, code: e.code === 'type' || e.code === 'size' ? e.code : 'read' }); continue; }
    if (have.has(img)) { r.known++; continue; }
    have.add(img);
    symbols.push({ img, name: nameOf(en.file), group: cleanText(en.group, 40) });
    r.added++;
  }
  if (r.added) save(dir, symbols);
  return Object.assign(r, { symbols });
}

/** Name und Gruppe ändern */
function update(dir, img, o) {
  const symbols = list(dir);
  const s = symbols.find((x) => x.img === img);
  if (!s) return symbols;
  if (o && o.name !== undefined) s.name = cleanText(o.name, 60) || s.name;
  if (o && o.group !== undefined) s.group = cleanText(o.group, 40);
  save(dir, symbols);
  return symbols;
}

/** aus der Sammlung nehmen (das Bild selbst bleibt für Seiten, die es benutzen) */
function remove(dir, img) {
  const symbols = list(dir).filter((x) => x.img !== img);
  save(dir, symbols);
  return symbols;
}

module.exports = { FILE, MAX_SCAN, list, scanFolder, add, update, remove };
