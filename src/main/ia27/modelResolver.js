const fs = require("node:fs");
const path = require("node:path");

function readFloat64(buf, offset) {
  const b = new ArrayBuffer(8);
  const view = new DataView(b);
  for (let i = 0; i < 8; i++) {
    view.setUint8(i, buf[offset + i]);
  }
  return view.getFloat64(0, true);
}

function readGGUFHeader(filePath) {
  try {
    // La metadata de GGUF ocupa la zona inicial del archivo (desde bytes a
    // unos pocos MB). Leemos 16 MB de una vez; alcanza para modelos grandes.
    const METADATA_BUF = 16 * 1024 * 1024;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(METADATA_BUF);
    const n = fs.readSync(fd, buf, 0, METADATA_BUF, 0);
    fs.closeSync(fd);

    if (n < 24 || buf.slice(0, 4).toString("ascii") !== "GGUF") {
      return null;
    }

    const version = buf.readUInt32LE(4);
    if (version !== 2 && version !== 3) {
      return { error: "GGUF v" + version + " no soportado", version: version };
    }

    const tensorCount = Number(buf.readBigUInt64LE(8));
    const metadataKVCount = Number(buf.readBigUInt64LE(16));
    const metadata = {};

    // Guarda: solo lee dentro del buffer cargado.
    const canRead = (len) => len <= n;

    const readStr = (offset) => {
      if (!canRead(offset + 8)) return null;
      const v = Number(buf.readBigUInt64LE(offset));
      const start = offset + 8;
      if (!canRead(start + v)) return null;
      const s = buf.slice(start, start + Number(v)).toString("utf8");
      return { value: s, next: start + Number(v) };
    };

    let offset = 24;

    for (let i = 0; i < Math.min(metadataKVCount, 512); i++) {
      const rk = readStr(offset);
      if (!rk) break;
      const key = rk.value;
      offset = rk.next;

      if (!canRead(offset + 4)) break;
      const valueType = buf.readUInt32LE(offset);
      offset += 4;

      let value = null;
      switch (valueType) {
        case 0: if (canRead(offset + 1)) { value = buf.readUInt8(offset); offset += 1; } break;
        case 1: if (canRead(offset + 1)) { value = buf.readInt8(offset); offset += 1; } break;
        case 2: if (canRead(offset + 2)) { value = buf.readUInt16LE(offset); offset += 2; } break;
        case 3: if (canRead(offset + 2)) { value = buf.readInt16LE(offset); offset += 2; } break;
        case 4: if (canRead(offset + 4)) { value = buf.readUInt32LE(offset); offset += 4; } break;
        case 5: if (canRead(offset + 4)) { value = buf.readInt32LE(offset); offset += 4; } break;
        case 6: if (canRead(offset + 4)) { value = buf.readFloatLE(offset); offset += 4; } break;
        case 7: if (canRead(offset + 1)) { value = buf.readUInt8(offset) !== 0; offset += 1; } break;
        case 8: {
          const r = readStr(offset);
          if (!r) { offset = offset + 8; break; }
          value = r.value;
          offset = r.next;
          break;
        }
        case 9: {
          if (!canRead(offset + 12)) break;
          const elemType = buf.readUInt32LE(offset);
          offset += 4;
          const arrLen = Number(buf.readBigUInt64LE(offset));
          offset += 8;
          const seen = [];
          for (let ai = 0; ai < arrLen; ai++) {
            if (elemType === 8) {
              const r = readStr(offset);
              if (!r) break;
              if (seen.length < 64) seen.push(r.value);
              offset = r.next;
            } else {
              const es = elemType === 0 || elemType === 7 ? 1 : elemType === 2 || elemType === 3 ? 2 : elemType === 4 || elemType === 5 || elemType === 6 ? 4 : elemType === 10 || elemType === 11 || elemType === 12 ? 8 : 0;
              if (es === 0) break;
              if (!canRead(offset + es)) break;
              if (seen.length < 64) {
                if (elemType === 0) seen.push(buf.readUInt8(offset));
                else if (elemType === 1) seen.push(buf.readInt8(offset));
                else if (elemType === 2) seen.push(buf.readUInt16LE(offset));
                else if (elemType === 3) seen.push(buf.readInt16LE(offset));
                else if (elemType === 4) seen.push(buf.readUInt32LE(offset));
                else if (elemType === 5) seen.push(buf.readInt32LE(offset));
                else if (elemType === 6) seen.push(buf.readFloatLE(offset));
                else if (elemType === 10) seen.push(Number(buf.readBigUInt64LE(offset)));
                else if (elemType === 11) seen.push(Number(buf.readBigInt64LE(offset)));
                else if (elemType === 12) seen.push(readFloat64(buf, offset));
              }
              offset += es;
            }
          }
          value = seen;
          break;
        }
        case 10: if (canRead(offset + 8)) { value = Number(buf.readBigUInt64LE(offset)); offset += 8; } break;
        case 11: if (canRead(offset + 8)) { value = Number(buf.readBigInt64LE(offset)); offset += 8; } break;
        case 12: if (canRead(offset + 8)) { value = readFloat64(buf, offset); offset += 8; } break;
        default:
          value = "[tipo " + valueType + "]";
          break;
      }

      if (key) metadata[key] = value;
    }

    return buildHeader(metadata, version, tensorCount);
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

// Deriva los campos de interés de la metadata GGUF, con tolerancia a
// variantes (LM Studio/llama.cpp pueden usar claves ligeramente distintas).
function buildHeader(metadata, version, tensorCount) {
  const architecture = metadata["general.architecture"] || null;

  let parameterCount = Number(metadata["general.parameter_count"]);
  if (!parameterCount && metadata["general.size_label"]) {
    const m = /([\d.]+)\s*([BM])/i.exec(String(metadata["general.size_label"]));
    if (m) {
      const mult = m[2].toUpperCase() === "B" ? 1e9 : 1e6;
      parameterCount = Number(m[1]) * mult;
    }
  }
  parameterCount = parameterCount || null;

  let contextSize = Number(metadata["model.context_length"]) || Number(metadata[architecture + ".context_length"]) || 0;
  if (!contextSize) {
    const ctxKey = Object.keys(metadata).find((k) => k.endsWith(".context_length"));
    if (ctxKey) contextSize = Number(metadata[ctxKey]) || 0;
  }
  contextSize = contextSize || null;

  let quantization = metadata["general.quantization.version"] || null;
  if (quantization == null) {
    const ft = Number(metadata["general.file_type"]);
    quantization = FILE_TYPE_NAMES[ft] || (ft ? "tipo " + ft : null);
  }

  return {
    version: version,
    tensorCount: tensorCount,
    metadata: metadata,
    architecture: architecture,
    parameterCount: parameterCount,
    contextSize: contextSize,
    quantization: quantization,
    description: metadata["general.description"] || null,
  };
}

// Nombres legibles de general.file_type (llama.cpp).
const FILE_TYPE_NAMES = {
  0: "F32", 1: "F16", 2: "Q4_0", 3: "Q4_1", 5: "Q5_0", 6: "Q5_1",
  7: "Q8_0", 8: "Q8_1", 9: "Q2_K", 10: "Q3_K", 11: "Q3_K_S", 12: "Q3_K_M",
  13: "Q3_K_L", 14: "Q4_K", 15: "Q4_K_M", 16: "Q4_K_S", 17: "Q5_K",
  18: "Q5_K_M", 19: "Q5_K_S", 20: "Q6_K", 21: "Q8_K", 22: "IQ2_XXS",
  23: "IQ2_XS", 24: "IQ3_XXS", 25: "IQ1_S", 26: "IQ4_NL", 27: "IQ3_S",
  28: "IQ2_S", 29: "IQ4_XS", 30: "IQ1_M", 31: "BF16", 32: "IQ4_NL",
  33: "IQ3_M", 34: "IQ2_M", 35: "IQ2_M", 36: "IQ4_K",
};

function formatBytesModel(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = Number(bytes);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(i > 0 ? 1 : 0) + " " + units[i];
}

function paramLabel(count) {
  if (!count) return null;
  if (count >= 1e9) return (count / 1e9).toFixed(1) + " B";
  return (count / 1e6).toFixed(0) + " M";
}

function scanModelDir(modelsDir) {
  if (!fs.existsSync(modelsDir)) return [];

  const out = [];
  try {
    for (const entry of fs.readdirSync(modelsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".gguf")) continue;
      const full = path.join(modelsDir, entry.name);
      const stat = fs.statSync(full);
      const header = readGGUFHeader(full);

      out.push({
        filename: entry.name,
        path: full,
        sizeBytes: stat.size,
        sizeFormatted: formatBytesModel(stat.size),
        architecture: header ? header.architecture : null,
        paramCount: header ? header.parameterCount : null,
        paramLabel: header ? paramLabel(header.parameterCount) : null,
        contextSize: header ? header.contextSize : null,
        quantization: header ? header.quantization : null,
        valid: !!header && !header.error,
        error: header ? header.error : null,
      });
    }
  } catch (_) {
    // escaneo fallido
  }

  return out.sort(function (a, b) {
    return (a.paramCount || 0) - (b.paramCount || 0);
  });
}

function resolveModel({ modelsDir, preferredModel, modelPathOverride } = {}) {
  if (modelPathOverride) {
    if (!fs.existsSync(modelPathOverride)) {
      throw new Error("La ruta del modelo no existe: " + modelPathOverride);
    }
    const header = readGGUFHeader(modelPathOverride);
    if (!header) {
      throw new Error("El archivo indicado no es un modelo GGUF v\u00e1lido: " + modelPathOverride);
    }
    return {
      modelPath: modelPathOverride,
      source: "override",
      tag: path.basename(modelPathOverride),
      sizeBytes: fs.statSync(modelPathOverride).size,
      header: header,
      availableModels: [],
    };
  }

  const available = scanModelDir(modelsDir);
  if (available.length === 0) {
    throw new Error(
      "No se encontraron modelos GGUF en " + modelsDir +
      ". Coloca archivos .gguf en esa carpeta."
    );
  }

  let chosen;
  if (preferredModel) {
    chosen = available.find(function (m) { return m.filename === preferredModel; });
  }
  if (!chosen) {
    chosen = available[0];
  }

  if (!chosen || !chosen.valid) {
    throw new Error("Ning\u00fan modelo GGUF v\u00e1lido encontrado en " + modelsDir);
  }

  return {
    modelPath: chosen.path,
    source: "local",
    tag: chosen.filename,
    sizeBytes: chosen.sizeBytes,
    header: chosen,
    availableModels: available.filter(function (m) { return m.valid; }).map(function (m) {
      return {
        filename: m.filename,
        paramLabel: m.paramLabel,
        sizeFormatted: m.sizeFormatted,
        quantization: m.quantization,
      };
    }),
  };
}

module.exports = { scanModelDir, readGGUFHeader, resolveModel, formatBytesModel };