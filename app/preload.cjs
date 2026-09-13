const { contextBridge, ipcRenderer } = require("electron");

// The app page runs unchanged in a browser (public demo) — these are the only desktop extras.
contextBridge.exposeInMainWorld("echoDesktop", {
  platform: process.platform,
  get: () => ipcRenderer.invoke("desktop:get"),
  set: (patch) => ipcRenderer.invoke("desktop:set", patch),
  openPath: (p) => ipcRenderer.invoke("desktop:openPath", p),
  quit: () => ipcRenderer.invoke("desktop:quit"),
});
