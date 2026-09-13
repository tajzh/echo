import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PATHS, ensureHome } from "./config.mjs";

// User-facing setup: which harnesses echo is hooked into, and which model runs the dose.
// All edits go to the user's own config files, with a one-time backup next to each file.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin/echo.mjs");
const NODE = process.execPath;
const H = os.homedir();
const MARK = /echo\.mjs\\?"? hook /; // every hook command we write matches this (quoted path, JSON-escaped or not)

function onPath(cmd) { try { execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/sh" }); return true; } catch { return false; } }
function readJson(p, fallback = {}) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } }
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (fs.existsSync(p) && !fs.existsSync(p + ".echo-bak")) fs.copyFileSync(p, p + ".echo-bak");
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}
const ours = (entry) => MARK.test(JSON.stringify(entry));
const without = (arr) => (Array.isArray(arr) ? arr.filter((e) => !ours(e)) : []);

// Claude Code / Codex share the {hooks:[{type,command,timeout}]} group shape.
const group = (cmd, timeout, extra = {}) => ({ hooks: [{ type: "command", command: cmd, timeout, ...extra }] });

export const HARNESSES = {
  "claude-code": {
    label: "Claude Code（CLI 与桌面版）", file: path.join(H, ".claude/settings.json"),
    present: () => onPath("claude") || fs.existsSync(path.join(H, ".claude")),
    display: "CLI：Stop 消息 + 状态栏；桌面版：卡片/通知",
    note: "桌面版目前不渲染 hook 消息，靠卡片或系统通知。",
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.hooks ||= {};
      cfg.hooks.UserPromptSubmit = without(cfg.hooks.UserPromptSubmit); cfg.hooks.Stop = without(cfg.hooks.Stop);
      if (on) {
        cfg.hooks.UserPromptSubmit.push(group(`"${NODE}" "${BIN}" hook cc-prompt`, 10));
        cfg.hooks.Stop.push(group(`"${NODE}" "${BIN}" hook cc-stop`, 60));
        if (!cfg.statusLine) cfg.statusLine = { type: "command", command: `"${NODE}" "${BIN}" statusline` };
      } else if (cfg.statusLine && JSON.stringify(cfg.statusLine).includes("echo.mjs")) delete cfg.statusLine;
      for (const k of ["UserPromptSubmit", "Stop"]) if (!cfg.hooks[k].length) delete cfg.hooks[k];
      if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
      writeJson(p, cfg);
    },
  },
  codex: {
    label: "Codex（CLI 与桌面版）", file: path.join(H, ".codex/hooks.json"),
    present: () => onPath("codex") || fs.existsSync(path.join(H, ".codex")),
    display: "TUI：Stop 消息；桌面版：卡片/通知",
    note: "首次要在 codex 里输入 /hooks 信任一次。桌面版 hook 派发有不稳定报告。",
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.hooks ||= {};
      cfg.hooks.UserPromptSubmit = without(cfg.hooks.UserPromptSubmit); cfg.hooks.Stop = without(cfg.hooks.Stop);
      if (on) {
        cfg.hooks.UserPromptSubmit.push(group(`"${NODE}" "${BIN}" hook codex-prompt`, 10));
        cfg.hooks.Stop.push(group(`"${NODE}" "${BIN}" hook codex-stop`, 60, { statusMessage: "echo" }));
      }
      for (const k of ["UserPromptSubmit", "Stop"]) if (!cfg.hooks[k].length) delete cfg.hooks[k];
      writeJson(p, cfg);
    },
  },
  zcode: {
    label: "ZCode（智谱桌面版）", file: path.join(H, ".zcode/cli/config.json"),
    present: () => onPath("zcode") || fs.existsSync(path.join(H, ".zcode")),
    display: "卡片/通知",
    note: "只认用户级配置；改完要新开一个 session。",
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.hooks ||= {}; cfg.hooks.events ||= {};
      const ev = cfg.hooks.events;
      ev.UserPromptSubmit = without(ev.UserPromptSubmit); ev.Stop = without(ev.Stop);
      if (on) {
        cfg.hooks.enabled = true;
        ev.UserPromptSubmit.push({ hooks: [{ type: "command", command: `"${NODE}" "${BIN}" hook zcode-prompt`, timeoutMs: 10000 }] });
        ev.Stop.push({ hooks: [{ type: "command", command: `"${NODE}" "${BIN}" hook zcode-stop`, timeoutMs: 10000 }] });
      }
      for (const k of ["UserPromptSubmit", "Stop"]) if (!ev[k].length) delete ev[k];
      writeJson(p, cfg);
    },
  },
  cursor: {
    label: "Cursor（IDE 与 CLI）", file: path.join(H, ".cursor/hooks.json"),
    present: () => onPath("cursor-agent") || onPath("agent") || onPath("cursor") || fs.existsSync(path.join(H, ".cursor")),
    display: "CLI：状态栏（需另配 cli-config.json）；IDE：卡片/通知",
    note: "",
    apply(on) {
      const p = this.file, cfg = readJson(p); cfg.version ||= 1; cfg.hooks ||= {};
      cfg.hooks.beforeSubmitPrompt = without(cfg.hooks.beforeSubmitPrompt); cfg.hooks.afterAgentResponse = without(cfg.hooks.afterAgentResponse);
      if (on) {
        cfg.hooks.beforeSubmitPrompt.push({ command: `"${NODE}" "${BIN}" hook cursor-prompt`, timeout: 10 });
        cfg.hooks.afterAgentResponse.push({ command: `"${NODE}" "${BIN}" hook cursor-response`, timeout: 10 });
      }
      for (const k of ["beforeSubmitPrompt", "afterAgentResponse"]) if (!cfg.hooks[k].length) delete cfg.hooks[k];
      writeJson(p, cfg);
    },
  },
};

export function harnessStatus() {
  return Object.entries(HARNESSES).map(([id, h]) => {
    const raw = fs.existsSync(h.file) ? fs.readFileSync(h.file, "utf8") : "";
    return { id, label: h.label, file: h.file, present: h.present(), enabled: MARK.test(raw), display: h.display, note: h.note };
  });
}

export function setHarness(id, on) {
  const h = HARNESSES[id]; if (!h) throw new Error(`unknown harness ${id}`);
  h.apply(Boolean(on));
  return harnessStatus().find((x) => x.id === id);
}

// ---- backend (model) config ----
export const BACKEND_TYPES = {
  "pi-cli": { label: "pi（用 pi 里已登录的模型，如 GLM Coding Plan）", present: () => onPath("pi"), fields: ["model"], defaults: { model: "zai-coding-cn/glm-5.3-flash" } },
  "zcode-cli": { label: "ZCode 自带 CLI（走 ZCode 的额度）", present: () => onPath("zcode"), fields: ["model"], defaults: { model: "" }, note: "ZCode 未公开文档的无头模式，社区验证可用；未在本机测试。" },
  "claude-cli": { label: "Claude Code（claude -p，走你的订阅）", present: () => onPath("claude"), fields: ["model"], defaults: { model: "haiku" } },
  openai: { label: "OpenAI 兼容端点（按量 key）", present: () => true, fields: ["baseUrl", "apiKey", "name", "extra"], defaults: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", name: "glm-4.5-flash", extra: "" } },
};

export function readConfig() { ensureHome(); return readJson(PATHS.config, {}); }
export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.writeFileSync(PATHS.config, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return next;
}
export function maskBackend(b) { return b && b.apiKey ? { ...b, apiKey: b.apiKey.slice(0, 4) + "…" + b.apiKey.slice(-4) } : b; }
export function backendOptions() {
  return Object.entries(BACKEND_TYPES).map(([id, t]) => ({ id, label: t.label, present: t.present(), fields: t.fields, defaults: t.defaults, note: t.note || "" }));
}
