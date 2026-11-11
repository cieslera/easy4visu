'use strict';
/**
 * Variablenliste eines Geräts aus .itf, Symboltabelle und ST-Programm zusammenführen (Format: docs/VARIABLEN.md).
 *
 *   Adresse         aus der .itf (fehlt sie, rechnet der Modbus-Treiber sie aus dem Operanden)
 *   name            wie in easySoft: Symbolname, sonst Name aus der Kommentar-Tabelle, sonst der Operand (MW3)
 *   label           lesbar für die Visu: „Anlage Anforderung“ bzw. automatisch „Merkerwort MW3“
 *   comment, hint   Beschreibung aus Tabelle/Kommentar; Hinweis aus dem Programm (z. B. „= IA5“)
 *   role            Vorschlag aus dem Programm: 'display' (Anzeige), 'control' (Bedienung, z. B. Taster/Sollwert),
 *                   'internal' (kommt im Programm vor, ist aber kein Ein-/Ausgang der Visu); null = unbekannt
 *
 * Operanden anderer NET-Teilnehmer (2NW3) landen in foreign, Sende-/Empfangsbits (SN/RN) in info.
 * Beim erneuten Einlesen (keepUserChanges) bleiben eigene Änderungen erhalten: alle Felder, die mit „user“ beginnen
 * (userLabel, userRole, userUnit, userScale …), und die id.
 */

const { t } = require('../i18n');
const { WRITABLE } = require('../protocols/operand');
const { operandText } = require('./symbols');

const ORDER = ['I', 'Q', 'IA', 'QA', 'ID', 'M', 'MB', 'MW', 'MD', 'N', 'NB', 'NW', 'ND', 'CLOCK'];
const DATA_TYPE = { I: 'BIT', Q: 'BIT', ID: 'BIT', M: 'BIT', N: 'BIT', MB: 'BYTE', NB: 'BYTE', MW: 'WORD', NW: 'WORD',
  MD: 'LINT', ND: 'LINT', IA: 'LINT', QA: 'LINT' };

/** „Anlage_Anforderung“ -> „Anlage Anforderung“ */
function displayLabel(name) {
  return String(name).replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** automatischer Name: „Merkerwort MW3“, „Uhr Jahr“ */
function autoLabel(type, index) {
  if (type === 'CLOCK') return index === null || index === undefined ? t('import.clockAll') : t(`import.clock.${index}`);
  return `${t(`import.types.${type}`)} ${type}${index}`;
}

/**
 * Kommt der Wert vermutlich von außen (Visu)? Das Programm liest ihn und beschreibt ihn höchstens so:
 *   Bits:  nur zurücksetzen (M6 := FALSE – Impuls-Befehl), nie aus einem Ausdruck
 *   Zahlen: nur mit Konstanten (MW3 := 3 – Standardwert für einen Sollwert)
 */
function fromOutside(type, st) {
  if (st.writes === 0) return true;
  if (st.exprWrites > 0) return false;
  const bit = type === 'M' || type === 'N';
  return bit ? st.constWrites === 0 : true;
}

function keyOf(type, index) {
  return type === 'CLOCK' ? `CLOCK.${index}` : `${type}${index}`;
}

/**
 * @param src { itf: Variablen aus parseItf | null, symbols: aus parseSymbols | null, st: aus parseSt | null,
 *              netId: NET-ID des Geräts (Operanden mit dieser ID gelten als eigene) }
 * @returns { variables, foreign, info, warnings }
 */
function buildVariables(src) {
  const netId = Number.isInteger(src.netId) ? src.netId : null;
  const own = (net) => net === null || net === undefined || net === netId;
  const rows = new Map(); // key -> { type, index, itf, sym, st }
  const row = (type, index) => {
    const k = keyOf(type, index);
    if (!rows.has(k)) rows.set(k, { key: k, type, index, itf: null, sym: null, st: null, cmt: null });
    return rows.get(k);
  };
  const foreign = new Map();
  const info = new Map();
  const outside = (o, name) => {
    const k = operandText(o);
    const target = o.type === 'SN' || o.type === 'RN' ? info : foreign;
    const e = target.get(k) || { operand: k, net: o.net, type: o.type, index: o.index, name: null };
    if (name && !e.name) e.name = name;
    target.set(k, e);
  };

  for (const v of src.itf || []) {
    if (v.operand === 'CLOCK') row('CLOCK', v.index).itf = v;
    else if (v.operand) row(v.operand, v.index).itf = v;
  }
  for (const s of src.symbols || []) {
    if (s.type === 'SN' || s.type === 'RN' || !own(s.net)) outside(s, s.name);
    else if (s.type !== 'CLOCK') row(s.type, s.index).sym = s;
  }
  // Operanden-Kommentare (FUP/KOP): Text wird zum Anzeigenamen
  for (const c of src.comments || []) {
    if (c.owner !== null && c.owner !== undefined && netId !== null && c.owner !== netId) continue; // anderes Gerät im NET
    if (c.type === 'SN' || c.type === 'RN' || !own(c.net)) outside(c, c.text);
    else if (c.type !== 'CLOCK') row(c.type, c.index).cmt = c;
  }
  if (src.st) {
    for (const o of src.st.operands) {
      const used = o.reads + o.writes > 0;
      if (o.type === 'SN' || o.type === 'RN' || !own(o.net)) { if (used) outside(o, o.tableName); continue; }
      // nur in der Kommentar-Tabelle, im Programm nicht benutzt: nur den Namen übernehmen, keine eigene Variable
      if (!used && !rows.has(keyOf(o.type, o.index))) continue;
      row(o.type, o.index).st = o;
    }
  }

  const warnings = [];
  const usedNames = new Map();
  const variables = [];
  const sorted = [...rows.values()].sort((a, b) => (ORDER.indexOf(a.type) - ORDER.indexOf(b.type)) || (a.index - b.index));
  for (const r of sorted) {
    const { type, index, itf, sym, st, cmt } = r;
    const given = (sym && sym.name) || (st && st.tableName) || null;
    let name = given || (itf ? itf.name : r.key);
    if (usedNames.has(name.toLowerCase())) {
      const other = usedNames.get(name.toLowerCase());
      const renamed = `${name}_${r.key.replace('.', '_')}`;
      warnings.push(t('import.warn.nameTwice', { name, a: other, b: r.key, new: renamed }));
      name = renamed;
    }
    usedNames.set(name.toLowerCase(), r.key);

    const writable = itf ? itf.writable : (WRITABLE.has(type) || type === 'CLOCK');
    let role = null;
    const note = String((st && (st.tableNote || st.comment)) || (sym && sym.comment) || '');
    const used = st && st.reads + st.writes > 0;
    if (/^\s*schreiben/i.test(note)) role = 'control'; // so in der Kommentar-Tabelle vermerkt
    else if (/^\s*lesen/i.test(note)) role = 'display';
    else if (/^\s*(nur\s+)?intern/i.test(note)) role = 'internal';
    else if (used) {
      if (type === 'I' || type === 'Q' || type === 'IA' || type === 'QA' || type === 'ID') role = 'display';
      else if (writable && st.reads > 0 && fromOutside(type, st)) role = 'control'; // Taster, Befehl, Sollwert
      else if (st.writes > 0) role = 'display';
      else role = 'internal';
    }
    const v = {
      name,
      label: given ? displayLabel(given) : cmt ? cmt.text
        : (itf && itf.label && itf.label !== itf.name ? itf.label : autoLabel(type, index)),
      operand: type,
      index,
      type: itf ? itf.type : (type === 'CLOCK' ? 'WORD' : DATA_TYPE[type]),
      writable,
      comment: (sym && sym.comment) || (st && (st.tableNote || st.comment)) || (given && cmt ? cmt.text : null) || null,
      hint: st && st.copyOf ? t('import.hint.copyOf', { op: st.copyOf }) : null,
      role,
      sources: [itf && 'itf', sym && 'symbols', st && 'st', cmt && 'comments'].filter(Boolean),
    };
    if (itf) v.modbus = itf.modbus;
    if (src.itf && !itf) {
      v.notInItf = true;
      warnings.push(t('import.warn.notInItf', { op: r.key, name }));
    }
    variables.push(v);
  }
  const named = (f) => (f.name ? ` (${f.name})` : '');
  for (const f of foreign.values()) warnings.push(t('import.warn.foreign', { op: f.operand, name: named(f), net: f.net }));
  for (const f of info.values()) warnings.push(t('import.warn.snrn', { op: f.operand, name: named(f) }));
  return { variables, foreign: [...foreign.values()], info: [...info.values()], warnings };
}

/**
 * Erneut einlesen: neue Liste übernehmen, eigene Änderungen aus der alten behalten.
 * Zuordnung über den Operanden (nicht den Namen – der kann sich in easySoft geändert haben).
 * @returns { variables, added: [Namen], removed: [Namen] }
 */
function keepUserChanges(oldVars, newVars) {
  const opKey = (v) => `${Number.isInteger(v.net) ? v.net : ''}${keyOf(String(v.operand || '').toUpperCase(), v.index)}`;
  const old = new Map((oldVars || []).map((v) => [opKey(v), v]));
  const added = [];
  const variables = newVars.map((nv) => {
    const ov = old.get(opKey(nv));
    if (!ov) {
      added.push(nv.name);
      return nv;
    }
    old.delete(opKey(nv));
    const v = Object.assign({}, nv);
    if (ov.id !== undefined) v.id = ov.id;
    // Import liefert nur den Operanden als Namen (keine Symboltabelle/Kommentare): bisherigen Namen behalten
    if (nv.name.toUpperCase() === opKey(nv).toUpperCase() && ov.name !== nv.name) {
      v.name = ov.name;
      if (ov.label) v.label = ov.label;
    }
    for (const [k, val] of Object.entries(ov)) if (/^user[A-Z]/.test(k)) v[k] = val;
    return v;
  });
  // von Hand angelegte Variablen bleiben, auch wenn sie im Import fehlen
  const removed = [];
  for (const ov of old.values()) {
    if (ov.sources && ov.sources.includes('manual') && !variables.some((v) => v.name === ov.name)) variables.push(ov);
    else removed.push(ov.name);
  }
  return { variables, added, removed };
}

/**
 * Variable von Hand: aus Operand (easySoft-Schreibweise) und Name eine vollständige Variable bauen.
 * Wirft mit verständlichem Text, wenn der Operand unbekannt ist.
 */
function manualVariable(input) {
  const { parseOperand, WRITABLE: W } = require('../protocols/operand');
  const op = parseOperand(input.operand);
  if (!op) throw new Error(t('import.manual.badOperand', { text: String(input.operand || '').trim() }));
  const opText = op.type === 'CLOCK' ? 'CLOCK' : `${op.net !== null ? op.net : ''}${op.type}${op.index}`;
  const name = String(input.name || '').trim() || opText;
  const v = {
    name,
    label: input.label && String(input.label).trim() ? String(input.label).trim() : (input.name ? displayLabel(name) : autoLabel(op.type, op.index)),
    operand: op.type,
    index: op.index,
    type: op.type === 'CLOCK' ? 'WORD' : DATA_TYPE[op.type],
    writable: op.net === null && W.has(op.type),
    comment: null, hint: null, role: null,
    sources: ['manual'],
  };
  if (op.net !== null) v.net = op.net;
  return v;
}

module.exports = { buildVariables, keepUserChanges, manualVariable, displayLabel, autoLabel };
