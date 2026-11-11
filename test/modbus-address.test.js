'use strict';
// Modbus-Adressen ohne .itf-Datei müssen genau dem easySoft-Export entsprechen. Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseItf } = require('../src/import/itf');
const { modbusAddress } = require('../src/protocols/modbus/address');
const { parseOperand } = require('../src/protocols/operand');
const { FW } = require('../src/protocols/modbus/map');

const EXPORTS = [
  ['easye4mb-beispiel.itf', FW.V140],
  ['test-netzwerk-nt1-fw246.itf', FW.V240],
  ['net-test/Netzwerk-net1.itf', FW.V240], // NT1, FW 2.46
  ['net-test/Netzwerk-net2.itf', FW.V140], // NT2, FW 1.40–2.3x
];

for (const [file, fw] of EXPORTS) {
  test(`gleiche Adressen wie der easySoft-Export ${file}`, () => {
    const { variables } = parseItf(fs.readFileSync(path.join(__dirname, '..', 'beispiele', file), 'utf8'));
    assert.ok(variables.length > 0);
    for (const v of variables) {
      const a = modbusAddress({ type: v.operand, index: v.index }, fw);
      assert.deepStrictEqual(a.modbus, v.modbus, v.name);
      assert.strictEqual(a.type, v.type, `${v.name}: Typ`);
    }
  });
}

test('Grenzen je Firmware, nicht erreichbare Operanden', () => {
  assert.strictEqual(modbusAddress({ type: 'MW', index: 1022 }, FW.V240).modbus.register, 47022);
  assert.throws(() => modbusAddress({ type: 'MW', index: 513 }, FW.V140), (e) => e.e4.key === 'indexRangeFw');
  assert.throws(() => modbusAddress({ type: 'NW', index: 33 }, FW.V240), (e) => e.e4.key === 'indexRange');
  assert.throws(() => modbusAddress({ type: 'SN', index: 1 }, FW.V240), (e) => e.e4.key === 'device.errors.noModbus');
  // ältere Firmware: Analogwerte 16 Bit
  assert.deepStrictEqual(modbusAddress({ type: 'IA', index: 2 }, FW.OLD).modbus, { area: 'input', fcRead: 4, register: 2, words: 1 });
});

test('Operanden-Schreibweise aus easySoft-ST (auch andere NET-Teilnehmer)', () => {
  assert.deepStrictEqual(parseOperand('I01'), { net: null, type: 'I', index: 1 });
  assert.deepStrictEqual(parseOperand('MW500'), { net: null, type: 'MW', index: 500 });
  assert.deepStrictEqual(parseOperand('2NW3'), { net: 2, type: 'NW', index: 3 });
  assert.deepStrictEqual(parseOperand('2SN01'), { net: 2, type: 'SN', index: 1 });
  assert.deepStrictEqual(parseOperand('ai3'), { net: null, type: 'IA', index: 3 });
  assert.deepStrictEqual(parseOperand('O2'), { net: null, type: 'Q', index: 2 });
  assert.deepStrictEqual(parseOperand('Uhr'), { net: null, type: 'CLOCK', index: null });
  assert.strictEqual(parseOperand('9NW3'), null);
  assert.strictEqual(parseOperand('Pumpe'), null);
  assert.strictEqual(parseOperand('M[5]'), null);
});
