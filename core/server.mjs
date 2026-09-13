import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HOST, PORT, PATHS, ensureHome, BACKEND } from "./config.mjs";
import { appendTurn, updateTurn, latest, turnsSince, readState, writeState, readFavorites, toggleFavorite, onChange } from "./store.mjs";
import { dose, simulatedAgentReply, describeBackend, complete, currentBackend, PROMPTS } from "./translate.mjs";
import { harnessStatus, setHarness, snippet, backendOptions, readConfig, writeConfig, maskBackend } from "./setup.mjs";
import { notify, notifySupported } from "./notify.mjs";
import { handleHook, renderDose } from "./hooks.mjs";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const PKG = JSON.parse(fs.readFileSync(path.resolve(WEB_DIR, "../package.json"), "utf8"));

// echo core: a small local HTTP daemon, embedded in the desktop app or run standalone.
// Harness hooks POST here (via curl); the app UI and CLI read from here.
//
//   POST /hook/<kind>     harness hook payload on stdin -> harness-specific response
//   GET  /statusline      one/two ANSI lines for CLI status bars
//   POST /turns           {role:"user"|"agent", text, session?, source?}   -> {turn}
//   GET  /dose/latest     [?session=]  -> {you_said, in_short, level, pending}
//   GET  /today | /recent | /favorites | /state | /setup | /health | /events (SSE)

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => { try { resolve(s.trim() ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

export function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(" ")}\n`;
  try { fs.appendFileSync(PATHS.log, line); } catch {}
}

async function generate(turn) {
  const { level } = readState();
  try {
    const t0 = Date.now();
    const r = await dose(turn.role, turn.text, { level });
    updateTurn(turn.id, { en: r.en, kind: r.kind, status: "done", latency_ms: Date.now() - t0 });
    log(`dose ${turn.role}/${r.kind} ${Date.now() - t0}ms: ${r.en}`);
    if (turn.role === "agent") await maybeNotify(turn.session);
  } catch (e) {
    updateTurn(turn.id, { status: "error", error: String(e.message || e) });
    log(`dose error ${turn.role}: ${e.message}`);
  }
}

// One toast per exchange, once In short is ready. Waits briefly for You said if it is still running.
async function maybeNotify(session) {
  const st = readState();
  if (st.notify === false || (st.notify === undefined && !notifySupported())) return;
  let d = doseView(session);
  for (let i = 0; i < 40 && d.you_said?.status === "pending"; i++) { await new Promise((r) => setTimeout(r, 250)); d = doseView(session); }
  const lines = [];
  if (d.you_said?.status === "done") lines.push(`${d.you_said.kind === "better" ? "Better" : "You said"}: ${d.you_said.text}`);
  if (d.in_short?.status === "done") lines.push(`In short: ${d.in_short.text}`);
  if (!lines.length) return;
  const ok = await notify("echo", lines.join("\n"));
  log(`notify ${ok ? "sent" : "failed"} (${process.platform})`);
}

function doseView(session) {
  const u = latest({ session, role: "user" });
  const a = latest({ session, role: "agent" });
  const aFresh = a && (!u || a.ts >= u.ts); // agent line only if it belongs to the same exchange
  return {
    level: readState().level,
    enabled: readState().enabled !== false,
    you_said: u ? { text: u.en, kind: u.kind, status: u.status, ts: u.ts, source: u.source } : null,
    in_short: aFresh ? { text: a.en, status: a.status, ts: a.ts } : null,
    pending: (u && u.status === "pending") || (aFresh && a.status === "pending") || false,
  };
}

function today() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const turns = turnsSince(start).filter((t) => t.status === "done");
  const said = turns.filter((t) => t.role === "user");
  const heard = turns.filter((t) => t.role === "agent");
  return {
    date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
    turns: turns.length,
    you_said: said.map((t) => ({ zh: t.text.slice(0, 80), en: t.en, kind: t.kind })),
    in_short: heard.map((t) => t.en),
  };
}

const PAGES = { "/": "index.html", "/index.html": "index.html", "/app": "app.html", "/card": "app.html" };

async function route(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  const p = url.pathname;
  if (req.method === "GET" && p === "/health") {
    return json(res, 200, { ok: true, pid: process.pid, version: PKG.version, backend: currentBackend().type, model: describeBackend(), notify: readState().notify ?? notifySupported(), envBackend: BACKEND });
  }
  // ---- harness hooks (curl) ----
  if (req.method === "POST" && p.startsWith("/hook/")) {
    const r = await handleHook(p.slice(6), await readBody(req), { generate, doseView });
    return json(res, r.status, r.body);
  }
  if (req.method === "GET" && p === "/statusline") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return res.end(renderDose(doseView(url.searchParams.get("session") || undefined)));
  }
  // ---- turns ----
  if (req.method === "POST" && p === "/turns") {
    const body = await readBody(req);
    if (!body.text || !["user", "agent"].includes(body.role)) return json(res, 400, { error: "need role user|agent and text" });
    if (readState().enabled === false) return json(res, 200, { skipped: "disabled" });
    const turn = appendTurn({ role: body.role, text: body.text, session: body.session || null, source: body.source || "unknown" });
    const gp = generate(turn);
    if (url.searchParams.get("wait") === "1") { await gp; return json(res, 200, { turn: latest({ role: body.role }) }); }
    return json(res, 202, { turn });
  }
  if (req.method === "GET" && p === "/dose/latest") return json(res, 200, doseView(url.searchParams.get("session") || undefined));
  if (req.method === "GET" && p === "/today") return json(res, 200, today());
  if (req.method === "GET" && p === "/recent") {
    const n = Math.min(200, Number(url.searchParams.get("n") || 20));
    const all = turnsSince(new Date(0));
    return json(res, 200, { turns: all.slice(-n).reverse().map((t) => ({ id: t.id, ts: t.ts, role: t.role, source: t.source, session: t.session, text: t.text.slice(0, 300), en: t.en, kind: t.kind, status: t.status })) });
  }
  // Demo: stand-in agent so the public page can show a full turn. Not part of the product.
  if (req.method === "POST" && p === "/demo/reply") {
    const body = await readBody(req);
    if (!body.text) return json(res, 400, { error: "need text" });
    return json(res, 200, { reply: await simulatedAgentReply(body.text) });
  }
  // ---- live updates ----
  if (req.method === "GET" && p === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(`event: hello\ndata: {}\n\n`);
    const off = onChange((evt) => res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
    const ka = setInterval(() => res.write(`: keepalive\n\n`), 15000);
    req.on("close", () => { off(); clearInterval(ka); });
    return;
  }
  // ---- setup: harnesses + model backend ----
  if (req.method === "GET" && p === "/setup") {
    return json(res, 200, {
      harnesses: harnessStatus(), lastSeen: readState().lastSeen || {},
      backend: maskBackend(currentBackend()), fromConfig: Boolean(readConfig().backend), backendOptions: backendOptions(),
      platform: process.platform, home: os.homedir(), dataDir: PATHS.home, version: PKG.version, port: PORT,
    });
  }
  if (req.method === "GET" && p === "/setup/snippet") {
    try { return json(res, 200, snippet(url.searchParams.get("id"))); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (req.method === "POST" && p === "/setup/harness") {
    const body = await readBody(req);
    try { const r = setHarness(body.id, body.enabled); log(`harness ${body.id} ${body.enabled ? "enabled" : "disabled"}`); return json(res, 200, r); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (req.method === "POST" && p === "/setup/backend") {
    const body = await readBody(req);
    const b = body.backend || {};
    if (!b.type) return json(res, 400, { error: "need backend.type" });
    const prev = readConfig().backend;
    if (b.apiKey && b.apiKey.includes("…") && prev?.apiKey) b.apiKey = prev.apiKey; // form sent back the masked key
    if (body.test) {
      const t0 = Date.now();
      try { const en = await complete(PROMPTS.youSaid, "这个 PR 先别合，等 QA 跑完再说", b); return json(res, 200, { ok: true, en: en.trim(), ms: Date.now() - t0 }); }
      catch (e) { return json(res, 200, { ok: false, error: e.message, ms: Date.now() - t0 }); }
    }
    writeConfig({ backend: b });
    log(`backend set: ${describeBackend(b)}`);
    return json(res, 200, { backend: maskBackend(b) });
  }
  // ---- favorites / state ----
  if (req.method === "GET" && p === "/favorites") return json(res, 200, { favorites: readFavorites() });
  if (req.method === "POST" && p === "/favorites/toggle") {
    const body = await readBody(req);
    if (!body.text || !["word", "sentence"].includes(body.kind)) return json(res, 400, { error: "need kind word|sentence and text" });
    return json(res, 200, toggleFavorite(body));
  }
  if (req.method === "GET" && p === "/state") return json(res, 200, readState());
  if (req.method === "POST" && p === "/state") {
    const body = await readBody(req);
    const patch = {};
    if (body.level !== undefined) patch.level = Math.max(0, Math.min(1, Number(body.level) || 0));
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.notify !== undefined) patch.notify = Boolean(body.notify);
    if (body.onboarded !== undefined) patch.onboarded = Boolean(body.onboarded);
    return json(res, 200, writeState(patch));
  }
  // ---- pages ----
  if (req.method === "GET" && PAGES[p]) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(fs.readFileSync(path.join(WEB_DIR, PAGES[p])));
  }
  json(res, 404, { error: "not found" });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try { await route(req, res); }
    catch (e) { log(`http error ${req.method} ${req.url}: ${e.message}`); if (!res.headersSent) json(res, 500, { error: String(e.message || e) }); }
  });
}

// Start the core on 127.0.0.1:PORT. Resolves {server, port} or, if an echo core already owns the
// port (e.g. started by the CLI), {server:null, port, existing:true}.
export async function startCore() {
  ensureHome();
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", async (e) => {
      if (e.code !== "EADDRINUSE") return reject(e);
      try { const r = await fetch(`http://${HOST}:${PORT}/health`); if (r.ok) return resolve({ server: null, port: PORT, existing: true }); } catch {}
      reject(new Error(`port ${PORT} is taken by something that is not echo`));
    });
    server.listen(PORT, HOST, () => {
      fs.writeFileSync(PATHS.pid, String(process.pid));
      log(`echo core ${PKG.version} listening on http://${HOST}:${PORT} model=${describeBackend()}`);
      resolve({ server, port: PORT });
    });
  });
}

export function stopCore(server) {
  try { fs.unlinkSync(PATHS.pid); } catch {}
  server?.close();
}

// `node core/server.mjs` — standalone (CLI, demo server, systemd).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { server, existing } = await startCore();
  if (existing) { console.log(`echo core already running on http://${HOST}:${PORT}`); process.exit(0); }
  if (process.stdout.isTTY) console.log(`echo core on http://${HOST}:${PORT} (model ${describeBackend()})`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopCore(server); process.exit(0); });
}
