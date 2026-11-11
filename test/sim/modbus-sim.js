"use strict";
// Übernommen aus node-red-contrib-easye4-modbus 1.0.1 (am Gerät getestet). Änderungen möglichst klein halten.
// Simulator: verhält sich wie eine easyE4 als Modbus-TCP-Server (laut Eaton "Modbus TCP Map").
// Aufruf allein:  node sim.js [port]   (Standard 5020)
// In Tests:       const sim = await require("./sim").start({ port: 0, ... })

const net = require("net");

function start(opts) {
    opts = Object.assign({
        port: 5020,
        fw: 246,              // Firmware (z. B. 144, 246)
        mwFrom: 1, mwTo: 512, // Freigabe Merker (MW-Bereich)
        nwFrom: 1, nwTo: 32,  // Freigabe NET-Merker
        io: true,             // Freigabe E/As und Uhrendaten lesen
        clockLocked: false,   // Uhr stellen gesperrt
        readOnly: false,      // Merker, Net-Merker nur lesend
        fc5: true,            // FC5/FC15 werden unterstützt
        twoDigitYear: false,  // Jahr in Register 5005 zweistellig
        delay: 0,             // Antwortverzögerung in ms
        silent: false,        // keine Antwort (Zeitüberschreitung testen)
        minusOne: false,      // false = Telegramm-Adresse = Register-Nr. (wie die echte easyE4), true = Register-Nr. - 1 (Eaton-Doku)
        gapsUndefined: true,  // wie am echten Gerät: Q5-Q16 und I9-I16 gibt es nicht (Exception 2)
    }, opts);
    const st = {
        I: new Uint8Array(129), Q: new Uint8Array(129), ID: new Uint8Array(97),
        MW: new Uint16Array(1023), NW: new Uint16Array(33),
        IA: new Int32Array(513), QA: new Int32Array(129),
        clockOffset: 0, requests: [], maxParallel: 0, connections: 0, maxConnections: 0,
    };
    const fw = () => opts.fw;
    const mwOk = (n) => n >= opts.mwFrom && n <= opts.mwTo && n >= 1 && n <= (fw() >= 240 ? 1022 : 512);
    const nwOk = (n) => n >= opts.nwFrom && n <= opts.nwTo && n >= 1 && n <= 32;
    const mBit = (n) => (st.MW[Math.ceil(n / 16)] >> ((n - 1) % 16)) & 1;
    const nBit = (n) => (st.NW[Math.ceil(n / 16)] >> ((n - 1) % 16)) & 1;
    function setBit(arr, n, v) {
        const w = Math.ceil(n / 16);
        const b = 1 << ((n - 1) % 16);
        arr[w] = v ? arr[w] | b : arr[w] & ~b;
    }
    function now() { return new Date(Date.now() + st.clockOffset); }
    function rtc(reg) {
        const d = now();
        const y = d.getFullYear();
        switch (reg) {
            case 5000: return d.getSeconds();
            case 5001: return d.getMinutes();
            case 5002: return d.getHours();
            case 5003: return d.getDate();
            case 5004: return d.getMonth() + 1;
            case 5005: return opts.twoDigitYear ? y % 100 : y;
            case 5006: return (d.getMinutes() << 8) | d.getSeconds();
            case 5007: return d.getHours();
            case 5008: return ((d.getMonth() + 1) << 8) | d.getDate();
            case 5009: return y;
        }
    }
    const EXC = (code) => { const e = new Error("exc"); e.exc = code; throw e; };

    // Bit lesen; Rückgabe 0/1 oder Exception 2
    function readBit(fc, r) {
        if (fc === 1) {
            if (r >= 1 && r <= 128) { if (!opts.io || (opts.gapsUndefined && r > 4 && r < 17)) EXC(2); return st.Q[r]; }
            if (r >= 1001 && r <= 1512) { const n = r - 1000; if (!mwOk(Math.ceil(n / 16))) EXC(2); return mBit(n); }
            if (r >= 2001 && r <= 2512) { const n = r - 2000; if (!nwOk(Math.ceil(n / 16))) EXC(2); return nBit(n); }
            if (fw() >= 140 && r >= 50001 && r <= 50128) { if (!opts.io) EXC(2); return st.Q[r - 50000]; }
            if (fw() >= 140 && r >= 56001 && r <= (fw() >= 240 ? 57024 : 56512)) { const n = r - 56000; if (!mwOk(Math.ceil(n / 16))) EXC(2); return mBit(n); }
            if (fw() >= 140 && r >= 58001 && r <= 58512) { const n = r - 58000; if (!nwOk(Math.ceil(n / 16))) EXC(2); return nBit(n); }
            EXC(2);
        }
        if (r >= 1 && r <= 128) { if (!opts.io || (opts.gapsUndefined && r > 8 && r < 17)) EXC(2); return st.I[r]; }
        if (r >= 3001 && r <= 3096) { if (!opts.io) EXC(2); return st.ID[r - 3000]; }
        if (fw() >= 140 && r >= 52001 && r <= 52128) { if (!opts.io) EXC(2); return st.I[r - 52000]; }
        if (fw() >= 140 && r >= 54001 && r <= 54096) { if (!opts.io) EXC(2); return st.ID[r - 54000]; }
        if (r >= 1001 && r <= 1512) { const n = r - 1000; if (!mwOk(Math.ceil(n / 16))) EXC(2); return mBit(n); }
        EXC(2);
    }
    function a32(arr, base, r) { const i = Math.ceil((r - base) / 2); const v = arr[i] >>> 0; return (r - base) % 2 === 1 ? v & 0xffff : v >>> 16; }
    function readReg(fc, r) {
        if (fc === 4) {
            if (r >= 1 && r <= 48) { if (!opts.io) EXC(2); return st.IA[r] & 0xffff; }
            if (fw() >= 140 && r >= 6501 && r <= 6596) { if (!opts.io) EXC(2); return a32(st.IA, 6500, r); }
            if (fw() >= 240 && r >= 42001 && r <= 43024) { if (!opts.io) EXC(2); return a32(st.IA, 42000, r); }
            // easy4Visu: QA auch über FC4 (am Gerät mit FW 2.46 geprüft, 24.10.2026; easySoft exportiert QA als RI)
            if (fw() >= 240 && r >= 40001 && r <= 40256) { if (!opts.io) EXC(2); return a32(st.QA, 40000, r); }
            EXC(2);
        }
        if (r >= 1 && r <= 48) { if (!opts.io) EXC(2); return st.QA[r] & 0xffff; }
        if (r >= 1001 && r <= 1512) { if (!mwOk(r - 1000)) EXC(2); return st.MW[r - 1000]; }
        if (r >= 2001 && r <= 2032) { if (!nwOk(r - 2000)) EXC(2); return st.NW[r - 2000]; }
        if (r >= 5000 && r <= 5009) { if (!opts.io) EXC(2); return rtc(r); }
        if (fw() >= 140 && r >= 6001 && r <= 6096) { if (!opts.io) EXC(2); return a32(st.QA, 6000, r); }
        if (fw() >= 140 && r >= 7001 && r <= 7512) { if (!mwOk(r - 7000)) EXC(2); return st.MW[r - 7000]; }
        if (fw() >= 140 && r >= 8001 && r <= 8032) { if (!nwOk(r - 8000)) EXC(2); return st.NW[r - 8000]; }
        if (fw() >= 240 && r >= 40001 && r <= 40256) { if (!opts.io) EXC(2); return a32(st.QA, 40000, r); }
        if (fw() >= 240 && r >= 46001 && r <= 47022) { if (!mwOk(r - 46000)) EXC(2); return st.MW[r - 46000]; }
        EXC(2);
    }
    // Schreibziel prüfen und Schreibfunktion liefern
    function bitTarget(r) {
        let n;
        let arr;
        if (r >= 1001 && r <= 1512) { n = r - 1000; arr = "MW"; }
        else if (r >= 2001 && r <= 2512) { n = r - 2000; arr = "NW"; }
        else if (fw() >= 140 && r >= 56001 && r <= (fw() >= 240 ? 57024 : 56512)) { n = r - 56000; arr = "MW"; }
        else if (fw() >= 140 && r >= 58001 && r <= 58512) { n = r - 58000; arr = "NW"; }
        else EXC(2);
        if (!(arr === "MW" ? mwOk : nwOk)(Math.ceil(n / 16))) EXC(2);
        return (v) => setBit(st[arr], n, v);
    }
    let pendingClock = null;
    function regTarget(r) {
        let w;
        if (r >= 1001 && r <= 1512) w = ["MW", r - 1000];
        else if (r >= 2001 && r <= 2032) w = ["NW", r - 2000];
        else if (fw() >= 140 && r >= 7001 && r <= 7512) w = ["MW", r - 7000];
        else if (fw() >= 140 && r >= 8001 && r <= 8032) w = ["NW", r - 8000];
        else if (fw() >= 240 && r >= 46001 && r <= 47022) w = ["MW", r - 46000];
        else if (r >= 5000 && r <= 5005) {
            if (!opts.io || opts.clockLocked) EXC(2);
            return (v) => { pendingClock = pendingClock || {}; pendingClock[r] = v; };
        } else EXC(2);
        if (!(w[0] === "MW" ? mwOk : nwOk)(w[1])) EXC(2);
        return (v) => { st[w[0]][w[1]] = v; };
    }
    function applyClock() {
        if (!pendingClock) return;
        const c = pendingClock;
        pendingClock = null;
        const cur = now();
        const g = (r, d) => (c[r] !== undefined ? c[r] : d);
        let y = g(5005, cur.getFullYear());
        if (y < 100) y += 2000;
        const d = new Date(y, g(5004, cur.getMonth() + 1) - 1, g(5003, cur.getDate()), g(5002, cur.getHours()), g(5001, cur.getMinutes()), g(5000, cur.getSeconds()));
        st.clockOffset = d.getTime() - Date.now();
        st.lastClockWrite = c;
    }

    function handle(pdu) {
        const fc = pdu[0];
        const a = pdu.readUInt16BE(1) + (opts.minusOne ? 1 : 0);
        try {
            if (fc === 1 || fc === 2) {
                const n = pdu.readUInt16BE(3);
                if (n < 1 || n > (fw() >= 240 ? 1024 : 512)) EXC(3);
                const bits = [];
                for (let i = 0; i < n; i++) bits.push(readBit(fc, a + i));
                const out = Buffer.alloc(2 + Math.ceil(n / 8));
                out[0] = fc;
                out[1] = Math.ceil(n / 8);
                bits.forEach((b, i) => { if (b) out[2 + (i >> 3)] |= 1 << (i & 7); });
                return out;
            }
            if (fc === 3 || fc === 4) {
                const n = pdu.readUInt16BE(3);
                if (n < 1 || n > 125) EXC(3);
                const out = Buffer.alloc(2 + 2 * n);
                out[0] = fc;
                out[1] = 2 * n;
                for (let i = 0; i < n; i++) out.writeUInt16BE(readReg(fc, a + i), 2 + 2 * i);
                return out;
            }
            if (fc === 5 || fc === 15) {
                if (!opts.fc5) EXC(1);
                if (opts.readOnly) EXC(1);
                if (fc === 5) {
                    const v = pdu.readUInt16BE(3);
                    if (v !== 0 && v !== 0xff00) EXC(3);
                    bitTarget(a)(v === 0xff00);
                    return Buffer.from(pdu.subarray(0, 5));
                }
                const n = pdu.readUInt16BE(3);
                const fns = [];
                for (let i = 0; i < n; i++) fns.push(bitTarget(a + i));
                fns.forEach((f, i) => f((pdu[6 + (i >> 3)] >> (i & 7)) & 1));
                return Buffer.from(pdu.subarray(0, 5));
            }
            if (fc === 6) {
                const t = regTarget(a);
                if (opts.readOnly && !(a >= 5000 && a <= 5009)) EXC(1);
                t(pdu.readUInt16BE(3));
                applyClock();
                return Buffer.from(pdu.subarray(0, 5));
            }
            if (fc === 16) {
                const n = pdu.readUInt16BE(3);
                if (n < 1 || n > 123 || pdu[5] !== 2 * n) EXC(3);
                if (opts.readOnly && !(a >= 5000 && a <= 5009)) EXC(1);
                const fns = [];
                for (let i = 0; i < n; i++) fns.push(regTarget(a + i));
                fns.forEach((f, i) => f(pdu.readUInt16BE(6 + 2 * i)));
                applyClock();
                return Buffer.from(pdu.subarray(0, 5));
            }
            EXC(1);
        } catch (e) {
            if (e.exc === undefined) throw e;
            return Buffer.from([fc | 0x80, e.exc]);
        }
    }

    let inFlight = 0;
    const sockets = new Set();
    const server = net.createServer((sock) => {
        st.connections++;
        st.maxConnections = Math.max(st.maxConnections, sockets.size + 1);
        sockets.add(sock);
        let buf = Buffer.alloc(0);
        sock.on("data", (d) => {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 7 && buf.length >= 6 + buf.readUInt16BE(4)) {
                const len = buf.readUInt16BE(4);
                const frame = buf.subarray(0, 6 + len);
                buf = buf.subarray(6 + len);
                const head = Buffer.from(frame.subarray(0, 7));
                const pdu = Buffer.from(frame.subarray(7));
                st.requests.push({ fc: pdu[0], addr: pdu.readUInt16BE(1) + (opts.minusOne ? 1 : 0), count: pdu.length >= 5 ? pdu.readUInt16BE(3) : 0, unit: head[6] });
                if (opts.silent) continue;
                inFlight++;
                st.maxParallel = Math.max(st.maxParallel, inFlight);
                setTimeout(() => {
                    inFlight--;
                    const res = handle(pdu);
                    head.writeUInt16BE(res.length + 1, 4);
                    if (!sock.destroyed) sock.write(Buffer.concat([head, res]));
                }, opts.delay);
            }
        });
        sock.on("error", () => {});
        sock.on("close", () => sockets.delete(sock));
    });
    return new Promise((resolve, reject) => {
        server.once("error", reject); // easy4Visu: z. B. Port belegt melden statt endlos warten
        server.listen(opts.port, "127.0.0.1", () => {
            resolve({
                port: server.address().port, opts, st,
                dropClients() { sockets.forEach((s) => s.destroy()); },
                stop() { return new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()); }); },
            });
        });
    });
}

module.exports = { start };

if (require.main === module) {
    const port = parseInt(process.argv[2], 10) || 5020;
    start({ port }).then((s) => {
        // etwas Bewegung für den Beispiel-Flow
        s.st.I[1] = 1;
        s.st.IA[1] = 512;
        setInterval(() => { s.st.MW[3] = (s.st.MW[3] + 1) & 0xffff; }, 1000);
        console.log("easyE4-Simulator (Modbus TCP) auf Port " + s.port);
    });
}
