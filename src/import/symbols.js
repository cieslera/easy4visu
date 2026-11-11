'use strict';
/**
 * Symboltabelle aus easySoft (CSV, „Symbolische Namen“ für ST-Programme) einlesen.
 *
 * Export aus easySoft 8.46 (beispiele/symbole/Symbolische_Namen_easye4_mqtt_demo_Main.csv):
 *   UTF-16 ohne BOM, CRLF, Semikolon, Kopfzeile "Symbolischer Name;Operand", Operanden wie M01, MW03, I01, Q01.
 * Selbst erstellt und importierbar (beispiele/symbole/eigene-tabelle.csv): UTF-8, LF, Operanden wie M1, MW3.
 * Eine Kommentar-Spalte wird mitgelesen, falls vorhanden.
 *
 * Ergebnis: { symbols: [{ name, operand: 'MW3', net, type, index, comment }], warnings }
 */

const { decodeText } = require('./text');
const { parseOperand, isDeviceKey } = require('../protocols/operand');

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function splitLine(line, sep) {
  // einfache CSV-Regeln: Felder in Anführungszeichen dürfen das Trennzeichen enthalten
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === sep && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Operand als Text in easySoft-Schreibweise ohne führende Nullen: "MW03" -> "MW3", "2NW03" -> "2NW3" */
function operandText(op) {
  if (op.type === 'CLOCK') return 'CLOCK';
  return `${op.net !== null ? op.net : ''}${op.type}${op.index}`;
}

function parseSymbols(input) {
  const text = decodeText(input);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const warnings = [];
  const symbols = [];
  if (!lines.length) throw new Error('Leere Datei');
  const sep = [';', '\t', ','].find((s) => lines[0].includes(s)) || ';';
  const head = splitLine(lines[0], sep).map((h) => h.toLowerCase());
  let iName = head.findIndex((h) => /symbol|name/.test(h));
  let iOp = head.findIndex((h) => /operand|adresse|address/.test(h));
  const iComment = head.findIndex((h) => /kommentar|comment|beschreibung/.test(h));
  let start = 1;
  if (iName < 0 || iOp < 0) {
    // ohne Kopfzeile: erste Spalte Name, zweite Operand
    iName = 0;
    iOp = 1;
    start = 0;
  }
  const seen = new Map();
  for (let i = start; i < lines.length; i++) {
    const cols = splitLine(lines[i], sep);
    const name = cols[iName] || '';
    const opText = cols[iOp] || '';
    const lineNo = i + 1;
    const op = parseOperand(opText);
    if (!NAME_RE.test(name)) { warnings.push(`Zeile ${lineNo}: ungültiger Name „${name}“`); continue; }
    if (!op && isDeviceKey(opText)) continue; // Gerätetaste P1 … P8: bekannt, keine Variable der Visu
    if (!op) { warnings.push(`Zeile ${lineNo}: unbekannter Operand „${opText}“ bei „${name}“`); continue; }
    const key = name.toLowerCase();
    if (seen.has(key)) { warnings.push(`Zeile ${lineNo}: „${name}“ steht schon in Zeile ${seen.get(key)}`); continue; }
    seen.set(key, lineNo);
    symbols.push({ name, operand: operandText(op), net: op.net, type: op.type, index: op.index,
      comment: iComment >= 0 && cols[iComment] ? cols[iComment] : null });
  }
  return { symbols, warnings };
}

module.exports = { parseSymbols, operandText };
