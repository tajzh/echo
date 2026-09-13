import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const HOME = process.env.ECHO_HOME || path.join(os.homedir(), ".echo");
export const PORT = Number(process.env.ECHO_PORT || 4319);
export const HOST = "127.0.0.1";
export const BASE_URL = `http://${HOST}:${PORT}`;

export const PATHS = {
  home: HOME,
  turns: path.join(HOME, "turns.jsonl"),
  state: path.join(HOME, "state.json"),
  favorites: path.join(HOME, "favorites.json"),
  pid: path.join(HOME, "server.pid"),
  log: path.join(HOME, "server.log"),
};

export function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true });
}

// Dose limits: the whole point is "one glance". Keep these small.
export const LIMITS = {
  youSaidWords: 30,
  inShortWords: 20,
  storedTextChars: 4000,
};

// Translation backend.
//   claude-cli : `claude -p --model haiku` (default; uses your subscription, ~5s)
//   openai     : any OpenAI-compatible endpoint (ECHO_MODEL_BASE_URL / _API_KEY / _NAME)
export const BACKEND = process.env.ECHO_BACKEND || (process.env.ECHO_MODEL_BASE_URL ? "openai" : "claude-cli");
// Cheapest model, thinking off: this is a two-sentence translation, not reasoning.
// ECHO_MODEL_EXTRA merges extra JSON into the request body (e.g. '{"thinking":{"type":"disabled"}}' for GLM,
// '{"enable_thinking":false}' for Qwen, '{"reasoning_effort":"minimal"}' for OpenAI gpt-5 family).
function guessExtra(baseUrl = "") {
  if (/bigmodel\.cn|z\.ai/.test(baseUrl)) return { thinking: { type: "disabled" } };
  if (/dashscope|aliyuncs/.test(baseUrl)) return { enable_thinking: false };
  if (/api\.openai\.com/.test(baseUrl)) return { reasoning_effort: "minimal" };
  return {};
}
export const MODEL = {
  baseUrl: process.env.ECHO_MODEL_BASE_URL,
  apiKey: process.env.ECHO_MODEL_API_KEY,
  name: process.env.ECHO_MODEL_NAME || "glm-4.5-flash",
  extra: process.env.ECHO_MODEL_EXTRA ? JSON.parse(process.env.ECHO_MODEL_EXTRA) : guessExtra(process.env.ECHO_MODEL_BASE_URL),
  claudeModel: process.env.ECHO_CLAUDE_MODEL || "haiku",
};
