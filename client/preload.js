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
  runInFreshTab: (cwd, payload) => ipcRenderer.send("terminal:run-in-fresh-tab", { cwd, payload }),
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
  navigate: (url) => ipcRenderer.invoke("app:navigate", url),
  getLogPaths: () => ipcRenderer.invoke("app:get-log-paths"),
});

// Expose Savant client/server bridge (server config + offline outbox)
contextBridge.exposeInMainWorld("savantClient", {
  getServerConfig: () => ipcRenderer.invoke("savant:get-server-config"),
  setServerUrl: (url) => ipcRenderer.invoke("savant:set-server-url", url),
  listLocalSessions: (opts) => ipcRenderer.invoke("savant:list-local-sessions", opts || {}),
  getLocalSession: (opts) => ipcRenderer.invoke("savant:get-local-session", opts || {}),
  renameLocalSession: (opts) => ipcRenderer.invoke("savant:rename-local-session", opts || {}),
  setLocalSessionStar: (opts) => ipcRenderer.invoke("savant:set-local-session-star", opts || {}),
  setLocalSessionArchive: (opts) => ipcRenderer.invoke("savant:set-local-session-archive", opts || {}),
  deleteLocalSession: (opts) => ipcRenderer.invoke("savant:delete-local-session", opts || {}),
  enqueueMutation: (payload) => ipcRenderer.invoke("savant:enqueue-mutation", payload),
  getQueueStats: () => ipcRenderer.invoke("savant:get-queue-stats"),
  listQueue: (limit) => ipcRenderer.invoke("savant:list-queue", limit),
  retryQueueItem: (id) => ipcRenderer.invoke("savant:retry-queue-item", id),
  flushQueueNow: () => ipcRenderer.invoke("savant:flush-queue-now"),
  onSyncStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("savant:sync-status", handler);
    return () => ipcRenderer.removeListener("savant:sync-status", handler);
  },
  onSessionsUpdated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("savant:sessions-updated", handler);
    return () => ipcRenderer.removeListener("savant:sessions-updated", handler);
  },
});
