# Adapters

An adapter does one thing: hand each conversation turn to the core (`POST /turns`).
Display is separate: the status line (Claude Code and Cursor CLI share the same spec) polls `GET /dose/latest`.
The agent itself never knows echo exists.

Run `echo snippet claude-code` or `echo snippet cursor` to print user-level config with absolute paths.
The project-level copies in `.claude/settings.json` and `.cursor/hooks.json` make this repo itself a try-out room.

| Agent | Turn capture | Display |
| --- | --- | --- |
| Claude Code | hooks `UserPromptSubmit` (prompt) + `Stop` (last assistant text from `transcript_path`) | `statusLine` |
| Cursor (IDE / CLI) | hooks `beforeSubmitPrompt` (prompt) + `afterAgentResponse` (text) | CLI `statusLine` in `~/.cursor/cli-config.json` |
| Codex | not yet — planned: OpenAI-compatible proxy (`OPENAI_BASE_URL`) | terminal / Feishu |
| Agent Hub rooms | not yet — planned: message-pipeline tap; dose posted as a room/Feishu line | Feishu |
| Anything else | `POST http://127.0.0.1:4319/turns {"role":"user"|"agent","text":...}` | `GET /dose/latest` |
