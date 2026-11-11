'use strict';
/**
 * Operanden-Kommentare aus easySoft (Export als .xls) – die Namensquelle für FUP- und KOP-Programme.
 *
 * Aufbau (beispiele/symbole/Export Kommentare FUP.xls, easySoft 8.46):
 *   easySoft V8.46        Unbenannt1.e80
 *   CV1SR2ER5CC2          26.10.2026 12:00:21        <- Gerätetyp, Zeitpunkt
 *   NET-ID | Operand | Deutsch                      <- Kopfzeile, eine Spalte je Sprache
 *          | I01     | Start Pumpe 1
 * Die Spalte NET-ID ist im Beispiel leer (= das Gerät selbst). Ist sie gefüllt und die NET-ID des Geräts bekannt,
 * werden nur passende Zeilen übernommen (Annahme – noch nicht mit einem NET-Projekt geprüft).
 *
 * Ergebnis: { comments: [{ net, type, index, operand, text }], deviceType, warnings }
 */

const { readXls } = require('./xls');
const { parseOperand, isDeviceKey } = require('../protocols/operand');
const { operandText } = require('./symbols');

function parseComments(input, opts) {
  const lang = (opts && opts.lang) || 'deutsch';
  const sheets = readXls(input);
  const warnings = [];
  const comments = [];
  let deviceType = null;
  for (const sheet of sheets) {
    const rows = sheet.rows.map((r) => r.map((c) => String(c === undefined || c === null ? '' : c).trim()));
    const head = rows.findIndex((r) => r.some((c) => /^operand$/i.test(c)));
    if (head < 0) continue;
    if (head >= 1 && rows[1] && rows[1][0] && !deviceType) deviceType = rows[1][0];
    const cols = rows[head].map((c) => c.toLowerCase());
    const iOp = cols.indexOf('operand');
    const iNet = cols.findIndex((c) => /net-?id/.test(c));
    // Textspalte: gewünschte Sprache, sonst die erste Spalte rechts vom Operanden
    let iText = cols.indexOf(lang);
    if (iText < 0) iText = cols.findIndex((c, i) => i > iOp && c);
    if (iText < 0) { warnings.push(`${sheet.name}: keine Kommentar-Spalte gefunden`); continue; }
    for (let r = head + 1; r < rows.length; r++) {
      const row = rows[r];
      const opText = row[iOp] || '';
      const text = row[iText] || '';
      if (!opText && !text) continue;
      const op = parseOperand(opText);
      if (!op && isDeviceKey(opText)) continue; // Gerätetaste P1 … P8: bekannt, keine Variable der Visu
      if (!op) { warnings.push(`Zeile ${r + 1}: unbekannter Operand „${opText}“`); continue; }
      if (!text) continue;
      const net = iNet >= 0 && /^\d+$/.test(row[iNet] || '') ? Number(row[iNet]) : null;
      comments.push({ net: op.net !== null ? op.net : null, owner: net, type: op.type, index: op.index, operand: operandText(op), text });
    }
  }
  if (!comments.length && !warnings.length) warnings.push('Keine Operanden-Kommentare gefunden (Kopfzeile „Operand“ fehlt?)');
  return { comments, deviceType, warnings };
}

module.exports = { parseComments };
