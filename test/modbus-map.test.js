'use strict';
// Registerbelegung gegen die Eaton-Tabelle "Modbus TCP Map" prüfen.
// Übernommen aus node-red-contrib-easye4-modbus (Tests/test/map.test.js), auf node:test umgestellt.
const { describe, it } = require('node:test');
const assert = require("assert");
const M = require("../src/protocols/modbus/map.js");
const { FW } = M;

const reg = (t, n, fw) => M.operand(t, n, fw === undefined ? FW.V240 : fw).parts.map((p) => p.fc + ":" + p.addr).join(",");

describe("Registerbelegung (Eaton Modbus TCP Map)", function () {
    it("Bits: I, Q, ID, M, N", function () {
        assert.strictEqual(reg("I", 1), "2:1");
        assert.strictEqual(reg("I", 128), "2:128");
        assert.strictEqual(reg("Q", 1), "1:1");
        assert.strictEqual(reg("Q", 17), "1:17");
        assert.strictEqual(reg("ID", 1), "2:3001");
        assert.strictEqual(reg("ID", 96), "2:3096");
        assert.strictEqual(reg("M", 1), "1:1001");
        assert.strictEqual(reg("M", 512), "1:1512");
        assert.strictEqual(reg("M", 513), "1:56513");
        assert.strictEqual(reg("M", 1024), "1:57024");
        assert.strictEqual(reg("N", 1), "1:2001");
        assert.strictEqual(reg("N", 512), "1:2512");
    });
    it("Worte: MW, NW, MB, NB, MD, ND", function () {
        assert.strictEqual(reg("MW", 1), "3:1001");
        assert.strictEqual(reg("MW", 512), "3:1512");
        assert.strictEqual(reg("MW", 513), "3:46513");
        assert.strictEqual(reg("MW", 1022), "3:47022");
        assert.strictEqual(reg("NW", 32), "3:2032");
        assert.strictEqual(reg("MB", 1), "3:1001");
        assert.strictEqual(reg("MB", 2), "3:1001");
        assert.strictEqual(reg("MB", 3), "3:1002");
        assert.strictEqual(reg("MD", 1), "3:1001,3:1002");
        assert.strictEqual(reg("MD", 2), "3:1003,3:1004"); // wie im easySoft-Export: MD002 -> R1003
        assert.strictEqual(reg("MD", 10), "3:1019,3:1020"); // MD010 -> R1019
        assert.strictEqual(reg("ND", 1), "3:2001,3:2002");
    });
    it("Analogwerte je Firmware", function () {
        assert.strictEqual(reg("IA", 1, FW.OLD), "4:1");
        assert.strictEqual(reg("QA", 48, FW.OLD), "3:48");
        assert.strictEqual(reg("IA", 1, FW.V140), "4:6501,4:6502");
        assert.strictEqual(reg("IA", 4, FW.V140), "4:6507,4:6508");
        assert.strictEqual(reg("QA", 48, FW.V140), "3:6095,3:6096");
        assert.strictEqual(reg("IA", 1), "4:42001,4:42002");
        assert.strictEqual(reg("IA", 512), "4:43023,4:43024");
        assert.strictEqual(reg("QA", 128), "3:40255,3:40256");
        assert.strictEqual(reg("AI", 2, FW.OLD), "4:2"); // Alias
    });
    it("Grenzen je Firmware", function () {
        assert.throws(() => M.operand("M", 513, FW.V140), (e) => e.e4.key === "indexRangeFw");
        assert.throws(() => M.operand("MW", 513, FW.OLD), (e) => e.e4.key === "indexRangeFw");
        assert.throws(() => M.operand("IA", 49, FW.V140), (e) => e.e4.key === "indexRangeFw");
        assert.throws(() => M.operand("NW", 33, FW.V240), (e) => e.e4.key === "indexRange");
        assert.throws(() => M.operand("X", 1, FW.V240), (e) => e.e4.key === "unknownType");
    });
    it("Dekodieren: Byte-/Wortreihenfolge, Vorzeichen", function () {
        const md = M.operand("MD", 1, FW.V240);
        assert.strictEqual(md.decode([0x5678, 0x1234]), 0x12345678);
        assert.strictEqual(md.decode([0xffff, 0xffff]), -1);
        assert.strictEqual(M.operand("MB", 1, FW.V240).decode([0x1234]), 0x34);
        assert.strictEqual(M.operand("MB", 2, FW.V240).decode([0x1234]), 0x12);
        assert.strictEqual(M.operand("IA", 1, FW.OLD).decode([0xfffe]), -2);
        assert.strictEqual(M.operand("MW", 1, FW.V240).decode([0xfffe]), 65534);
    });
    it("Listen und Bereiche lesen", function () {
        const l = M.parseList("I1-I8, Q1..4, mw3, MD6, AI1, CLOCK, MW3", FW.V240);
        assert.deepStrictEqual(l.map((o) => o.key), ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "Q1", "Q2", "Q3", "Q4", "MW3", "MD6", "IA1", "CLOCK"]);
        assert.throws(() => M.parseList("MW3-Q4", FW.V240), (e) => e.e4.key === "badOperand");
        assert.throws(() => M.parseList("Hallo", FW.V240), (e) => e.e4.key === "badOperand");
        assert.throws(() => M.parseList(" , ", FW.V240), (e) => e.e4.key === "noOperands");
    });
    it("Anfragen zusammenfassen", function () {
        const plan = M.planReads(M.parseList("MW1, MW2, MW5, MW100, M1-M16, MD1, I1-I8, Q1", FW.V240));
        const s = plan.map((r) => r.fc + ":" + r.addr + "x" + r.count).sort();
        assert.deepStrictEqual(s, ["1:1001x16", "1:1x1", "2:1x8", "3:1001x5", "3:1100x1"]);
        // Bereich über 125 Register wird geteilt
        const big = M.planReads(M.range("MW", 1, 300, FW.V240));
        assert.deepStrictEqual(big.map((r) => r.count), [125, 125, 50]);
        // Grenze 512 -> getrennte Bereiche
        const b2 = M.planReads(M.range("MW", 510, 515, FW.V240));
        assert.deepStrictEqual(b2.map((r) => r.addr + "x" + r.count), ["1510x3", "46513x3"]);
    });
    it("Schreiben planen", function () {
        assert.deepStrictEqual(M.writePlan("MW", 3, -1, FW.V240), { key: "MW3", kind: "reg", addr: 1003, value: 65535 });
        assert.deepStrictEqual(M.writePlan("MD", 1, 0x12345678, FW.V240), { key: "MD1", kind: "regs", addr: 1001, values: [0x5678, 0x1234] });
        assert.deepStrictEqual(M.writePlan("MD", 1, -2, FW.V240).values, [0xfffe, 0xffff]);
        assert.deepStrictEqual(M.writePlan("M", 17, "ein", FW.V240), { key: "M17", kind: "coil", addr: 1017, value: true, wordAddr: 1002, bit: 0 });
        assert.deepStrictEqual(M.writePlan("MB", 4, 255, FW.V240), { key: "MB4", kind: "byte", addr: 1002, value: 255, high: true });
        assert.throws(() => M.writePlan("Q", 1, 1, FW.V240), (e) => e.e4.key === "notWritable");
        assert.throws(() => M.writePlan("MW", 1, 70000, FW.V240), (e) => e.e4.key === "badNumber");
        assert.throws(() => M.writePlan("MW", 1, 1.5, FW.V240), (e) => e.e4.key === "badNumber");
        assert.throws(() => M.writePlan("M", 1, "vielleicht", FW.V240), (e) => e.e4.key === "badBool");
    });
    it("Uhr", function () {
        const d = new Date(2026, 9, 22, 12, 34, 56);
        assert.deepStrictEqual(M.clockRegs(d, false), [56, 34, 12, 22, 10, 2026]);
        assert.deepStrictEqual(M.clockRegs(d, true), [56, 34, 12, 22, 10, 26]);
        assert.deepStrictEqual(M.clock().decode([56, 34, 12, 22, 10, 26]), { year: 2026, month: 10, day: 22, hour: 12, minute: 34, second: 56 });
        assert.strictEqual(M.toDate({ year: 2026, month: 1, day: 2 }).getDate(), 2);
        assert.throws(() => M.toDate("gestern"), (e) => e.e4.key === "badDate");
    });
});
