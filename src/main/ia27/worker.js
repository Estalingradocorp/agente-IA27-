function makePort() {
  if (process.parentPort) {
    return {
      postMessage: (m) => process.parentPort.postMessage(m),
      onMessage: (cb) =>
        process.parentPort.on("message", (event) => {
          const data = event && event.data !== undefined ? event.data : event;
          cb(data);
        }),
    };
  }
  return {
    postMessage: (m) => process.send(m),
    onMessage: (cb) => process.on("message", cb),
  };
}

const port = makePort();
const send = (type, payload) => port.postMessage(Object.assign({ type }, payload));

let engine = null;
let session = null;
let sessionHistory = null;
let abortController = null;
let dataDir = null;
let currentSettings = null;

const consentWaiters = new Map();
const openWaiters = new Map();

function requestConsent(command) {
  return new Promise((resolve) => {
    const id = "w-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    consentWaiters.set(id, resolve);
    send("consent:request", { id, command });
  });
}

function requestOpen(filePath) {
  return new Promise((resolve) => {
    const id = "w-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    openWaiters.set(id, resolve);
    send("open:request", { id, path: filePath });
  });
}

function normalizeForCompare(history) {
  return history.map((item) => {
    if (item && item.type === "model") {
      return { type: "model", response: item.response.filter((x) => typeof x === "string") };
    }
    return item;
  });
}

function sameItem(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === "user" || a.type === "system") return a.text === b.text;
  if (a.type === "model") {
    if (!Array.isArray(a.response) || !Array.isArray(b.response)) return false;
    if (a.response.length !== b.response.length) return false;
    return a.response.every((x, i) => x === b.response[i]);
  }
  return false;
}

function isPrefixOf(prefix, full) {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (!sameItem(prefix[i], full[i])) return false;
  }
  return true;
}

async function init({ modelPath, settings, dataDir: dd }) {
  dataDir = dd;
  currentSettings = settings || {};
  const { LLMEngine } = require("./engine");
  engine = new LLMEngine({
    modelPath,
    settings,
    onProgress: (p) => send("progress", { progress: p }),
    onStage: (m) => send("stage", { message: m }),
  });
  const t0 = Date.now();
  await engine.init();
  const loadMs = Date.now() - t0;
  send("ready", {
    info: engine.getModelInfo(),
    metrics: {
      loadMs,
      ramUsedMB: Math.round(process.memoryUsage().rss / 1048576),
    },
  });
  checkAndReportNet();
}

async function checkAndReportNet() {
  try {
    const { checkInternet } = require("./tools");
    const net = await checkInternet();
    send("net", { online: !!net.online, fuente: net.fuente || null, ms: net.ms || null });
  } catch {
    send("net", { online: false, fuente: null });
  }
}

function extractToolCall(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  t = t.replace(/^<\s*tool_call\s*>/i, "").replace(/<\s*\/\s*tool_call\s*>\s*$/i, "").trim();
  const start = t.indexOf('{"name":');
  if (start === -1 || start > 160) return null;
  const sub = t.slice(start);
  let end = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < sub.length; i += 1) {
    const ch = sub[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
  }
  if (end === -1) return null;
  let obj;
  try {
    obj = JSON.parse(sub.slice(0, end));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const name = String(obj.name || "").trim();
  if (!name) return null;
  let args = obj.arguments;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  return { name, arguments: args, raw: sub.slice(0, end) };
}

async function runChat({ requestId, messages, systemPrompt, message, sampling, useTools, settings }) {
  console.log("[worker] runChat recv", requestId, "msg:", JSON.stringify(message).slice(0, 50), "msgs:", Array.isArray(messages) ? messages.length : "?", "maxTokens:", sampling && sampling.maxTokens);
  const { buildToolHandlers } = require("./tools");
  const toolSettings = settings || currentSettings;
  const handlers = useTools
    ? buildToolHandlers({
        emit: (type, d) => send("tool", { requestId, name: d.name, state: d.state, preview: d.preview }),
        consent: requestConsent,
        openPath: requestOpen,
        dataDir,
        settings: toolSettings,
      })
    : undefined;

  const { LlamaChatSession } = engine.bindings;
  if (!session || session.disposed) {
    session = new LlamaChatSession({
      contextSequence: engine.sequence,
      systemPrompt,
      chatWrapper: "auto",
    });
    sessionHistory = null;
  }

  const target = messages || [];
  const reuseTarget = target.slice(0, -1);
  const current = sessionHistory ? normalizeForCompare(sessionHistory) : null;
  const canReuse = current != null && isPrefixOf(normalizeForCompare(reuseTarget), current);
  console.log("[worker] setChatHistory?", !canReuse, "targetType0:", target[0] && target[0].type, "targetLen0:", target[0] && target[0].text && target[0].text.length);
  if (!canReuse) {
    session.setChatHistory(target);
    sessionHistory = null;
  }
  console.log("[worker] session ready, sequence? ", !!(engine && engine.sequence));

  abortController = new AbortController();
  const t0 = Date.now();
  let firstTokenMs = null;
  let chunks = 0;
  const toolCalls = [];
  const buffer = [];

  // Streaming en tiempo real con retención de seguridad: los últimos RETENTION
  // caracteres se mantienen sin enviar por si el modelo genera una llamada de
  // herramienta (JSON) que no debe mostrarse como texto al operador.
  const RETENTION = 300;
  let pending = "";

  const onChunk = (text) => {
    if (firstTokenMs == null) firstTokenMs = Date.now() - t0;
    chunks += 1;
    buffer.push(text);
    pending += text;
    if (pending.length > RETENTION) {
      const cut = pending.length - RETENTION;
      const toSend = pending.slice(0, cut);
      pending = pending.slice(cut);
      send("token", { requestId, text: toSend });
    }
    if (chunks % 40 === 1) console.log("[worker] chunk", chunks, "at", Date.now() - t0, "ms");
  };

  const flushPending = () => {
    if (pending) {
      send("token", { requestId, text: pending });
      pending = "";
    }
  };

  const finalSampling = { ...sampling };
  console.log("[worker] promptWithMeta start");
  let meta = await session.promptWithMeta(message, {
    ...finalSampling,
    signal: abortController.signal,
    onTextChunk: onChunk,
  });
  console.log("[worker] promptWithMeta done, resp:", JSON.stringify(meta.responseText).slice(0, 60));
  let responseText = meta.responseText || buffer.join("");

  let guard = 0;
  let call = handlers ? extractToolCall(responseText) : null;
  if (call && !(handlers && handlers[call.name])) call = null;
  if (call) {
    // El primer prompt fue una llamada de herramienta: descartar el streaming parcial.
    pending = "";
  }
  while (call && guard < 2) {
    guard += 1;
    toolCalls.push({ name: call.name, params: call.arguments });
    let result;
    try {
      result = await handlers[call.name].handler(call.arguments);
    } catch (err) {
      result = "Error al ejecutar la herramienta '" + call.name + "': " + String((err && err.message) || err);
    }
    buffer.length = 0;
    const followUp =
      "La herramienta '" + call.name + "' devolvió este resultado:\n" +
      String(result) + "\n\nResponde al usuario usando este resultado. No vuelvas a llamar herramientas.";
    meta = await session.promptWithMeta(followUp, {
      ...finalSampling,
      signal: abortController.signal,
      onTextChunk: onChunk,
    });
    responseText = meta.responseText || buffer.join("");
    call = handlers ? extractToolCall(responseText) : null;
    if (call && !(handlers && handlers[call.name])) call = null;
    if (call) pending = "";
  }

  if (!call) flushPending();

  const totalMs = Date.now() - t0;

  sessionHistory = session.getChatHistory();

  const tokens = meta && meta.tokens ? meta.tokens : null;
  const timings = tokens && tokens.timings ? tokens.timings : null;
  const tokenCount =
    tokens && typeof tokens.tokens === "number" ? tokens.tokens : chunks;
  const tokensPerSec =
    timings && timings.predictedPerSecond
      ? Math.round(timings.predictedPerSecond)
      : tokenCount > 0 && totalMs > 0
        ? Math.round((tokenCount / totalMs) * 1000)
        : 0;

  send("chat:done", {
    requestId,
    responseText,
    toolCalls,
    metrics: {
      tokens: tokenCount,
      chunks,
      totalMs,
      firstTokenMs,
      tokensPerSec,
      promptMs: timings && timings.promptMs ? Math.round(timings.promptMs) : null,
      predictedMs: timings && timings.predictedMs ? Math.round(timings.predictedMs) : null,
      ramUsedMB: Math.round(process.memoryUsage().rss / 1048576),
    },
  });
}

port.onMessage(async (msg) => {
  try {
    send("debug", { type: msg && msg.type, requestId: msg && msg.requestId });
    switch (msg.type) {
      case "init":
        await init(msg);
        break;
      case "net:check":
        await checkAndReportNet();
        break;
      case "chat":
        await runChat(msg);
        break;
      case "reset":
        if (session) {
          try { session.dispose(); } catch { /* ignore */ }
          session = null;
          sessionHistory = null;
        }
        break;
      case "cancel":
        if (abortController) {
          abortController.abort(new Error("Generaci\u00f3n cancelada por el operador."));
        }
        break;
      case "consent:response": {
        const waiter = consentWaiters.get(msg.id);
        if (waiter) {
          consentWaiters.delete(msg.id);
          waiter(msg.approved);
        }
        break;
      }
      case "open:response": {
        const waiter = openWaiters.get(msg.id);
        if (waiter) {
          openWaiters.delete(msg.id);
          waiter(msg.result);
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    if (msg.type === "chat") {
      send("chat:error", { requestId: msg.requestId, message: String((err && err.message) || err) });
    } else {
      send("error", { message: String((err && err.message) || err) });
    }
  }
});