const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("IA27SPLASH", {
  onStage: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ia27:splash", listener);
    return () => ipcRenderer.removeListener("ia27:splash", listener);
  },
});