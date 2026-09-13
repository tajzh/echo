# Adapters

echo lives inside the agent harness. It is not a separate app; the web page is only a remote demo surface.

Two things a harness must offer, and most do:

1. **Capture** each turn: a prompt-submit hook (your text) and a stop hook (the agent's final text). Claude Code, Codex, Cursor and Gemini CLI all have these, with near-identical JSON on stdin.
2. **Show** two lines to you without touching the model's context. Claude Code and Codex hooks can return `systemMessage`, which the harness shows to the user and never sends to the model. Claude Code and Cursor CLI additionally have a `statusLine`.

The agent itself never sees echo. The dose is produced by echo's own small model.

| Harness | Capture | In-harness display | Status |
| --- | --- | --- | --- |
| Claude Code | `UserPromptSubmit` + `Stop` (`last_assistant_message`) | `Stop` → `systemMessage` (verified: arrives as an informational message), plus `statusLine` | done |
| Codex CLI (≥0.124) | `UserPromptSubmit` + `Stop` (`last_assistant_message`) | `Stop` → `systemMessage` (warning line in the TUI; `codex exec` does not print it) | done; user-level `~/.codex/hooks.json`, trust once via `/hooks` |
| Cursor IDE / CLI | `beforeSubmitPrompt` + `afterAgentResponse` | CLI: `statusLine`. IDE: no user-visible hook output yet | capture done |
| Gemini CLI | `BeforeAgent` / `AfterAgent` hooks | to check | planned |
| Agent Hub rooms | message-pipeline tap | room / Feishu line | planned |
| Anything with a base URL (fallback) | OpenAI/Anthropic-compatible proxy | inject the two lines into the stream | planned |
| Anything else | `POST http://127.0.0.1:4319/turns {"role":"user"|"agent","text":...}` | `GET /dose/latest` | — |

`echo snippet claude-code|codex|cursor` prints user-level config with absolute paths.
Project-level copies in `.claude/settings.json` and `.cursor/hooks.json` make this repo itself a try-out room.
