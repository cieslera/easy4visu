// Simulierte easyE4 (JSON-API) nach der Eaton-Dokumentation – nur zum Testen
// Übernommen aus node-red-contrib-easye4-json 1.1.1 (Tests/sim.js).
"use strict";
const http = require("http");

function b64(bytes) { return Buffer.from(bytes).toString("base64"); }

function createSim(opts = {}) {
    const st = {
        fw: opts.fw || "1.20",
        state: "RUN",
        devname: "easyE4",
        date: "2026-10-18",
        time: "11:00:00",
        anonymous: opts.anonymous !== false,
        users: { admin: "geheim", testuser: "pw1" },
        apikeys: { KEY123: "testuser" },
        I: new Array(129).fill(0), O: new Array(129).fill(0),
        AI: new Array(49).fill(0), AO: new Array(49).fill(0), ID: new Array(97).fill(0),
        M: new Array(513).fill(0), MB: new Array(513).fill(0), MW: new Array(513).fill(0), MD: new Array(257).fill(0),
        N: {}, NB: {}, NW: {}, ND: {},
        T1: { "0;0": 1, "0;1": 0, "0;2": 0, "1;0": 0, "2;0": 4534000, "2;1": 0, "3;0": 1200 },
        fbConnectedConst: { "T1(2;0)": true },
        saved: 0,
        log: [],
        delay: 0,
        busy503: 0,
        active: 0, maxActive: 0, conns: 0, maxConns: 0, openConns: 0,
    };
    for (const t of ["N", "NB", "NW", "ND"]) for (let n = 0; n <= 8; n++) st[t][n] = new Array(513).fill(0);
    const MAX = { I: 128, O: 128, AI: 48, AO: 48, ID: 96, M: 512, MB: 512, MW: 512, MD: 256, N: 512, NB: 64, NW: 32, ND: 16 };
    const WIDTH = { I: "bit", O: "bit", ID: "bit", M: "bit", N: "bit", MB: 1, NB: 1, MW: 2, NW: 2, MD: 4, ND: 4, AI: 4, AO: 4 };

    function arr(t, net) { return ["N", "NB", "NW", "ND"].includes(t) ? st[t][net] : st[t]; }
    function encode(t, list) {
        const w = WIDTH[t];
        if (w === "bit") {
            const bytes = new Array(Math.ceil(list.length / 8)).fill(0);
            list.forEach((v, i) => { if (v) bytes[i >> 3] |= 1 << (i & 7); });
            return b64(bytes);
        }
        const buf = Buffer.alloc(list.length * w);
        list.forEach((v, i) => {
            if (w === 1) buf.writeUInt8(v & 0xff, i);
            else if (w === 2) buf.writeUInt16LE(v & 0xffff, i * 2);
            else buf.writeInt32LE(v | 0, i * 4);
        });
        return buf.toString("base64");
    }
    function singleV(t, v) {
        if (st.fw === "1.10") return encode(t, [v]);
        return v;
    }

    function auth(req) {
        const h = req.headers.authorization || "";
        if (h.startsWith("Basic ")) {
            const [u, p] = Buffer.from(h.slice(6), "base64").toString().split(":");
            if (st.users[u] !== undefined && st.users[u] === p) return u;
            return null;
        }
        if (h.startsWith("Bearer ")) {
            const k = h.slice(7).trim();
            return st.apikeys[k] ? st.apikeys[k] : null;
        }
        return st.anonymous ? "guest" : null;
    }

    function readElm(e, out) {
        let m;
        const add = (sec, key, val) => {
            out[sec] = out[sec] || {};
            if (Array.isArray(val)) { out[sec][key] = out[sec][key] || []; out[sec][key].push(...val); } else out[sec][key] = val;
        };
        const SYS = { STATE: () => ({ STATE: st.state }), VERSION: () => ({ VERS: st.fw, BUILD: "206" }), DEVNAME: () => ({ DEVNAME: st.devname }),
            DATE: () => ({ DATE: st.date }), TIME: () => ({ TIME: st.time }), CYC: () => ({ CYC: { CYCMIN: "10032", CYCMAX: "11916", CYCACT: "10047" } }),
            IPSET: () => ({ IPSET: { ACTIP: "10.0.0.5", IPMODE: "1", ACTMASK: "255.255.255.0", ACTGW: "10.0.0.1" } }), DEVID: () => ({ DEVID: "0" }),
            PROGNAME: () => ({ PROGNAME: "myeasy" }), DIAG: () => ({ DIAG_CNT: "1", DIAG_TIME: "100", DIAG_LIST: [{ DIAG: "0", CNT: "1", TIME: "10", MOD: "196", CODE: "67", DID: "0x1F" }] }) };
        if (SYS[e]) { for (const [k, v] of Object.entries(SYS[e]())) add("SYSINFO", k, v); return; }
        if ((m = /^(I|O|AI|AO|M)$/.exec(e))) {
            add("OPERANDS", m[1] + "ALL", encode(m[1], arr(m[1]).slice(1, MAX[m[1]] + 1)));
            return;
        }
        if ((m = /^(N|NB|NW|ND)\((\d+);(\d+)(?:,(\d+))?\)$/.exec(e))) {
            const t = m[1], net = +m[2], a = +m[3], b = m[4] !== undefined ? +m[4] : null;
            if (net > 8) return add("OPERANDS", t + (b === null ? "SINGLE" : "RANGE"), [{ ID: net, INDEX: a, ERROR: 9 }]);
            if (b === null) {
                if (a < 1 || a > MAX[t]) return add("OPERANDS", t + "SINGLE", [{ ID: net, INDEX: a, ERROR: 8 }]);
                return add("OPERANDS", t + "SINGLE", [{ ID: net, INDEX: a, V: singleV(t, arr(t, net)[a]) }]);
            }
            if (WIDTH[t] === "bit" && ((a - 1) % 8 !== 0 || b % 8 !== 0)) return add("OPERANDS", t + "RANGE", [{ ID: net, START: a, END: b, ERROR: 7 }]);
            return add("OPERANDS", t + "RANGE", [{ ID: net, START: a, END: b, V: encode(t, arr(t, net).slice(a, b + 1)) }]);
        }
        if ((m = /^(AI|AO|ID|MB|MW|MD|I|O|M)\((\d+)(?:,(\d+))?\)$/.exec(e))) {
            const t = m[1], a = +m[2], b = m[3] !== undefined ? +m[3] : null;
            if (b === null) {
                if (a < 1 || a > MAX[t]) return add("OPERANDS", t + "SINGLE", [{ INDEX: a, ERROR: 8 }]);
                return add("OPERANDS", t + "SINGLE", [{ INDEX: a, V: singleV(t, arr(t)[a]) }]);
            }
            if (b > MAX[t] || a < 1) return add("OPERANDS", t + "RANGE", [{ START: a, END: b, ERROR: 7 }]);
            if (WIDTH[t] === "bit" && ((a - 1) % 8 !== 0 || b % 8 !== 0)) return add("OPERANDS", t + "RANGE", [{ START: a, END: b, ERROR: 7 }]);
            return add("OPERANDS", t + "RANGE", [{ START: a, END: b, V: encode(t, arr(t).slice(a, b + 1)) }]);
        }
        if ((m = /^FB([A-Z]+)(\d+)\((\d);(\d+)\)$/.exec(e))) {
            const name = m[1], inst = +m[2], type = +m[3], off = +m[4];
            if (name !== "T") return add("FB", name, [{ INST: inst, TYPE: type, OFFSET: off, ERROR: 32 }]);
            if (inst !== 1) return add("FB", name, [{ INST: inst, TYPE: type, OFFSET: off, ERROR: 33 }]);
            const v = st.T1[type + ";" + off];
            if (v === undefined) return add("FB", name, [{ INST: inst, TYPE: type, OFFSET: off, ERROR: 35 }]);
            if (type === 2) {
                const ms = v;
                return add("FB", name, [{ INST: inst, TYPE: type, OFFSET: off, TIMEBASE: 1, H: Math.floor(ms / 3600000), M: Math.floor(ms / 60000) % 60, S: Math.floor(ms / 1000) % 60, MS: ms % 1000 }]);
            }
            return add("FB", name, [{ INST: inst, TYPE: type, OFFSET: off, V: v }]);
        }
        throw Object.assign(new Error("unknown"), { http: 400 });
    }

    const server = http.createServer((req, res) => {
        st.active++; st.maxActive = Math.max(st.maxActive, st.active);
        res.on("finish", () => { st.active--; });
        const url = new URL(req.url, "http://x");
        st.log.push({ url: req.url, auth: req.headers.authorization });
        const send = (code, body) => {
            setTimeout(() => {
                res.writeHead(code, { "Content-Type": "application/json" });
                res.end(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body));
            }, st.delay);
        };
        if (st.busy503 > 0) { st.busy503--; return send(503); }
        if (req.url.length > 256) return send(400);
        const user = auth(req);
        if (!user) return send(401);
        const p = url.pathname;
        const q = req.url.split("?")[1] || "";
        const params = {};
        q.split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) params[kv.slice(0, i).toLowerCase()] = decodeURIComponent(kv.slice(i + 1)); });
        try {
            if (p === "/api/get/data" || p === "/api/get/adm") {
                if (p === "/api/get/adm" && user !== "admin") return send(401);
                const raw = q.replace(/^elm=/, "");
                const out = {};
                for (const e of raw.split("+")) readElm(e, out);
                return send(200, out);
            }
            if (user === "guest") return send(401);
            if (p === "/api/set/op") {
                const t = params.op, i = +params.index, v = +params.val, net = +(params.netid || 0);
                if (!WIDTH[t] || ["I", "O", "AI", "AO", "ID"].includes(t)) return send(400);
                if (i < 1 || i > MAX[t]) return send(200, [{ ERROR: 8 }]);
                arr(t, net)[i] = v;
                return send(204);
            }
            if (p === "/api/set/par") {
                if (params.op === "SAVE") { st.saved++; return send(200, "SUCCESS"); }
                if (st.state !== "RUN") return send(403);
                const out = [];
                for (let k = 1; k <= 7; k++) {
                    const s = params["v" + k];
                    if (s === undefined) continue;
                    const m = /^([A-Z]+)(\d+)\((\d);(\d+);(-?\d+)\)$/.exec(s);
                    if (!m) { out.push({ [s]: -1, ERROR: 6 }); continue; }
                    if (m[1] !== "T" || m[2] !== "1") { out.push({ [s]: -1, ERROR: 33 }); continue; }
                    const key = m[3] + ";" + m[4];
                    if (m[3] === "2" && !st.fbConnectedConst["T1(" + key + ")"]) { out.push({ [s]: -1, ERROR: 36 }); continue; }
                    if (m[3] === "2" && (+m[5] < 1 || +m[5] > 359940000)) { out.push({ [s]: -1, ERROR: 37 }); continue; }
                    st.T1[key] = +m[5];
                    out.push({ [s]: 0, SUCCESS: 0 });
                }
                return send(200, out);
            }
            if (p === "/api/set/mode") { st.state = params.v1 === "RUN" ? "RUN" : "STOP"; return send(204); }
            if (p === "/api/set/clock") {
                if (st.state !== "STOP") return send(403);
                const pad = (x) => String(x).padStart(2, "0");
                if (params.op === "date") st.date = params.v1 + "-" + pad(params.v2) + "-" + pad(params.v3);
                else st.time = pad(params.v1) + ":" + pad(params.v2) + ":" + pad(params.v3);
                return send(204);
            }
            if (p === "/api/set/adm") {
                if (user !== "admin") return send(401);
                if (st.state !== "STOP") return send(403);
                if (params.op === "devname") { st.devname = params.v1; return send(204); }
                return send(400);
            }
            return send(404);
        } catch (e) {
            return send(e.http || 500);
        }
    });
    server.on("connection", (sock) => { st.conns++; st.openConns++; st.maxConns = Math.max(st.maxConns, st.openConns); sock.on("close", () => st.openConns--); });
    return {
        st,
        listen: () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port))),
        close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); }),
    };
}
module.exports = createSim;
