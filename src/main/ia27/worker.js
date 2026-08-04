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
  const { LLMEngine } = require("./engine");
  engine = new LLMEngine({
    modelPath,
    settings,
    onProgress: (p) => send("progress", { progress: p }),
    onStage: (m) => send("stage", { message: m }),
  });
  await engine.init();
  send("ready", { info: engine.getModelInfo() });
}

async function runChat({ requestId, messages, systemPrompt, message, sampling, useTools }) {
  const { buildToolHandlers } = require("./tools");
  const handlers = useTools
    ? buildToolHandlers({
        emit: (type, d) => send("tool", { requestId, name: d.name, state: d.state, preview: d.preview }),
        consent: requestConsent,
        openPath: requestOpen,
        dataDir,
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
  const meta = await session.promptWithMeta(message, {
    ...sampling,
    functions: handlers,
    signal: abortController.signal,
    onTextChunk: (text) => send("token", { requestId, text }),
  });

  sessionHistory = session.getChatHistory();

  const toolCalls = [];
  for (const item of meta.response || []) {
    if (item && typeof item === "object" && item.type === "functionCall") {
      toolCalls.push({ name: item.name, params: item.params });
    }
  }
  send("chat:done", { requestId, responseText: meta.responseText || "", toolCalls });
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