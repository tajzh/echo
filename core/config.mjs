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
export const MODEL = {
  baseUrl: process.env.ECHO_MODEL_BASE_URL,
  apiKey: process.env.ECHO_MODEL_API_KEY,
  name: process.env.ECHO_MODEL_NAME || "qwen-flash",
  claudeModel: process.env.ECHO_CLAUDE_MODEL || "haiku",
};
