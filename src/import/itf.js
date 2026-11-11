'use strict';
/**
 * Import der easySoft-Variablenliste für Galileo (*.itf).
 *
 * Aufbau (am Beispiel easye4mb-beispiel.itf, ASCII, CRLF, Tabulator-getrennt):
 *   Name              Type   Address
 *   M001_M016[1..16]  BIT    R1001.0     -> Merker M1..M16 als Bits im Holding-Register 1001
 *   MB003_MB004[3..4] BYTE   R1002.0     -> MB3 = Low-Byte, MB4 = High-Byte von Register 1002
 *   MW003             WORD   R1003
 *   MD006             LINT   R1011       -> 32 Bit, zwei Register (niederwertiges zuerst)
 *   I01               BIT    MI1         -> Discrete Input 1 (FC2)
 *   Q01               BIT    M1          -> Coil 1 (FC1) – Achtung: "M" ist hier Modbus-Coil, nicht Merker!
 *   RTC_EASY[0..5]    WORD   R5000       -> Uhr: s, min, h, Tag, Monat, Jahr
 *
 * Ergebnis: Liste einzelner Variablen mit easyE4-Operand und Modbus-Adresse.
 */

const TYPE_BITS = { BIT: 1, BOOL: 1, BYTE: 8, USINT: 8, SINT: 8, WORD: 16, INT: 16, UINT: 16,
  DWORD: 32, DINT: 32, UDINT: 32, LINT: 32, REAL: 32 };

// Galileo-Adresskürzel -> Modbus-Bereich
const AREAS = {
  R: { area: 'holding', fcRead: 3 },   // Holding Register
  RI: { area: 'input', fcRead: 4 },    // Input Register (vermutet, noch nicht im Beispiel)
  MI: { area: 'discrete', fcRead: 2 }, // Discrete Input
  M: { area: 'coil', fcRead: 1 },      // Coil
};

const CLOCK_FIELDS = ['Sekunde', 'Minute', 'Stunde', 'Tag', 'Monat', 'Jahr'];

function parseAddress(text) {
  const m = /^([A-Z]+)(\d+)(?:\.(\d+))?$/i.exec(text.trim());
  if (!m) return null;
  const prefix = m[1].toUpperCase();
  const def = AREAS[prefix];
  if (!def) return null;
  return { prefix, area: def.area, fcRead: def.fcRead, number: Number(m[2]),
    bit: m[3] === undefined ? null : Number(m[3]) };
}

/** "M001_M016[1..16]" -> {base:'M', from:1, to:16}; "MW003" -> {base:'MW', from:3, to:3} */
function parseName(text) {
  const name = text.trim();
  let m = /^(.*)\[(\d+)\.\.(\d+)\]$/.exec(name);
  if (m) {
    const head = m[1];
    const op = /^([A-Z]+)\d+_\1\d+$/i.exec(head);
    return { raw: name, base: op ? op[1].toUpperCase() : head, from: Number(m[2]), to: Number(m[3]),
      isOperand: !!op, isArray: true };
  }
  m = /^([A-Z]+)0*(\d+)$/i.exec(name);
  if (m) return { raw: name, base: m[1].toUpperCase(), from: Number(m[2]), to: Number(m[2]), isOperand: true, isArray: false };
  return { raw: name, base: name, from: 0, to: 0, isOperand: false, isArray: false };
}

/** Darf die easyE4 diesen Wert über Modbus schreiben lassen? (E/As nein, Merker/NET/Uhr ja) */
function isWritable(area, operand) {
  if (area === 'discrete' || area === 'input') return false;
  if (/^(I|Q|IA|QA|ID)$/.test(operand)) return false;
  return true;
}

function expand(row, lineNo, warnings) {
  const nameInfo = parseName(row.name);
  const type = row.type.trim().toUpperCase();
  const bits = TYPE_BITS[type];
  const addr = parseAddress(row.address);
  if (!bits) { warnings.push(`Zeile ${lineNo}: unbekannter Typ "${row.type}"`); return []; }
  if (!addr) { warnings.push(`Zeile ${lineNo}: unbekannte Adresse "${row.address}"`); return []; }

  const out = [];
  const isClock = /^RTC/i.test(nameInfo.base);
  for (let idx = nameInfo.from, k = 0; idx <= nameInfo.to; idx++, k++) {
    let name; let operand = null; let index = null; let label = null;
    if (isClock) {
      name = `CLOCK.${idx}`; operand = 'CLOCK'; index = idx; label = `Uhr ${CLOCK_FIELDS[idx] || idx}`;
    } else if (nameInfo.isOperand) {
      operand = nameInfo.base; index = idx; name = `${operand}${idx}`;
    } else {
      name = nameInfo.isArray ? `${nameInfo.base}[${idx}]` : nameInfo.base;
    }

    const modbus = { area: addr.area, fcRead: addr.fcRead };
    if (addr.area === 'coil' || addr.area === 'discrete') {
      modbus.address = addr.number + k;
    } else if (bits < 16) {
      // Bit/Byte innerhalb eines Registers: Startbit + k * Breite
      const bitPos = (addr.bit || 0) + k * bits;
      modbus.register = addr.number + Math.floor(bitPos / 16);
      modbus.bit = bitPos % 16;
      modbus.bits = bits;
    } else {
      const words = bits / 16;
      modbus.register = addr.number + k * words;
      modbus.words = words;
      if (words === 2) modbus.wordOrder = 'low-first';
    }
    out.push({ name, label: label || name, operand, index, type, bits,
      writable: isWritable(addr.area, operand || ''), modbus, source: { file: 'itf', line: lineNo, raw: row.name } });
  }
  return out;
}

function parseItf(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const warnings = [];
  const variables = [];
  let header = null;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const cols = line.split('\t');
    if (!header) {
      header = cols.map((c) => c.trim().toLowerCase());
      if (!(header.includes('name') && header.includes('address'))) {
        throw new Error('Keine gültige ITF-Datei: Kopfzeile "Name<Tab>Type<Tab>Address" fehlt');
      }
      return;
    }
    const row = {};
    header.forEach((h, j) => { row[h] = (cols[j] || '').trim(); });
    variables.push(...expand({ name: row.name, type: row.type || '', address: row.address }, i + 1, warnings));
  });
  if (!header) throw new Error('Leere Datei');
  return { variables, warnings };
}

module.exports = { parseItf, parseName, parseAddress };
