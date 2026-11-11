'use strict';
/**
 * Variablen (Format siehe docs/VARIABLEN.md) -> Lese- und Schreibpläne für Modbus.
 *
 * Zwei Wege, die zu denselben Registern führen:
 *  1. Variable mit modbus-Angaben aus der .itf-Datei: die Adressen werden genau so verwendet.
 *  2. Variable nur mit Operand (operand 'MW', index 3 oder name 'MW3'): address.js rechnet die Adresse
 *     so aus, wie easySoft sie exportieren würde (abhängig von der Firmware-Stufe).
 *
 * Operanden anderer NET-Teilnehmer (z. B. 2NW3) und Sende-/Empfangsbits (SN/RN) sind über Modbus beim
 * eigenen Gerät nicht erreichbar – eine Visu liest sie beim jeweiligen Gerät selbst.
 *
 * Lesepläne haben das Format von map.operand(): { key, parts: [{ fc, addr, area }], decode(values[]) },
 * damit map.planReads() und map.decodeAll() sie zusammenfassen können.
 */

const MAP = require('./map');
const { modbusAddress } = require('./address');
const { operandOf, WRITABLE } = require('../operand');
const { keyOf } = require('../driver');

const SIGNED = new Set(['INT', 'SINT', 'DINT', 'LINT']);

function fail(key, args) {
  const e = new Error(key);
  e.e4 = { key, args: args || {} };
  return e;
}

/**
 * Wo liegt die Variable? -> { modbus, type, writable } bzw. { clock: true } für die ganze Uhr.
 * ownNet: NET-ID des Geräts selbst (Operanden mit dieser ID gelten als eigene).
 */
function resolve(v, fw, ownNet) {
  if (v.modbus) {
    const input = v.modbus.area === 'discrete' || v.modbus.area === 'input';
    return { modbus: v.modbus, type: String(v.type || '').toUpperCase(), writable: v.writable !== false && !input };
  }
  const op = operandOf(v);
  if (!op) throw fail('device.errors.noAddress', { name: v.name });
  // SN/RN: die NET-ID davor ist der Partner, nicht der Besitzer – über Modbus gar nicht erreichbar
  if (op.type === 'SN' || op.type === 'RN') throw fail('device.errors.noModbus', { name: v.name });
  if (op.net !== null && op.net !== ownNet) throw fail('device.errors.otherNet', { name: v.name, net: op.net });
  if (op.type === 'CLOCK' && op.index === null) return { clock: true };
  const a = modbusAddress(op, fw);
  return { modbus: a.modbus, type: a.type, writable: v.writable !== false && (WRITABLE.has(op.type) || op.type === 'CLOCK') };
}

function float32(lo, hi) {
  const b = Buffer.alloc(4);
  b.writeUInt16BE(hi, 0);
  b.writeUInt16BE(lo, 2);
  return b.readFloatBE(0);
}

function readOpFor(key, mb, type) {
  if (mb.area === 'coil' || mb.area === 'discrete') {
    const fc = mb.area === 'coil' ? 1 : 2;
    return { key, parts: [{ fc, addr: mb.address, area: `b${fc}` }], decode: (x) => x[0] };
  }
  const fc = mb.area === 'input' ? 4 : 3;
  const part = (addr) => ({ fc, addr, area: `r${fc}` });
  if (mb.bits !== undefined && mb.bits < 16) {
    const mask = (1 << mb.bits) - 1;
    return {
      key, parts: [part(mb.register)],
      decode: (x) => {
        const n = (x[0] >> (mb.bit || 0)) & mask;
        return type === 'SINT' && n > 127 ? n - 256 : n;
      },
    };
  }
  if (mb.words === 2) {
    // 32 Bit: niederwertiges Register zuerst
    return {
      key, parts: [part(mb.register), part(mb.register + 1)],
      decode: (x) => {
        if (type === 'REAL') return float32(x[0], x[1]);
        const n = (x[1] << 16) | x[0];
        return SIGNED.has(type) ? n | 0 : n >>> 0;
      },
    };
  }
  return { key, parts: [part(mb.register)], decode: (x) => (type === 'INT' ? (x[0] << 16) >> 16 : x[0]) };
}

/** Leseplan für eine Variable. fw = Firmware-Stufe aus map.fwLevel() */
function readOp(v, fw, ownNet) {
  const key = keyOf(v);
  const r = resolve(v, fw, ownNet);
  if (r.clock) return Object.assign({}, MAP.clock(), { key });
  return readOpFor(key, r.modbus, r.type);
}

/** Schreibplan (Format wie map.writePlan, zusätzlich kind 'bit' = Bit in einem Register) */
function writePlan(v, value, fw, ownNet) {
  const r = resolve(v, fw, ownNet);
  if (r.clock || !r.writable) throw fail('device.errors.notWritable', { name: v.name });
  const mb = r.modbus;
  const name = v.name;
  if (mb.area === 'coil') return { key: `C${mb.address}`, kind: 'coil', addr: mb.address, value: MAP.toBool(value) };
  const addr = mb.register;
  if (mb.bits === 1) return { key: `R${addr}.${mb.bit}`, kind: 'bit', addr, bit: mb.bit || 0, value: MAP.toBool(value) };
  if (mb.bits === 8) {
    let n = MAP.toInt(value, -128, 255, name);
    if (n < 0) n += 256;
    return { key: `R${addr}.${mb.bit}`, kind: 'byte', addr, value: n, high: mb.bit === 8 };
  }
  if (mb.words === 2) {
    let n;
    if (r.type === 'REAL') {
      const f = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'));
      if (!Number.isFinite(f)) throw fail('badReal', { what: name, value: String(value) });
      const b = Buffer.alloc(4);
      b.writeFloatBE(f, 0);
      n = b.readUInt32BE(0);
    } else {
      n = MAP.toInt(value, -2147483648, 4294967295, name) >>> 0;
    }
    return { key: `R${addr}`, kind: 'regs', addr, values: [n & 0xffff, n >>> 16] };
  }
  let n = MAP.toInt(value, -32768, 65535, name);
  if (n < 0) n += 65536;
  return { key: `R${addr}`, kind: 'reg', addr, value: n };
}

module.exports = { readOp, writePlan, resolve };
