const { SYSTEM_PROMPT } = require("./persona");

const TOOL_INTENT = new RegExp(
  [
    "hora|fecha|fechas?",
    "sistema|ram|memoria|cpu|procesador|disco|unidad|hostname|usuario|encendido|batería|temperatura",
    "listar|directorio|carpeta|archivo|archivos|abrir|leer|buscar|explorar|renombrar|mover|copiar|borrar",
    "ejecutar|comando|terminal|cmd|powershell",
    "nota|guardar|recordar|anotar",
    "muéstrame|muestrame|revisa|consulta|busca|abre",
  ].join("|"),
  "i"
);

class Agent {
  constructor({ bridge, memory, emit }) {
    this.bridge = bridge;
    this.memory = memory;
    this.emit = emit;
    this.currentRequestId = null;
  }

  get sampling() {
    const s = this.memory.getSettings();
    return {
      temperature: Number(s.temperature ?? 0.7),
      topK: Number(s.topK ?? 40),
      topP: Number(s.topP ?? 0.9),
      repeatPenalty: { penalty: Number(s.repeatPenalty ?? 1.1) },
      maxTokens: Number(s.maxTokens ?? 1024),
    };
  }

  _needsTools(message) {
    return TOOL_INTENT.test(message);
  }

  _historyItems(conversation) {
    const items = [{ type: "system", text: SYSTEM_PROMPT }];
    if (!conversation) return items;
    for (const m of conversation.messages || []) {
      if (m.role === "user") items.push({ type: "user", text: m.content });
      else if (m.role === "assistant") items.push({ type: "model", response: [m.content || ""] });
    }
    return items;
  }

  async send({ conversationId, message }) {
    const conversation = this.memory.getConversation(conversationId);
    if (!conversation) throw new Error("La conversación indicada no existe.");

    const userMsg = { role: "user", content: message, ts: new Date().toISOString() };
    this.memory.appendMessage(conversationId, userMsg);
    this.emit("gen:start", { conversationId });

    const requestId = "r-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    this.currentRequestId = requestId;

    let result;
    try {
      result = await this.bridge.chat({
        requestId,
        messages: this._historyItems(this.memory.getConversation(conversationId)),
        systemPrompt: SYSTEM_PROMPT,
        message,
        sampling: this.sampling,
        useTools: this._needsTools(message),
        onToken: (m) => this.emit("gen:token", { conversationId, text: m.text }),
        onTool: (m) => this.emit("gen:tool", { conversationId, name: m.name, state: m.state, preview: m.preview }),
      });
    } catch (err) {
      this.emit("gen:error", { conversationId, message: String((err && err.message) || err) });
      throw err;
    } finally {
      this.currentRequestId = null;
    }

    const assistantMsg = {
      role: "assistant",
      content: (result.responseText || "").trim(),
      ts: new Date().toISOString(),
      toolCalls: result.toolCalls || [],
    };
    this.memory.appendMessage(conversationId, assistantMsg);
    this.emit("gen:done", { conversationId, message: assistantMsg });
    return assistantMsg;
  }

  cancel() {
    if (this.currentRequestId) {
      this.bridge.cancel();
    }
  }
}

module.exports = { Agent };
