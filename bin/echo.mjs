#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASE_URL, PATHS, ensureHome } from "../core/config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

const HELP = `echo — learn English from the conversations you already have with your agents

  echo start | stop | status        run the local core (127.0.0.1:4319)
  echo on | off                     enable / disable the dose
  echo level 0|1                    0: write Chinese, see "You said"   1: try English, see "Better"
  echo dose "<text>"                one-shot: what you just said, in English
  echo today                        today's digest
  echo demo                         scripted end-to-end turn
  echo snippet claude-code|codex|cursor   print user-level hook config
  echo hook <cc-prompt|cc-stop|codex-prompt|codex-stop|cursor-prompt|cursor-response>   (stdin JSON from the agent's hook)
  echo statusline                   (stdin JSON from the CLI status line)
`;

async function api(method, p, body) {
  const res = await fetch(BASE_URL + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function healthy() {
  try { const r = await fetch(BASE_URL + "/health"); return r.ok; } catch { return false; }
}

async function ensureServer() {
  if (await healthy()) return true;
  ensureHome();
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_ENTRYPOINT")) delete env[k];
  const out = fs.openSync(PATHS.log, "a");
  const child = spawn(process.execPath, [path.join(ROOT, "core/server.mjs")], { detached: true, stdio: ["ignore", out, out], env, cwd: ROOT });
  child.unref();
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); if (await healthy()) return true; }
  return false;
}

function readStdinJson() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => { try { resolve(s.trim() ? JSON.parse(s) : {}); } catch { resolve({}); } });
    if (process.stdin.isTTY) resolve({});
  });
}

// Claude Code transcript (JSONL): text of the assistant turn(s) since the last human message.
function lastAssistantText(transcriptPath) {
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
    if (e.type === "assistant" && Array.isArray(content)) {
      for (const c of content) if (c.type === "text" && c.text) texts.unshift(c.text);
    }
  }
  return texts.join("\n").trim();
}

const DIM = "\x1b[2m", CYAN = "\x1b[36m", GREEN = "\x1b[32m", YEL = "\x1b[33m", RESET = "\x1b[0m";

function renderDose(d, { color = true } = {}) {
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

async function main() {
  switch (cmd) {
    case undefined: case "help": case "-h": case "--help":
      process.stdout.write(HELP); return;

    case "start": {
      const ok = await ensureServer();
      const h = ok ? await api("GET", "/health") : null;
      console.log(ok ? `echo core running (pid ${h.pid}, backend ${h.backend}/${h.model})` : "failed to start; see " + PATHS.log);
      return;
    }
    case "stop": {
      try { process.kill(Number(fs.readFileSync(PATHS.pid, "utf8")), "SIGTERM"); console.log("stopped"); } catch { console.log("not running"); }
      return;
    }
    case "status": {
      if (!(await healthy())) { console.log("echo core: not running"); return; }
      const h = await api("GET", "/health"); const s = await api("GET", "/state");
      console.log(`echo core: running (pid ${h.pid}) backend=${h.backend}/${h.model} level=${s.level} enabled=${s.enabled !== false}`);
      console.log(renderDose(await api("GET", "/dose/latest")));
      return;
    }
    case "on": case "off":
      await ensureServer(); console.log(await api("POST", "/state", { enabled: cmd === "on" })); return;
    case "level":
      await ensureServer(); console.log(await api("POST", "/state", { level: Number(args[0] ?? 0) })); return;

    case "dose": {
      const text = args.join(" ").trim() || (await readStdinJson()).text;
      if (!text) { console.error("usage: echo dose \"<text>\""); process.exit(1); }
      await ensureServer();
      const r = await api("POST", "/turns?wait=1", { role: "user", text, source: "cli" });
      console.log(renderDose({ you_said: { text: r.turn.en, kind: r.turn.kind, status: r.turn.status } }));
      return;
    }

    case "today": {
      await ensureServer();
      const t = await api("GET", "/today");
      console.log(`${YEL}echo · ${t.date} · ${t.turns} turns${RESET}\n`);
      if (!t.you_said.length) { console.log(DIM + "nothing yet today" + RESET); return; }
      console.log(`${CYAN}Things you said today, in English:${RESET}`);
      for (const s of t.you_said) console.log(`  • ${s.en}\n    ${DIM}${s.zh.replace(/\s+/g, " ")}${RESET}`);
      if (t.in_short.length) { console.log(`\n${GREEN}What you heard back:${RESET}`); for (const s of t.in_short) console.log(`  • ${s}`); }
      return;
    }

    // ---- adapters: hooks ----
    case "hook": {
      const kind = args[0];
      if (process.env.ECHO_INTERNAL) { if (kind === "cursor-prompt") console.log('{"continue":true}'); return; } // never observe our own model calls
      const input = await readStdinJson();
      const ok = await ensureServer();
      if (!ok) { if (kind === "cursor-prompt") console.log('{"continue":true}'); return; }
      const post = (role, text, session, source, wait = false) => text && text.trim() && api("POST", `/turns${wait ? "?wait=1" : ""}`, { role, text, session, source });
      // Claude Code and Codex share the same hook wire format. The dose is shown *inside the harness*
      // as the Stop hook's systemMessage: visible to you, never sent to the model.
      if (kind === "cc-prompt" || kind === "codex-prompt") {
        await post("user", input.prompt, input.session_id, kind === "cc-prompt" ? "claude-code" : "codex");
        console.log('{"suppressOutput":true}'); return;
      }
      if (kind === "cc-stop" || kind === "codex-stop") {
        if (input.stop_hook_active) { console.log("{}"); return; }
        const reply = input.last_assistant_message || lastAssistantText(input.transcript_path);
        await post("agent", reply, input.session_id, kind === "cc-stop" ? "claude-code" : "codex", true);
        // You said was started at prompt time; by now it is normally done. Give it a moment if not.
        let d = await api("GET", `/dose/latest?session=${encodeURIComponent(input.session_id || "")}`);
        for (let i = 0; i < 40 && d.you_said?.status === "pending"; i++) { await new Promise((r) => setTimeout(r, 250)); d = await api("GET", `/dose/latest?session=${encodeURIComponent(input.session_id || "")}`); }
        const msg = renderDose(d, { color: false });
        console.log(JSON.stringify({ systemMessage: msg })); return;
      }
      if (kind === "cursor-prompt") { await post("user", input.prompt, input.conversation_id, "cursor"); console.log('{"continue":true}'); return; }
      if (kind === "cursor-response") { await post("agent", input.text, input.conversation_id, "cursor"); console.log("{}"); return; }
      console.error(`unknown hook kind ${kind}`); process.exit(1);
    }

    // ---- adapters: status line (Claude Code & Cursor CLI share the spec) ----
    case "statusline": {
      await readStdinJson(); // session-scoped view later; single user for now
      if (!(await healthy())) { process.stdout.write(DIM + "▸ echo: core not running (echo start)" + RESET); return; }
      const d = await api("GET", "/dose/latest");
      process.stdout.write(renderDose(d));
      return;
    }

    case "snippet": {
      const bin = path.join(ROOT, "bin/echo.mjs");
      if (args[0] === "claude-code") {
        console.log(`// merge into ~/.claude/settings.json`);
        console.log(JSON.stringify({
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: "command", command: `node ${bin} hook cc-prompt`, timeout: 10 }] }],
            Stop: [{ hooks: [{ type: "command", command: `node ${bin} hook cc-stop`, timeout: 10 }] }],
          },
          statusLine: { type: "command", command: `node ${bin} statusline` },
        }, null, 2));
      } else if (args[0] === "codex") {
        console.log(`// ~/.codex/hooks.json  (project-level .codex/hooks.json only loads once the project's .codex layer is trusted)`);
        console.log(JSON.stringify({ hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: `node ${bin} hook codex-prompt`, timeout: 10 }] }],
          Stop: [{ hooks: [{ type: "command", command: `node ${bin} hook codex-stop`, timeout: 60, statusMessage: "echo" }] }],
        } }, null, 2));
        console.log(`\n// then in codex run /hooks once to trust them`);
      } else if (args[0] === "cursor") {
        console.log(`// ~/.cursor/hooks.json`);
        console.log(JSON.stringify({ version: 1, hooks: {
          beforeSubmitPrompt: [{ command: `node ${bin} hook cursor-prompt`, timeout: 10 }],
          afterAgentResponse: [{ command: `node ${bin} hook cursor-response`, timeout: 10 }],
        } }, null, 2));
        console.log(`\n// merge into ~/.cursor/cli-config.json`);
        console.log(JSON.stringify({ statusLine: { type: "command", command: `node ${bin} statusline`, padding: 1 } }, null, 2));
      } else { console.error("usage: echo snippet claude-code|codex|cursor"); process.exit(1); }
      return;
    }

    case "demo": {
      await ensureServer();
      const zh = args.join(" ") || "把我发的话翻译成英文这个很好，但是正文用英文不太合理，太长了，至少前期我不可能静下心读的。";
      const reply = "同意，改。正文回到中文，英文的量控制在一眼扫完：每轮只在最前面加两行，一行是你刚说的话的英文版，一行是这轮回复的一句话英文结论。生词栏去掉，词的积累放到后台，只在日终摘要里出现。";
      console.log(`${DIM}you  →${RESET} ${zh}\n${DIM}agent→${RESET} ${reply.slice(0, 60)}…\n`);
      const t0 = Date.now();
      await Promise.all([
        api("POST", "/turns?wait=1", { role: "user", text: zh, source: "demo" }),
        api("POST", "/turns?wait=1", { role: "agent", text: reply, source: "demo" }),
      ]);
      console.log(renderDose(await api("GET", "/dose/latest")));
      console.log(`${DIM}(${Date.now() - t0} ms, generated by echo's own small model; the agent never saw echo)${RESET}`);
      return;
    }

    default:
      console.error(`unknown command ${cmd}\n`); process.stdout.write(HELP); process.exit(1);
  }
}

main().catch((e) => { console.error("echo:", e.message); process.exit(1); });
