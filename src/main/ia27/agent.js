const { SYSTEM_PROMPT } = require("./persona");

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

  _historyItems(conversation) {
    const items = [{ type: "system", text: SYSTEM_PROMPT }];
    if (!conversation) return items;
    for (const m of conversation.messages || []) {
      if (m.role === "user") items.push({ type: "user", text: m.content });
      else if (m.role === "assistant") items.push({ type: "model", response: [m.content || ""] });
    }
    return this._fitToContext(items);
  }

  _fitToContext(items) {
    const s = this.memory.getSettings();
    const contextSize = Number(s.contextSize || 8192);
    const maxTokens = Number(s.maxTokens || 2048);
    const budgetTokens = Math.max(800, contextSize - maxTokens - 1200);
    const budgetChars = Math.floor(budgetTokens * 3.5);
    const itemLen = (it) =>
      it.type === "model" ? (it.response || []).join(" ").length : (it.text || "").length;
    const total = items.reduce((a, it) => a + itemLen(it), 0);
    if (total <= budgetChars) return items;
    const keepIdx = [0, items.length - 1];
    let acc = itemLen(items[0]) + itemLen(items[items.length - 1]);
    for (let i = items.length - 2; i >= 1 && acc <= budgetChars; i -= 1) {
      acc += itemLen(items[i]);
      keepIdx.push(i);
    }
    keepIdx.sort((a, b) => a - b);
    return keepIdx.map((i) => items[i]);
  }

  async send({ conversationId, message, attachments, prompt }) {
    const conversation = this.memory.getConversation(conversationId);
    if (!conversation) throw new Error("La conversación indicada no existe.");

    const userMsg = { role: "user", content: message, ts: new Date().toISOString() };
    if (attachments && attachments.length) userMsg.attachments = attachments;
    if (prompt != null) userMsg.prompt = prompt;
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
        useTools: true,
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
