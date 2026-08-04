(function () {
  "use strict";

  const api = window.IA27SPLASH;
  const fill = document.getElementById("progress-fill");
  const percentEl = document.getElementById("progress-percent");
  const statusEl = document.getElementById("status-text");

  let progress = 0;
  let lastStage = "";

  const STAGE_TEXT = {
    hardware: "Analizando hardware del sistema…",
    scanning: "Escaneando modelos disponibles…",
    selecting: "Seleccionando el modelo óptimo…",
    loading: "Preparando entorno de inferencia…",
    warming: "Optimizando recursos del sistema…",
    ready: "Núcleo neuronal en línea",
    error: "Error al iniciar IA-27",
  };

  const STAGE_FLOOR = {
    hardware: 0.02,
    scanning: 0.08,
    selecting: 0.15,
    loading: 0.2,
    warming: 0.9,
    ready: 1,
  };

  function setProgress(value, animate) {
    progress = Math.max(progress, Math.min(1, value));
    if (fill) {
      fill.style.width = Math.round(progress * 100) + "%";
    }
    if (percentEl) {
      percentEl.textContent = Math.round(progress * 100) + "%";
    }
  }

  function setStatus(message) {
    if (statusEl && message) {
      statusEl.textContent = message;
      statusEl.style.animation = "none";
      void statusEl.offsetWidth;
      statusEl.style.animation = "";
    }
  }

  function handleStage(stage) {
    if (!stage) return;

    if (stage.stage === "error") {
      lastStage = "error";
      if (stage.message) setStatus(stage.message);
      return;
    }

    if (stage.stage) lastStage = stage.stage;

    const floor = STAGE_FLOOR[stage.stage] != null ? STAGE_FLOOR[stage.stage] : progress;
    if (typeof stage.progress === "number") {
      setProgress(stage.progress, true);
    } else if (floor > progress) {
      setProgress(floor, true);
    }

    if (stage.message) {
      setStatus(stage.message);
    } else {
      const fallback = STAGE_TEXT[stage.stage];
      if (fallback && fallback !== statusEl.textContent) {
        setStatus(fallback);
      }
    }
  }

  if (api && api.onStage) {
    api.onStage(handleStage);
  }

  setStatus(STAGE_TEXT.hardware);
  setProgress(0.01);

  const ticker = setInterval(() => {
    if (progress >= 1 || lastStage === "error") {
      clearInterval(ticker);
      return;
    }
    setProgress(progress + 0.003);
  }, 150);
})();