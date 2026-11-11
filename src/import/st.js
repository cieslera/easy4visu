'use strict';
/**
 * ST-Programm aus easySoft auswerten: welche Operanden werden benutzt, wie heißen sie, was tut das Programm damit.
 *
 * Namen und Beschreibungen kommen (in dieser Reihenfolge) aus
 *   - der Symboltabelle (CSV, siehe symbols.js) – dann darf das Programm auch mit Namen statt Operanden arbeiten,
 *   - einer Tabelle im Kopfkommentar:   MW3   Lebenszeichen   lesen (Sekunden seit Start)
 *   - dem Kommentar hinter einer Zuweisung:   MW9 := IA05;   // 0 ... 10 V
 * Zusätzlich: wird der Operand vom Programm beschrieben und/oder gelesen, ist er eine Kopie (MW9 := IA05)?
 * Pin-Namen von Bausteinaufrufen (T01 (I1 := …, Q1 => M3)) sind keine Operanden.
 *
 * Ergebnis: { operands: [{ key, net, type, index, reads, writes, tableName, tableNote, comment, copyOf }],
 *             unknownNames: [...], warnings }
 */

const { decodeText } = require('./text');
const { parseOperand } = require('../protocols/operand');
const { operandText } = require('./symbols');

const KEYWORDS = new Set(['IF', 'THEN', 'ELSE', 'ELSIF', 'END_IF', 'CASE', 'OF', 'END_CASE', 'FOR', 'TO', 'BY', 'DO',
  'END_FOR', 'WHILE', 'END_WHILE', 'REPEAT', 'UNTIL', 'END_REPEAT', 'EXIT', 'RETURN', 'AND', 'OR', 'XOR', 'NOT', 'MOD',
  'TRUE', 'FALSE', 'VAR', 'END_VAR']);

/** Kommentare und Text-Konstanten vom Programmcode trennen; Positionen (Zeilen) bleiben erhalten */
function splitComments(src) {
  let code = '';
  const comments = [];
  let i = 0;
  let line = 1;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const two = src.substr(i, 2);
    if (two === '(*') {
      const end = src.indexOf('*)', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      const text = src.slice(i + 2, end < 0 ? src.length : end);
      comments.push({ kind: 'block', text, line });
      code += blank(src.slice(i, stop));
      line += (src.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
    } else if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? src.length : end;
      comments.push({ kind: 'line', text: src.slice(i + 2, stop), line });
      code += blank(src.slice(i, stop));
      i = stop;
    } else if (src[i] === "'" || src[i] === '"') {
      const q = src[i];
      const end = src.indexOf(q, i + 1);
      const stop = end < 0 ? src.length : end + 1;
      code += blank(src.slice(i, stop));
      line += (src.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
    } else {
      if (src[i] === '\n') line++;
      code += src[i];
      i++;
    }
  }
  return { code, comments };
}

/**
 * Tabelle im Kopfkommentar, in beiden Spalten-Reihenfolgen:
 *   "Operand  Name  Bemerkung"   (MW3   Lebenszeichen   lesen …)
 *   "Name  Operand  Bemerkung"   (Fern_Ein   M5   schreiben …)
 */
function tableEntries(comments) {
  const out = [];
  for (const c of comments) {
    if (c.kind !== 'block') continue;
    for (const raw of c.text.split(/\r?\n/)) {
      // Spalten sind durch mindestens zwei Leerzeichen oder einen Tabulator getrennt; ein Leerzeichen genügt nur,
      // wenn der Name einen Unterstrich hat (lange Namen: „Hand_Ein_gespeichert M10“). So wird Fließtext
      // („Taster I02 oder M6 …“) nicht für eine Tabellenzeile gehalten.
      const m = /^\s*([0-9A-Za-z_]+)( +|\t)\s*([0-9A-Za-z_]+)(?:\s+(.*?))?\s*$/.exec(raw);
      if (!m) continue;
      const wide = m[2].length >= 2 || m[2] === '\t';
      m.splice(2, 1); // jetzt wie vorher: m[1] erste Spalte, m[2] zweite, m[3] Rest
      if (!wide && !m[1].includes('_') && !m[2].includes('_')) continue;
      const first = parseOperand(m[1]);
      const second = parseOperand(m[2]);
      const isName = (s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
      if (first && first.type !== 'CLOCK' && isName(m[2]) && !second) out.push({ op: first, name: m[2], note: m[3] || null });
      else if (second && second.type !== 'CLOCK' && isName(m[1]) && !first) out.push({ op: second, name: m[1], note: m[3] || null });
    }
  }
  return out;
}

function matching(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')' && --depth === 0) return i;
  }
  return code.length - 1;
}

function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSt(input, opts) {
  const src = decodeText(input).replace(/\r\n?/g, '\n');
  const symbols = new Map(((opts && opts.symbols) || []).map((s) => [s.name.toUpperCase(), s]));
  const warnings = [];
  const ops = new Map();
  const unknown = new Set();

  const entry = (op) => {
    const key = operandText(op);
    if (!ops.has(key)) {
      // writes = resetWrites (:= FALSE / 0) + constWrites (andere Konstante) + exprWrites (Ausdruck, Bausteinausgang)
      ops.set(key, { key, net: op.net, type: op.type, index: op.index, reads: 0, writes: 0,
        resetWrites: 0, constWrites: 0, exprWrites: 0,
        tableName: null, tableNote: null, comment: null, copyOf: undefined });
    }
    return ops.get(key);
  };
  // Wort im Programm -> Operand (direkt oder über die Symboltabelle) oder null
  const resolve = (word) => {
    const s = symbols.get(word.toUpperCase());
    if (s) return { net: s.net, type: s.type, index: s.index };
    const op = parseOperand(word);
    return op && op.type !== 'CLOCK' ? op : null;
  };
  const WORD = /\b[0-9]?[A-Za-z_][A-Za-z0-9_]*\b/g;
  // alle Operanden in einem Ausdruck als gelesen zählen
  const reads = (expr) => {
    for (const m of expr.replace(/\b\w+#[\w.:]+/g, ' ').matchAll(WORD)) {
      const w = m[0];
      const after = expr.slice(m.index + w.length).trimStart();
      if (after.startsWith('[') || after.startsWith('(')) continue; // M[MB20] bzw. Funktionsaufruf
      const op = resolve(w);
      if (op) entry(op).reads++;
      else if (!KEYWORDS.has(w.toUpperCase()) && !/^\d/.test(w)) unknown.add(w);
    }
  };

  const { code: rawCode, comments } = splitComments(src);
  let code = rawCode;

  // 1. Bausteinaufrufe: NAME ( pin := ausdruck, pin => ziel ) – Pins sind keine Operanden
  const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m;
  while ((m = callRe.exec(code))) {
    const name = m[1];
    if (KEYWORDS.has(name.toUpperCase()) || resolve(name)) continue; // "IF (" bzw. Operand vor Klammer
    const open = code.indexOf('(', m.index + name.length);
    const close = matching(code, open);
    for (const arg of splitArgs(code.slice(open + 1, close))) {
      const out = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=>(.*)$/s.exec(arg);
      const inp = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*:=(.*)$/s.exec(arg);
      if (out) {
        const target = out[1].trim();
        if (target) {
          const op = resolve(target);
          if (op) {
            entry(op).writes++;
            entry(op).exprWrites++;
          }
        }
      } else reads(inp ? inp[1] : arg);
    }
    // Aufruf ausblenden (Zeilen bleiben erhalten), dann weitersuchen
    code = code.slice(0, m.index) + code.slice(m.index, close + 1).replace(/[^\n]/g, ' ') + code.slice(close + 1);
    callRe.lastIndex = m.index;
  }

  // 2. Anweisungen: ZIEL := ausdruck;
  const lines = code.split('\n');
  const assignAt = new Map(); // Zeile -> beschriebener Operand (für Kommentare hinter der Zeile)
  let pos = 0;
  for (const stmt of code.split(';')) {
    const line = (code.slice(0, pos).match(/\n/g) || []).length + 1;
    pos += stmt.length + 1;
    const a = /([0-9]?[A-Za-z_][A-Za-z0-9_]*)\s*:=([\s\S]*)$/.exec(stmt);
    if (!a) { reads(stmt); continue; }
    reads(stmt.slice(0, a.index)); // z. B. IF-Bedingung davor
    const target = resolve(a[1]);
    const rhs = a[2];
    reads(rhs);
    if (!target) {
      if (!KEYWORDS.has(a[1].toUpperCase())) unknown.add(a[1]);
      continue;
    }
    const e = entry(target);
    e.writes++;
    const single = rhs.trim();
    if (/^(FALSE|0)$/i.test(single)) e.resetWrites++; // Befehl zurücksetzen (z. B. Impuls aus der Visu)
    else if (/^(TRUE|-?\d+)$/i.test(single)) e.constWrites++;
    else e.exprWrites++;
    const src1 = /^[0-9]?[A-Za-z_][A-Za-z0-9_]*$/.test(single) ? resolve(single) : null;
    const copy = src1 ? operandText(src1) : null;
    e.copyOf = e.copyOf === undefined ? copy : (e.copyOf === copy ? copy : null);
    const targetLine = line + (stmt.slice(0, a.index).match(/\n/g) || []).length;
    if (!assignAt.has(targetLine)) assignAt.set(targetLine, e);
  }

  // 3. Kommentar hinter einer Zuweisung
  for (const c of comments) {
    if (c.kind !== 'line') continue;
    const e = assignAt.get(c.line);
    const text = c.text.trim();
    if (e && text && !e.comment && lines[c.line - 1] && lines[c.line - 1].trim()) e.comment = text;
  }

  // 4. Tabelle im Kopfkommentar
  for (const t of tableEntries(comments)) {
    const e = entry(t.op);
    if (!e.tableName) {
      e.tableName = t.name;
      e.tableNote = t.note;
    }
  }

  for (const e of ops.values()) if (e.copyOf === undefined) e.copyOf = null;
  const unknownNames = [...unknown].filter((w) => !/^[A-Za-z]{1,3}\d+$/.test(w) || !resolve(w)).sort();
  if (unknownNames.length && !symbols.size) {
    warnings.push(`Unbekannte Namen im Programm (${unknownNames.slice(0, 5).join(', ')}${unknownNames.length > 5 ? ' …' : ''}) – benutzt das Programm symbolische Namen? Dann die Symboltabelle (CSV) mit einlesen.`);
  }
  return { operands: [...ops.values()], unknownNames, warnings };
}

module.exports = { parseSt, splitComments };
