import fs from "node:fs";
import { appendTurn, latest, readState, writeState } from "./store.mjs";
import { inflight } from "./translate.mjs";

// Harness hooks land here (POST /hook/<kind>). The hook command itself is just curl, so the
// harness needs nothing installed besides Echo. Each handler returns exactly what that harness
// expects on stdout.
//
//   cc-prompt / cc-stop        Claude Code (CLI + Desktop)   {suppressOutput} / {systemMessage}
//   codex-prompt / codex-stop  Codex (CLI + Desktop)         same wire format as Claude Code
//   zcode-prompt / zcode-stop  ZCode                         no user-facing output; the app shows it
//   cursor-prompt / cursor-response  Cursor (IDE + CLI)      {continue:true} / {}

const SRC = { cc: "claude-code", codex: "codex", zcode: "zcode", cursor: "cursor" };

// Claude Code transcript (JSONL): text of the assistant turn(s) since the last human message.
export function lastAssistantText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return "";
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  const texts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch { continue; }
    const content = e.message?.content;
    if (e.type === "user") {
      const isHuman = typeof content === "string" || (Array.isArray(content) && content.some((c) => c.type === "text"));
      if (isHuman) break;
    }
    if (e.type === "assistant" && Array.isArray(content)) for (const c of content) if (c.type === "text" && c.text) texts.unshift(c.text);
  }
  return texts.join("\n").trim();
}

export function renderDose(d, { color = true } = {}) {
  const DIM = "\x1b[2m", CYAN = "\x1b[36m", GREEN = "\x1b[32m", RESET = "\x1b[0m";
  const c = (code, s) => (color ? code + s + RESET : s);
  const lines = [];
  if (d.you_said) {
    const label = d.you_said.kind === "better" ? "Better" : "You said";
    const txt = d.you_said.status === "pending" ? "…" : d.you_said.status === "error" ? "(unavailable)" : d.you_said.text;
    lines.push(`${c(CYAN, "▸ " + label + ":")} ${txt}`);
  }
  if (d.in_short) {
    const txt = d.in_short.status === "pending" ? "…" : d.in_short.status === "error" ? "(unavailable)" : d.in_short.text;
    lines.push(`${c(GREEN, "▸ In short:")} ${txt}`);
  }
  if (!lines.length) lines.push(c(DIM, "▸ echo: waiting for your first message"));
  return lines.join("\n");
}

// Echo's own model calls go through the same harness CLIs (claude -p, pi -p, zcode) and would fire
// these hooks again. Anything whose prompt is one of our in-flight requests is ours: ignore it,
// and remember its session so the matching Stop is ignored too.
const ownSessions = new Set();
function isOwn(input) {
  const sid = input.session_id || input.conversation_id;
  if (input.prompt && inflight.has(input.prompt)) { if (sid) ownSessions.add(sid); return true; }
  return sid && ownSessions.has(sid);
}

function seen(source) {
  const st = readState();
  writeState({ lastSeen: { ...(st.lastSeen || {}), [source]: new Date().toISOString() } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function handleHook(kind, input, { generate, doseView }) {
  const [fam, ev] = String(kind).split("-");
  const source = SRC[fam];
  if (!source) return { status: 404, body: { error: `unknown hook ${kind}` } };
  const ok = (body) => ({ status: 200, body });
  const quiet = fam === "cursor" && ev === "prompt" ? { continue: true } : {};
  if (isOwn(input)) return ok(quiet);
  seen(source);
  if (readState().enabled === false) return ok(quiet);

  const post = (role, text, session, wait = false) => {
    if (!text || !String(text).trim()) return null;
    const turn = appendTurn({ role, text: String(text), session: session || null, source });
    const p = generate(turn);
    return wait ? p.then(() => turn) : turn;
  };

  if (ev === "prompt") {
    post("user", input.prompt, input.session_id || input.conversation_id);
    return ok(fam === "cursor" ? { continue: true } : fam === "zcode" ? {} : { suppressOutput: true });
  }
  if (fam === "cursor" && ev === "response") { post("agent", input.text, input.conversation_id); return ok({}); }
  if (ev === "stop") {
    if (input.stop_hook_active) return ok({});
    const reply = input.last_assistant_message || lastAssistantText(input.transcript_path);
    const sid = input.session_id;
    if (fam === "zcode") { post("agent", reply, sid); return ok({}); } // nothing to show inline; don't block
    await post("agent", reply, sid, true);
    let d = doseView(sid);
    for (let i = 0; i < 40 && d.you_said?.status === "pending"; i++) { await sleep(250); d = doseView(sid); }
    return ok({ systemMessage: renderDose(d, { color: false }) });
  }
  return { status: 404, body: { error: `unknown hook ${kind}` } };
}
