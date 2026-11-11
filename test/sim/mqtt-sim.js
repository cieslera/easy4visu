'use strict';
// Simulator für MQTT: ein Broker (Aedes) und eine simulierte easyE4 (FW ≥ 2.40), die sich wie im
// Eaton-Handbuch und wie in node-red-contrib-easye4-mqtt beschrieben verhält:
//   <Basis>/data              easyE4 sendet zyklisch {"state":{"reported":{...}}}, nur im RUN;
//                             beim Verbinden {"connected":"true"}, als Letzter Wille {"connected":"false"}
//   <Basis>/set               easyE4 übernimmt {"state":{"M5":1}} (nicht beschreibbare Operanden ignoriert sie)
//   <Basis>/actions/request   {"id","operation"} -> Antwort auf /actions/response: erst IN_PROGRESS, dann SUCCEEDED
// In Tests:  const s = await require('./sim/mqtt-sim').start({ base: 'easye4/nt1' })  ...  await s.stop()
// Allein:    node test/sim/mqtt-sim.js [port]

const net = require('node:net');
const tls = require('node:tls');
const { Aedes } = require('aedes');
const mqtt = require('mqtt');

const NOT_WRITABLE = /^(Q|QA)\d+$|^I(0*([1-9]|1[0-6]))$|^IA0*[1-4]$|^ID0*([1-9]|1\d|2[0-5])$/i;

async function start(opts) {
  opts = Object.assign({
    port: 0,
    base: 'easye4/sim',
    user: null, password: null, // Anmeldung am Broker verlangen
    tls: null,                  // { key, cert } -> Broker mit TLS
    interval: 50,               // zyklische Daten alle … ms
    values: { M1: 0, M2: 1, MW3: 42, MD6: -2, I1: 1, Q1: 0, IA1: 512, ID1: 0 },
    actionDelay: 20,            // Zeit bis SUCCEEDED
    device: true,               // simulierte easyE4 verbinden
  }, opts);
  const st = { values: Object.assign({}, opts.values), state: 'RUN', received: [], actions: [], seenIds: new Set() };

  const broker = await Aedes.createBroker();
  if (opts.user) {
    broker.authenticate = (client, username, password, done) => {
      const ok = username === opts.user && password && password.toString() === opts.password;
      if (ok) return done(null, true);
      const e = new Error('auth');
      e.returnCode = 4;
      done(e, false);
    };
  }
  const server = opts.tls ? tls.createServer(opts.tls, broker.handle) : net.createServer(broker.handle);
  await new Promise((r) => server.listen(opts.port, '127.0.0.1', r));
  const port = server.address().port;
  const url = `${opts.tls ? 'mqtts' : 'mqtt'}://127.0.0.1:${port}`;

  const data = (reported) => JSON.stringify({ state: { reported } });
  let dev = null;
  let timer = null;

  function connectDevice() {
    return new Promise((resolve) => {
      dev = mqtt.connect(url, {
        clientId: 'easyE4-sim', username: opts.user || undefined, password: opts.password || undefined,
        rejectUnauthorized: false, reconnectPeriod: 0,
        will: { topic: `${opts.base}/data`, payload: data({ connected: 'false' }), qos: 1, retain: false },
      });
      dev.on('connect', () => {
        dev.subscribe([`${opts.base}/set`, `${opts.base}/actions/request`], { qos: 0 }, () => {
          dev.publish(`${opts.base}/data`, data({ connected: 'true' }), { qos: 1 });
          resolve();
        });
      });
      dev.on('message', (topic, payload) => {
        let msg;
        try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
        if (topic.endsWith('/set')) {
          st.received.push(msg);
          const s = msg && msg.state;
          if (s && typeof s === 'object') {
            for (const [k, v] of Object.entries(s)) if (!NOT_WRITABLE.test(k)) st.values[k] = v;
          }
          return;
        }
        st.actions.push(msg);
        if (!msg || !msg.id || st.seenIds.has(msg.id)) return; // eine schon benutzte ID führt die easyE4 nicht aus
        st.seenIds.add(msg.id);
        const reply = (status, extra) => dev.publish(`${opts.base}/actions/response`,
          JSON.stringify(Object.assign({ id: msg.id, operation: msg.operation, status }, extra)), { qos: 0 });
        reply('IN_PROGRESS');
        setTimeout(() => {
          if (msg.operation === 'StartDevice') st.state = 'RUN';
          else if (msg.operation === 'StopDevice') st.state = 'STOP';
          else return reply('FAILED', { statusDetails: { errorMsg: 'unknown operation' } });
          reply('SUCCEEDED');
        }, opts.actionDelay);
      });
    });
  }
  if (opts.device) {
    await connectDevice();
    timer = setInterval(() => {
      if (dev && dev.connected && st.state === 'RUN') dev.publish(`${opts.base}/data`, data(st.values), { qos: 0 });
    }, opts.interval);
  }

  return {
    port, url, st, broker,
    /** easyE4 bricht die Verbindung ab -> Broker sendet den Letzten Willen (connected = false) */
    dropDevice() { if (dev && dev.stream) dev.stream.destroy(); },
    async stop() {
      clearInterval(timer);
      if (dev) await dev.endAsync(true).catch(() => {});
      await new Promise((r) => broker.close(r));
      await new Promise((r) => server.close(r));
    },
  };
}

module.exports = { start };

if (require.main === module) {
  start({ port: parseInt(process.argv[2], 10) || 1883, interval: 1000 }).then((s) => {
    console.log(`MQTT-Simulator: Broker ${s.url}, easyE4 mit Basis-Topic easye4/sim`);
  });
}
