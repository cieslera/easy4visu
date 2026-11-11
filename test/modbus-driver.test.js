'use strict';
// Modbus-Treiber gegen den easyE4-Simulator (test/sim/modbus-sim.js). Aufruf: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const sim = require('./sim/modbus-sim');
const { createDriver } = require('../src/protocols');
const { ModbusDriver, _links } = require('../src/protocols/modbus/driver');
const { parseItf } = require('../src/import/itf');

const itf = (file) => parseItf(fs.readFileSync(path.join(__dirname, '..', 'beispiele', file), 'utf8')).variables;
const byName = (vars) => Object.fromEntries(vars.map((v) => [v.name, v]));

// Simulator starten, Treiber erzeugen, nach dem Test beides beenden
async function withSim(simOpts, drvSettings, fn) {
  const s = await sim.start(Object.assign({ port: 0 }, simOpts));
  const drv = createDriver(Object.assign({ protocol: 'modbus', host: '127.0.0.1', port: s.port, gap: 0 }, drvSettings));
  try {
    await fn(s, drv);
  } finally {
    await drv.close();
    await s.stop();
  }
}

async function until(cond) {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(cond(), 'Bedingung nicht erfüllt');
}

// freier Port, auf dem niemand lauscht
function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

test('Operanden lesen (ohne .itf, Adressen je Firmware)', () => withSim({}, {}, async (s, drv) => {
  s.st.MW[3] = 42;
  s.st.MW[1] = 0x5678; s.st.MW[2] = 0x1234;
  s.st.MW[3] = 42;
  s.st.I[1] = 1;
  s.st.Q[2] = 1;
  const states = [];
  drv.on('state', (st) => states.push(st));
  const r = await drv.read([{ name: 'MW3' }, { name: 'I1' }, { name: 'Q2' }, { name: 'MD1' }, { name: 'MB3' },
    { name: 'M1' }, { name: 'Uhr', operand: 'CLOCK' }]);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.values.MW3, 42);
  assert.strictEqual(r.values.I1, 1);
  assert.strictEqual(r.values.Q2, 1);
  assert.strictEqual(r.values.MD1, 0x12345678);
  assert.strictEqual(r.values.MB3, 0x34); // MB3 = Low-Byte von MW2
  assert.strictEqual(r.values.M1, 0); // MW1 = 0x5678 -> Bit 0 = 0
  assert.strictEqual(r.values.Uhr.year, new Date().getFullYear());
  assert.deepStrictEqual(states, ['online']);
  assert.strictEqual(drv.stateText(), 'verbunden');
}));

test('.itf-Variablen lesen (Beispiel FW 1.x: Merker-Bits und -Bytes in Registern)', () => withSim({}, {}, async (s, drv) => {
  s.st.MW[1] = 0b1000000000000101; // M1, M3, M16
  s.st.MW[2] = 0xab12; // MB3 = 0x12, MB4 = 0xab
  s.st.MW[3] = 65535;
  s.st.MW[11] = 0xfffe; s.st.MW[12] = 0xffff; // MD6 (R1011) = -2
  s.st.I[1] = 1;
  s.st.Q[3] = 1;
  const r = await drv.read(itf('easye4mb-beispiel.itf'));
  assert.deepStrictEqual(r.errors, []);
  const v = r.values;
  assert.deepStrictEqual([v.M1, v.M2, v.M3, v.M16], [1, 0, 1, 1]);
  assert.strictEqual(v.MB3, 0x12);
  assert.strictEqual(v.MB4, 0xab);
  assert.strictEqual(v.MW3, 65535);
  assert.strictEqual(v.MD6, -2);
  assert.strictEqual(v.I1, 1);
  assert.deepStrictEqual([v.Q1, v.Q2, v.Q3], [0, 0, 1]);
  assert.strictEqual(v['CLOCK.5'], new Date().getFullYear());
  // Merker M1..M16 sind EIN Register: es darf nur eine Anfrage dafür geben
  assert.ok(s.st.requests.length <= 5, `zu viele Anfragen: ${s.st.requests.length}`);
}));

test('.itf-Variablen lesen (FW 2.46: MW ab 46001, IA 32 Bit als Input Register)', () => withSim({ fw: 246 }, { firmware: '240' }, async (s, drv) => {
  s.st.MW[2] = 1234;
  s.st.MW[10] = 7;
  s.st.IA[2] = -5;
  s.st.IA[3] = 100000;
  const r = await drv.read(itf('test-netzwerk-nt1-fw246.itf'));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.values.MW2, 1234);
  assert.strictEqual(r.values.MW10, 7);
  assert.strictEqual(r.values.IA2, -5);
  assert.strictEqual(r.values.IA3, 100000);
  assert.ok(s.st.requests.some((q) => q.fc === 3 && q.addr === 46002), 'MW2 muss über Register 46002 gelesen werden');
  assert.ok(s.st.requests.some((q) => q.fc === 4 && q.addr === 42003), 'IA2 muss über Input Register 42003 gelesen werden');
}));

test('Operanden schreiben', () => withSim({}, {}, async (s, drv) => {
  await drv.write({ name: 'MW3' }, -1);
  assert.strictEqual(s.st.MW[3], 65535);
  await drv.write({ name: 'M17' }, 'ein');
  assert.strictEqual(s.st.MW[2] & 1, 1);
  await drv.write({ name: 'MB4' }, 255);
  assert.strictEqual(s.st.MW[2], 0xff01);
  await drv.write({ name: 'MD1' }, 0x12345678);
  assert.deepStrictEqual([s.st.MW[1], s.st.MW[2]], [0x5678, 0x1234]);
  await assert.rejects(drv.write({ name: 'Q1' }, 1), /„Q1“ kann nicht geschrieben werden/);
  await assert.rejects(drv.write({ name: 'Uhr', operand: 'CLOCK' }, 1), /kann nicht geschrieben werden/);
  await assert.rejects(drv.write({ name: 'MW1' }, 70000), /ganze Zahl von -32768 bis 65535/);
}));

test('.itf-Variablen schreiben (Bit und Byte im Register, 32 Bit)', () => withSim({}, {}, async (s, drv) => {
  const v = byName(itf('easye4mb-beispiel.itf'));
  s.st.MW[1] = 0x0100;
  await drv.write(v.M1, true);
  assert.strictEqual(s.st.MW[1], 0x0101, 'Bit 0 setzen, Bit 8 muss bleiben');
  await drv.write(v.M9, 0);
  assert.strictEqual(s.st.MW[1], 0x0001);
  s.st.MW[2] = 0x1234;
  await drv.write(v.MB4, 0xab);
  assert.strictEqual(s.st.MW[2], 0xab34);
  await drv.write(v.MB3, 1);
  assert.strictEqual(s.st.MW[2], 0xab01);
  await drv.write(v.MD6, -2);
  assert.deepStrictEqual([s.st.MW[11], s.st.MW[12]], [0xfffe, 0xffff]);
  await assert.rejects(drv.write(v.Q1, 1), /„Q1“ kann nicht geschrieben werden/);
  await assert.rejects(drv.write(v.I1, 1), /„I1“ kann nicht geschrieben werden/);
}));

test('nicht freigegebene Adresse: nur dieser Wert fehlt, die anderen kommen', () => withSim({ mwTo: 10 }, {}, async (s, drv) => {
  s.st.MW[8] = 8;
  s.st.MW[9] = 9;
  // MW8, MW9 und MW11 landen in einer Anfrage (kleine Lücke) – MW11 ist nicht freigegeben
  const r = await drv.read([{ name: 'MW8' }, { name: 'MW9' }, { name: 'MW11' }]);
  assert.deepStrictEqual(r.values, { MW8: 8, MW9: 9 });
  assert.strictEqual(r.errors.length, 1);
  assert.strictEqual(r.errors[0].name, 'MW11');
  assert.strictEqual(r.errors[0].code, 2);
  assert.match(r.errors[0].text, /nicht freigegeben/);
}));

test('unbekannte Variable und Variable ohne Adresse', () => withSim({}, {}, async (s, drv) => {
  const r = await drv.read([{ name: 'Pumpe' }, { name: 'MW3' }, { name: 'MW9999' }]);
  assert.deepStrictEqual(Object.keys(r.values), ['MW3']);
  assert.match(r.errors.find((e) => e.name === 'Pumpe').text, /keine Adresse bekannt/);
  assert.match(r.errors.find((e) => e.name === 'MW9999').text, /MW: Nummer muss zwischen 1 und 1022/);
}));

test('Merker-Bits über das Merkerwort schreiben, nie über Coils (wie easySoft exportiert)', () => withSim({ fc5: false }, {}, async (s, drv) => {
  s.st.MW[1] = 0x8000;
  await drv.write({ name: 'M5' }, true);
  assert.strictEqual(s.st.MW[1], 0x8010);
  await drv.write({ name: 'M5' }, false);
  assert.strictEqual(s.st.MW[1], 0x8000);
  assert.ok(s.st.requests.every((q) => q.fc === 3 || q.fc === 6), 'nur Register lesen/schreiben');
  assert.ok(s.st.requests.every((q) => q.addr === 46001), 'FW 2.40+: MW1 = Register 46001');
}));

test('Uhr stellen', () => withSim({ twoDigitYear: true }, {}, async (s, drv) => {
  const regs = await drv.setClock(new Date(2026, 0, 2, 3, 4, 5));
  assert.deepStrictEqual(regs, [5, 4, 3, 2, 1, 26]);
  assert.strictEqual(s.st.lastClockWrite[5005], 26);
}));

test('easyE4 nicht erreichbar: Fehler mit Text, Zustand offline', async () => {
  const drv = new ModbusDriver({ host: '127.0.0.1', port: await freePort(), timeout: 500 });
  const states = [];
  drv.on('state', (st) => states.push(st));
  try {
    await assert.rejects(drv.read([{ name: 'MW1' }]), (err) => err.network === true && /nicht erreichbar/.test(err.message));
    assert.deepStrictEqual(states, ['offline']);
    const r = await drv.test();
    assert.strictEqual(r.ok, false);
    assert.match(r.text, /nicht erreichbar/);
  } finally {
    await drv.close();
  }
});

test('Verbindung testen: Uhr lesen', () => withSim({}, {}, async (s, drv) => {
  const r = await drv.test();
  assert.strictEqual(r.ok, true);
  assert.match(r.text, /^Verbindung OK – Uhr der easyE4: \d\d\.\d\d\.\d{4} /);
}));

test('Verbindung testen: falsche Adressierung wird erkannt', () => withSim({ minusOne: true }, {}, async (s, drv) => {
  const r = await drv.test();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.warn, true);
  assert.deepStrictEqual(r.suggest, { addressing: 'minus1' });
  assert.match(r.text, /Register-Nr. − 1/);
}));

test('Verbindung testen: Uhr nicht freigegeben -> MW1', () => withSim({ io: false }, {}, async (s, drv) => {
  s.st.MW[1] = 17;
  const r = await drv.test();
  assert.strictEqual(r.ok, true);
  assert.match(r.text, /MW1 = 17/);
}));

test('mehrere Treiber für dieselbe easyE4 teilen sich eine Verbindung', () => withSim({ delay: 5 }, {}, async (s, drv) => {
  const drv2 = createDriver({ protocol: 'modbus', host: '127.0.0.1', port: s.port });
  try {
    await Promise.all([drv.read([{ name: 'MW1' }]), drv2.read([{ name: 'MW2' }]), drv.read([{ name: 'I1' }])]);
    assert.strictEqual(s.st.maxConnections, 1);
    assert.strictEqual(s.st.maxParallel, 1, 'nie zwei Anfragen gleichzeitig');
  } finally {
    await drv2.close();
  }
  assert.strictEqual(_links.size, 1, 'Verbindung bleibt, solange noch ein Treiber sie nutzt');
}));

test('Einstellungen prüfen, geschlossener Treiber', async () => {
  const d = createDriver({ protocol: 'modbus', host: '' });
  assert.strictEqual(d.problem, 'Keine Adresse der easyE4 eingetragen');
  await assert.rejects(d.read([{ name: 'MW1' }]), /Keine Adresse/);
  assert.strictEqual((await d.test()).ok, false);
  assert.strictEqual(createDriver({ protocol: 'modbus', host: 'x', port: 70000 }).problem, 'Ungültiger Port');
  assert.throws(() => createDriver({ protocol: 'xyz' }), /Unbekanntes Protokoll „xyz“/);
  const c = createDriver({ protocol: 'modbus', host: '127.0.0.1' });
  await c.close();
  await assert.rejects(c.read([{ name: 'MW1' }]), /Verbindung wurde beendet/);
  assert.strictEqual(_links.size, 0, 'alle Verbindungen geschlossen');
});

test('Operanden ohne .itf: FW 2.46 liest Merker ab 46001, ältere FW ab 1001', async () => {
  await withSim({ fw: 246 }, {}, async (s, drv) => {
    s.st.MW[3] = 3;
    s.st.MW[1] = 1;
    s.st.QA[5] = 2000;
    const r = await drv.read([{ name: 'MW3' }, { name: 'M1' }, { name: 'QA5' }]);
    assert.deepStrictEqual(r.values, { MW3: 3, M1: 1, QA5: 2000 });
    // M1 und MW3 liegen in den Registern 46001 und 46003 -> eine gemeinsame Anfrage ab 46001
    const addrs = s.st.requests.map((q) => `${q.fc}:${q.addr}`).sort();
    assert.deepStrictEqual(addrs, ['3:46001', '4:40009']);
  });
  await withSim({ fw: 144 }, { firmware: '140' }, async (s, drv) => {
    s.st.MW[3] = 3;
    s.st.IA[1] = -20;
    const r = await drv.read([{ name: 'MW3' }, { name: 'IA1' }]);
    assert.deepStrictEqual(r.values, { MW3: 3, IA1: -20 });
    assert.deepStrictEqual(s.st.requests.map((q) => `${q.fc}:${q.addr}`).sort(), ['3:1003', '4:6501']);
  });
});

test('NET-Test NT1 (FW 2.46): NET-Merker, Diagnose, Erweiterungen, QA, hohe Merker', () => withSim({ fw: 246, mwTo: 1022 }, {}, async (s, drv) => {
  const vars = itf('net-test/Netzwerk-net1.itf');
  s.st.NW[1] = 0x8001; // N1, N16
  s.st.NW[2] = 0x0500; // NB4 = 5
  s.st.NW[3] = 2521;
  s.st.NW[5] = 7563; // ND3 = NW5 + NW6
  s.st.ID[29] = 1;
  s.st.I[17] = 1;
  s.st.Q[20] = 1;
  s.st.IA[9] = 4000;
  s.st.QA[6] = 819;
  s.st.MW[63] = 0x80; // M1000 = Bit 7 von MW63
  s.st.MW[399] = 0xfffe; s.st.MW[400] = 0xffff; // MD200 = -2
  s.st.MW[500] = 500;
  const r = await drv.read(vars);
  const v = r.values;
  // Q17–Q20 und I17–I20 gibt es im Simulator (wie am Gerät mit 8TE1); I9–I16/Q5–Q16 nicht
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual([v.N1, v.N2, v.N16, v.NB4, v.NW3, v.ND3], [1, 0, 1, 5, 2521, 7563]);
  assert.deepStrictEqual([v.ID29, v.ID2, v.I17, v.Q20], [1, 0, 1, 1]);
  assert.deepStrictEqual([v.IA9, v.QA6, v.M1000, v.M999, v.MD200, v.MW500], [4000, 819, 1, 0, -2, 500]);
}));

test('NET-Test NT2 (FW 1.40–2.3x): Merker ab 1001, IA ab 6501', () => withSim({ fw: 144 }, { firmware: '140' }, async (s, drv) => {
  s.st.MW[1] = 4; // M3
  s.st.MW[11] = 1000;
  s.st.IA[1] = 1234;
  s.st.NW[3] = 2541;
  const r = await drv.read(itf('net-test/Netzwerk-net2.itf'));
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual([r.values.M3, r.values.MD6, r.values.IA1, r.values.NW3], [1, 1000, 1234, 2541]);
}));

test('Operanden anderer NET-Teilnehmer und SN/RN: verständliche Meldung', () => withSim({}, { netId: 1 }, async (s, drv) => {
  s.st.NW[3] = 33;
  const r = await drv.read([{ name: '2NW3' }, { name: '1NW3' }, { name: 'NW3' }, { name: '2SN01' }]);
  assert.deepStrictEqual(r.values, { '1NW3': 33, NW3: 33 }, 'eigene NET-ID 1 = eigenes Gerät');
  assert.match(r.errors.find((e) => e.name === '2NW3').text, /gehört zum NET-Teilnehmer 2/);
  assert.match(r.errors.find((e) => e.name === '2SN01').text, /über Modbus nicht erreichbar/);
  await assert.rejects(drv.write({ name: '2NW3' }, 1), /NET-Teilnehmer 2/);
}));

test('Neu verbinden nach Abbruch bleibt nicht hängen (verspätetes „close“ der alten Verbindung)', async () => {
  // Ablauf wie beim Ausfall der easyE4: sie bricht die Verbindung ab, der Client verbindet nach dem
  // „error“ sofort neu, das „close“ der alten Verbindung kommt erst danach. Früher blieb der neue Versuch hängen.
  const { ModbusTcpClient } = require('../src/protocols/modbus/modbus-tcp');
  let serverSock = null;
  const srv = net.createServer((sock) => { serverSock = sock; });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const c = new ModbusTcpClient('127.0.0.1', srv.address().port, { connectTimeout: 1500 });
  try {
    await c.connect();
    await until(() => serverSock !== null);
    const retry = new Promise((resolve) => {
      c.socket.once('error', () => resolve(c.connect().then(() => 'verbunden', (e) => e.code)));
    });
    const closed = new Promise((r) => srv.close(r));
    serverSock.resetAndDestroy();
    const result = await Promise.race([retry, new Promise((r) => setTimeout(() => r('hängt'), 3000))]);
    assert.ok(['ECONNREFUSED', 'ETIMEDOUT'].includes(result), `Ergebnis: ${result}`);
    await closed;
  } finally {
    c.close();
  }
});
