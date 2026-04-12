const { contextBridge, ipcRenderer } = require("electron");

// Expose terminal IPC to the renderer via window.terminalAPI
contextBridge.exposeInMainWorld("terminalAPI", {
  create: (opts) => ipcRenderer.invoke("terminal:create", opts),
  write: (tabId, data) => ipcRenderer.send("terminal:data-in", { tabId, data }),
  resize: (tabId, cols, rows) => ipcRenderer.send("terminal:resize", { tabId, cols, rows }),
  close: (tabId) => ipcRenderer.invoke("terminal:close", tabId),
  closeAll: () => ipcRenderer.invoke("terminal:close-all"),
  list: () => ipcRenderer.invoke("terminal:list"),
  openExternal: (cwd) => ipcRenderer.invoke("terminal:open-external", cwd),
  runInNewTab: (cwd, command) => ipcRenderer.send("terminal:run-in-new-tab", { cwd, command }),
  getPrefs: () => ipcRenderer.invoke("terminal:get-prefs"),
  setPrefs: (prefs) => ipcRenderer.invoke("terminal:set-prefs", prefs),

  onData: (callback) => {
    const handler = (_event, payload) => callback(payload.tabId, payload.data);
    ipcRenderer.on("terminal:data-out", handler);
    return () => ipcRenderer.removeListener("terminal:data-out", handler);
  },
  onClosed: (callback) => {
    const handler = (_event, tabId) => callback(tabId);
    ipcRenderer.on("terminal:close-ack", handler);
    return () => ipcRenderer.removeListener("terminal:close-ack", handler);
  },

  // BrowserView drawer control (called from terminal.html)
  hideDrawer: () => ipcRenderer.send("terminal:hide-drawer"),
  startDrag: () => ipcRenderer.send("terminal:start-drag"),
  stopDrag: () => ipcRenderer.send("terminal:stop-drag"),
  setWidthPct: (pct) => ipcRenderer.send("terminal:set-width-pct", pct),
  getWidthPct: () => ipcRenderer.invoke("terminal:get-width-pct"),

  // Commands from main process → terminal.html
  onCommand: (callback) => {
    const handler = (_event, cmd, arg) => callback(cmd, arg);
    ipcRenderer.on("terminal:command", handler);
    return () => ipcRenderer.removeListener("terminal:command", handler);
  },

  // Drawer visibility control (called from main pages)
  toggleDrawer: () => ipcRenderer.send("terminal:toggle-drawer"),
  showDrawer: (cwd) => ipcRenderer.send("terminal:show-drawer", cwd),
  addNewTab: (cwd) => ipcRenderer.send("terminal:add-new-tab", cwd),

  // Query drawer state
  isDrawerOpen: () => ipcRenderer.invoke("terminal:is-drawer-open"),

  // Listen for drawer state changes from main process
  onDrawerState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("terminal:drawer-state", handler);
    return () => ipcRenderer.removeListener("terminal:drawer-state", handler);
  },
});

// Expose context IPC (directory picker) via window.electronAPI
contextBridge.exposeInMainWorld("electronAPI", {
  pickDirectory: () => ipcRenderer.invoke("pick-directory"),
  openPath: (filePath) => ipcRenderer.invoke("shell:openPath", filePath),
  restartMcp: (name) => ipcRenderer.invoke("mcp:restart", name),
});
