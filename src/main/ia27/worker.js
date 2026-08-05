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
}

async function runChat({ requestId, messages, systemPrompt, message, sampling, useTools, settings }) {
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
  if (!canReuse) {
    session.setChatHistory(target);
    sessionHistory = null;
  }

  abortController = new AbortController();
  const t0 = Date.now();
  let firstTokenMs = null;
  let chunks = 0;
  const meta = await session.promptWithMeta(message, {
    ...sampling,
    functions: handlers,
    signal: abortController.signal,
    onTextChunk: (text) => {
      if (firstTokenMs == null) firstTokenMs = Date.now() - t0;
      chunks += 1;
      send("token", { requestId, text });
    },
  });
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

  const toolCalls = [];
  for (const item of meta.response || []) {
    if (item && typeof item === "object" && item.type === "functionCall") {
      toolCalls.push({ name: item.name, params: item.params });
    }
  }
  send("chat:done", {
    requestId,
    responseText: meta.responseText || "",
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
    switch (msg.type) {
      case "init":
        await init(msg);
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