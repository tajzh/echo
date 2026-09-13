# Echo

在你和 coding agent 本来就在进行的对话里学英语。agent 不需要知道它存在。

Echo 是一个本地桌面程序（macOS / Windows / Linux）。打开它，选好你在用的 harness（Claude Code、Codex、ZCode、Cursor），点「接入」；之后你照常用中文和 agent 工作，每一轮 Echo 给你两行一眼能扫完的英文：

```
▸ You said: Can you check why this function leaks memory?
▸ In short:  Event listeners keep accumulating—call removeListener in the unmount lifecycle.
```

- **You said**：你刚说的话，英文怎么说。意思你已经知道，只是看"英文怎么说"，几乎不费力。
- **In short**：agent 这轮回复的一句话英文结论。
- 剂量上限固定（30 词 / 20 词），不随消息长度涨。正文永远是中文；不读这两行，工作一点不受影响。
- 强度只有一个开关：Lv 1 后你想试着用英文写，`You said` 变成 `Better:`（原生工程师会怎么说）。不逼、不提醒。
- 点英文里的任何一个词或句尾的 ★ 收藏；今天说过的话的英文版都在「回声」页里。

## 安装

从 [Releases](../../releases) 下载对应平台的包（`.dmg` / `.exe` / `.AppImage`），打开 Echo：

1. **Harness** 页：Echo 会检测本机装了哪些 harness。点「接入」，Echo 往该 harness 的用户级配置里写两条 hook；有的 harness 还差一步（Codex 要 `/hooks` 信任一次，ZCode 要新开 session），页面会告诉你。
2. **模型** 页：选一个给 Echo 做翻译和概括的便宜模型。已登录的 `pi`（如 GLM Coding Plan）、ZCode 自带 CLI、Claude Code、或任意 OpenAI 兼容端点 + key。「测试一次」看耗时和译文，再「保存并启用」。
3. **设置** 页：窗口置顶、登录时启动、系统通知。

Echo 收进托盘（菜单栏）后台工作；关掉 Echo，hook 就静默，agent 不受影响。所有数据只在本机 `~/.echo/`。

开发运行：

```bash
npm install
npm run icons     # 生成图标（一次）
npm start         # Electron 应用
npm run core      # 只跑 core（服务器 / 公网 demo 用）
npm run dist      # 打当前平台的包 → release/
```

## 工作原理

```
你 ──中文──▶ [Claude Code / Codex / ZCode / Cursor] ──中文回复──▶ 你
                     │ hook（curl）                      │ hook（curl）
                     ▼                                   ▼
              Echo（本机 127.0.0.1:4319，桌面程序内嵌）
              ├─ 两行英文：Echo 自己的小模型（不是主 agent）
              ├─ 展示：Echo 窗口（可置顶）/ 系统通知 / CLI 里的 Stop 消息与状态栏
              └─ 记录：~/.echo/（对话、译文、收藏、配置）
```

- **接入 = 写 hook**。hook 命令是一行 `curl`，把该轮的文本发给本机 Echo，等 Echo 回两行；harness 侧不需要装任何东西。Echo 不在时 curl 失败即退出，harness 无感。
- **英文由 Echo 自己的模型生成**，主 agent 的上下文一个字不多。这是它能接任何 harness 的原因。
- **模型走已登录的工具**（`pi -p`、`zcode --prompt`、`claude -p`）或直连 OpenAI 兼容端点；在 Echo 里可切换、可测试。Echo 自己的模型调用不会再触发 hook（core 侧按在途文本过滤）。

各 harness 能显示什么、有什么坑，见 [adapters/README.md](adapters/README.md)。

## CLI

桌面程序是产品；`bin/echo.mjs` 给服务器、脚本和终端用户：

```bash
node bin/echo.mjs setup                  # harness 状态；setup claude-code on|off 接入 / 移除
node bin/echo.mjs snippet cursor         # 打印会写入的 hook 配置
node bin/echo.mjs start | status | app   # 不用桌面程序时跑 core；app 在浏览器里打开同一套界面
node bin/echo.mjs dose "帮我看看这个函数为什么会内存泄漏"
node bin/echo.mjs today
```

## 目录

```
app/      Electron 壳：内嵌 core、托盘、窗口、开机自启
core/     本地服务：hook 协议、模型后端、harness 接入、存储、通知
web/      界面（app.html 桌面与浏览器共用；index.html 公网 demo）
bin/      CLI
deploy/   公网 demo 的 systemd / Caddy 配置
```

## 状态

`0.1.0`。做了：桌面程序（托盘、置顶、自启、通知）、Harness 一键接入/移除（4 家）、模型后端可配可测（4 种）、两行剂量、Lv 0/1、收藏、今日回顾、CI 三平台打包。

没做：安装包签名与公证（首次打开需在系统里允许）、词汇模型与间隔重复、多会话隔离（窗口显示全局最近一轮）、Gemini CLI 适配、ZCode CLI 后端的实机验证。
