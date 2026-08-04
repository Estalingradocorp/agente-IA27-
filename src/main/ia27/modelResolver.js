const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getModelsHome() {
  return process.env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models");
}

function listManifestFiles(home) {
  const root = path.join(home, "manifests");
  const out = [];
  if (!fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

function isGGUFFile(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf.toString("ascii") === "GGUF";
  } catch {
    return false;
  }
}

function normalizeSlashes(p) {
  return p.replace(/\\/g, "/");
}

function resolveQwenModel({ preferredTag = "7b", modelPathOverride } = {}) {
  if (modelPathOverride) {
    if (!fs.existsSync(modelPathOverride)) {
      throw new Error("La ruta del modelo no existe: " + modelPathOverride);
    }
    if (!isGGUFFile(modelPathOverride)) {
      throw new Error("El archivo indicado no es un modelo GGUF válido: " + modelPathOverride);
    }
    return {
      modelPath: modelPathOverride,
      source: "override",
      tag: path.basename(modelPathOverride),
      sizeBytes: fs.statSync(modelPathOverride).size,
    };
  }

  const home = getModelsHome();
  const manifests = listManifestFiles(home)
    .filter((f) => normalizeSlashes(f).includes("/qwen2.5/"))
    .sort();

  const byTag = manifests.find((f) => f.endsWith(path.sep + preferredTag)) || manifests[0];
  if (!byTag) {
    throw new Error(
      "No se encontró Qwen 2.5 en el almacén local (" + home + "). Verifica que el modelo esté instalado."
    );
  }

  const manifest = JSON.parse(fs.readFileSync(byTag, "utf8"));
  const layer = (manifest.layers || []).find((l) => l.mediaType === "application/vnd.ollama.image.model");
  if (!layer) {
    throw new Error("El manifiesto de Qwen 2.5 no contiene la capa de modelo.");
  }

  const digest = layer.digest.replace(/^sha256:/, "sha256-");
  const blob = path.join(home, "blobs", digest);
  if (!fs.existsSync(blob)) {
    throw new Error("No se encuentra el archivo de pesos del modelo: " + blob);
  }
  if (!isGGUFFile(blob)) {
    throw new Error("El archivo de pesos del modelo no es un GGUF válido: " + blob);
  }

  return {
    modelPath: blob,
    source: "ollama-store",
    tag: byTag.split(path.sep).slice(-2).join("/"),
    sizeBytes: layer.size,
  };
}

module.exports = { resolveQwenModel, getModelsHome };
