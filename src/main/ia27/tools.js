const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".hg", ".svn", "$recycle.bin",
  "system volume information", "windows", "program files", "program files (x86)",
  "appdata", "ntuser.dat", "pagefile.sys", "hiberfil.sys",
]);

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return "desconocido";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(bytes);
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + " " + units[i];
}

function currentDateTime() {
  const now = new Date();
  return {
    fecha: now.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
    hora: now.toLocaleTimeString("es-ES"),
    iso: now.toISOString(),
    epoch: Math.floor(now.getTime() / 1000),
  };
}

function systemInfo() {
  const cpus = os.cpus();
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const drives = [];
  try {
    const raw = require("node:child_process").execFileSync(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,FreeSpace,Size | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, encoding: "utf8", timeout: 15000 }
    );
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data ? [data] : [];
    for (const d of items) {
      drives.push({ unidad: d.DeviceID, total: formatBytes(Number(d.Size) || 0), libre: formatBytes(Number(d.FreeSpace) || 0) });
    }
  } catch {
    // no se pudieron enumerar las unidades
  }
  return {
    sistema: os.type() + " " + os.release() + " (" + os.arch() + ")",
    plataforma: os.platform(),
    hostname: os.hostname(),
    usuario: os.userInfo().username,
    cpu: cpus.length ? cpus[0].model.trim() : "desconocido",
    nucleos: cpus.length,
    ram_total: formatBytes(totalRam),
    ram_libre: formatBytes(freeRam),
    ram_usada: formatBytes(totalRam - freeRam),
    uptime_segundos: Math.floor(os.uptime()),
    unidades: drives,
  };
}

function readTextSafely(filePath, maxChars = 60000, maxLines = 800) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("No es un archivo: " + filePath);
  if (stat.size > 2 * 1024 * 1024) throw new Error("El archivo supera el límite de lectura (2 MB).");
  let text = fs.readFileSync(filePath, "utf8");
  if (maxLines) {
    const lines = text.split(/\r?\n/);
    if (lines.length > maxLines) {
      text = lines.slice(0, maxLines).join("\n") + "\n...[líneas omitidas]";
    }
  }
  if (text.length > maxChars) text = text.slice(0, maxChars) + "\n...[contenido truncado]";
  return text;
}

function listDirectory(dirPath, maxEntries = 60) {
  const target = dirPath || process.cwd();
  if (!fs.existsSync(target)) throw new Error("La ruta no existe: " + target);
  const stat = fs.statSync(target);
  if (stat.isFile()) return { ruta: target, tipo: "archivo", tamano: formatBytes(stat.size) };
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  const limited = entries.slice(0, maxEntries);
  const list = limited.map((e) => {
    let size = null;
    if (e.isFile()) {
      try { size = formatBytes(fs.statSync(path.join(target, e.name)).size); } catch { /* ignore */ }
    }
    return { nombre: e.name, tipo: e.isDirectory() ? "carpeta" : "archivo", tamano: size };
  });
  return {
    ruta: target,
    total: entries.length,
    mostrando: list.length,
    entradas: list,
    omitidos: entries.length - list.length,
  };
}

function searchFiles(pattern, dirPath, maxResults = 40) {
  const target = dirPath || os.homedir();
  if (!fs.existsSync(target)) throw new Error("La carpeta no existe: " + target);
  const cleanPattern = pattern.replace(/^[*\s]+/, "").replace(/[*\s]+$/, "");
  if (!cleanPattern) throw new Error("Indica un patrón de búsqueda.");
  const re = new RegExp(cleanPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*").replace(/\\\?/g, "."), "i");
  const results = [];
  const stack = [target];
  const visited = new Set();
  while (stack.length > 0 && results.length < maxResults) {
    const dir = stack.pop();
    if (visited.has(dir) || results.length >= maxResults) continue;
    visited.add(dir);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (results.length >= maxResults) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const lower = e.name.toLowerCase();
        if (IGNORED_DIRS.has(lower)) continue;
        if (re.test(e.name)) results.push({ nombre: e.name, ruta: full, tipo: "carpeta" });
        if (stack.length < 400) stack.push(full);
      } else if (e.isFile()) {
        if (re.test(e.name)) {
          let size = null;
          try { size = formatBytes(fs.statSync(full).size); } catch { /* ignore */ }
          results.push({ nombre: e.name, ruta: full, tipo: "archivo", tamano: size });
        }
      }
    }
  }
  return { patron: pattern, resultados: results, total: results.length, ruta_base: target };
}

function runCommand(command, { timeoutMs = 30000, cwd = os.homedir() } = {}) {
  return new Promise((resolve) => {
    if (!command || !command.trim()) return resolve("Comando vacío.");
    execFile(
      "cmd.exe",
      ["/d", "/s", "/c", command],
      { windowsHide: true, cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        const out = { comando: command, codigo: err ? (err.code ?? 1) : 0, stdout: (stdout || "").slice(0, 4000), stderr: (stderr || "").slice(0, 2000) };
        if (err && err.killed) out.stderr = (out.stderr || "") + "\n[comando cancelado por tiempo límite]";
        let parts = [];
        if (out.stdout.trim()) parts.push("SALIDA:\n" + out.stdout.trim());
        if (out.stderr.trim()) parts.push("ERROR:\n" + out.stderr.trim());
        parts.push("CÓDIGO DE SALIDA: " + out.codigo);
        resolve(parts.join("\n\n"));
      }
    );
  });
}

function appendNote(dataDir, content) {
  const dir = path.join(dataDir, "notas");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "cuaderno.txt");
  const stamp = new Date().toLocaleString("es-ES");
  fs.appendFileSync(file, "[" + stamp + "]\n" + content.trim() + "\n\n", "utf8");
  return "Nota guardada en " + file;
}

function fileInfo(filePath) {
  const stat = fs.statSync(filePath);
  return {
    nombre: path.basename(filePath),
    ruta: filePath,
    extension: path.extname(filePath).toLowerCase(),
    tipo: stat.isDirectory() ? "carpeta" : "archivo",
    tamano: formatBytes(stat.size),
    bytes: stat.size,
    modificado: stat.mtime ? stat.mtime.toISOString() : null,
  };
}

function writeFileSafely(filePath, content, { overwrite = true } = {}) {
  const abs = path.resolve(filePath);
  if (fs.existsSync(abs) && !overwrite) throw new Error("El archivo ya existe: " + abs);
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(abs, String(content ?? ""), "utf8");
  return "Archivo guardado en " + abs + " (" + formatBytes(fs.statSync(abs).size) + ")";
}

function buildToolHandlers(ctx) {
  const { emit, consent, openPath, dataDir } = ctx;

  const tools = {
    fecha_hora: {
      description: "Fecha y hora actuales.",
      params: { type: "object", properties: {}, required: [] },
      handler: async () => {
        emit("tool", { name: "fecha_hora", state: "done", preview: "fecha/hora" });
        const d = currentDateTime();
        return "Fecha: " + d.fecha + ". Hora: " + d.hora + ".";
      },
    },
    info_sistema: {
      description: "Datos del equipo: OS, CPU, RAM, discos, hostname, tiempo encendido.",
      params: { type: "object", properties: {}, required: [] },
      handler: async () => {
        emit("tool", { name: "info_sistema", state: "done", preview: "equipo" });
        return JSON.stringify(systemInfo(), null, 2);
      },
    },
    listar_directorio: {
      description: "Listar archivos y carpetas de un directorio.",
      params: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "Ruta absoluta (opcional)." },
        },
        required: [],
      },
      handler: async ({ ruta }) => {
        emit("tool", { name: "listar_directorio", state: "done", preview: ruta || "actual" });
        return JSON.stringify(listDirectory(ruta), null, 2);
      },
    },
    leer_archivo: {
      description: "Leer el contenido de un archivo de texto.",
      params: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "Ruta absoluta del archivo." },
          max_lineas: { type: "number", description: "Máximo de líneas (opcional)." },
        },
        required: ["ruta"],
      },
      handler: async ({ ruta, max_lineas }) => {
        emit("tool", { name: "leer_archivo", state: "done", preview: ruta });
        return readTextSafely(ruta, 60000, max_lineas || 800);
      },
    },
    buscar_archivos: {
      description: "Buscar archivos por nombre (comodines * y ?).",
      params: {
        type: "object",
        properties: {
          patron: { type: "string", description: "Patrón, p. ej. informe* o *.pdf." },
          carpeta: { type: "string", description: "Carpeta inicial (opcional)." },
        },
        required: ["patron"],
      },
      handler: async ({ patron, carpeta }) => {
        emit("tool", { name: "buscar_archivos", state: "done", preview: patron });
        return JSON.stringify(searchFiles(patron, carpeta), null, 2);
      },
    },
    abrir_ruta: {
      description: "Abrir un archivo o carpeta en su aplicación predeterminada.",
      params: {
        type: "object",
        properties: { ruta: { type: "string", description: "Ruta absoluta a abrir." } },
        required: ["ruta"],
      },
      handler: async ({ ruta }) => {
        emit("tool", { name: "abrir_ruta", state: "done", preview: ruta });
        return openPath(ruta);
      },
    },
    ejecutar_comando: {
      description: "Ejecutar un comando de Windows (requiere consentimiento).",
      params: {
        type: "object",
        properties: { comando: { type: "string", description: "Comando de shell." } },
        required: ["comando"],
      },
      handler: async ({ comando }) => {
        const ok = await consent(comando);
        if (!ok) return "El operador rechazó ejecutar el comando.";
        emit("tool", { name: "ejecutar_comando", state: "running", preview: comando });
        const out = await runCommand(comando);
        emit("tool", { name: "ejecutar_comando", state: "done", preview: comando });
        return out;
      },
    },
    crear_nota: {
      description: "Guardar una nota en el cuaderno persistente de IA-27.",
      params: {
        type: "object",
        properties: { texto: { type: "string", description: "Contenido de la nota." } },
        required: ["texto"],
      },
      handler: async ({ texto }) => {
        emit("tool", { name: "crear_nota", state: "done", preview: "nota" });
        return appendNote(dataDir, texto);
      },
    },
    leer_documento: {
      description: "Extraer texto de un documento (PDF, DOCX, HTML, CSS, TXT, Markdown, JSON, CSV, código).",
      params: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "Ruta absoluta del documento." },
        },
        required: ["ruta"],
      },
      handler: async ({ ruta }) => {
        emit("tool", { name: "leer_documento", state: "running", preview: ruta });
        const { extractText } = require("./documents");
        const doc = await extractText(ruta);
        emit("tool", { name: "leer_documento", state: "done", preview: ruta });
        return "Documento: " + doc.nombre + " (" + doc.extension + ", " + formatBytes(doc.tamano) + ")\n\n" + doc.texto;
      },
    },
    informacion_archivo: {
      description: "Obtener tamaño, tipo y fecha de modificación de un archivo o carpeta.",
      params: {
        type: "object",
        properties: { ruta: { type: "string", description: "Ruta absoluta." } },
        required: ["ruta"],
      },
      handler: async ({ ruta }) => {
        emit("tool", { name: "informacion_archivo", state: "done", preview: ruta });
        return JSON.stringify(fileInfo(ruta), null, 2);
      },
    },
    escribir_archivo: {
      description: "Crear o reescribir un archivo de texto con el contenido indicado (requiere consentimiento).",
      params: {
        type: "object",
        properties: {
          ruta: { type: "string", description: "Ruta absoluta donde guardar el archivo." },
          contenido: { type: "string", description: "Contenido completo del archivo." },
          sobreescribir: { type: "boolean", description: "Si true, reemplaza un archivo existente (por defecto true)." },
        },
        required: ["ruta", "contenido"],
      },
      handler: async ({ ruta, contenido, sobreescribir }) => {
        const ok = await consent("Escribir archivo: " + ruta);
        if (!ok) return "El operador rechazó escribir el archivo.";
        emit("tool", { name: "escribir_archivo", state: "running", preview: ruta });
        const out = writeFileSafely(ruta, contenido, { overwrite: sobreescribir !== false });
        emit("tool", { name: "escribir_archivo", state: "done", preview: ruta });
        return out;
      },
    },
  };

  return tools;
}

module.exports = {
  buildToolHandlers,
  readTextSafely,
  listDirectory,
  searchFiles,
  runCommand,
  systemInfo,
  currentDateTime,
  formatBytes,
  fileInfo,
  writeFileSafely,
};
