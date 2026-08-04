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
  constructor({ modelPath, settings = {}, onProgress, onStage }) {
    this.modelPath = modelPath;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.onProgress = onProgress;
    this.onStage = onStage;
    this.bindings = null;
    this.model = null;
    this.context = null;
    this.sequence = null;
  }

  async init() {
    this.bindings = await import("node-llama-cpp");
    const { getLlama } = this.bindings;
    const wantGpu = Number(this.settings.gpuLayers) > 0;

    this.onStage?.("Preparando motor neuronal…");
    this.onProgress?.(0.02);

    let gpuUsed = false;
    try {
      this.llama = await getLlama(
        wantGpu ? { gpu: "cuda" } : { gpu: { type: "auto", exclude: ["cuda", "vulkan"] } }
      );
      gpuUsed = wantGpu;
    } catch {
      if (wantGpu) {
        this.onStage?.("GPU no disponible; pasando a CPU.");
        this.llama = await getLlama({ gpu: { type: "auto", exclude: ["cuda", "vulkan"] } });
      } else {
        throw err;
      }
    }

    this.onStage?.("Cargando modelo de lenguaje…");
    this.onProgress?.(0.05);

    const modelName = path.basename(this.modelPath);
    const useMmap = this.useMmapOverride ?? "auto";

    try {
      this.model = await this.llama.loadModel({
        modelPath: this.modelPath,
        gpuLayers: gpuUsed ? Number(this.settings.gpuLayers) : 0,
        useMmap,
        onLoadProgress: (p) => {
          const mapped = 0.05 + p * 0.80;
          this.onProgress?.(mapped);
        },
      });
    } catch (loadErr) {
      if (wantGpu && gpuUsed) {
        this.onStage?.("Carga en GPU fallida; usando CPU.");
        this.model = await this.llama.loadModel({
          modelPath: this.modelPath,
          gpuLayers: 0,
          useMmap,
          onLoadProgress: (p) => {
            this.onProgress?.(0.05 + p * 0.80);
          },
        });
      } else {
        throw loadErr;
      }
    }

    this.onStage?.("Configurando contexto de inferencia…");
    this.onProgress?.(0.88);

    this.context = await this.model.createContext({
      contextSize: this.settings.contextSize,
      batchSize: this.settings.batchSize,
      threads: Number(this.settings.threads ?? 0),
    });
    this.sequence = this.context.getSequence();

    this.onStage?.("Calentando núcleo neuronal…");
    this.onProgress?.(0.92);

    try {
      const { LlamaCompletion } = this.bindings;
      const warmup = new LlamaCompletion({ contextSequence: this.sequence });
      await warmup.generateCompletion("Hola", { maxTokens: 2 });
    } catch {
      // calentamiento opcional
    }

    this.onProgress?.(0.98);
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