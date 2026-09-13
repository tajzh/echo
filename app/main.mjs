import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog, Notification } from "electron";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startCore, stopCore, log } from "../core/server.mjs";
import { BASE_URL } from "../core/config.mjs";
import { readState, writeState, onChange, latest } from "../core/store.mjs";
import { setNotifier } from "../core/notify.mjs";

// Echo desktop: the core runs inside this process; the UI is the core's own web page.
// Menu-bar / tray app: closing the window keeps Echo listening for harness hooks.

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HIDDEN = process.argv.includes("--hidden");
const isMac = process.platform === "darwin";

if (!app.requestSingleInstanceLock()) app.quit();

// GUI apps on macOS (and some Linux sessions) start with a minimal PATH, so `pi` / `claude` / `zcode`
// would not be found. Take the PATH from the user's login shell.
function fixPath() {
  if (process.platform === "win32") return;
  try {
    const sh = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(sh, ["-ilc", 'echo -n "__PATH__$PATH"'], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    const p = out.split("__PATH__").pop().trim();
    if (p && p.length > process.env.PATH.length) process.env.PATH = p;
  } catch {}
}
fixPath();

let win = null, tray = null, core = null, quitting = false;

const desktopState = () => ({ alwaysOnTop: false, closeToTray: true, ...(readState().desktop || {}) });
const setDesktop = (patch) => { const next = { ...desktopState(), ...patch }; writeState({ desktop: next }); return next; };

function icon(name) { return nativeImage.createFromPath(path.join(DIR, "assets", name)); }

function createWindow() {
  const d = desktopState();
  win = new BrowserWindow({
    width: 420, height: 680, minWidth: 340, minHeight: 420,
    title: "Echo", backgroundColor: "#0f1115", show: false, alwaysOnTop: d.alwaysOnTop,
    titleBarStyle: isMac ? "hiddenInset" : "default", autoHideMenuBar: true,
    icon: isMac ? undefined : icon("icon.png"),
    webPreferences: { preload: path.join(DIR, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.loadURL(`${BASE_URL}/app`);
  win.once("ready-to-show", () => { if (!HIDDEN) win.show(); });
  win.on("close", (e) => {
    if (quitting) return;
    if (desktopState().closeToTray) { e.preventDefault(); win.hide(); }
  });
  win.on("closed", () => (win = null));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

function showWindow() { if (!win) createWindow(); win.show(); win.focus(); }

function trayMenu() {
  const st = readState(); const d = desktopState();
  return Menu.buildFromTemplate([
    { label: "打开 Echo", click: showWindow },
    { type: "separator" },
    { label: st.enabled === false ? "恢复" : "暂停", click: () => { writeState({ enabled: st.enabled === false }); refreshTray(); } },
    { label: "Lv 0 · 中文写，看 You said", type: "radio", checked: !st.level, click: () => { writeState({ level: 0 }); refreshTray(); } },
    { label: "Lv 1 · 英文写，看 Better", type: "radio", checked: st.level === 1, click: () => { writeState({ level: 1 }); refreshTray(); } },
    { label: "窗口置顶", type: "checkbox", checked: d.alwaysOnTop, click: (m) => { setDesktop({ alwaysOnTop: m.checked }); win?.setAlwaysOnTop(m.checked); } },
    { type: "separator" },
    { label: "退出 Echo", click: () => { quitting = true; app.quit(); } },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(trayMenu());
  const u = latest({ role: "user" }); const a = latest({ role: "agent" });
  const lines = ["Echo" + (readState().enabled === false ? "（暂停中）" : "")];
  if (u?.status === "done") lines.push(`${u.kind === "better" ? "Better" : "You said"}: ${u.en}`);
  if (a?.status === "done" && (!u || a.ts >= u.ts)) lines.push(`In short: ${a.en}`);
  tray.setToolTip(lines.join("\n").slice(0, 250));
}

function createTray() {
  const img = isMac ? icon("trayTemplate.png") : icon("tray.png");
  if (isMac) img.setTemplateImage(true);
  tray = new Tray(img);
  tray.on("click", () => (isMac ? tray.popUpContextMenu() : showWindow()));
  refreshTray();
  onChange(() => refreshTray());
}

ipcMain.handle("desktop:get", () => ({
  ...desktopState(), autostart: app.getLoginItemSettings().openAtLogin,
  platform: process.platform, versions: { electron: process.versions.electron, app: app.getVersion() },
}));
ipcMain.handle("desktop:set", (_e, patch) => {
  if (patch.autostart !== undefined) app.setLoginItemSettings({ openAtLogin: Boolean(patch.autostart), openAsHidden: true, args: ["--hidden"] });
  const { autostart, ...rest } = patch;
  const d = setDesktop(rest);
  if (rest.alwaysOnTop !== undefined) win?.setAlwaysOnTop(d.alwaysOnTop);
  refreshTray();
  return { ...d, autostart: app.getLoginItemSettings().openAtLogin, platform: process.platform, versions: { electron: process.versions.electron, app: app.getVersion() } };
});
ipcMain.handle("desktop:openPath", (_e, p) => shell.openPath(p));
ipcMain.handle("desktop:quit", () => { quitting = true; app.quit(); });

app.on("second-instance", showWindow);
app.on("activate", showWindow);
app.on("window-all-closed", () => { /* keep running in the tray */ });
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => { if (core?.server) stopCore(core.server); });

app.whenReady().then(async () => {
  if (isMac) app.setActivationPolicy("regular");
  try { core = await startCore(); }
  catch (e) {
    dialog.showErrorBox("Echo 启动失败", `${e.message}\n\n本机 4319 端口被其他程序占用。关掉它，或设置环境变量 ECHO_PORT 后重开 Echo。`);
    app.quit(); return;
  }
  log(`desktop ${app.getVersion()} electron ${process.versions.electron} ${core.existing ? "(attached to running core)" : ""}`);
  setNotifier((title, body) => { if (Notification.isSupported()) new Notification({ title, body, silent: true }).on("click", showWindow).show(); });
  createTray();
  createWindow();
});
