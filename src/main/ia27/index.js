const { EventEmitter } = require("node:events");
const path = require("node:path");
const { profile: profileHardware } = require("./hardware");
const { scanModelDir, resolveModel } = require("./modelResolver");
const { recommend: recommendModel } = require("./modelRecommender");
const { MemoryStore } = require("./memory");
const { Agent } = require("./agent");
const { WorkerBridge } = require("./bridge");
const { extractText } = require("./documents");
const { idleLine } = require("./persona");

class IACore extends EventEmitter {
  constructor({ dataDir, openPath, consent }) {
    super();
    this.dataDir = dataDir;
    this.modelsDir = path.join(dataDir, "models");
    this.memory = new MemoryStore(dataDir);
    this.bridge = null;
    this.agent = null;
    this.resolvedModel = null;
    this.modelInfo = null;
    this.ready = false;
    this.state = "idle";
    this.openPath = openPath;
    this.consentPrompt = consent;
  }

  emitStage(stage, message, progress) {
    this.emit("stage", { stage, message, progress });
  }

  async init() {
    this.state = "loading";

    this.emitStage("hardware", "Analizando hardware del sistema…", 0.01);
    const hw = profileHardware(this.dataDir);
    this.emitStage("hardware", "Hardware detectado: " + hw.cpu.model.split(" ")[0] + ", " + hw.ram.totalFormatted, 0.04);

    this.emitStage("scanning", "Escaneando modelos disponibles…", 0.06);
    const settings = this.memory.getSettings();
    const modelsDir = path.join(this.dataDir, "models");

    const availableModels = scanModelDir(modelsDir);
    this.availableModels = availableModels;
    this.emitStage("scanning", availableModels.length + " modelo(s) encontrado(s)", 0.10);

    this.emitStage("selecting", "Seleccionando modelo \u00f3ptimo seg\u00fan hardware…", 0.12);

    let recommendation;
    if (availableModels.length > 0) {
      recommendation = recommendModel(availableModels, hw);
    } else {
      recommendation = { recommended: null, compatible: [], reason: "No se encontraron modelos en la carpeta local." };
    }

    const preferredModel = settings.modelTag || (recommendation.recommended ? recommendation.recommended.filename : null);
    this.emit("hardware", hw);
    this.emit("recommendation", recommendation);

    if (recommendation.recommended) {
      this.emitStage("selecting", recommendation.reason, 0.15);
    } else {
      this.emitStage("error", recommendation.reason, 0);
      this.emit("status", { state: "error", message: recommendation.reason });
      return;
    }

    try {
      const resolved = resolveModel({
        modelsDir,
        preferredModel,
        modelPathOverride: settings.modelPath,
      });
      this.resolvedModel = resolved;
      this.emitStage("selecting", "Modelo seleccionado: " + resolved.tag, 0.18);
    } catch (err) {
      this.emitStage("error", "Error al seleccionar modelo: " + err.message, 0);
      this.emit("status", { state: "error", message: err.message });
      return;
    }

    this.bridge = new WorkerBridge();
    this.bridge.on("progress", (m) => {
      this.emit("stage", { stage: "loading", progress: 0.20 + (m.progress || 0), message: "Cargando modelo…" });
    });
    this.bridge.on("stage", (m) => {
      this.emit("stage", { stage: m.stage || "loading", message: m.message });
    });
    this.bridge.on("consent:request", async (m) => {
      const approved = await this.consentPrompt(m.command);
      this.bridge.respondConsent(m.id, approved);
    });
    this.bridge.on("open:request", async (m) => {
      const result = await this.openPath(m.path);
      this.bridge.respondOpen(m.id, result);
    });

    this.bridge.start(path.join(__dirname, "worker.js"));

    this.emitStage("loading", "Inicializando motor neuronal…", 0.20);

    const info = await this.bridge.init({
      modelPath: this.resolvedModel.modelPath,
      settings,
      dataDir: this.dataDir,
    });
    this.modelInfo = info.info || null;

    this.emitStage("ready", "Modelo listo", 1.0);

    this.agent = new Agent({
      bridge: this.bridge,
      memory: this.memory,
      emit: (type, data) => this.emit(type, data),
    });

    this.ready = true;
    this.state = "ready";
    this.emit("status", { state: "ready", model: this.resolvedModel.tag });
  }

  async send(payload) {
    if (!this.agent) throw new Error("El n\u00facleo neuronal no est\u00e1 listo.");
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
      availableModels: this.availableModels || this.resolvedModel?.availableModels || [],
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
      "\n\nAnaliza este documento y resume lo esencial: prop\u00f3sito, datos clave, estructura y, si aplica, problemas o decisiones importantes.";
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