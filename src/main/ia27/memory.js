const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");

const ENC_MAGIC = Buffer.from("IA27ENC:00");

function makeId() {
  return crypto.randomUUID();
}

function keyDerive(dataDir) {
  const saltFile = path.join(dataDir, ".salt");
  let salt;
  if (fs.existsSync(saltFile)) {
    salt = Buffer.from(fs.readFileSync(saltFile));
  } else {
    salt = crypto.randomBytes(16);
    fs.writeFileSync(saltFile, salt);
  }
  return crypto.pbkdf2Sync(os.hostname() + "__ia27", salt, 10000, 32, "sha256");
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, iv, tag, enc]);
}

function decrypt(key, data) {
  if (!data.slice(0, ENC_MAGIC.length).equals(ENC_MAGIC)) return data.toString("utf8");
  const iv = data.slice(ENC_MAGIC.length, ENC_MAGIC.length + 16);
  const tag = data.slice(ENC_MAGIC.length + 16, ENC_MAGIC.length + 32);
  const enc = data.slice(ENC_MAGIC.length + 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

class MemoryStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.conversationsDir = path.join(dataDir, "conversaciones");
    this.settingsFile = path.join(dataDir, "config.json");
    fs.mkdirSync(this.conversationsDir, { recursive: true });
    this._key = null;
  }

  _keyGet() {
    if (!this._key) this._key = keyDerive(this.dataDir);
    return this._key;
  }

  _encryptEnabled() {
    return this.getSettings().encriptar === true;
  }

  listConversations() {
    const out = [];
    for (const file of fs.readdirSync(this.conversationsDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const id = file.replace(".json", "");
        const rawData = this._read(id);
        if (!rawData) continue;
        const raw = JSON.parse(rawData);
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
    const rawData = this._read(id);
    if (!rawData) return null;
    return JSON.parse(rawData);
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
    const raw = JSON.stringify(conv, null, 2);
    if (this._encryptEnabled()) {
      fs.writeFileSync(this._file(conv.id), encrypt(this._keyGet(), raw));
    } else {
      fs.writeFileSync(this._file(conv.id), raw, "utf8");
    }
  }

  _read(id) {
    const file = this._file(id);
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    if (buf.length >= ENC_MAGIC.length && buf.slice(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
      return decrypt(this._keyGet(), buf);
    }
    return buf.toString("utf8");
  }
}

module.exports = { MemoryStore };
