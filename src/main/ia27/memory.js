const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function makeId() {
  return crypto.randomUUID();
}

class MemoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.conversationsDir = path.join(dataDir, "conversaciones");
    this.settingsFile = path.join(dataDir, "config.json");
    fs.mkdirSync(this.conversationsDir, { recursive: true });
  }

  listConversations() {
    const out = [];
    for (const file of fs.readdirSync(this.conversationsDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.conversationsDir, file), "utf8"));
        out.push({
          id: raw.id,
          title: raw.title,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
          modelTag: raw.modelTag,
          messageCount: (raw.messages || []).length,
        });
      } catch {
        // conversación corrupta: se ignora
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  createConversation({ modelTag = "qwen2.5" } = {}) {
    const now = new Date().toISOString();
    const conv = {
      id: makeId(),
      title: "Nueva conversación",
      createdAt: now,
      updatedAt: now,
      modelTag,
      messages: [],
    };
    this._save(conv);
    return this.getConversation(conv.id);
  }

  getConversation(id) {
    const file = this._file(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  renameConversation(id, title) {
    const conv = this.getConversation(id);
    if (!conv) return null;
    conv.title = (title || "Conversación").slice(0, 80);
    conv.updatedAt = new Date().toISOString();
    this._save(conv);
    return conv;
  }

  deleteConversation(id) {
    const file = this._file(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  appendMessage(id, message) {
    const conv = this.getConversation(id);
    if (!conv) return null;
    conv.messages.push(message);
    if (conv.title === "Nueva conversación" && message.role === "user" && message.content) {
      conv.title = message.content.replace(/\s+/g, " ").trim().slice(0, 60) || "Conversación";
    }
    conv.updatedAt = new Date().toISOString();
    this._save(conv);
    return conv;
  }

  updateMessage(id, messageIndex, patch) {
    const conv = this.getConversation(id);
    if (!conv || !conv.messages[messageIndex]) return null;
    Object.assign(conv.messages[messageIndex], patch);
    conv.updatedAt = new Date().toISOString();
    this._save(conv);
    return conv;
  }

  getSettings() {
    if (!fs.existsSync(this.settingsFile)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.settingsFile, "utf8"));
    } catch {
      return {};
    }
  }

  setSettings(patch) {
    const current = this.getSettings();
    const next = { ...current, ...patch };
    fs.writeFileSync(this.settingsFile, JSON.stringify(next, null, 2), "utf8");
    return next;
  }

  _file(id) {
    return path.join(this.conversationsDir, id + ".json");
  }

  _save(conv) {
    fs.writeFileSync(this._file(conv.id), JSON.stringify(conv, null, 2), "utf8");
  }
}

module.exports = { MemoryStore };
