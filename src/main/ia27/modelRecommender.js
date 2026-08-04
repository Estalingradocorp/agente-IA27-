function tierFromBytes(totalRamBytes) {
  const gb = totalRamBytes / (1024 * 1024 * 1024);
  if (gb < 8) return "minimal";
  if (gb <= 16) return "basic";
  if (gb <= 32) return "medium";
  return "high";
}

function recommendModel(models, hardware) {
  const ramTotal = hardware.ram.total;
  const ramGB = ramTotal / (1024 * 1024 * 1024);
  const hasCuda = hardware.gpu.cudaAvailable;

  const tiers = [
    { name: "minimal", maxParams: 1.6e9,  minRamGB: 4 },
    { name: "basic",   maxParams: 4e9,    minRamGB: 8 },
    { name: "medium",  maxParams: 8e9,    minRamGB: 16 },
    { name: "high",    maxParams: 20e9,   minRamGB: 32 },
  ];

  var activeTier = 0;
  for (var t = tiers.length - 1; t >= 0; t--) {
    if (ramGB >= tiers[t].minRamGB) {
      activeTier = t;
      break;
    }
  }

  const compatible = [];
  const incompatible = [];

  for (const m of models) {
    const params = m.paramCount || 0;
    // RAM necesaria aprox: ~0.7 GB por cada 1B de parámetros, + base de contexto.
    const estimatedRamGB = params >= 1 ? (params / 1e9) * 0.7 + 0.5 : 0.5;

    if (ramGB >= estimatedRamGB && (hardware.disk.free || 0) >= (m.sizeBytes || 0) * 1.1) {
      compatible.push(m);
    } else {
      incompatible.push({
        filename: m.filename,
        paramLabel: m.paramLabel,
        reason: ramGB < estimatedRamGB
          ? ("Requiere ~" + estimatedRamGB.toFixed(1) + " GB de RAM; disponible " + ramGB.toFixed(1) + " GB")
          : "Espacio en disco insuficiente"
      });
    }
  }

  compatible.sort(function (a, b) { return (a.paramCount || 0) - (b.paramCount || 0); });

  var recommended = null;
  const maxParams = tiers[activeTier].maxParams;

  for (var i = compatible.length - 1; i >= 0; i--) {
    if ((compatible[i].paramCount || 0) <= maxParams) {
      recommended = compatible[i];
      break;
    }
  }
  if (!recommended && compatible.length > 0) {
    recommended = compatible[0];
  }

  const tierNames = ["minimal", "basic", "medium", "high"];
  const tierMessages = {
    minimal: "Equipo con recursos limitados (" + ramGB.toFixed(1) + " GB RAM)",
    basic: "Equipo balanceado (" + ramGB.toFixed(1) + " GB RAM)",
    medium: "Equipo capaz (" + ramGB.toFixed(1) + " GB RAM)",
    high: "Equipo potente (" + ramGB.toFixed(1) + " GB RAM)",
  };

  var reason = "No hay modelos compatibles con este hardware.";
  if (recommended) {
    reason = tierMessages[tierNames[activeTier]] + ". Modelo recomendado: ~" +
      (recommended.paramLabel || "?") + " par\u00e1metros.";
  }

  return {
    recommended: recommended,
    compatible: compatible,
    incompatible: incompatible,
    reason: reason,
    tier: tierNames[activeTier],
    acceleration: hasCuda ? "cuda" : "cpu",
    totalModels: models.length,
  };
}

module.exports = { recommend: recommendModel, tierFromBytes };