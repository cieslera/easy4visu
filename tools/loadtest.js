'use strict';
/**
 * Belastungstest: easy4Visu-Kern mit 8 simulierten easyE4 gleichzeitig (wie ein voller NET-Verbund NET1…NET8):
 * 4 × Modbus TCP (Abfrage alle 0,5 s), 2 × JSON-API (alle 1 s), 2 × MQTT (zyklische Daten jede Sekunde).
 * Je Gerät 80 Variablen (MW1…MW60, M1…M16, wechselnde Werte), 10 davon werden aufgezeichnet (Trend-Datenbank).
 * Alle 10 s schreibt der Test je Gerät einen Sollwert und misst, wann er zurückgemeldet ist.
 * Die Simulatoren laufen in einem eigenen Prozess, gemessen werden nur Speicher und Rechenzeit von easy4Visu.
 *
 *   node tools/loadtest.js [Minuten] [Bericht.json]     (Standard 60 Minuten)
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { fork } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MW_N = 60;
const M_N = 16;

// ---------------------------------------------------------------- Prozess mit den Simulatoren
if (process.argv[2] === '--sims') {
  (async () => {
    const mb = [];
    for (let i = 0; i < 4; i++) mb.push(await require(path.join(ROOT, 'test', 'sim', 'modbus-sim.js')).start({ port: 0, fw: 246, delay: 15 }));
    const js = [];
    for (let i = 0; i < 2; i++) { const s = require(path.join(ROOT, 'test', 'sim', 'json-sim.js'))(); s.port = await s.listen(); js.push(s); }
    const mq = [];
    for (let i = 0; i < 2; i++) {
      const values = {};
      for (let n = 1; n <= MW_N; n++) values[`MW${n}`] = n;
      for (let n = 1; n <= M_N; n++) values[`M${n}`] = 0;
      mq.push(await require(path.join(ROOT, 'test', 'sim', 'mqtt-sim.js')).start({ base: `easye4/last${i + 1}`, interval: 1000, values }));
    }
    // Werte ändern sich laufend (wie eine echte Anlage); MW50 bleibt dem Schreibtest vorbehalten
    let tick = 0;
    setInterval(() => {
      tick++;
      for (const s of mb) {
        for (let n = 1; n <= 40; n++) s.st.MW[n] = (n * 37 + tick * (n % 7 + 1)) & 0xffff;
        s.st.requests.length = 0; // Protokoll des Simulators nicht endlos wachsen lassen
      }
      for (const s of js) for (let n = 1; n <= 40; n++) s.st.MW[n] = (n * 41 + tick * (n % 5 + 1)) & 0xffff;
      for (const s of mq) {
        for (let n = 1; n <= 40; n++) s.st.values[`MW${n}`] = (n * 43 + tick * (n % 3 + 1)) & 0xffff;
        for (let n = 1; n <= M_N; n++) s.st.values[`M${n}`] = (tick + n) % 4 === 0 ? 1 : 0;
        s.st.received.length = 0;
      }
    }, 1000);
    process.send({ mb: mb.map((s) => s.port), js: js.map((s) => s.port), mq: mq.map((s) => ({ port: s.port, base: s.opts ? s.opts.base : null })) });
  })().catch((e) => { console.error(e); process.exit(1); });
  return;
}

// ---------------------------------------------------------------- Test (easy4Visu-Kern)
const minutes = Number(process.argv[2]) || 60;
const reportFile = process.argv[3] || null;
const { AppApi } = require(path.join(ROOT, 'src', 'app', 'api'));

(async () => {
  const sims = fork(__filename, ['--sims'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const ports = await new Promise((res, rej) => { sims.once('message', res); sims.once('exit', (c) => rej(new Error(`Simulatoren beendet (${c})`))); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy4visu-last-'));
  const api = new AppApi({ dir });
  const devs = [];
  const add = async (dev, secrets, kind) => {
    const d = await api.saveDevice(dev, secrets);
    const ops = [];
    for (let n = 1; n <= MW_N; n++) ops.push(`MW${n}`);
    for (let n = 1; n <= M_N; n++) ops.push(`M${n}`);
    for (const op of ops) await api.addVariable(d.id, { operand: op, name: op, label: op });
    for (let n = 1; n <= 10; n++) await api.setRecord(d.id, `MW${n}`, true);
    devs.push({ id: d.id, name: dev.name, kind, polls: 0, errors: 0, offline: 0, writes: 0, confirmed: 0, lat: [], lost: 0 });
  };
  for (let i = 0; i < 4; i++) await add({ name: `NET${i + 1} Modbus`, protocol: 'modbus', interval: 500, settings: { host: '127.0.0.1', port: ports.mb[i] } }, undefined, 'Modbus');
  for (let i = 0; i < 2; i++) await add({ name: `NET${i + 5} JSON`, protocol: 'json', interval: 1000, settings: { host: '127.0.0.1', port: ports.js[i], auth: 'basic', user: 'testuser', gap: 0 } }, { password: 'pw1' }, 'JSON-API');
  for (let i = 0; i < 2; i++) await add({ name: `NET${i + 7} MQTT`, protocol: 'mqtt', interval: 500, settings: { host: '127.0.0.1', port: ports.mq[i].port, baseTopic: `easye4/last${i + 1}`, tls: false, timeout: 3000 } }, undefined, 'MQTT');
  const byId = new Map(devs.map((d) => [d.id, d]));

  api.runtime.on('polled', (id) => { const d = byId.get(id); if (d) d.polls++; });
  api.runtime.on('deviceError', (id) => { const d = byId.get(id); if (d) d.errors++; });
  // Abbruch = nicht mehr verbunden, nachdem das Gerät schon einmal verbunden war (der Aufbau am Anfang zählt nicht)
  api.runtime.on('state', (id, state) => { const d = byId.get(id); if (!d) return; if (state === 'online') d.wasOnline = true; else if (d.wasOnline && !d.down) d.offline++; d.down = state !== 'online'; });
  const waiting = new Map(); // id -> { value, t0 }
  api.values.on('change', (id, name, entry) => {
    const w = waiting.get(id);
    if (w && name === 'MW50' && Number(entry.value) === w.value) { const d = byId.get(id); d.confirmed++; d.lat.push(Date.now() - w.t0); waiting.delete(id); }
  });

  await api.setOnline(true);
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  const samples = [];
  let val = 1000;
  const writer = setInterval(() => {
    for (const d of devs) {
      if (waiting.has(d.id)) { d.lost++; waiting.delete(d.id); }
      val = (val + 7) % 60000;
      waiting.set(d.id, { value: val, t0: Date.now() });
      d.writes++;
      api.writeValue(d.id, 'MW50', val).catch(() => { d.errors++; waiting.delete(d.id); });
    }
  }, 10000);
  let lastCpu = process.cpuUsage();
  let lastT = Date.now();
  const sampler = setInterval(() => {
    const c = process.cpuUsage(lastCpu);
    const now = Date.now();
    const cpuPct = ((c.user + c.system) / 1000) / (now - lastT) * 100;
    lastCpu = process.cpuUsage(); lastT = now;
    const m = process.memoryUsage();
    const s = { min: Math.round((now - t0) / 60000), rssMB: Math.round(m.rss / 1e6), heapMB: Math.round(m.heapUsed / 1e6), cpuPct: Math.round(cpuPct * 10) / 10,
      polls: devs.reduce((a, d) => a + d.polls, 0) };
    samples.push(s);
    console.log(`${s.min} min: Speicher ${s.rssMB} MB (Heap ${s.heapMB} MB), Rechenzeit ${s.cpuPct} %, Abfragen gesamt ${s.polls}`);
  }, 60000);

  await new Promise((r) => setTimeout(r, minutes * 60000));
  clearInterval(writer); clearInterval(sampler);
  await new Promise((r) => setTimeout(r, 3000)); // letzte Bestätigungen abwarten
  const secs = (Date.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const hist = api.history && api.history.stats ? api.history.stats() : null;
  const report = {
    minuten: Math.round(secs / 60), geraete: devs.length,
    rechenzeitProzent: Math.round(((cpu.user + cpu.system) / 1000) / (secs * 1000) * 1000) / 10,
    speicher: { erstesMB: samples[0] && samples[0].rssMB, letztesMB: samples.length && samples[samples.length - 1].rssMB, maxMB: Math.max(...samples.map((s) => s.rssMB)) },
    trendDatenbankMB: hist ? Math.round(hist.bytes / 1e5) / 10 : null,
    geraeteListe: devs.map((d) => ({ name: d.name, protokoll: d.kind, abfragenProSekunde: Math.round(d.polls / secs * 10) / 10, fehler: d.errors, verbindungsabbrueche: d.offline,
      schreiben: d.writes, bestaetigt: d.confirmed, nichtBestaetigt: d.lost, bestaetigungMs: { median: pct(d.lat, 0.5), p95: pct(d.lat, 0.95), max: d.lat.length ? Math.max(...d.lat) : null } })),
    verlauf: samples,
  };
  console.log(JSON.stringify(report, null, 2));
  if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  await api.setOnline(false).catch(() => {});
  await api.stop().catch(() => {});
  sims.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('Belastungstest fehlgeschlagen:', e); process.exit(1); });
