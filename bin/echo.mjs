#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASE_URL, PATHS, ensureHome } from "../core/config.mjs";
import { renderDose } from "../core/hooks.mjs";
import { harnessStatus, setHarness, snippet } from "../core/setup.mjs";

// Echo CLI. The desktop app is the product; this is for servers, scripts and people who live in a terminal.
// Harness hooks do not go through here any more (they are plain curl against the core), but `echo hook`
// still works as a stdin→core forwarder for custom setups.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

const HELP = `echo — learn English from the conversations you already have with your agents

  echo start | stop | status        run the local core (127.0.0.1:4319) without the desktop app
  echo app                          open the app UI in a browser (the core serves it)
  echo setup                        show harness status;  echo setup <harness> on|off  to hook / unhook
  echo snippet <harness>            print the user-level hook config Echo would write
  echo on | off                     enable / disable the dose
  echo level 0|1                    0: write Chinese, see "You said"   1: try English, see "Better"
  echo notify on|off                OS toast per turn
  echo dose "<text>"                one-shot: what you just said, in English
  echo today                        today's digest
  echo demo                         scripted end-to-end turn
  echo hook <kind>                  forward a hook payload from stdin to the core (kind: cc-prompt, cc-stop, codex-*, zcode-*, cursor-prompt, cursor-response)
  echo statusline                   print the current dose for a CLI status bar

  harnesses: claude-code | codex | zcode | cursor
`;

async function api(method, p, body) {
  const res = await fetch(BASE_URL + p, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}
async function healthy() { try { const r = await fetch(BASE_URL + "/health"); return r.ok; } catch { return false; } }

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

function readStdin() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => resolve(s));
    if (process.stdin.isTTY) resolve("");
  });
}

const DIM = "\x1b[2m", CYAN = "\x1b[36m", GREEN = "\x1b[32m", YEL = "\x1b[33m", RESET = "\x1b[0m";

function openUrl(url) {
  const opener = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

async function main() {
  switch (cmd) {
    case undefined: case "help": case "-h": case "--help":
      process.stdout.write(HELP); return;

    case "start": {
      const ok = await ensureServer();
      const h = ok ? await api("GET", "/health") : null;
      console.log(ok ? `echo core running (pid ${h.pid}, model ${h.model})` : "failed to start; see " + PATHS.log);
      return;
    }
    case "stop": {
      try { process.kill(Number(fs.readFileSync(PATHS.pid, "utf8")), "SIGTERM"); console.log("stopped"); } catch { console.log("not running"); }
      return;
    }
    case "status": {
      if (!(await healthy())) { console.log("echo core: not running"); return; }
      const h = await api("GET", "/health"); const s = await api("GET", "/state");
      console.log(`echo core: running (pid ${h.pid}) model=${h.model} level=${s.level} enabled=${s.enabled !== false}`);
      console.log(renderDose(await api("GET", "/dose/latest")));
      return;
    }
    case "app": case "card": {
      await ensureServer(); openUrl(BASE_URL + "/app"); console.log(`app: ${BASE_URL}/app`); return;
    }
    case "on": case "off":
      await ensureServer(); console.log(await api("POST", "/state", { enabled: cmd === "on" })); return;
    case "level":
      await ensureServer(); console.log(await api("POST", "/state", { level: Number(args[0] ?? 0) })); return;
    case "notify":
      await ensureServer(); console.log(await api("POST", "/state", { notify: args[0] !== "off" })); return;

    case "setup": {
      if (args[0]) { const r = setHarness(args[0], args[1] !== "off"); console.log(`${r.label}: ${r.enabled ? "hooked" : "unhooked"}  (${r.file})`); if (r.enabled) console.log(DIM + r.after + RESET); return; }
      for (const h of harnessStatus()) console.log(`${h.enabled ? GREEN + "●" : h.present ? YEL + "○" : DIM + "·"}${RESET} ${h.label.padEnd(12)} ${h.enabled ? "hooked" : h.present ? "detected, not hooked" : "not detected"}   ${DIM}${h.file}${RESET}`);
      return;
    }
    case "snippet": {
      try { console.log(JSON.stringify(snippet(args[0]), null, 2)); } catch (e) { console.error(e.message); process.exit(1); }
      return;
    }

    case "dose": {
      const text = args.join(" ").trim() || (await readStdin()).trim();
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

    // Forwarders — equivalent to the curl commands Echo installs, for setups that prefer a node entry point.
    case "hook": {
      const body = await readStdin();
      if (!(await healthy())) { if (args[0] === "cursor-prompt") console.log('{"continue":true}'); return; }
      const res = await fetch(`${BASE_URL}/hook/${args[0]}`, { method: "POST", body, headers: { "content-type": "application/json" } });
      process.stdout.write(await res.text()); return;
    }
    case "statusline": {
      await readStdin();
      if (!(await healthy())) { process.stdout.write(DIM + "▸ echo: not running" + RESET); return; }
      process.stdout.write(await (await fetch(BASE_URL + "/statusline")).text()); return;
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
