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
  emitChange({ type: "turn", turn: rec });
  return rec;
}

export function updateTurn(id, patch) {
  const all = load();
  const idx = all.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  // Rewrite whole file; fine at demo scale.
  fs.writeFileSync(PATHS.turns, all.map((t) => JSON.stringify(t)).join("\n") + "\n");
  emitChange({ type: "turn", turn: all[idx] });
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

// ---- favorites: words / sentences you starred from the card, with the sentence they came from ----
const FAV_PATH = PATHS.favorites;

export function readFavorites() {
  ensureHome();
  try { return JSON.parse(fs.readFileSync(FAV_PATH, "utf8")); } catch { return []; }
}

export function toggleFavorite({ kind, text, context }) {
  const all = readFavorites();
  const key = (kind === "word" ? text.toLowerCase() : text).trim();
  const idx = all.findIndex((f) => f.kind === kind && f.key === key);
  let on;
  if (idx >= 0) { all.splice(idx, 1); on = false; }
  else { all.unshift({ kind, key, text: text.trim(), context: (context || "").trim(), ts: new Date().toISOString() }); on = true; }
  fs.writeFileSync(FAV_PATH, JSON.stringify(all, null, 2));
  return { on, favorites: all };
}

// ---- live updates ----
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitChange(evt) { for (const fn of listeners) { try { fn(evt); } catch {} } }

export function readState() {
  ensureHome();
  try { return JSON.parse(fs.readFileSync(PATHS.state, "utf8")); } catch { return { level: 0, enabled: true }; }
}

export function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.writeFileSync(PATHS.state, JSON.stringify(next, null, 2));
  return next;
}
