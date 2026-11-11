#!/usr/bin/env node
'use strict';
/**
 * Prüfprogramm: eine easyE4 über Modbus TCP, den Webserver (JSON-API) oder MQTT ansprechen und Werte anzeigen.
 * Anleitung mit Beispielen: docs/GERAETETEST.md. Kurzhilfe: node tools/probe.js --help
 */

const fs = require('node:fs');
const readline = require('node:readline');
const { parseArgs } = require('node:util');
const { createDriver } = require('../src/protocols');
const { parseItf } = require('../src/import/itf');

const HELP = `
Prüfprogramm für easy4Visu – eine easyE4 testen

  node tools/probe.js <protokoll> <adresse> [Optionen]

  <protokoll>   modbus | json | mqtt
  <adresse>     IP-Adresse der easyE4 (bei mqtt: des Brokers)

Allgemein
  --read "MW1,MW3,I1"   diese Operanden lesen (sonst eine Auswahl, bei mqtt alles Empfangene)
  --itf datei.itf       alle Variablen aus dem easySoft-Export lesen
  --watch 10            10-mal lesen (Abstand --interval Sekunden, Standard 1)
  --write MW5=2000      danach schreiben und noch einmal lesen (mehrmals möglich)
  --port 502            Port (Standard: modbus 502, json 80/443, mqtt 1883/8883)
  --timeout 3000        Zeitlimit in ms

Modbus TCP
  --fw 2.46             Firmware der easyE4 (wichtig für die Register ohne .itf)
  --minus1              Adressierung „Register-Nr. − 1“
Webserver (json; JSON-API der easyE4)
  --https               verschlüsselt (bei FW 1.x altes TLS – wird unterstützt)
  --user admin          Benutzer; Passwort wird abgefragt (oder --password)
  --apikey SCHLÜSSEL    statt Benutzer/Passwort
MQTT
  --base easye4/1       Basis-Topic: easySoft-Topics sind dann easye4/1/data, /set, /actions/…
  --topic-data, --topic-set, --topic-request, --topic-response
                        nur bei eigenen Topics in easySoft (Publish, Subscribe, Actions subscribe/publish)
  --tls                 verschlüsselt (z. B. Port 8883)
  --ca ca.crt           CA-Zertifikat des Brokers: Broker wird geprüft (schaltet --tls ein)
  --user name           Benutzer am Broker; Passwort wird abgefragt (oder --password)

Passwort auch über die Umgebungsvariable E4_PASSWORD möglich.
`;

const DEFAULT_READ = {
  modbus: 'CLOCK, MW1, MW2, MW3, MW4, I1, I2, I3, I4, Q1, Q2, Q3, Q4',
  json: 'MW1, MW2, MW3, MW4, I1, I2, I3, I4, Q1, Q2, Q3, Q4, CLOCK',
  mqtt: null,
};

function firmwareLevel(text) {
  if (!text) return '240';
  const m = /^(\d+)\.(\d+)/.exec(String(text));
  if (!m) return String(text);
  const v = Number(m[1]) * 100 + Number(m[2]);
  return v >= 240 ? '240' : v >= 140 ? '140' : 'old';
}

// Passwort abfragen, ohne die getippten Zeichen anzuzeigen
function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true; // die Frage selbst ist schon ausgegeben
  });
}

function show(v) {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'object') {
    if (v.year !== undefined) {
      const p = (n) => String(n).padStart(2, '0');
      return `${p(v.day)}.${p(v.month)}.${v.year} ${p(v.hour)}:${p(v.minute)}:${p(v.second)}`;
    }
    return JSON.stringify(v);
  }
  return String(v);
}

function printTable(rows) {
  const w = Math.max(8, ...rows.map((r) => r[0].length));
  const w2 = Math.max(6, ...rows.map((r) => r[1].length));
  console.log(`  ${'Variable'.padEnd(w)}  ${'Wert'.padEnd(w2)}  Hinweis`);
  for (const [a, b, c] of rows) console.log(`  ${a.padEnd(w)}  ${b.padEnd(w2)}  ${c}`);
}

async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, read: { type: 'string' }, itf: { type: 'string' },
      watch: { type: 'string' }, interval: { type: 'string' }, write: { type: 'string', multiple: true },
      port: { type: 'string' }, timeout: { type: 'string' }, fw: { type: 'string' }, minus1: { type: 'boolean' },
      unit: { type: 'string' }, https: { type: 'boolean' }, verify: { type: 'boolean' }, user: { type: 'string' },
      password: { type: 'string' }, apikey: { type: 'string' }, base: { type: 'string' }, tls: { type: 'boolean' }, ca: { type: 'string' },
      'topic-data': { type: 'string' }, 'topic-set': { type: 'string' }, 'topic-request': { type: 'string' },
      'topic-response': { type: 'string' },
    },
  });
  const [protocol, host] = positionals;
  if (o.help || !protocol || !host) {
    console.log(HELP);
    return o.help ? 0 : 2;
  }
  if (!['modbus', 'json', 'mqtt'].includes(protocol)) {
    console.log(`Unbekanntes Protokoll „${protocol}“ – möglich: modbus, json, mqtt`);
    return 2;
  }

  const settings = { protocol, host };
  if (o.port) settings.port = o.port;
  if (o.timeout) settings.timeout = o.timeout;
  const secrets = {};
  if (protocol === 'modbus') {
    settings.firmware = firmwareLevel(o.fw);
    if (o.minus1) settings.addressing = 'minus1';
    if (o.unit) settings.unitId = o.unit;
  } else if (protocol === 'json') {
    settings.https = !!o.https;
    settings.verifyCert = !!o.verify;
    settings.auth = o.apikey ? 'bearer' : o.user ? 'basic' : 'none';
    if (o.user) settings.user = o.user;
    if (o.apikey) secrets.apikey = o.apikey;
  } else {
    settings.baseTopic = o.base;
    settings.topics = { data: o['topic-data'], set: o['topic-set'], request: o['topic-request'], response: o['topic-response'] };
    settings.tls = !!o.tls;
    if (o.ca) settings.caFile = require('node:path').resolve(o.ca);
    settings.verifyCert = !!o.verify;
    if (o.user) settings.user = o.user;
  }
  if (o.user) {
    secrets.password = o.password !== undefined ? o.password
      : process.env.E4_PASSWORD !== undefined ? process.env.E4_PASSWORD
        : await askHidden(`Passwort für ${o.user} (wird beim Tippen nicht angezeigt): `);
  }

  let variables;
  if (o.itf) {
    const r = parseItf(fs.readFileSync(o.itf, 'utf8'));
    r.warnings.forEach((w) => console.log(`Hinweis .itf: ${w}`));
    variables = r.variables;
  } else {
    const list = o.read || DEFAULT_READ[protocol];
    variables = list ? list.split(/[,;\s]+/).filter(Boolean).map((name) => ({ name })) : null;
  }

  const drv = createDriver(settings, secrets);
  try {
    if (drv.problem) {
      console.log(`Einstellung fehlt: ${drv.problem}`);
      return 2;
    }
    console.log(`\neasyE4 ${host} über ${{ modbus: 'Modbus TCP', json: 'Webserver', mqtt: 'MQTT' }[protocol]} …`);
    const test = await drv.test();
    console.log(`Verbindung testen: ${test.text}`);
    if (!test.ok) return 1;

    const readOnce = async () => {
      let vars = variables;
      if (!vars) { // MQTT ohne --read: alles, was die easyE4 sendet
        await drv.read([]);
        vars = [...drv.cache.keys()].map((name) => ({ name }));
      }
      const r = await drv.read(vars);
      const rows = vars.map((v) => {
        const k = v.id || v.name;
        const err = r.errors.find((e) => e.name === k);
        const where = v.modbus ? (v.modbus.register !== undefined ? `Register ${v.modbus.register}${v.modbus.bit !== undefined ? `.${v.modbus.bit}` : ''}` : `Adresse ${v.modbus.address}`) : '';
        return [k, err ? '–' : show(r.values[k]), err ? err.text : where];
      });
      printTable(rows);
    };

    const times = Math.max(1, parseInt(o.watch, 10) || 1);
    const pause = Math.max(0.2, Number(String(o.interval || '1').replace(',', '.')) || 1) * 1000;
    for (let i = 0; i < times; i++) {
      if (times > 1) console.log(`\nLesen ${i + 1}/${times} – ${new Date().toLocaleTimeString('de-DE')}`);
      else console.log('');
      await readOnce();
      if (i < times - 1) await new Promise((r) => setTimeout(r, pause));
    }

    if (o.write && o.write.length) {
      console.log('');
      for (const w of o.write) {
        const m = /^([^=]+)=(.*)$/.exec(w);
        if (!m) { console.log(`„${w}“ verstehe ich nicht – Beispiel: --write MW5=2000`); continue; }
        const name = m[1].trim();
        const v = (variables || []).find((x) => x.name === name) || { name };
        try {
          await drv.write(v, m[2].trim());
          console.log(`Geschrieben: ${name} = ${m[2].trim()}`);
        } catch (err) {
          console.log(`Schreiben ${name} nicht möglich: ${err.message}`);
        }
      }
      await new Promise((r) => setTimeout(r, protocol === 'mqtt' ? 1500 : 200));
      console.log('\nNach dem Schreiben:');
      await readOnce();
    }
    return 0;
  } catch (err) {
    console.log(`Fehler: ${err.message}`);
    return 1;
  } finally {
    await drv.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    console.log(`Fehler: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, firmwareLevel };
