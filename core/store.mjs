import fs from "node:fs";
import { PATHS, ensureHome, LIMITS } from "./config.mjs";

// Append-only JSONL store. Single user, local only. Good enough until the
// user model needs real queries; then swap for SQLite without touching adapters.

let cache = null;

function load() {
  if (cache) return cache;
  ensureHome();
  cache = [];
  if (fs.existsSync(PATHS.turns)) {
    for (const line of fs.readFileSync(PATHS.turns, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { cache.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    }
  }
  return cache;
}

export function appendTurn(turn) {
  const rec = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    ...turn,
    text: (turn.text || "").slice(0, LIMITS.storedTextChars),
    en: null,
    kind: null,
    status: "pending",
  };
  load().push(rec);
  fs.appendFileSync(PATHS.turns, JSON.stringify(rec) + "\n");
  return rec;
}

export function updateTurn(id, patch) {
  const all = load();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  // Rewrite whole file; fine at demo scale.
  fs.writeFileSync(PATHS.turns, all.map((t) => JSON.stringify(t)).join("\n") + "\n");
  return all[idx];
}

export function latest({ session, role } = {}) {
  const all = load();
  for (let i = all.length - 1; i >= 0; i--) {
    const t = all[i];
    if (session && t.session !== session) continue;
    if (role && t.role !== role) continue;
    return t;
  }
  return null;
}

export function turnsSince(date) {
  const cutoff = date.getTime();
  return load().filter((t) => new Date(t.ts).getTime() >= cutoff);
}

export function readState() {
  ensureHome();
  try { return JSON.parse(fs.readFileSync(PATHS.state, "utf8")); } catch { return { level: 0, enabled: true }; }
}

export function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(PATHS.state, JSON.stringify(next, null, 2));
  return next;
}
