(function () {
  "use strict";

  const api = window.IA27;
  const $ = (id) => document.getElementById(id);

  const state = {
    conversations: [],
    activeId: null,
    generating: false,
    streamEl: null,
    streamText: "",
    renderScheduled: false,
    pendingConsent: null,
    settings: {},
    readyOnce: false,
  };

  const galaxy = new window.Galaxy($("galaxy"));

  // ---------------- utils ----------------
  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function sanitizeHtml(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(href|src)\s*=\s*(["'])\s*javascript:/gi, "$1=$2");
  }

  function renderMarkdown(md) {
    let html;
    try {
      html = window.marked.parse(md || "", { breaks: true, gfm: true });
    } catch {
      html = escapeHtml(md);
    }
    const holder = document.createElement("div");
    holder.innerHTML = sanitizeHtml(html);
    holder.querySelectorAll("pre code").forEach((block) => {
      try {
        window.hljs.highlightElement(block);
      } catch {
        // resaltado opcional
      }
    });
    return holder.innerHTML;
  }

  function scrollBottom() {
    const box = $("messages");
    box.scrollTop = box.scrollHeight;
  }

  // ---------------- conversations ----------------
  async function loadConversations() {
    state.conversations = await api.listConversations();
    renderConversations();
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function renderConversations() {
    const list = $("conv-list");
    list.innerHTML = "";
    if (state.conversations.length === 0) {
      const empty = document.createElement("div");
      empty.className = "conv-empty";
      empty.textContent = "Sin conversaciones todavía.";
      empty.style.cssText = "padding: 12px 10px; font-size: 12px; color: #4a5a7a;";
      list.appendChild(empty);
      return;
    }
    for (const c of state.conversations) {
      const item = document.createElement("button");
      item.className = "conv-item" + (c.id === state.activeId ? " active" : "");
      item.innerHTML =
        '<span class="conv-marker"></span>' +
        '<span class="conv-meta">' +
        '<span class="conv-title"></span>' +
        '<span class="conv-date"></span>' +
        "</span>" +
        '<button class="conv-del" title="Eliminar">✕</button>';
      item.querySelector(".conv-title").textContent = c.title;
      item.querySelector(".conv-date").textContent =
        formatDate(c.updatedAt) + (c.modelTag ? " · " + c.modelTag : "");
      item.addEventListener("click", () => openConversation(c.id));
      item.querySelector(".conv-del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteConversation(c.id);
      });
      list.appendChild(item);
    }
  }

  async function deleteConversation(id) {
    if (state.generating) return;
    await api.deleteConversation(id);
    if (id === state.activeId) {
      state.activeId = null;
      const next = await api.createConversation();
      await api.switchConversation(next.id);
      state.activeId = next.id;
      $("conv-title").textContent = next.title;
      $("messages").innerHTML = "";
    }
    await loadConversations();
  }

  async function openConversation(id) {
    if (state.generating) return;
    state.activeId = id;
    await api.switchConversation(id);
    const conv = await api.getConversation(id);
    $("conv-title").textContent = conv ? conv.title : "Conversación";
    renderMessages(conv ? conv.messages : []);
    renderConversations();
  }

  // ---------------- messages ----------------
  function renderMessages(messages) {
    const box = $("messages");
    box.innerHTML = "";
    for (const m of messages || []) {
      appendMessage(m);
    }
    scrollBottom();
  }

  function appendMessage(m) {
    const box = $("messages");
    const isUser = m.role === "user";
    const div = document.createElement("div");
    div.className = "msg " + (isUser ? "msg-user" : "msg-assistant");
    div.dataset.role = m.role;

    if (isUser) {
      if (m.content && m.content.startsWith("[Documento adjunto:")) {
        const match = m.content.match(/^\[Documento adjunto: ([^\]]+)\]/);
        const name = match ? match[1] : "documento";
        const preview = escapeHtml(m.content.slice(0, 200));
        div.innerHTML =
          '<div class="doc-card">' +
          '<div><span class="doc-name">📄 ' + escapeHtml(name) + "</span></div>" +
          "<div>" + preview + "…</div>" +
          "</div>";
      } else {
        div.innerHTML = '<div class="bubble">' + escapeHtml(m.content || "") + "</div>";
      }
    } else {
      const chips = (m.toolCalls || [])
        .map((t) => '<div class="tool-chip">⚙ usó <b>' + escapeHtml(t.name) + "</b></div>")
        .join("");
      div.innerHTML =
        '<div class="avatar">✹</div>' +
        '<div class="assistant-body">' +
        '<div class="msg-meta">IA-27 <span class="msg-time"></span></div>' +
        chips +
        '<div class="bubble">' + renderMarkdown(m.content || "") + "</div>" +
        "</div>";
      if (m.ts) {
        div.querySelector(".msg-time").textContent =
          "· " + new Date(m.ts).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      }
    }
    box.appendChild(div);
    return div;
  }

  // ---------------- generation ----------------
  function setGenerating(on) {
    state.generating = on;
    $("btn-send").disabled = on;
    $("btn-cancel").classList.toggle("hidden", !on);
    $("input").disabled = on;
    galaxy.setActive(on);
  }

  function onGenStart() {
    state.streamText = "";
    state.streamEl = appendMessage({ role: "assistant", content: "" });
    const bubble = state.streamEl.querySelector(".bubble");
    bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    scrollBottom();
  }

  function scheduleStreamRender() {
    if (state.renderScheduled) return;
    state.renderScheduled = true;
    requestAnimationFrame(() => {
      state.renderScheduled = false;
      if (!state.streamEl) return;
      const bubble = state.streamEl.querySelector(".bubble");
      if (!state.streamText.trim()) return;
      bubble.innerHTML = renderMarkdown(state.streamText);
      scrollBottom();
    });
  }

  function onGenToken(data) {
    if (!state.streamEl) return;
    state.streamText += data.text;
    galaxy.noteToken();
    scheduleStreamRender();
  }

  function onGenTool(data) {
    if (!state.streamEl) return;
    let chip = state.streamEl.querySelector('.tool-chip[data-tool="' + CSS.escape(data.name) + '"]');
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "tool-chip";
      chip.dataset.tool = data.name;
      chip.textContent = "⚙ usó " + data.name;
      state.streamEl.querySelector(".assistant-body").insertBefore(chip, state.streamEl.querySelector(".bubble"));
    }
    chip.classList.toggle("running", data.state === "running");
  }

  function finalizeStream(message) {
    if (!state.streamEl) return;
    const bubble = state.streamEl.querySelector(".bubble");
    bubble.innerHTML = renderMarkdown(message.content || "");
    const body = state.streamEl.querySelector(".assistant-body");
    body.querySelectorAll(".tool-chip").forEach((c) => c.remove());
    for (const t of message.toolCalls || []) {
      const chip = document.createElement("div");
      chip.className = "tool-chip";
      chip.textContent = "⚙ usó " + t.name;
      body.insertBefore(chip, bubble);
    }
    state.streamEl = null;
    state.streamText = "";
    scrollBottom();
  }

  function onGenDone(data) {
    finalizeStream(data.message);
    setGenerating(false);
    loadConversations();
  }

  function onGenError(data) {
    if (state.streamEl) {
      const bubble = state.streamEl.querySelector(".bubble");
      if (state.streamText.trim()) {
        bubble.innerHTML = renderMarkdown(state.streamText) + "<p></p>";
      }
      const errEl = document.createElement("div");
      errEl.className = "bubble error-bubble";
      errEl.textContent = "⚠ " + String(data.message || "Error durante la generación.");
      state.streamEl.querySelector(".assistant-body").appendChild(errEl);
      state.streamEl = null;
      state.streamText = "";
    }
    setGenerating(false);
    loadConversations();
  }

  async function sendCurrent() {
    const text = $("input").value.trim();
    if (!text || state.generating) return;
    $("input").value = "";
    autoResizeInput();

    appendMessage({ role: "user", content: text, ts: new Date().toISOString() });
    scrollBottom();
    setGenerating(true);

    try {
      const msg = await api.sendMessage({ conversationId: state.activeId, message: text });
      if (msg && state.streamEl) finalizeStream(msg);
    } catch (err) {
      const reason = String((err && err.message) || err);
      if (reason.includes("cancelada")) {
        finalizeStream({ content: state.streamText, toolCalls: [] });
      } else {
        onGenError({ message: reason });
      }
    } finally {
      setGenerating(false);
      loadConversations();
    }
  }

  // ---------------- attachment ----------------
  async function attachFile(filePath) {
    if (state.generating) return;
    if (!filePath) return;
    setGenerating(true);
    try {
      await api.attachDocument({ conversationId: state.activeId, filePath });
      const conv = await api.getConversation(state.activeId);
      renderMessages(conv ? conv.messages : []);
    } catch (err) {
      appendErrorMessage(String((err && err.message) || err));
    } finally {
      setGenerating(false);
      loadConversations();
    }
  }

  function appendErrorMessage(message) {
    const div = document.createElement("div");
    div.className = "msg msg-assistant";
    div.innerHTML =
      '<div class="avatar">✹</div>' +
      '<div class="assistant-body">' +
      '<div class="msg-meta">IA-27</div>' +
      '<div class="bubble error-bubble">⚠ ' + escapeHtml(message) + "</div>" +
      "</div>";
    $("messages").appendChild(div);
    scrollBottom();
  }

  // ---------------- status ----------------
  function handleStatus(data) {
    const el = $("model-status");
    const text = el.querySelector(".status-text");
    el.className = "model-status";

    if (data.state === "ready") {
      el.classList.add("ready");
      text.textContent = "en línea · " + (data.model || "qwen2.5");
      if (!state.readyOnce) {
        state.readyOnce = true;
        startFirstConversation();
      }
    } else if (data.state === "loading") {
      el.classList.add("loading");
      if (typeof data.progress === "number") {
        text.textContent = "cargando " + Math.round(data.progress * 100) + "%";
      } else {
        text.textContent = data.message || "cargando…";
      }
    } else if (data.state === "error") {
      el.classList.add("error");
      text.textContent = "error";
      if (!$("messages").children.length) {
        $("messages").appendChild(buildBootError(data.message));
      }
    }
  }

  function buildBootError(message) {
    const div = document.createElement("div");
    div.className = "boot-error";
    div.innerHTML =
      "<b>No se pudo iniciar el núcleo neuronal.</b><br/>" +
      escapeHtml(message) +
      "<br/><br/>Verifica que el modelo Qwen 2.5 esté instalado localmente o ajusta la ruta del modelo en ⚙ Ajustes.";
    return div;
  }

  function onBootError(data) {
    if (!$("messages").children.length) {
      $("messages").appendChild(buildBootError(data.message));
    }
  }

  // ---------------- consent ----------------
  function onConsentRequest(data) {
    state.pendingConsent = data;
    $("consent-command").textContent = data.command;
    $("consent-modal").classList.remove("hidden");
  }

  function respondConsent(approved) {
    const payload = state.pendingConsent;
    if (payload) {
      api.consentResponse({ id: payload.id, approved });
      state.pendingConsent = null;
    }
    $("consent-modal").classList.add("hidden");
  }

  // ---------------- settings ----------------
  async function openSettings() {
    state.settings = await api.getSettings();
    const s = state.settings;
    const range = $("set-temperature");
    range.value = s.temperature != null ? s.temperature : 0.7;
    $("val-temperature").textContent = Number(range.value).toFixed(1);
    $("set-maxTokens").value = s.maxTokens != null ? s.maxTokens : 1024;
    $("set-contextSize").value = s.contextSize != null ? s.contextSize : 4096;
    $("set-gpuLayers").value = s.gpuLayers != null ? s.gpuLayers : 0;
    $("set-threads").value = s.threads != null ? s.threads : 0;
    $("set-autoApprove").checked = !!s.autoApproveCommands;
    $("set-modelPath").value = s.modelPath || "";
    $("settings-modal").classList.remove("hidden");
  }

  async function saveSettings() {
    const patch = {
      temperature: Number($("set-temperature").value),
      maxTokens: Math.max(64, Number($("set-maxTokens").value) || 1024),
      contextSize: Number($("set-contextSize").value),
      gpuLayers: Math.max(0, Number($("set-gpuLayers").value) || 0),
      threads: Math.max(0, Number($("set-threads").value) || 0),
      autoApproveCommands: $("set-autoApprove").checked,
      modelPath: $("set-modelPath").value.trim() || undefined,
    };
    await api.updateSettings(patch);
    closeSettings();
  }

  function closeSettings() {
    $("settings-modal").classList.add("hidden");
    $("settings-note").textContent = "";
    $("btn-restart-app").classList.add("hidden");
    $("settings-close").classList.remove("hidden");
  }

  // ---------------- input ----------------
  function autoResizeInput() {
    const el = $("input");
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }

  // ---------------- boot ----------------
  async function boot() {
    $("btn-send").disabled = true;

    const status = await api.getStatus();
    handleStatus(status);

    if (status.ready) {
      await api.cancelGeneration();
      await startFirstConversation();
    }

    $("input").disabled = false;
    $("btn-send").disabled = false;
    $("input").focus();
  }

  async function startFirstConversation() {
    const list = await api.listConversations();
    if (list.length > 0) {
      state.activeId = list[0].id;
      await api.switchConversation(list[0].id);
      const conv = await api.getConversation(list[0].id);
      $("conv-title").textContent = conv ? conv.title : "Conversación";
      renderMessages(conv ? conv.messages : []);
    } else {
      await newConversation();
    }
    renderConversations();
  }

  async function newConversation() {
    if (state.generating) return;
    const conv = await api.createConversation();
    state.activeId = conv.id;
    await api.switchConversation(conv.id);
    $("conv-title").textContent = conv.title;
    renderMessages([]);
    renderConversations();
    $("input").focus();
  }

  // ---------------- events ----------------
  api.onEvent(({ type, data }) => {
    switch (type) {
      case "status": handleStatus(data); break;
      case "gen:start": onGenStart(); break;
      case "gen:token": onGenToken(data); break;
      case "gen:tool": onGenTool(data); break;
      case "gen:done": onGenDone(data); break;
      case "gen:error": onGenError(data); break;
      case "consent:request": onConsentRequest(data); break;
      case "boot:error": onBootError(data); break;
      default: break;
    }
  });

  // ---------------- wiring ----------------
  $("btn-new").addEventListener("click", newConversation);
  $("btn-send").addEventListener("click", sendCurrent);
  $("btn-cancel").addEventListener("click", () => {
    api.cancelGeneration();
    setGenerating(false);
  });
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendCurrent();
    }
  });
  $("input").addEventListener("input", autoResizeInput);

  $("btn-attach").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) attachFile(file.path);
    e.target.value = "";
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.path) attachFile(file.path);
  });

  $("consent-approve").addEventListener("click", () => respondConsent(true));
  $("consent-deny").addEventListener("click", () => respondConsent(false));

  $("btn-settings").addEventListener("click", openSettings);
  $("btn-company").addEventListener("click", () => {
    api.openExternal("https://estalingradocorp.qzz.io/");
  });
  $("set-temperature").addEventListener("input", (e) => {
    $("val-temperature").textContent = Number(e.target.value).toFixed(1);
  });
  $("settings-close").addEventListener("click", saveSettings);
  $("btn-restart-app").addEventListener("click", () => api.relaunch());
  $("btn-browse-model").addEventListener("click", async () => {
    const file = await api.selectModelFile();
    if (file) $("set-modelPath").value = file;
  });
  $("btn-reset-model").addEventListener("click", () => {
    $("set-modelPath").value = "";
  });

  $("settings-modal").addEventListener("click", (e) => {
    if (e.target === $("settings-modal")) closeSettings();
  });
  $("consent-modal").addEventListener("click", (e) => {
    if (e.target === $("consent-modal")) respondConsent(false);
  });

  boot();
})();
