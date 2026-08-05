let utilityProcessApi = null;
try {
  const electron = require("electron");
  if (electron && typeof electron === "object" && electron.utilityProcess) {
    utilityProcessApi = electron.utilityProcess;
  }
} catch {
  // fuera de Electron: se usa child_process
}

class WorkerBridge {
  constructor() {
    this.proc = null;
    this.listeners = new Map();
    this.chatPromises = new Map();
    this.consentWaiters = new Map();
    this.openWaiters = new Map();
    this.currentTokenCb = null;
    this.currentToolCb = null;
    this.isUtility = !!utilityProcessApi;
  }

  start(workerPath) {
    if (this.isUtility) {
      this.proc = utilityProcessApi.fork(workerPath);
      this.proc.on("message", (msg) => this._onMessage(msg));
    } else {
      const { fork } = require("node:child_process");
      this.proc = fork(workerPath, [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
      this.proc.on("message", (msg) => this._onMessage(msg));
    }
  }

  send(msg) {
    if (this.isUtility) this.proc.postMessage(msg);
    else this.proc.send(msg);
  }

  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }

  _emit(type, data) {
    for (const cb of this.listeners.get(type) || []) {
      try {
        cb(data);
      } catch (err) {
        console.error("Error en listener del puente:", err);
      }
    }
  }

  _onMessage(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case "chat:done":
      case "chat:error": {
        const pending = this.chatPromises.get(msg.requestId);
        if (pending) {
          this.chatPromises.delete(msg.requestId);
          this.currentTokenCb = null;
          this.currentToolCb = null;
          if (msg.type === "chat:done") pending.resolve(msg);
          else pending.reject(new Error(msg.message || "Error en la generación"));
        }
        break;
      }
      case "token":
        this.currentTokenCb?.(msg);
        break;
      case "tool":
        this.currentToolCb?.(msg);
        break;
      case "consent:request": {
        const waiter = this.consentWaiters.get(msg.id);
        if (waiter) {
          this.consentWaiters.delete(msg.id);
          waiter(msg);
        }
        break;
      }
      case "open:request": {
        const waiter = this.openWaiters.get(msg.id);
        if (waiter) {
          this.openWaiters.delete(msg.id);
          waiter(msg);
        }
        break;
      }
      case "progress":
        this._emit("progress", msg);
        break;
      case "stage":
        this._emit("stage", msg);
        break;
      case "ready":
        this._emit("ready", msg);
        break;
      case "error":
        this._emit("error", msg);
        break;
      default:
        this._emit(msg.type, msg);
    }
  }

  init({ modelPath, settings, dataDir }) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const offReady = this.on("ready", (m) => {
        if (settled) return;
        settled = true;
        offReady();
        offError();
        resolve(m);
      });
      const offError = this.on("error", (m) => {
        if (settled) return;
        settled = true;
        offReady();
        offError();
        reject(new Error(m.message || "Error al iniciar el motor neuronal"));
      });
      this.send({ type: "init", modelPath, settings, dataDir });
    });
  }

  chat({ requestId, messages, systemPrompt, message, sampling, useTools, settings, onToken, onTool }) {
    return new Promise((resolve, reject) => {
      this.chatPromises.set(requestId, { resolve, reject });
      this.currentTokenCb = onToken;
      this.currentToolCb = onTool;
      this.send({ type: "chat", requestId, messages, systemPrompt, message, sampling, useTools, settings });
    });
  }

  cancel() {
    this.send({ type: "cancel" });
  }

  reset() {
    this.send({ type: "reset" });
  }

  requestConsent(command) {
    return new Promise((resolve) => {
      const id = "b-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      this.consentWaiters.set(id, (msg) => resolve(msg.approved));
      this.send({ type: "consent:request", id, command });
    });
  }

  respondConsent(id, approved) {
    this.send({ type: "consent:response", id, approved });
  }

  requestOpen(filePath) {
    return new Promise((resolve) => {
      const id = "o-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      this.openWaiters.set(id, (msg) => resolve(msg.result));
      this.send({ type: "open:request", id, path: filePath });
    });
  }

  respondOpen(id, result) {
    this.send({ type: "open:response", id, result });
  }

  async stop() {
    try {
      if (this.isUtility) this.proc?.kill?.();
      else this.proc?.kill?.();
    } catch {
      // proceso ya terminado
    }
    this.proc = null;
  }
}

module.exports = { WorkerBridge };
