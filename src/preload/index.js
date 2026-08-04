const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("IA27", {
  listConversations: () => ipcRenderer.invoke("ia27:listConversations"),
  createConversation: () => ipcRenderer.invoke("ia27:createConversation"),
  getConversation: (id) => ipcRenderer.invoke("ia27:getConversation", id),
  deleteConversation: (id) => ipcRenderer.invoke("ia27:deleteConversation", id),
  renameConversation: (id, title) => ipcRenderer.invoke("ia27:renameConversation", id, title),
  sendMessage: (payload) => ipcRenderer.invoke("ia27:send", payload),
  cancelGeneration: () => ipcRenderer.invoke("ia27:cancel"),
  attachDocument: (payload) => ipcRenderer.invoke("ia27:attach", payload),
  switchConversation: (id) => ipcRenderer.invoke("ia27:switchConversation", id),
  getStatus: () => ipcRenderer.invoke("ia27:getStatus"),
  getSettings: () => ipcRenderer.invoke("ia27:getSettings"),
  updateSettings: (patch) => ipcRenderer.invoke("ia27:updateSettings", patch),
  selectModelFile: () => ipcRenderer.invoke("ia27:selectModelFile"),
  relaunch: () => ipcRenderer.invoke("ia27:relaunch"),
  openExternal: (url) => ipcRenderer.invoke("ia27:openExternal", url),
  consentResponse: (payload) => ipcRenderer.send("ia27:consentResponse", payload),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ia27:event", listener);
    return () => ipcRenderer.removeListener("ia27:event", listener);
  },
});
