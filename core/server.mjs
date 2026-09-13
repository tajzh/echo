import http from "node:http";
import fs from "node:fs";
import { HOST, PORT, PATHS, ensureHome, BACKEND } from "./config.mjs";
import { appendTurn, updateTurn, latest, turnsSince, readState, writeState, readFavorites, toggleFavorite, onChange } from "./store.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dose, simulatedAgentReply, describeBackend } from "./translate.mjs";
import { notify, notifySupported } from "./notify.mjs";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");

// echo core: a tiny local HTTP daemon. Adapters POST conversation turns here;
// the core generates the English dose asynchronously and serves it back.
//
//   POST /turns          {role:"user"|"agent", text, session?, source?}   -> {turn}
//   GET  /dose/latest    [?session=]  -> {you_said, in_short, level, pending}
//   GET  /today          -> today's digest
//   GET  /state  | POST /state {level?, enabled?}
//   GET  /health

ensureHome();

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(" ")}\n`;
  fs.appendFileSync(PATHS.log, line);
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
  // Only show the agent line if it belongs to the same exchange (came after the user turn).
  const aFresh = a && (!u || a.ts >= u.ts);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, pid: process.pid, backend: BACKEND, model: describeBackend(), notify: readState().notify ?? notifySupported() });
    }
    if (req.method === "POST" && url.pathname === "/turns") {
      const body = await readBody(req);
      if (!body.text || !["user", "agent"].includes(body.role)) return json(res, 400, { error: "need role user|agent and text" });
      if (readState().enabled === false) return json(res, 200, { skipped: "disabled" });
      const turn = appendTurn({ role: body.role, text: body.text, session: body.session || null, source: body.source || "unknown" });
      const p = generate(turn);
      if (url.searchParams.get("wait") === "1") { await p; return json(res, 200, { turn: latest({ role: body.role }) }); }
      return json(res, 202, { turn });
    }
    if (req.method === "GET" && url.pathname === "/dose/latest") {
      return json(res, 200, doseView(url.searchParams.get("session") || undefined));
    }
    if (req.method === "GET" && url.pathname === "/today") return json(res, 200, today());
    if (req.method === "GET" && url.pathname === "/recent") {
      const n = Math.min(50, Number(url.searchParams.get("n") || 20));
      const all = turnsSince(new Date(0));
      return json(res, 200, { turns: all.slice(-n).reverse().map((t) => ({ id: t.id, ts: t.ts, role: t.role, source: t.source, session: t.session, text: t.text.slice(0, 300), en: t.en, kind: t.kind, status: t.status })) });
    }
    // Demo: stand-in agent so the page can show a full turn. Not part of the product.
    if (req.method === "POST" && url.pathname === "/demo/reply") {
      const body = await readBody(req);
      if (!body.text) return json(res, 400, { error: "need text" });
      const reply = await simulatedAgentReply(body.text);
      return json(res, 200, { reply });
    }
    // Card: the persistent, closable, interactive surface (desktop "status line"). Live via SSE.
    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: {}\n\n`);
      const off = onChange((evt) => res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
      const ka = setInterval(() => res.write(`: keepalive\n\n`), 15000);
      req.on("close", () => { off(); clearInterval(ka); });
      return;
    }
    if (req.method === "GET" && url.pathname === "/favorites") return json(res, 200, { favorites: readFavorites() });
    if (req.method === "POST" && url.pathname === "/favorites/toggle") {
      const body = await readBody(req);
      if (!body.text || !["word", "sentence"].includes(body.kind)) return json(res, 400, { error: "need kind word|sentence and text" });
      return json(res, 200, toggleFavorite(body));
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/card")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(fs.readFileSync(path.join(WEB_DIR, url.pathname === "/card" ? "card.html" : "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/state") return json(res, 200, readState());
    if (req.method === "POST" && url.pathname === "/state") {
      const body = await readBody(req);
      const patch = {};
      if (body.level !== undefined) patch.level = Math.max(0, Math.min(1, Number(body.level) || 0));
      if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      if (body.notify !== undefined) patch.notify = Boolean(body.notify);
      return json(res, 200, writeState(patch));
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    log(`http error ${req.method} ${url.pathname}: ${e.message}`);
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  fs.writeFileSync(PATHS.pid, String(process.pid));
  log(`echo core listening on http://${HOST}:${PORT} backend=${BACKEND}`);
  if (process.stdout.isTTY) console.log(`echo core on http://${HOST}:${PORT} (backend ${BACKEND})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { try { fs.unlinkSync(PATHS.pid); } catch {} process.exit(0); });
