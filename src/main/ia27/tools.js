const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { COMPANY_INFO } = require("./company");

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

function looksLikeWebQuery(pattern, dirPath) {
  const p = String(pattern || "").trim();
  const d = String(dirPath || "").trim();
  if (!p) return false;
  if (p.includes("*") || p.includes("?")) return false;
  const pl = p.toLowerCase();
  const dl = d.toLowerCase();

  if (d && (
    dl.includes("internet") ||
    dl.includes("http") ||
    dl.includes("www") ||
    dl.includes("google") ||
    dl.includes("duckduckgo") ||
    dl.includes("wikipedia") ||
    dl.includes("wiki") ||
    dl.includes("archive.org") ||
    dl.includes("wayback") ||
    dl.startsWith("/web")
  )) return true;

  if (
    pl.includes("://") ||
    pl.startsWith("http") ||
    pl.startsWith("www.") ||
    pl.includes("buscar en internet") ||
    pl.includes("wikipedia") ||
    pl.includes("wiki") ||
    pl.includes("archive.org") ||
    pl.includes("wayback") ||
    pl.includes(" buscar ") ||
    pl.startsWith("internet ")
  ) return true;

  return /[\p{L}]{2,}\s+[\p{L}]{2,}/u.test(p);
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

function stripTags(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDdgUrl(url) {
  const m = String(url || "").match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  return url;
}

function parseDuckDuckGoHtml(html, maxResults) {
  const out = [];
  const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const titles = [];
  let m;
  while ((m = titleRe.exec(html)) && titles.length < maxResults) {
    titles.push({ url: decodeDdgUrl(m[1]), title: stripTags(m[2]) });
  }
  const snippets = [];
  while ((m = snipRe.exec(html)) && snippets.length < maxResults) {
    snippets.push(stripTags(m[1]));
  }
  for (let i = 0; i < titles.length; i += 1) {
    out.push({ titulo: titles[i].title, url: titles[i].url, resumen: snippets[i] || "" });
  }
  return out;
}

async function webSearch(query, maxResults = 5) {
  const q = String(query || "").trim();
  if (!q) return "Indica qué buscar.";
  const fetchWithTimeout = (url, ms = 10000) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    return fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IA27/1.1" },
    }).finally(() => clearTimeout(timer));
  };

  try {
    try {
      const res = await fetchWithTimeout(
        "https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_html=1&skip_disambig=1"
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.AbstractText) {
          const direct =
            "RESULTADO DIRECTO:\n" + stripTags(data.AbstractText) +
            (data.AbstractURL ? "\nFuente: " + data.AbstractURL : "");
          return direct;
        }
      }
    } catch {
      // se prueba el buscador HTML
    }

    const res = await fetchWithTimeout("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q));
    if (!res.ok) return "No se pudo consultar el buscador (estado HTTP " + res.status + ").";
    const html = await res.text();
    const results = parseDuckDuckGoHtml(html, maxResults);
    if (!results.length) return "No se encontraron resultados para: " + q;
    return (
      "RESULTADOS DE BÚSQUEDA PARA: " + q + "\n" +
      results.map((r, i) => (i + 1) + ". " + r.titulo + "\n   URL: " + r.url + "\n   " + (r.resumen || "")).join("\n")
    );
  } catch (err) {
    return "Error al buscar en internet: " + String((err && err.message) || err);
  }
}

function fetchWithTimeout(url, ms = 10000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  return fetch(url, {
    signal: ac.signal,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IA27/1.1" },
  }).finally(() => clearTimeout(timer));
}

async function webSearchWikipedia(query, lang = "es", maxResults = 5) {
  const q = String(query || "").trim();
  if (!q) return "Indica qué consultar en Wikipedia.";
  const api = "https://" + String(lang || "es").replace(/[^a-zA-Z-]/g, "") + ".wikipedia.org/w/api.php";
  const wikiUrl = (title) =>
    "https://" + String(lang || "es").replace(/[^a-zA-Z-]/g, "") + ".wikipedia.org/wiki/" + encodeURIComponent(String(title).replace(/ /g, "_"));

  try {
    const searchRes = await fetchWithTimeout(
      api + "?action=query&list=search&srsearch=" + encodeURIComponent(q) + "&srlimit=" + maxResults + "&format=json&origin=*",
      12000
    );
    if (!searchRes.ok) return "No se pudo consultar Wikipedia (estado HTTP " + searchRes.status + ").";
    const data = await searchRes.json();
    const hits = data && data.query && data.query.search ? data.query.search : [];
    if (!hits.length) return "No se encontraron artículos de Wikipedia para: " + q;

    const top = hits[0];
    try {
      const extRes = await fetchWithTimeout(
        api + "?action=query&prop=extracts&exintro=1&explaintext=1&pageids=" + top.pageid + "&format=json&origin=*",
        12000
      );
      if (extRes.ok) {
        const extData = await extRes.json();
        const pages = extData && extData.query && extData.query.pages ? extData.query.pages : {};
        const page = Object.keys(pages).map((k) => pages[k])[0];
        if (page && page.extract) {
          return (
            "RESULTADO DE WIKIPEDIA PARA: " + q + "\n\n" +
            "Artículo: " + page.title + "\n\n" +
            page.extract.slice(0, 3000) + "\n\n" +
            "URL: " + wikiUrl(page.title)
          );
        }
      }
    } catch {
      // se vuelve a la lista de resultados
    }

    const lines = hits.map((h) => {
      const title = h.title;
      return (
        "• " + title + "\n  " + stripTags(h.snippet || "") + "\n  URL: " + wikiUrl(title)
      );
    });
    return "RESULTADOS DE WIKIPEDIA PARA: " + q + "\n" + lines.join("\n\n");
  } catch (err) {
    return "Error al consultar Wikipedia: " + String((err && err.message) || err);
  }
}

async function webSearchInternetArchive(query, maxResults = 5) {
  const q = String(query || "").trim();
  if (!q) return "Indica qué buscar en Internet Archive.";

  try {
    const searchRes = await fetchWithTimeout(
      "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) +
      "&fl[]=identifier&fl[]=title&fl[]=description&fl[]=mediatype&rows=" + maxResults + "&output=json",
      15000
    );
    if (searchRes.ok) {
      const data = await searchRes.json();
      const docs = data && data.response && data.response.docs ? data.response.docs : [];
      if (docs.length) {
        const lines = docs.map((d) => {
          const ident = String(d.identifier || "");
          const title = String(d.title || ident || "sin título");
          const desc = Array.isArray(d.description) ? d.description[0] : d.description;
          return (
            "• " + title + " (" + (d.mediatype || "?") + ")\n  " +
            stripTags(String(desc || "")).slice(0, 200) + "\n  URL: https://archive.org/details/" + encodeURIComponent(ident)
          );
        });
        return "RESULTADOS DE INTERNET ARCHIVE PARA: " + q + "\n" + lines.join("\n\n");
      }
    }

    const wbRes = await fetchWithTimeout("https://archive.org/wayback/available?url=" + encodeURIComponent(q), 15000);
    if (wbRes.ok) {
      const wbData = await wbRes.json();
      const snap = wbData && wbData.archived_snapshots && wbData.archived_snapshots.closest;
      if (snap && snap.url) {
        return (
          "ARCHIVO WAYBACK MACHINE:\n" + q + "\n" +
          "Snapshots disponibles en: " + snap.url + "\n" +
          "Guardado: " + (snap.timestamp || "desconocido") + ".\n" +
          "URL completa: " + snap.url
        );
      }
    }

    return "No se encontraron resultados en Internet Archive para: " + q;
  } catch (err) {
    return "Error al consultar Internet Archive: " + String((err && err.message) || err);
  }
}

function buildToolHandlers(ctx) {
  const { emit, consent, openPath, dataDir, settings } = ctx;

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
        try {
          return JSON.stringify(listDirectory(ruta), null, 2);
        } catch (err) {
          return "La carpeta '" + (ruta || "") + "' no existe en este equipo o es inaccesible. Verifica la ruta. Si buscabas información, prueba con buscar_wikipedia, buscar_internet_archive o buscar_internet.";
        }
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
        try {
          return readTextSafely(ruta, 60000, max_lineas || 800);
        } catch (err) {
          return "No se pudo leer el archivo '" + ruta + "': " + String((err && err.message) || err) + ". Verifica que exista en este equipo. Si buscabas información, prueba con buscar_wikipedia o buscar_internet_archive.";
        }
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
        const lp = String(patron || "").toLowerCase();
        const lc = String(carpeta || "").toLowerCase();
        if (lc.includes("wikipedia") || lp.includes("wikipedia") || lp.includes("wiki")) {
          const topic = String(patron || "").replace(/buscar\s*(en)?\s*wikipedia|wikipedia|wiki/gi, "").replace(/^\s*sobre\s+/i, "").replace(/^\s*acerca\s+de\s+/i, "").trim();
          emit("tool", { name: "buscar_archivos", state: "running", preview: patron });
          const out = await webSearchWikipedia(topic || patron);
          emit("tool", { name: "buscar_archivos", state: "done", preview: patron });
          return "NOTA: redirigido automáticamente a la búsqueda en Wikipedia (buscar_wikipedia).\n\n" + out;
        }
        if (lc.includes("archive.org") || lc.includes("wayback") || lp.includes("archive.org") || lp.includes("wayback")) {
          emit("tool", { name: "buscar_archivos", state: "running", preview: patron });
          const out = await webSearchInternetArchive(patron);
          emit("tool", { name: "buscar_archivos", state: "done", preview: patron });
          return "NOTA: redirigido automáticamente a la búsqueda en Internet Archive (buscar_internet_archive).\n\n" + out;
        }
        if (looksLikeWebQuery(patron, carpeta)) {
          if (!settings || settings.buscarInternet !== true) {
            emit("tool", { name: "buscar_archivos", state: "done", preview: patron });
            return "Parece que querías buscar en internet, pero la búsqueda en internet está deshabilitada. El operador debe activarla en ⚙ Ajustes (Permitir búsqueda en internet).";
          }
          emit("tool", { name: "buscar_archivos", state: "running", preview: patron });
          const out = await webSearch(patron);
          emit("tool", { name: "buscar_archivos", state: "done", preview: patron });
          return "NOTA: la consulta fue redirigida automáticamente a la búsqueda en internet (buscar_internet).\n\n" + out;
        }
        emit("tool", { name: "buscar_archivos", state: "done", preview: patron });
        try {
          return JSON.stringify(searchFiles(patron, carpeta), null, 2);
        } catch (err) {
          return "La carpeta '" + (carpeta || "") + "' no existe en este equipo o es inaccesible. Verifica la ruta. Si buscabas información, prueba con buscar_wikipedia, buscar_internet_archive o buscar_internet.";
        }
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
        try {
          const { extractText } = require("./documents");
          const doc = await extractText(ruta);
          emit("tool", { name: "leer_documento", state: "done", preview: ruta });
          return "Documento: " + doc.nombre + " (" + doc.extension + ", " + formatBytes(doc.tamano) + ")\n\n" + doc.texto;
        } catch (err) {
          emit("tool", { name: "leer_documento", state: "done", preview: ruta });
          return "No se pudo leer el documento '" + ruta + "': " + String((err && err.message) || err) + ". Verifica que exista en este equipo.";
        }
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
        try {
          return JSON.stringify(fileInfo(ruta), null, 2);
        } catch (err) {
          return "La ruta '" + ruta + "' no existe en este equipo o es inaccesible. Verifica la ruta. Si buscabas información, prueba con buscar_wikipedia o buscar_internet_archive.";
        }
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
    info_empresa: {
      description: "Información oficial y verificada sobre Estalingrado Corp: productos, proyectos, redes y datos de la corporación.",
      params: {
        type: "object",
        properties: {
          tema: { type: "string", description: "Aspecto a consultar (opcional): productos, proyectos, redes, filosofía, etc." },
        },
        required: [],
      },
      handler: async ({ tema }) => {
        emit("tool", { name: "info_empresa", state: "done", preview: tema || "ficha corporativa" });
        return COMPANY_INFO;
      },
    },
    buscar_internet: {
      description: "Buscar información actualizada en internet (requiere que el operador lo habilite en Ajustes).",
      params: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Consulta o términos a buscar en la web." },
        },
        required: ["consulta"],
      },
      handler: async ({ consulta }) => {
        if (!settings || settings.buscarInternet !== true) {
          return "La búsqueda en internet está deshabilitada. El operador debe activarla en ⚙ Ajustes (Permitir búsqueda en internet).";
        }
        emit("tool", { name: "buscar_internet", state: "running", preview: consulta });
        const out = await webSearch(consulta);
        emit("tool", { name: "buscar_internet", state: "done", preview: consulta });
        return out;
      },
    },
    buscar_wikipedia: {
      description: "Buscar en Wikipedia (enciclopedia libre). Ideal para definiciones, biografías, conceptos, historia y datos enciclopédicos. Siempre disponible, no requiere configuración.",
      params: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Término o tema a buscar en Wikipedia." },
          idioma: { type: "string", description: "Código de idioma (opcional): es, en, etc. Por defecto 'es'." },
        },
        required: ["consulta"],
      },
      handler: async ({ consulta, idioma }) => {
        emit("tool", { name: "buscar_wikipedia", state: "running", preview: consulta });
        const out = await webSearchWikipedia(consulta, idioma || "es");
        emit("tool", { name: "buscar_wikipedia", state: "done", preview: consulta });
        return out;
      },
    },
    buscar_internet_archive: {
      description: "Buscar en Internet Archive y Wayback Machine: libros y documentos públicos, páginas web archivadas, audio y video. Siempre disponible, no requiere configuración.",
      params: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Término a buscar, o una URL para consultar snapshots en Wayback Machine." },
        },
        required: ["consulta"],
      },
      handler: async ({ consulta }) => {
        emit("tool", { name: "buscar_internet_archive", state: "running", preview: consulta });
        const out = await webSearchInternetArchive(consulta);
        emit("tool", { name: "buscar_internet_archive", state: "done", preview: consulta });
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
