'use strict';
/**
 * Variablen-Import aus easySoft-Dateien: .itf (Adressen), Symboltabelle (CSV) und ST-Programm(e).
 *
 *   const r = importFiles({ itf: 'NT1.itf', symbols: ['Symbolische_Namen_….csv'], st: ['Main.st'],
 *                           comments: ['Kommentare.xls'], netId: 1 });
 *   r.variables, r.foreign, r.info, r.warnings
 *   applyToDevice(deviceStore, deviceId, r)   // übernimmt die Liste, eigene Änderungen bleiben
 */

const fs = require('node:fs');
const { decodeText } = require('./text');
const { parseItf } = require('./itf');
const { parseSymbols } = require('./symbols');
const { parseSt } = require('./st');
const { parseComments } = require('./comments');
const { buildVariables, keepUserChanges } = require('./merge');
const { t } = require('../i18n');

const list = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);

function importFiles(opts) {
  const warnings = [];
  let itf = null;
  if (opts.itf) {
    const r = parseItf(decodeText(fs.readFileSync(opts.itf)));
    r.warnings.forEach((w) => warnings.push(`.itf: ${w}`));
    itf = r.variables;
  }
  let symbols = null;
  for (const f of list(opts.symbols)) {
    const r = parseSymbols(fs.readFileSync(f));
    r.warnings.forEach((w) => warnings.push(`Symboltabelle: ${w}`));
    symbols = (symbols || []).concat(r.symbols);
  }
  // Operanden-Kommentare aus easySoft (.xls) – Namen für FUP/KOP
  let comments = null;
  for (const f of list(opts.comments)) {
    const r = parseComments(fs.readFileSync(f));
    r.warnings.forEach((w) => warnings.push(`Kommentare: ${w}`));
    comments = (comments || []).concat(r.comments);
  }
  // mehrere ST-Programme (z. B. Main und Unterprogramme): Zählungen addieren
  let st = null;
  for (const f of list(opts.st)) {
    const r = parseSt(fs.readFileSync(f), { symbols: symbols || [] });
    r.warnings.forEach((w) => warnings.push(`ST: ${w}`));
    if (!st) { st = r; continue; }
    for (const o of r.operands) {
      const e = st.operands.find((x) => x.key === o.key);
      if (!e) { st.operands.push(o); continue; }
      e.reads += o.reads;
      e.writes += o.writes;
      for (const k of ['tableName', 'tableNote', 'comment']) if (!e[k]) e[k] = o[k];
      e.copyOf = e.copyOf === o.copyOf ? e.copyOf : null;
    }
  }
  const r = buildVariables({ itf, symbols, st, comments, netId: opts.netId });
  r.warnings = warnings.concat(r.warnings);
  return r;
}

/** Importierte Variablen in ein Gerät übernehmen; eigene Änderungen (Felder user…) bleiben erhalten */
function applyToDevice(store, deviceId, result) {
  const d = store.get(deviceId);
  if (!d) throw new Error(t('core.errors.noDevice', { id: deviceId }));
  const k = keepUserChanges(d.variables, result.variables);
  store.setVariables(deviceId, k.variables);
  return { added: k.added, removed: k.removed };
}

module.exports = { importFiles, applyToDevice };
