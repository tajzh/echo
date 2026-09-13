# echo

在你和 agent 本来就在进行的对话里学英语。agent 不需要知道它存在。

## 它做什么

你照常用中文和任何 agent 工作。每一轮，echo 在旁边给你两行一眼能扫完的英文：

```
▸ You said: Can you check why this function leaks memory?
▸ In short:  Event listeners keep accumulating—call removeListener in the unmount lifecycle.
```

- **You said**：你刚说的话，英文怎么说。意思你已经知道，只是看"英文怎么说"，几乎不费力。
- **In short**：agent 这轮回复的一句话英文结论。
- 剂量上限固定（30 词 / 20 词），不随消息长度涨。正文永远是中文；不读这两行，工作一点不受影响。
- 旋钮只管一件事：`echo level 1` 后你想试着用英文写，`You said` 的位置变成 `Better:` 纠正版。不逼、不提醒。
- 后台默默记录；`echo today` 一分钟看完今天你说过的话的英文版。

## 架构

```
你 ──中文──▶ [任意 agent] ──中文回复──▶ 你
        │                    │
        └──── adapter ───────┘   把每轮 user/agent 文本 POST 给 core
                   │
              echo core（本机 127.0.0.1:4319）
              ├─ 剂量生成：echo 自己的小模型（不是主 agent）
              ├─ 记录：~/.echo/turns.jsonl（后续换 SQLite）
              ├─ 旋钮：level / on-off
              └─ 展示：status line / GET /dose/latest / 日终摘要
```

英文由 echo 自己的小模型生成，不依赖主 agent 配合——这是它"任何 agent 都能用"的原因。适配器只做一件事：把对话轮次喂给 core。见 [adapters/README.md](adapters/README.md)。

## 试一下（demo）

```bash
cd ~/projects/echo
node bin/echo.mjs demo                 # 一轮模拟对话，看两行英文
node bin/echo.mjs dose "帮我看看这个函数为什么会内存泄漏"
node bin/echo.mjs today

# 在本仓库里开 claude 或 cursor agent：项目级 hooks 已配好，每轮自动记录，
# Claude Code 的 status line 会显示最近一轮的两行英文。
claude
```

装到全局（任何目录里的 Claude Code / Cursor 都生效）：`node bin/echo.mjs snippet claude-code`、`node bin/echo.mjs snippet cursor`，按提示合并到用户配置。

## 后端

默认用 `claude -p --model haiku`（走你的订阅，约 5–9 秒，异步出现在状态栏）。有 OpenAI 兼容端点时设 `ECHO_MODEL_BASE_URL` / `ECHO_MODEL_API_KEY` / `ECHO_MODEL_NAME`，延迟到 1 秒内。

## 状态

`0.0.1-demo`。做了：core、CLI、Claude Code 与 Cursor 的 hooks 适配、status line 展示、0/1 档、日终摘要。没做：词汇模型与间隔重复、Codex 代理适配、hub/飞书适配、多会话隔离（当前状态栏显示全局最近一轮）、日终推送。
