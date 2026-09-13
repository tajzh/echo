import { spawn } from "node:child_process";

// Display driver: OS notification (toast). Used where the harness has no user-facing hook
// channel — Claude Desktop, Codex Desktop, ZCode, Cursor IDE. Runs on the same machine as the core.

// The desktop app plugs in Electron's native Notification here; standalone core falls back to OS tools.
let custom = null;
export function setNotifier(fn) { custom = fn; }

export function notifySupported() {
  if (process.env.ECHO_NOTIFY === "0") return false;
  if (custom) return true;
  if (process.platform === "darwin" || process.platform === "win32") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

export function notify(title, body) {
  if (!notifySupported()) return Promise.resolve(false);
  if (custom) return Promise.resolve(custom(title, body)).then(() => true, () => false);
  const p = process.platform;
  let cmd, args;
  if (p === "darwin") {
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    cmd = "osascript"; args = ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`];
  } else if (p === "win32") {
    // Windows 10/11 toast via WinRT; no extra modules required.
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "''");
    const lines = body.split("\n").map((l) => `<text>${esc(l)}</text>`).join("");
    const ps = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${esc(title)}</text>${lines}</binding></visual></toast>')
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('echo').Show([Windows.UI.Notifications.ToastNotification]::new($xml))`;
    cmd = "powershell"; args = ["-NoProfile", "-NonInteractive", "-Command", ps];
  } else {
    cmd = "notify-send"; args = ["--app-name=echo", "--expire-time=8000", title, body];
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("close", (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
}
