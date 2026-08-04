const { EventEmitter } = require("node:events");
const path = require("node:path");
const { resolveQwenModel } = require("./modelResolver");
const { MemoryStore } = require("./memory");
const { Agent } = require("./agent");
const { WorkerBridge } = require("./bridge");
const { extractText } = require("./documents");
const { idleLine } = require("./persona");

class IACore extends EventEmitter {
  constructor({ dataDir, openPath, consent }) {
    super();
    this.dataDir = dataDir;
    this.memory = new MemoryStore(dataDir);
    this.bridge = null;
    this.agent = null;
    this.resolvedModel = null;
    this.modelInfo = null;
    this.ready = false;
    this.state = "idle";
    this.openPath = openPath;
    this.consent = consent;
  }

  async init() {
    this.state = "loading";
    const settings = this.memory.getSettings();
    const resolved = resolveQwenModel({
      preferredTag: "7b",
      modelPathOverride: settings.modelPath,
    });
    this.resolvedModel = resolved;
    this.emit("status", {
      state: "loading",
      message: "Modelo localizado: " + resolved.tag,
      model: resolved.tag,
    });

    this.bridge = new WorkerBridge();
    this.bridge.on("status", (m) => this.emit("status", { ...m, model: resolved.tag }));
    this.bridge.on("consent:request", async (m) => {
      const approved = await this.consent(m.command);
      this.bridge.respondConsent(m.id, approved);
    });
    this.bridge.on("open:request", async (m) => {
      const result = await this.openPath(m.path);
      this.bridge.respondOpen(m.id, result);
    });

    this.bridge.start(path.join(__dirname, "worker.js"));
    const info = await this.bridge.init({
      modelPath: resolved.modelPath,
      settings,
      dataDir: this.dataDir,
    });
    this.modelInfo = info.info || null;

    this.agent = new Agent({
      bridge: this.bridge,
      memory: this.memory,
      emit: (type, data) => this.emit(type, data),
    });

    this.ready = true;
    this.state = "ready";
    this.emit("status", { state: "ready", model: resolved.tag });
  }

  async send(payload) {
    if (!this.agent) throw new Error("El núcleo neuronal no está listo.");
    return this.agent.send(payload);
  }

  cancelGeneration() {
    if (this.agent) this.agent.cancel();
  }

  async switchConversation() {
    return true;
  }

  getStatus() {
    return {
      ready: this.ready,
      state: this.state,
      model: this.resolvedModel?.tag || null,
      modelSource: this.resolvedModel?.source || null,
      modelPath: this.resolvedModel?.modelPath || null,
      modelInfo: this.modelInfo,
      idleLine: this.ready ? idleLine() : null,
    };
  }

  async newConversation() {
    return this.memory.createConversation({ modelTag: this.resolvedModel?.tag || "qwen2.5" });
  }

  async attachDocument({ conversationId, filePath }) {
    const doc = await extractText(filePath);
    const content =
      "[Documento adjunto: " + doc.nombre + "]\n\n" + doc.texto +
      "\n\nAnaliza este documento y resume lo esencial: propósito, datos clave, estructura y, si aplica, problemas o decisiones importantes.";
    const result = await this.agent.send({
      conversationId,
      message: content,
    });
    return { doc: { nombre: doc.nombre, extension: doc.extension, tamano: doc.tamano }, result };
  }

  async dispose() {
    if (this.bridge) await this.bridge.stop();
    this.bridge = null;
    this.agent = null;
  }
}

module.exports = { IACore };
