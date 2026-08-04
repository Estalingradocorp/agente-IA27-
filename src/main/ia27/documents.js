const fs = require("node:fs");
const path = require("node:path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const MAX_TEXT = 6000;

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".log", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml",
  ".ini", ".cfg", ".toml", ".srt", ".vtt",
]);

const CODE_EXTS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".html", ".htm", ".css", ".scss", ".c", ".h",
  ".cpp", ".hpp", ".cs", ".java", ".go", ".rs", ".rb", ".php", ".sh", ".bat", ".cmd",
  ".ps1", ".sql", ".vue", ".svelte", ".kt", ".swift", ".lua", ".r", ".m", ".dart",
  ".gradle", ".properties", ".env",
]);

function extractExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

async function extractText(filePath) {
  const ext = extractExtension(filePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("La ruta indicada no es un archivo.");

  let text = "";
  if (TEXT_EXTS.has(ext) || CODE_EXTS.has(ext)) {
    if (stat.size > 3 * 1024 * 1024) {
      throw new Error("El archivo supera el límite de análisis (3 MB).");
    }
    text = fs.readFileSync(filePath, "utf8");
  } else if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(buffer);
    text = parsed.text || "";
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value || "";
  } else if (ext === ".doc") {
    throw new Error("Los archivos .doc antiguos no son compatibles. Conviértelo a .docx o .txt.");
  } else {
    throw new Error("Formato no soportado: " + ext);
  }

  if (!text || !text.trim()) {
    throw new Error("No se pudo extraer texto legible del archivo.");
  }

  text = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT) + "\n...[contenido truncado por límite de análisis]";
  }

  return { nombre: path.basename(filePath), ruta: filePath, extension: ext, tamano: stat.size, texto: text };
}

module.exports = { extractText, MAX_TEXT };
