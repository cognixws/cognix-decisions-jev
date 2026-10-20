// The Jev provider (COGNIX[WS] fast decisions, ADR-0362): the core POSTs a
// System One request to /decide through the process relay; this process adds
// the owner's TypeSafe key and model and forwards it to api.typesafe.ai. The
// core checks the answer before any tool acts on it. /status says whether a
// key is set and the last call worked, in the core's closed words.
import http from "node:http";
import https from "node:https";
import { timingSafeEqual } from "node:crypto";

const env = process.env;
const API = new URL(env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone");
const log = (m) => console.error("[jev]", m);
// One warm connection: a new TLS handshake per decision costs more than the decision.
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function hostRequest(path) {
  return new Promise((done, fail) => {
    const base = new URL(env.PICODE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) return fail(new Error("PiCode Host API must use loopback."));
    const target = new URL(path, base);
    const client = target.protocol === "https:" ? https : http;
    // PiCode's own certificate on loopback, as every extension reads it.
    const req = client.request(target, { method: "GET", rejectUnauthorized: false, headers: { "X-PiCode-Extension-Token": env.PICODE_EXT_TOKEN } }, (res) => {
      const chunks = [];
      res.on("data", (b) => chunks.push(b));
      res.on("error", fail);
      res.on("end", () => {
        try { done({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || "{}") }); } catch (e) { fail(e); }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error("Host API timeout")));
    req.on("error", fail);
    req.end();
  });
}

// Settings are read once: PiCode restarts the process when they change.
let settings = null;
async function loadSettings() {
  if (settings) return settings;
  if (env.JEV_API_KEY) return (settings = { key: env.JEV_API_KEY, model: env.JEV_MODEL || "jev-latest" });
  const r = await hostRequest("/api/ext/v1/settings");
  settings = { key: String(r.body?.secrets?.api_key || "").trim(), model: String(r.body?.values?.model || "jev-latest") };
  return settings;
}

let last = { ok: null };

function forward(body, key) {
  const usesImages = JSON.stringify(body.questions || {}).includes('"box"') || body.assets;
  return new Promise((done, fail) => {
    const raw = Buffer.from(JSON.stringify(body));
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Content-Length": raw.length };
    if (usesImages) headers["TypeSafe-Danger-Zone-Images"] = "true";
    const req = https.request(API, { method: "POST", headers, agent }, (res) => {
      const chunks = [];
      res.on("data", (b) => chunks.push(b));
      res.on("error", fail);
      res.on("end", () => done({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.setTimeout(15_000, () => req.destroy(new Error("TypeSafe did not answer in time")));
    req.on("error", fail);
    req.end(raw);
  });
}

const equal = (a, b) => {
  const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

function readBody(req, max) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (b) => { size += b.length; if (size > max) { req.destroy(); fail(new Error("too large")); } else chunks.push(b); });
    req.on("end", () => { try { done(JSON.parse(Buffer.concat(chunks).toString() || "{}")); } catch (e) { fail(e); } });
    req.on("error", fail);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, value) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  if (!equal(req.headers["x-picode-proxy-secret"], env.PICODE_EXT_PROXY_SECRET)) return send(403, { error: "Use the PiCode process relay." });
  try {
    const s = await loadSettings();
    if (req.method === "GET" && req.url === "/status") {
      if (!s.key) return send(200, { state: "needs-setup", next: "settings" });
      if (last.ok === false) return send(200, { state: "needs-attention", next: last.auth ? "settings" : "retry" });
      return send(200, { state: "ready" });
    }
    if (req.method === "POST" && req.url === "/decide") {
      if (!s.key) return send(409, { error: "no TypeSafe API key" });
      const body = await readBody(req, 30 << 20);
      body.model = s.model;
      const answer = await forward(body, s.key);
      last = { ok: answer.status === 200, auth: answer.status === 401 || answer.status === 403 };
      if (answer.status !== 200) {
        log(`TypeSafe answered ${answer.status}: ${answer.text.slice(0, 200)}`);
        return send(502, { error: `TypeSafe answered ${answer.status}` });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(answer.text);
    }
    return send(404, { error: "not found" });
  } catch (e) {
    last = { ok: false };
    log(String(e?.message || e));
    return send(502, { error: "the request to TypeSafe failed" });
  }
});

server.listen(Number(env.PICODE_EXT_PORT), "127.0.0.1", () => log(`listening on ${env.PICODE_EXT_PORT}`));
