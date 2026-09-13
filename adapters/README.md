# Adapters

echo lives inside the agent harness. It is not a separate app; the web page is only a remote demo surface.

Two things a harness must offer:

1. **Capture** each turn: a prompt-submit hook (your text) and a stop hook (the agent's final text). Claude Code, Codex, ZCode, Cursor and Gemini CLI all have these. Claude Code's JSON-on-stdin format is the de facto standard: Codex and ZCode reuse it (`prompt`, `last_assistant_message`, `session_id`).
2. **Show** two lines to you without touching the model's context. This is where harnesses differ, so display is a pluggable driver:
   - `systemMessage` from the Stop hook — CLI only (Claude Code CLI verified; Codex TUI).
   - `statusLine` — Claude Code CLI, Cursor CLI.
   - **OS toast** from the core — the fallback for every desktop app, since none of them currently render user-facing hook output. One toast per turn, after `In short` is ready. macOS `osascript`, Windows WinRT toast via PowerShell, Linux `notify-send`.

The agent itself never sees echo. The dose is produced by echo's own small model.

| Harness | Capture | Display | Config | Notes |
| --- | --- | --- | --- | --- |
| Claude Code CLI | `UserPromptSubmit` + `Stop` | `systemMessage` (verified) + `statusLine` + toast | `~/.claude/settings.json` | `echo snippet claude-code` |
| Claude Desktop | same hooks, same file | toast only — desktop drops `systemMessage`/block reasons ([#66555](https://github.com/anthropics/claude-code/issues/66555)) | same | |
| Codex CLI ≥0.124 | `UserPromptSubmit` + `Stop` | `systemMessage` in TUI + toast | `~/.codex/hooks.json` | trust once via `/hooks`; project-level needs trusted `.codex` layer. `echo snippet codex` |
| Codex Desktop | same file | toast | same | desktop hook dispatch reported flaky ([openai/codex#16430](https://github.com/openai/codex/issues/16430)) |
| ZCode (Z.ai) | `UserPromptSubmit` + `Stop` (`last_assistant_message`) | toast | `~/.zcode/cli/config.json` with `hooks.enabled: true` | user scope only; use `"command"` string form (an `args` field invalidates the whole file on some builds); new session after editing. `echo snippet zcode` |
| Cursor IDE / CLI | `beforeSubmitPrompt` + `afterAgentResponse` | CLI `statusLine`; IDE toast | `~/.cursor/hooks.json` | `echo snippet cursor` |
| Gemini CLI | `BeforeAgent` / `AfterAgent` | to check | | planned |
| Agent Hub rooms | message-pipeline tap | room / Feishu line | | planned |
| Anything with a base URL | OpenAI/Anthropic-compatible proxy | inject the two lines into the stream | | planned fallback |
| Anything else | `POST http://127.0.0.1:4319/turns {"role":"user"|"agent","text":...}` | `GET /dose/latest` | | |

Project-level copies in `.claude/settings.json` and `.cursor/hooks.json` make this repo itself a try-out room.
