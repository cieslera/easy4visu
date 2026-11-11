'use strict';
// Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseItf } = require('../src/import/itf');

const text = fs.readFileSync(path.join(__dirname, '..', 'beispiele', 'easye4mb-beispiel.itf'), 'utf8');
const { variables, warnings } = parseItf(text);
const byName = Object.fromEntries(variables.map((v) => [v.name, v]));

test('keine Warnungen, alle Variablen aufgelöst', () => {
  assert.deepStrictEqual(warnings, []);
  // 16 Merker + 2 MB + 4 MW + 2 MD + I1 + 3 Q + 6 Uhr = 34
  assert.strictEqual(variables.length, 34);
});

test('Merker M1..M16 als Bits in Register 1001', () => {
  assert.deepStrictEqual(byName.M1.modbus, { area: 'holding', fcRead: 3, register: 1001, bit: 0, bits: 1 });
  assert.strictEqual(byName.M16.modbus.bit, 15);
  assert.strictEqual(byName.M16.modbus.register, 1001);
  assert.strictEqual(byName.M1.writable, true);
});

test('MB3 = Low-Byte, MB4 = High-Byte von Register 1002 (wie am Gerät gemessen)', () => {
  assert.strictEqual(byName.MB3.modbus.register, 1002);
  assert.strictEqual(byName.MB3.modbus.bit, 0);
  assert.strictEqual(byName.MB4.modbus.register, 1002);
  assert.strictEqual(byName.MB4.modbus.bit, 8);
});

test('MW und MD', () => {
  assert.strictEqual(byName.MW5.modbus.register, 1005);
  assert.strictEqual(byName.MD6.modbus.register, 1011);
  assert.strictEqual(byName.MD6.modbus.words, 2);
  assert.strictEqual(byName.MD7.modbus.register, 1013);
  assert.strictEqual(byName.MD6.bits, 32);
});

test('Eingang über Discrete Input, Ausgänge über Coils – nicht schreibbar', () => {
  assert.deepStrictEqual(byName.I1.modbus, { area: 'discrete', fcRead: 2, address: 1 });
  assert.strictEqual(byName.I1.writable, false);
  assert.deepStrictEqual(byName.Q3.modbus, { area: 'coil', fcRead: 1, address: 3 });
  assert.strictEqual(byName.Q3.writable, false);
  assert.strictEqual(byName.M1.operand, 'M'); // Merker, nicht Coil 1
});

test('Uhr 5000..5005', () => {
  assert.strictEqual(byName['CLOCK.0'].modbus.register, 5000);
  assert.strictEqual(byName['CLOCK.5'].modbus.register, 5005);
  assert.strictEqual(byName['CLOCK.5'].label, 'Uhr Jahr');
});

test('ungültige Datei wird erkannt', () => {
  assert.throws(() => parseItf('foo\tbar\n'), /Kopfzeile/);
  const r = parseItf('Name\tType\tAddress\r\nX1\tFOO\tR1\r\nX2\tWORD\tZ9\r\n');
  assert.strictEqual(r.warnings.length, 2);
});

// Export von einem Gerät mit Firmware 2.46 (andere Registerbereiche, Analogeingänge)
test('FW 2.46: MW ab 46001, IA 32 Bit ab 42001 als Input Register', () => {
  const r = parseItf(fs.readFileSync(path.join(__dirname, '..', 'beispiele', 'test-netzwerk-nt1-fw246.itf'), 'utf8'));
  const v = Object.fromEntries(r.variables.map((x) => [x.name, x]));
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.variables.length, 11);
  assert.strictEqual(v.MW2.modbus.register, 46002);
  assert.strictEqual(v.MW10.modbus.register, 46010);
  assert.deepStrictEqual(v.IA2.modbus, { area: 'input', fcRead: 4, register: 42003, words: 2, wordOrder: 'low-first' });
  assert.strictEqual(v.IA3.modbus.register, 42005);
  assert.strictEqual(v.IA2.writable, false);
  assert.strictEqual(v.I1.modbus.address, 1); // Eingänge auch bei FW 2.46 auf der alten Adresse
  assert.strictEqual(v['CLOCK.0'].modbus.register, 5000);
});

// NET-Test 24.10.2026: NT1 = FW 2.46 mit 8TE1, 6AE1, 4PE1; NT2 = ältere FW
test('NET-Test NT1 (FW 2.46): Merker-Bits im Register, NET-Merker ab 2001, ID als Discrete Input, QA als RI', () => {
  const r = parseItf(fs.readFileSync(path.join(__dirname, '..', 'beispiele', 'net-test', 'Netzwerk-net1.itf'), 'utf8'));
  const v = Object.fromEntries(r.variables.map((x) => [x.name, x]));
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.variables.length, 98);
  // hohe Merker: easySoft exportiert immer das ganze Merkerwort (M993-M1008 = MW63)
  assert.deepStrictEqual(v.M1000.modbus, { area: 'holding', fcRead: 3, register: 46063, bit: 7, bits: 1 });
  assert.strictEqual(v.MW500.modbus.register, 46500);
  assert.strictEqual(v.MD200.modbus.register, 46399);
  // NET-Merker: auch bei FW 2.46 ab Register 2001
  assert.deepStrictEqual(v.N16.modbus, { area: 'holding', fcRead: 3, register: 2001, bit: 15, bits: 1 });
  assert.strictEqual(v.NB4.modbus.register, 2002);
  assert.strictEqual(v.NB4.modbus.bit, 8);
  assert.strictEqual(v.NW3.modbus.register, 2003);
  assert.strictEqual(v.ND3.modbus.register, 2005);
  assert.strictEqual(v.ND3.writable, true);
  assert.deepStrictEqual(v.M16.modbus, { area: 'holding', fcRead: 3, register: 46001, bit: 15, bits: 1 });
  assert.strictEqual(v.MD10.modbus.register, 46019);
  assert.deepStrictEqual(v.ID29.modbus, { area: 'discrete', fcRead: 2, address: 3029 });
  assert.strictEqual(v.ID29.writable, false);
  assert.strictEqual(v.I17.modbus.address, 17);
  assert.strictEqual(v.Q20.modbus.address, 20);
  assert.strictEqual(v.IA9.modbus.register, 42017);
  assert.strictEqual(v.QA5.modbus.register, 40009); // ITF "RI" (FC4); am Gerät gehen FC3 und FC4 (24.10.2026)
  assert.strictEqual(v.QA5.writable, false);
});

test('NET-Test NT2 (FW 1.40–2.3x): Merker ab 1001, NET-Merker ab 2001, IA ab 6501', () => {
  const r = parseItf(fs.readFileSync(path.join(__dirname, '..', 'beispiele', 'net-test', 'Netzwerk-net2.itf'), 'utf8'));
  const v = Object.fromEntries(r.variables.map((x) => [x.name, x]));
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.variables.length, 57);
  assert.strictEqual(v.M1.modbus.register, 1001);
  assert.strictEqual(v.MD8.modbus.register, 1015);
  assert.strictEqual(v.N1.modbus.register, 2001);
  assert.strictEqual(v.ND3.modbus.register, 2005);
  assert.deepStrictEqual(v.ID1.modbus, { area: 'discrete', fcRead: 2, address: 3001 });
  // FW 1.40–2.3x: IA 32 Bit ab 6501
  assert.deepStrictEqual(v.IA1.modbus, { area: 'input', fcRead: 4, register: 6501, words: 2, wordOrder: 'low-first' });
});
