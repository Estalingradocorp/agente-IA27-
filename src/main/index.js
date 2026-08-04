const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const { IACore } = require("./ia27");

const IS_SMOKE = process.argv.includes("--smoke-test");

let mainWindow = null;
let core = null;
const pendingConsents = new Map();

function relay(type, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ia27:event", { type, data });
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 660,
    backgroundColor: "#05070c",
    show: false,
    autoHideMenuBar: true,
    title: "IA-27 — Estalingrado Corp",
    icon: path.join(__dirname, "..", "..", "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function registerIpc() {
  ipcMain.handle("ia27:listConversations", () => core.memory.listConversations());
  ipcMain.handle("ia27:createConversation", () => core.newConversation());
  ipcMain.handle("ia27:getConversation", (_e, id) => core.memory.getConversation(id));
  ipcMain.handle("ia27:deleteConversation", (_e, id) => {
    core.memory.deleteConversation(id);
    return true;
  });
  ipcMain.handle("ia27:renameConversation", (_e, id, title) => core.memory.renameConversation(id, title));
  ipcMain.handle("ia27:send", (_e, payload) => core.send(payload));
  ipcMain.handle("ia27:cancel", () => {
    core.cancelGeneration();
    return true;
  });
  ipcMain.handle("ia27:attach", (_e, payload) => core.attachDocument(payload));
  ipcMain.handle("ia27:switchConversation", (_e, id) => core.switchConversation(id));
  ipcMain.handle("ia27:getStatus", () => core.getStatus());
  ipcMain.handle("ia27:getSettings", () => core.memory.getSettings());
  ipcMain.handle("ia27:updateSettings", (_e, patch) => core.memory.setSettings(patch));
  ipcMain.handle("ia27:selectModelFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Seleccionar modelo GGUF de Qwen 2.5",
      properties: ["openFile"],
      filters: [{ name: "Modelos GGUF", extensions: ["gguf"] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.on("ia27:consentResponse", (_e, payload) => {
    const resolve = pendingConsents.get(payload.id);
    if (resolve) {
      pendingConsents.delete(payload.id);
      resolve(!!payload.approved);
    }
  });
  ipcMain.handle("ia27:relaunch", async () => {
    try {
      await core?.dispose?.();
    } catch {
      // limpieza best effort
    }
    app.relaunch();
    app.exit(0);
    return true;
  });
  ipcMain.handle("ia27:openExternal", (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });
}

async function boot() {
  const dataDir = path.join(app.getPath("userData"), "ia27-data");
  core = new IACore({
    dataDir,
    openPath: async (p) => {
      const err = await shell.openPath(p);
      return err ? "No se pudo abrir la ruta: " + err : "Ruta abierta correctamente.";
    },
    consent: (command) => {
      if (core.memory.getSettings().autoApproveCommands === true) return Promise.resolve(true);
      return new Promise((resolve) => {
        const id = "c-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        pendingConsents.set(id, resolve);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("ia27:event", { type: "consent:request", data: { id, command } });
        } else {
          resolve(false);
        }
      });
    },
  });

  for (const ev of ["status", "gen:start", "gen:token", "gen:tool", "gen:done", "gen:error"]) {
    core.on(ev, (data) => relay(ev, data));
  }

  registerIpc();
  createWindow();

  try {
    await core.init();
    relay("status", core.getStatus());
  } catch (err) {
    console.error("Boot error:", err);
    relay("status", {
      state: "error",
      message: String(err.message || err),
    });
    relay("boot:error", { message: String(err.message || err) });
  }

  if (IS_SMOKE) {
    const wc = mainWindow.webContents;
    wc.on("console-message", (...args) => {
      const raw = args[1];
      const msg = raw && typeof raw === "object" && "message" in raw ? raw.message : args[2];
      console.log("[renderer]", msg);
    });
    if (core.ready) {
      console.log("[SMOKE] core ready:", JSON.stringify(core.getStatus()));
      setTimeout(async () => {
        try {
          const conv = await core.newConversation();
          console.log("[SMOKE] send starting");
          const reply = await Promise.race([
            core.send({
              conversationId: conv.id,
              message: "Responde solo con la palabra: LISTO",
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error("send timeout")), 180000)),
          ]);
          console.log("[SMOKE] reply:", JSON.stringify(reply).slice(0, 300));
        } catch (err) {
          console.error("[SMOKE] send failed:", String((err && err.message) || err));
        }
        try {
          const check = await wc.executeJavaScript(
            "({ msgs: document.querySelectorAll('#messages .msg').length, galaxy: !!document.querySelector('#galaxy'), brand: document.querySelector('.brand-name') && document.querySelector('.brand-name').textContent })"
          ).catch((err) => ({ error: String(err) }));
          console.log("[SMOKE] renderer:", JSON.stringify(check));
        } catch {
          console.log("[SMOKE] renderer: no check");
        }
        app.exit(0);
      }, 2000);
    } else {
      console.error("[SMOKE] core NOT ready");
      setTimeout(() => app.exit(1), 1500);
    }
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(boot);
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async () => {
  try {
    await core?.dispose?.();
  } catch {
    // limpieza best effort
  }
});
