// Publish release/ artifacts as a static download page.
//   node deploy/publish-downloads.mjs [outDir=/srv/echo-download] [baseUrl=https://hub.sz-ruihua.cn/echo-download]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const [outDir = "/srv/echo-download", baseUrl = "https://hub.sz-ruihua.cn/echo-download"] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const REL = path.join(ROOT, "release");

const TARGETS = [
  { id: "mac-arm64", os: "macOS", sub: "Apple Silicon（M1 及以后）", match: /mac-arm64\.(dmg|zip)$/, primary: true },
  { id: "mac-x64", os: "macOS", sub: "Intel", match: /mac-x64\.(dmg|zip)$/ },
  { id: "win-x64", os: "Windows", sub: "10 / 11，64 位", match: /win-x64\.(exe|zip)$/ },
  { id: "linux-x64", os: "Linux", sub: "AppImage，x86_64", match: /linux-x86_64\.AppImage$/ },
];

fs.mkdirSync(outDir, { recursive: true });
const files = fs.readdirSync(REL).filter((f) => /\.(zip|exe|AppImage|dmg)$/.test(f));
const mb = (n) => (n / 1048576).toFixed(0) + " MB";
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const rows = [];
for (const t of TARGETS) {
  const f = files.filter((x) => t.match.test(x)).sort((a, b) => /\.(dmg|exe)$/.test(b) - /\.(dmg|exe)$/.test(a))[0]; // installers first
  if (!f) { rows.push({ ...t, missing: true }); continue; }
  const src = path.join(REL, f), dst = path.join(outDir, f);
  fs.copyFileSync(src, dst);
  rows.push({ ...t, file: f, size: mb(fs.statSync(src).size), sha: sha(src) });
}
fs.writeFileSync(path.join(outDir, "SHA256SUMS.txt"), rows.filter((r) => !r.missing).map((r) => `${r.sha}  ${r.file}`).join("\n") + "\n");
const built = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

const card = (r) => r.missing
  ? `<div class="card off"><div class="os">${esc(r.os)}</div><div class="sub">${esc(r.sub)}</div><div class="na">这一平台的包还没打，需要在对应系统或 CI 上构建。</div></div>`
  : `<div class="card ${r.primary ? "pri" : ""}"><div class="os">${esc(r.os)}</div><div class="sub">${esc(r.sub)}</div>
      <a class="dl" href="${esc(r.file)}" download>下载 <span>${esc(r.size)}</span></a>
      <div class="meta">${esc(r.file)}<br><code title="SHA-256">${r.sha.slice(0, 16)}…</code></div></div>`;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Echo · 下载</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262a33; --fg:#e6e6e6; --dim:#8a8f9a; --cyan:#5ed3f3; --green:#7ddc8a; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,"PingFang SC","Noto Sans CJK SC",system-ui,sans-serif; }
  .wrap { max-width:860px; margin:0 auto; padding:40px 20px 60px; }
  .hero { display:flex; gap:18px; align-items:center; margin-bottom:8px; } .hero img { width:64px; height:64px; border-radius:16px; }
  h1 { margin:0; font-size:28px; } .tag { color:var(--dim); font-size:13px; }
  p.lead { color:#c7cbd3; font-size:16px; margin:14px 0 26px; }
  pre.demo { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin:0 0 30px; font-size:14px; overflow:auto; }
  pre.demo .y { color:var(--cyan); } pre.demo .g { color:var(--green); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; display:flex; flex-direction:column; gap:6px; }
  .card.pri { border-color:#2e6b7e; } .card.off { opacity:.55; }
  .os { font-weight:700; font-size:17px; } .sub { color:var(--dim); font-size:13px; }
  .dl { margin-top:8px; display:inline-block; background:#1f4b5a; border:1px solid #2e6b7e; color:#dff6ff; text-decoration:none; padding:8px 12px; border-radius:9px; text-align:center; font-weight:600; }
  .dl span { color:var(--cyan); font-weight:400; font-size:12px; margin-left:6px; } .dl:hover { background:#25596b; }
  .meta { color:var(--dim); font-size:11px; word-break:break-all; margin-top:6px; } .na { color:var(--dim); font-size:12px; margin-top:8px; }
  h2 { font-size:13px; color:var(--dim); text-transform:uppercase; letter-spacing:1px; margin:36px 0 10px; }
  ol, ul { padding-left:20px; color:#c7cbd3; } li { margin:6px 0; } code { background:#1d212b; padding:1px 6px; border-radius:5px; font-size:13px; }
  details { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:10px 14px; margin:8px 0; } summary { cursor:pointer; font-weight:600; }
  a { color:var(--cyan); } footer { color:var(--dim); font-size:12px; margin-top:40px; }
</style></head><body><div class="wrap">
  <div class="hero"><img src="icon.png" alt=""><div><h1>Echo</h1><div class="tag">v${esc(pkg.version)} · 构建于 ${built}</div></div></div>
  <p class="lead">在你和 coding agent 本来就在进行的对话里学英语。你照常用中文和 Claude Code / Codex / ZCode / Cursor 工作，Echo 每轮给你两行一眼扫完的英文。agent 不知道它存在。</p>
  <pre class="demo"><span class="y">▸ You said:</span> Don't touch this API yet — wait until I finish adding the tests.
<span class="g">▸ In short:</span> He'll hold off on changing the interface until the tests are complete.</pre>

  <div class="grid">${rows.map(card).join("")}</div>
  <div class="meta" style="margin-top:8px"><a href="SHA256SUMS.txt">SHA256SUMS.txt</a> · 安装包目前未签名，首次打开系统会拦一下，见下方。</div>

  <h2>安装后三步</h2>
  <ol>
    <li>打开 Echo → <b>Harness</b> 页，对检测到的 harness 点「接入」。Codex 要在 codex 里输入一次 <code>/hooks</code> 信任；ZCode 要新开一个 session。</li>
    <li><b>模型</b> 页选一个给 Echo 做翻译的便宜模型：已登录的 <code>pi</code>（GLM Coding Plan）、ZCode 自带 CLI、Claude Code，或任意 OpenAI 兼容端点 + key。点「测试一次」。</li>
    <li>回到你的 agent 正常干活。两行英文出现在 Echo 窗口（可置顶）、系统通知，CLI 里还会直接显示在对话和状态栏。</li>
  </ol>

  <h2>各平台说明</h2>
  <details open><summary>macOS</summary><ul>
    <li>打开 dmg，把 <code>Echo.app</code> 拖到「应用程序」。</li>
    <li>首次打开若提示「无法验证开发者」：右键 → 打开；或 系统设置 → 隐私与安全性 → 仍要打开。</li>
    <li>若提示「已损坏」（未签名包从浏览器下载会被隔离）：终端执行 <code>xattr -cr /Applications/Echo.app</code> 后再打开。</li>
    <li>Echo 住在菜单栏；关窗口不退出。</li>
  </ul></details>
  <details><summary>Windows</summary><ul>
    <li>zip 是便携版：解压到任意目录（如 <code>D:\\Echo</code>），运行里面的 <code>Echo.exe</code>；exe 是一键安装版。SmartScreen 拦截时点「更多信息 → 仍要运行」。</li>
    <li>设置里的「登录时启动」对便携版同样有效（写入当前用户的启动项）。</li>
    <li>hook 用系统自带的 <code>curl.exe</code>（Windows 10 1803 起内置）。</li>
    <li>CLI 后端（pi / claude）在 Windows 上未实机验证；OpenAI 兼容端点最稳。</li>
  </ul></details>
  <details><summary>Linux</summary><ul>
    <li><code>chmod +x Echo-*.AppImage && ./Echo-*.AppImage</code>。没有 FUSE 时加 <code>--appimage-extract-and-run</code>。</li>
  </ul></details>

  <h2>它怎么工作</h2>
  <ul>
    <li>「接入」= 往 harness 的用户级配置写两条 hook，每条是一行 <code>curl</code> 发到本机 <code>127.0.0.1:4319</code>。harness 侧零依赖；Echo 没开就静默。随时可移除，改动前留 <code>.echo-bak</code>。</li>
    <li>英文由 Echo 自己选的小模型生成，主 agent 的上下文一个字不多。</li>
    <li>所有数据只在本机 <code>~/.echo/</code>。</li>
  </ul>
  <footer>在线 demo（需登录）：<a href="/echo/app">/echo/app</a></footer>
</div></body></html>`;

fs.writeFileSync(path.join(outDir, "index.html"), html);
fs.copyFileSync(path.join(ROOT, "build/icon.png"), path.join(outDir, "icon.png"));
console.log(`published to ${outDir}:`);
for (const r of rows) console.log(`  ${r.missing ? "--" : "ok"} ${r.id.padEnd(10)} ${r.file || ""} ${r.size || ""}`);
console.log(`${baseUrl}/`);
