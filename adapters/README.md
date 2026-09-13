# Harness adapters

Echo hooks into the harness you already use. "接入" in the app writes two hook entries into that harness's user-level config; each entry is a single `curl` against the local core (`127.0.0.1:4319/hook/<kind>`), so the harness needs nothing installed besides Echo. If Echo is not running, curl fails and `|| exit 0` keeps the harness quiet.

Two things a harness must offer:

1. **Capture** each turn: a prompt-submit hook (your text) and a stop hook (the agent's final text). Claude Code's JSON-on-stdin format is the de facto standard; Codex and ZCode reuse it (`prompt`, `last_assistant_message`, `session_id`).
2. **Show** two lines to you without touching the model's context. This is where harnesses differ:
   - `systemMessage` from the Stop hook — CLI only (Claude Code CLI verified; Codex TUI).
   - `statusLine` — Claude Code CLI, Cursor CLI (`GET /statusline`).
   - **The Echo window** (always-on-top if you want) and **OS notifications** — the fallback for every desktop app, since none of them currently render user-facing hook output.

The agent itself never sees Echo. The dose is produced by Echo's own small model; Echo's own CLI-based model calls are recognised core-side (in-flight text match) so they never loop back.

| Harness | Capture | Inline display | Config written | After 接入 |
| --- | --- | --- | --- | --- |
| Claude Code CLI | `UserPromptSubmit` + `Stop` | `systemMessage` (verified) + `statusLine` | `~/.claude/settings.json` | nothing |
| Claude Desktop | same hooks, same file | none — desktop drops `systemMessage` ([#66555](https://github.com/anthropics/claude-code/issues/66555)); use the Echo window / notification | same | nothing |
| Codex CLI ≥0.124 | `UserPromptSubmit` + `Stop` | `systemMessage` in TUI | `~/.codex/hooks.json` | run `/hooks` once to trust |
| Codex Desktop | same file | none; Echo window / notification | same | desktop hook dispatch reported flaky ([openai/codex#16430](https://github.com/openai/codex/issues/16430)) |
| ZCode (Z.ai) | `UserPromptSubmit` + `Stop` (`last_assistant_message`) | none; Echo window / notification | `~/.zcode/cli/config.json` (`hooks.enabled: true`) | start a new session. User scope only; `"command"` string form (an `args` field invalidates the file on some builds) |
| Cursor IDE / CLI | `beforeSubmitPrompt` + `afterAgentResponse` | CLI `statusLine` (`~/.cursor/cli-config.json`); IDE none | `~/.cursor/hooks.json` | nothing |
| Gemini CLI | `BeforeAgent` / `AfterAgent` | to check | | planned |
| Anything else | `POST http://127.0.0.1:4319/turns {"role":"user"|"agent","text":...}` | `GET /dose/latest` | | |

`node bin/echo.mjs snippet <harness>` prints exactly what 接入 writes. Every write leaves a one-time `<file>.echo-bak` next to the original; 移除 deletes only Echo's own entries.

## Hook wire

```
POST /hook/cc-prompt        {session_id, prompt}                       → {"suppressOutput":true}
POST /hook/cc-stop          {session_id, last_assistant_message|transcript_path, stop_hook_active} → {"systemMessage":"▸ You said: …\n▸ In short: …"}
POST /hook/codex-prompt|codex-stop      same as cc-*
POST /hook/zcode-prompt|zcode-stop      same payload; always → {}
POST /hook/cursor-prompt    {conversation_id, prompt}                  → {"continue":true}
POST /hook/cursor-response  {conversation_id, text}                    → {}
GET  /statusline                                                        → ANSI text
```
