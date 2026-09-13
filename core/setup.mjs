import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { PATHS, ensureHome, BASE_URL } from "./config.mjs";

// User-facing setup: which harnesses Echo is hooked into, and which model runs the dose.
// All edits go to the user's own config files, with a one-time backup next to each file.
//
// Hook commands are plain curl against the local core, so a harness needs nothing but Echo
// running. If Echo is closed, curl fails and `|| exit 0` keeps the harness quiet.

const H = os.homedir();
const MARK = /127\.0\.0\.1:\d+\/(hook\/|statusline)|echo\.mjs\\?"? (hook|statusline)/; // every command we write (or used to write) matches this

const hook = (kind, timeoutSec) => `curl -sf -m ${timeoutSec} -X POST ${BASE_URL}/hook/${kind} --data-binary @- || exit 0`;
const STATUSLINE = `curl -sf -m 3 ${BASE_URL}/statusline || exit 0`;

function onPath(cmd) {
  try { execSync(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`, { stdio: "ignore", shell: true }); return true; } catch { return false; }
}
function readJson(p, fallback = {}) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } }
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p) && !fs.existsSync(p + ".echo-bak")) fs.copyFileSync(p, p + ".echo-bak");
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}
const ours = (entry) => MARK.test(JSON.stringify(entry));
const without = (arr) => (Array.isArray(arr) ? arr.filter((e) => !ours(e)) : []);
const prune = (obj, keys) => { for (const k of keys) if (Array.isArray(obj[k]) && !obj[k].length) delete obj[k]; };

// Claude Code / Codex share the {hooks:[{type,command,timeout}]} group shape.
const group = (cmd, timeout, extra = {}) => ({ hooks: [{ type: "command", command: cmd, timeout, ...extra }] });

export const HARNESSES = {
  "claude-code": {
    label: "Claude Code", sub: "CLI 与桌面版", file: path.join(H, ".claude/settings.json"),
    present: () => onPath("claude") || fs.existsSync(path.join(H, ".claude")),
    display: "CLI：每轮在对话里显示两行 + 状态栏；桌面版：看 Echo 窗口 / 通知",
    after: "无需其他操作，下一轮对话生效。",
    snippet: () => ({
      hooks: { UserPromptSubmit: [group(hook("cc-prompt", 10), 10)], Stop: [group(hook("cc-stop", 60), 60)] },
      statusLine: { type: "command", command: STATUSLINE },
    }),
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.hooks ||= {};
      cfg.hooks.UserPromptSubmit = without(cfg.hooks.UserPromptSubmit); cfg.hooks.Stop = without(cfg.hooks.Stop);
      if (on) {
        const s = this.snippet();
        cfg.hooks.UserPromptSubmit.push(...s.hooks.UserPromptSubmit); cfg.hooks.Stop.push(...s.hooks.Stop);
        if (!cfg.statusLine) cfg.statusLine = s.statusLine;
      } else if (cfg.statusLine && ours(cfg.statusLine)) delete cfg.statusLine;
      prune(cfg.hooks, ["UserPromptSubmit", "Stop"]); if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
      writeJson(p, cfg);
    },
  },
  codex: {
    label: "Codex", sub: "CLI 与桌面版", file: path.join(H, ".codex/hooks.json"),
    present: () => onPath("codex") || fs.existsSync(path.join(H, ".codex")),
    display: "TUI：每轮在对话里显示两行；桌面版：看 Echo 窗口 / 通知",
    after: "在 codex 里输入一次 /hooks 信任这些 hook。",
    snippet: () => ({ hooks: { UserPromptSubmit: [group(hook("codex-prompt", 10), 10)], Stop: [group(hook("codex-stop", 60), 60, { statusMessage: "echo" })] } }),
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.hooks ||= {};
      cfg.hooks.UserPromptSubmit = without(cfg.hooks.UserPromptSubmit); cfg.hooks.Stop = without(cfg.hooks.Stop);
      if (on) { const s = this.snippet(); cfg.hooks.UserPromptSubmit.push(...s.hooks.UserPromptSubmit); cfg.hooks.Stop.push(...s.hooks.Stop); }
      prune(cfg.hooks, ["UserPromptSubmit", "Stop"]);
      writeJson(p, cfg);
    },
  },
  zcode: {
    label: "ZCode", sub: "智谱桌面版", file: path.join(H, ".zcode/cli/config.json"),
    present: () => onPath("zcode") || fs.existsSync(path.join(H, ".zcode")),
    display: "看 Echo 窗口 / 通知（ZCode 的 hook 没有面向用户的输出）",
    after: "新开一个 ZCode session（hook 在 session 开始时读取）。",
    snippet: () => ({ hooks: { enabled: true, events: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: hook("zcode-prompt", 10), timeoutMs: 10000 }] }],
      Stop: [{ hooks: [{ type: "command", command: hook("zcode-stop", 10), timeoutMs: 10000 }] }],
    } } }),
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.hooks ||= {}; cfg.hooks.events ||= {};
      const ev = cfg.hooks.events;
      ev.UserPromptSubmit = without(ev.UserPromptSubmit); ev.Stop = without(ev.Stop);
      if (on) { const s = this.snippet().hooks.events; cfg.hooks.enabled = true; ev.UserPromptSubmit.push(...s.UserPromptSubmit); ev.Stop.push(...s.Stop); }
      prune(ev, ["UserPromptSubmit", "Stop"]);
      writeJson(p, cfg);
    },
  },
  cursor: {
    label: "Cursor", sub: "IDE 与 CLI", file: path.join(H, ".cursor/hooks.json"),
    present: () => onPath("cursor-agent") || onPath("agent") || onPath("cursor") || fs.existsSync(path.join(H, ".cursor")),
    display: "CLI：状态栏；IDE：看 Echo 窗口 / 通知",
    after: "无需其他操作。",
    snippet: () => ({ version: 1, hooks: {
      beforeSubmitPrompt: [{ command: hook("cursor-prompt", 10), timeout: 10 }],
      afterAgentResponse: [{ command: hook("cursor-response", 10), timeout: 10 }],
    } }),
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.version ||= 1; cfg.hooks ||= {};
      cfg.hooks.beforeSubmitPrompt = without(cfg.hooks.beforeSubmitPrompt); cfg.hooks.afterAgentResponse = without(cfg.hooks.afterAgentResponse);
      if (on) { const s = this.snippet().hooks; cfg.hooks.beforeSubmitPrompt.push(...s.beforeSubmitPrompt); cfg.hooks.afterAgentResponse.push(...s.afterAgentResponse); }
      prune(cfg.hooks, ["beforeSubmitPrompt", "afterAgentResponse"]);
      writeJson(p, cfg);
      // Cursor CLI status line lives in a separate file.
      const cli = path.join(H, ".cursor/cli-config.json");
      if (fs.existsSync(cli) || on) {
        const c = readJson(cli);
        if (on) { if (!c.statusLine) c.statusLine = { type: "command", command: STATUSLINE, padding: 1 }; }
        else if (c.statusLine && ours(c.statusLine)) delete c.statusLine;
        if (on || fs.existsSync(cli)) writeJson(cli, c);
      }
    },
  },
};

export function harnessStatus() {
  return Object.entries(HARNESSES).map(([id, h]) => {
    const raw = fs.existsSync(h.file) ? fs.readFileSync(h.file, "utf8") : "";
    return { id, label: h.label, sub: h.sub, file: h.file, present: h.present(), enabled: MARK.test(raw), display: h.display, after: h.after };
  });
}

export function setHarness(id, on) {
  const h = HARNESSES[id]; if (!h) throw new Error(`unknown harness ${id}`);
  h.apply(Boolean(on));
  return harnessStatus().find((x) => x.id === id);
}

export function snippet(id) { const h = HARNESSES[id]; if (!h) throw new Error(`unknown harness ${id}`); return h.snippet(); }

// ---- backend (model) config ----
export const BACKEND_TYPES = {
  "pi-cli": { label: "pi", sub: "用 pi 里已登录的模型，例如 GLM Coding Plan", present: () => onPath("pi"), fields: ["model"], defaults: { model: "zai-coding-cn/glm-5.3-flash" } },
  "zcode-cli": { label: "ZCode 自带 CLI", sub: "走 ZCode 桌面版的登录与额度", present: () => onPath("zcode"), fields: ["model"], defaults: { model: "" }, note: "ZCode 未公开文档的无头模式，社区验证可用。" },
  "claude-cli": { label: "Claude Code", sub: "claude -p，走你的 Claude 订阅", present: () => onPath("claude"), fields: ["model"], defaults: { model: "haiku" } },
  openai: { label: "OpenAI 兼容端点", sub: "任意按量 API key", present: () => true, fields: ["baseUrl", "apiKey", "name", "extra"], defaults: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", name: "glm-4.5-flash", extra: "" } },
};

export function readConfig() { ensureHome(); return readJson(PATHS.config, {}); }
export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(PATHS.config, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}
export function maskBackend(b) { return b && b.apiKey ? { ...b, apiKey: b.apiKey.slice(0, 4) + "…" + b.apiKey.slice(-4) } : b; }
export function backendOptions() {
  return Object.entries(BACKEND_TYPES).map(([id, t]) => ({ id, label: t.label, sub: t.sub, present: t.present(), fields: t.fields, defaults: t.defaults, note: t.note || "" }));
}
