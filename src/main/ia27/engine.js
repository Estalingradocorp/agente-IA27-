const path = require("node:path");

const DEFAULT_SETTINGS = {
  contextSize: 4096,
  batchSize: 512,
  gpuLayers: 0,
  threads: 0,
  temperature: 0.7,
  topK: 40,
  topP: 0.9,
  maxTokens: 1024,
  repeatPenalty: 1.1,
};

class LLMEngine {
  constructor({ modelPath, settings = {}, onProgress, onStatus }) {
    this.modelPath = modelPath;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.onProgress = onProgress;
    this.onStatus = onStatus;
    this.bindings = null;
    this.model = null;
    this.context = null;
    this.sequence = null;
  }

  async init() {
    this.bindings = await import("node-llama-cpp");
    const { getLlama } = this.bindings;
    const wantGpu = Number(this.settings.gpuLayers) > 0;

    this.onStatus?.(wantGpu ? "Preparando motor neuronal (GPU)…" : "Preparando motor neuronal…");
    try {
      this.llama = await getLlama(
        wantGpu ? { gpu: "cuda" } : { gpu: { type: "auto", exclude: ["cuda", "vulkan"] } }
      );
    } catch (err) {
      if (wantGpu) {
        this.onStatus?.("GPU no disponible; pasando a CPU.");
        this.llama = await getLlama({ gpu: { type: "auto", exclude: ["cuda", "vulkan"] } });
      } else {
        throw err;
      }
    }

    this.onStatus?.("Cargando el modelo Qwen 2.5…");
    const useMmap = this.useMmapOverride ?? "auto";
    try {
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
        gpuLayers: wantGpu ? Number(this.settings.gpuLayers) : 0,
        useMmap,
        onLoadProgress: (p) => this.onProgress?.(p),
      });
    } catch (err) {
      if (wantGpu) {
        this.onStatus?.("Carga en GPU fallida; usando CPU.");
        this.model = await this.llama.loadModel({
          modelPath: this.modelPath,
          gpuLayers: 0,
          useMmap,
          onLoadProgress: (p) => this.onProgress?.(p),
        });
      } else {
        throw err;
      }
    }

    this.context = await this.model.createContext({
      contextSize: this.settings.contextSize,
      batchSize: this.settings.batchSize,
      threads: Number(this.settings.threads ?? 0),
    });
    this.sequence = this.context.getSequence();
  }

  createSession({ systemPrompt }) {
    const { LlamaChatSession } = this.bindings;
    return new LlamaChatSession({
      contextSequence: this.sequence,
      systemPrompt,
      chatWrapper: "auto",
    });
  }

  getModelInfo() {
    if (!this.model) return null;
    return {
      filename: this.model.filename ? path.basename(this.model.filename) : null,
      size: this.model.size,
      trainContextSize: this.model.trainContextSize,
      contextSize: this.settings.contextSize,
    };
  }

  async dispose() {
    try { this.model?.dispose?.(); } catch { /* ignore */ }
    this.model = null;
    this.context = null;
    this.sequence = null;
    this.llama = null;
  }
}

module.exports = { LLMEngine, DEFAULT_SETTINGS };
