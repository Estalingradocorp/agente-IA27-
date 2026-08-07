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

async function fetchWithRetry(url, ms = 12000, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetchWithTimeout(url, ms);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

function parseDuckDuckGoLiteHtml(html, maxResults) {
  const out = [];
  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
  const titles = [];
  let m;
  while ((m = linkRe.exec(html)) && titles.length < maxResults) {
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

function formatSearchResults(query, results) {
  return (
    "RESULTADOS DE BÚSQUEDA PARA: " + query + "\n" +
    results.map((r, i) => (i + 1) + ". " + r.titulo + "\n   URL: " + r.url + "\n   " + (r.resumen || "")).join("\n")
  );
}

async function webSearch(query, maxResults = 5) {
  const q = String(query || "").trim();
  if (!q) return "Indica qué buscar.";

  try {
    try {
      const res = await fetchWithRetry(
        "https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_html=1&skip_disambig=1",
        18000,
        2
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
    } catch (err) {
      // se prueba el buscador HTML
    }

    try {
      const res = await fetchWithRetry("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), 18000, 3);
      if (!res.ok) throw new Error("estado HTTP " + res.status);
      const results = parseDuckDuckGoHtml(await res.text(), maxResults);
      if (results.length) return formatSearchResults(q, results);
    } catch (err) {
      // se prueba la versión ligera del buscador
    }

    try {
      const res = await fetchWithRetry("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q), 18000, 3);
      if (!res.ok) throw new Error("estado HTTP " + res.status);
      const results = parseDuckDuckGoLiteHtml(await res.text(), maxResults);
      if (results.length) return formatSearchResults(q, results);
      return "No se encontraron resultados para: " + q;
    } catch (err) {
      return describeWebError("el buscador (DuckDuckGo)", err) + " Intenta con otros términos.";
    }
  } catch (err) {
    return describeWebError("el buscador (DuckDuckGo)", err) + " Intenta con otros términos.";
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

const NET_ERROR_PATTERN =
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|EADDRINFO|EADDRNOTAVAIL|getaddrinfo|socket hang up|fetch failed|network/i;

function webErrorKind(err) {
  if (!err) return "unknown";
  if (err.name === "AbortError") return "timeout";
  const msg = String(err.message || "");
  const cause = err.cause;
  const codes = [];
  if (cause && cause.code) codes.push(cause.code);
  if (err.code) codes.push(err.code);
  if (codes.some((c) => NET_ERROR_PATTERN.test(String(c)))) return "no-internet";
  if (NET_ERROR_PATTERN.test(msg)) return "no-internet";
  if (typeof err.status === "number" && err.status >= 400) return "service";
  if (/estado HTTP|HTTP \d{3}/i.test(msg)) return "service";
  return "unknown";
}

function describeWebError(service, err) {
  const kind = webErrorKind(err);
  const base = "No se pudo consultar " + service + ".";
  if (kind === "no-internet") {
    return base + " No hay conexión a internet. Revisa el indicador de red y reconecta; IA-27 consulta la web a través de sus herramientas y estas no funcionan sin conexión.";
  }
  if (kind === "timeout") {
    return base + " El servicio no respondió a tiempo; puede estar temporalmente caído o bloqueado. Reintenta en unos segundos.";
  }
  if (kind === "service") {
    const status = typeof err.status === "number" ? err.status : (String(err.message || "").match(/HTTP (\d{3})/i) || [])[1] || "?";
    return base + " El servicio respondió con un error (HTTP " + status + "). Puede estar temporalmente caído; reintenta más tarde.";
  }
  return base + " " + String((err && err.message) || err);
}

async function checkInternet() {
  const targets = [
    "https://html.duckduckgo.com/html/?q=ping",
    "https://open-meteo.com/",
    "https://example.com/",
  ];
  for (const url of targets) {
    const t0 = Date.now();
    try {
      const res = await fetchWithTimeout(url, 7000);
      if (res && res.ok) {
        return { online: true, fuente: url, ms: Date.now() - t0 };
      }
    } catch {
      // se prueba el siguiente objetivo
    }
  }
  return { online: false };
}

async function webSearchWikipedia(query, lang = "es", maxResults = 5) {
  const q = String(query || "").trim();
  if (!q) return "Indica qué consultar en Wikipedia.";
  const api = "https://" + String(lang || "es").replace(/[^a-zA-Z-]/g, "") + ".wikipedia.org/w/api.php";
  const wikiUrl = (title) =>
    "https://" + String(lang || "es").replace(/[^a-zA-Z-]/g, "") + ".wikipedia.org/wiki/" + encodeURIComponent(String(title).replace(/ /g, "_"));

  try {
    const searchRes = await fetchWithRetry(
      api + "?action=query&list=search&srsearch=" + encodeURIComponent(q) + "&srlimit=" + maxResults + "&format=json&origin=*",
      15000,
      3
    );
    if (!searchRes.ok) return "No se pudo consultar Wikipedia (estado HTTP " + searchRes.status + ").";
    const data = await searchRes.json();
    const hits = data && data.query && data.query.search ? data.query.search : [];
    if (!hits.length) return "No se encontraron artículos de Wikipedia para: " + q;

    const top = hits[0];
    try {
      const extRes = await fetchWithRetry(
        api + "?action=query&prop=extracts&exintro=1&explaintext=1&pageids=" + top.pageid + "&format=json&origin=*",
        15000,
        3
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
    return describeWebError("Wikipedia", err);
  }
}

async function webSearchInternetArchive(query, maxResults = 5) {
  const q = String(query || "").trim();
  if (!q) return "Indica qué buscar en Internet Archive.";

  try {
    const searchRes = await fetchWithRetry(
      "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) +
      "&fl[]=identifier&fl[]=title&fl[]=description&fl[]=mediatype&rows=" + maxResults + "&output=json",
      18000,
      3
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

    const wbRes = await fetchWithRetry("https://archive.org/wayback/available?url=" + encodeURIComponent(q), 18000, 3);
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
    return describeWebError("Internet Archive", err);
  }
}

async function geocodeCity(city) {
  const res = await fetchWithTimeout(
    "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(city) +
    "&count=1&language=es&format=json",
    12000
  );
  if (!res.ok) throw new Error("El servicio de geolocalización respondió HTTP " + res.status + ".");
  const data = await res.json();
  const results = data && data.results ? data.results : [];
  if (!results.length) throw new Error("No se encontró la ciudad: " + city);
  const r = results[0];
  return {
    nombre: r.name,
    pais: r.country || "",
    lat: r.latitude,
    lon: r.longitude,
    timezone: r.timezone || "auto",
  };
}

function wmoWeatherText(code) {
  const map = {
    0: "Cielo despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Nublado",
    45: "Niebla", 48: "Niebla con escarcha",
    51: "Llovizna ligera", 53: "Llovizna moderada", 55: "Llovizna intensa",
    56: "Llovizna helada ligera", 57: "Llovizna helada intensa",
    61: "Lluvia ligera", 63: "Lluvia moderada", 65: "Lluvia intensa",
    66: "Lluvia helada ligera", 67: "Lluvia helada intensa",
    71: "Nevada ligera", 73: "Nevada moderada", 75: "Nevada intensa", 77: "Células de nieve",
    80: "Chubascos de lluvia ligera", 81: "Chubascos de lluvia moderada", 82: "Chubascos de lluvia violenta",
    85: "Chubascos de nieve ligera", 86: "Chubascos de nieve intensa",
    95: "Tormenta ligera o moderada", 96: "Tormenta con granizo ligero", 99: "Tormenta con granizo intenso",
  };
  return map[Number(code)] || "Condición desconocida";
}

async function webWeather(city) {
  const c = String(city || "").trim();
  if (!c) return "Indica una ciudad para consultar el clima.";
  try {
    const geo = await geocodeCity(c);
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=" + geo.lat +
      "&longitude=" + geo.lon +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&timezone=auto&forecast_days=3";
    const res = await fetchWithRetry(url, 18000, 3);
    if (!res.ok) throw new Error("El servicio meteorológico respondió HTTP " + res.status + ".");
    const data = await res.json();
    const cur = data.current || {};
    const daily = data.daily || {};

    const lines = [
      "Clima actual en " + geo.nombre + (geo.pais ? ", " + geo.pais : "") + ":",
      "- Estado: " + wmoWeatherText(cur.weather_code),
      "- Temperatura: " + (cur.temperature_2m != null ? cur.temperature_2m + " °C" : "desconocida"),
      "- Sensación térmica: " + (cur.apparent_temperature != null ? cur.apparent_temperature + " °C" : "desconocida"),
      "- Humedad: " + (cur.relative_humidity_2m != null ? cur.relative_humidity_2m + " %" : "desconocida"),
      "- Precipitación: " + (cur.precipitation != null ? cur.precipitation + " mm" : "desconocida"),
      "- Viento: " + (cur.wind_speed_10m != null ? cur.wind_speed_10m + " km/h" : "desconocida"),
    ];

    const days = (daily.time || []).map((d, i) =>
      "  " + d + ": " + wmoWeatherText((daily.weather_code || [])[i]) +
      ", máx " + (daily.temperature_2m_max || [])[i] + " °C, mín " + (daily.temperature_2m_min || [])[i] + " °C" +
      ", prob. lluvia " + (daily.precipitation_probability_max || [])[i] + " %"
    );
    if (days.length) {
      lines.push("Pronóstico próximo:");
      lines.push(days.join("\n"));
    }
    lines.push("Fuente: Open-Meteo (api.open-meteo.com).");
    return lines.join("\n");
  } catch (err) {
    return describeWebError("el servicio meteorológico", err) + " Intenta con otra ciudad.";
  }
}

async function worldTime(city) {
  const c = String(city || "").trim();
  if (!c) return "Indica una ciudad para conocer su hora local.";
  try {
    const geo = await geocodeCity(c);
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + geo.lat +
      "&longitude=" + geo.lon + "&current=temperature_2m&timezone=auto&forecast_days=1";
    const res = await fetchWithRetry(url, 18000, 3);
    if (!res.ok) throw new Error("El servicio horario respondió HTTP " + res.status + ".");
    const data = await res.json();
    const zone = data.timezone || "desconocida";
    const offset = Number(data.utc_offset_seconds || 0);
    const local = new Date(Date.now() + offset * 1000);
    const hora = local.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const fecha = local.toLocaleDateString("es-ES", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const utc = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
    return (
      "Hora local en " + geo.nombre + (geo.pais ? ", " + geo.pais : "") + ":\n" +
      "  Fecha: " + fecha + "\n" +
      "  Hora: " + hora + "\n" +
      "  Zona horaria: " + zone + " (UTC" + (offset >= 0 ? "+" : "") + (offset / 3600) + ")\n" +
      "  Hora UTC de referencia: " + utc + "\n" +
      "Fuente: Open-Meteo (api.open-meteo.com)."
    );
  } catch (err) {
    return describeWebError("el servicio horario", err) + " Intenta con otra ciudad.";
  }
}

async function currencyRates(base, target, amount) {
  const b = String(base || "USD").trim().toUpperCase().slice(0, 3);
  const t = String(target || "").trim().toUpperCase().slice(0, 3);
  const amt = Number(amount == null ? 1 : amount);
  try {
    const res = await fetchWithRetry("https://open.er-api.com/v6/latest/" + encodeURIComponent(b), 18000, 3);
    if (!res.ok) throw new Error("El servicio de divisas respondió HTTP " + res.status + ".");
    const data = await res.json();
    if (!data || data.result !== "success") throw new Error(data && data["error-type"] ? data["error-type"] : "respuesta inválida del servicio de divisas.");
    const rates = data.rates || {};

    if (!t) {
      const common = ["EUR", "GBP", "JPY", "ARS", "MXN", "CLP", "COP", "BRL", "UYU", "PEN", "BOB", "VES"];
      const top = common.filter((k) => rates[k] != null).map((k) => "  1 " + b + " = " + Number(rates[k]).toFixed(2) + " " + k);
      return (
        "Tasas de cambio de 1 " + b + " (actualizado " + (data.time_last_update_utc || "recientemente") + "):\n" +
        top.join("\n") + "\nFuente: open.er-api.com"
      );
    }
    if (rates[t] == null) throw new Error("No existe la moneda '" + t + "'.");
    const converted = amt * rates[t];
    return (
      amt + " " + b + " = " + Number(converted).toFixed(2) + " " + t +
      " (1 " + b + " = " + Number(rates[t]).toFixed(4) + " " + t + ").\n" +
      "Fuente: open.er-api.com"
    );
  } catch (err) {
    return describeWebError("el servicio de divisas", err) + " Verifica los códigos de moneda (USD, EUR, ARS, etc.).";
  }
}

function stripRssTags(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function newsHeadlines(query) {
  const q = String(query || "").trim();
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(q || "noticias") +
    "&hl=es&gl=ES&ceid=ES:es";
  try {
    const res = await fetchWithRetry(url, 18000, 3);
    if (!res.ok) throw new Error("El servicio de noticias respondió HTTP " + res.status + ".");
    const xml = await res.text();
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) && items.length < 8) {
      const body = m[1];
      const titleM = body.match(/<title>(.*?)<\/title>/);
      if (titleM) {
        const linkM = body.match(/<link>(.*?)<\/link>/);
        items.push({ titulo: stripRssTags(titleM[1]), url: linkM ? linkM[1].trim() : "" });
      }
    }
    if (!items.length) return "No se encontraron noticias para: " + (q || "general");
    return (
      "NOTICIAS RECIENTES" + (q ? " SOBRE: " + q : "") + ":\n" +
      items.map((it, i) => (i + 1) + ". " + it.titulo + (it.url ? "\n   " + it.url : "")).join("\n") +
      "\nFuente: Google News RSS."
    );
  } catch (err) {
    return describeWebError("el servicio de noticias (Google News RSS)", err);
  }
}

function normalizeText(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

async function fetchWorldBankCountry(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  try {
    const res = await fetchWithRetry(
      "https://api.worldbank.org/v2/country/" + encodeURIComponent(q) + "?format=json&per_page=1",
      15000,
      3
    );
    if (res.ok) {
      const data = await res.json();
      const arr = data && data[1] ? data[1] : [];
      if (arr.length) return arr[0];
    }
  } catch {
    // se intenta resolver por nombre
  }
  try {
    const listRes = await fetchWithRetry(
      "https://api.worldbank.org/v2/country/all?format=json&per_page=400",
      25000,
      3
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      const all = listData && listData[1] ? listData[1] : [];
      const needle = normalizeText(q);
      const match = all.find((x) => {
        const n = normalizeText(x.name);
        return n === needle || normalizeText(x.id) === needle ||
          normalizeText(x.iso2Code) === needle ||
          (needle.length > 2 && n.includes(needle));
      });
      if (match) return match;
    }
  } catch {
    // sin resolución por nombre
  }
  return null;
}

async function countryInfo(country) {
  const c = String(country || "").trim();
  if (!c) return "Indica un país para obtener su información.";
  try {
    const info = await fetchWorldBankCountry(c);
    if (!info) throw new Error("No se encontró el país '" + c + "'.");
    const lines = [
      "País: " + (info.name || "desconocido"),
      "Capital: " + (info.capitalCity || "desconocida"),
      "Región: " + ((info.region && info.region.value) || "desconocida"),
      "Nivel de ingreso: " + ((info.incomeLevel && info.incomeLevel.value) || "desconocido"),
      "Código ISO: " + (info.iso2Code || "desconocido"),
    ];
    try {
      const popRes = await fetchWithRetry(
        "https://api.worldbank.org/v2/country/" + encodeURIComponent(info.id || c) + "/indicator/SP.POP.TOTL?format=json&date=2023",
        15000,
        3
      );
      if (popRes.ok) {
        const popData = await popRes.json();
        const popArr = popData && popData[1] ? popData[1] : [];
        if (popArr.length && popArr[0].value != null) {
          lines.push("Población (2023): " + Number(popArr[0].value).toLocaleString("es-ES") + " habitantes");
        }
      }
    } catch {
      // población opcional
    }
    lines.push("Fuente: Banco Mundial (api.worldbank.org).");
    return lines.join("\n");
  } catch (err) {
    return describeWebError("el Banco Mundial", err) + " Verifica el nombre del país.";
  }
}

function extractPageText(html) {
  let t = String(html || "");
  t = t.replace(/<script[\s\S]*?<\/script>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, " ");
  t = t.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  t = t.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  t = t.replace(/<header[\s\S]*?<\/header>/gi, " ");
  t = t.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  return stripTags(t);
}

async function readPage(url) {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return "Indica una URL válida que empiece por http:// o https://.";
  try {
    const res = await fetchWithRetry(u, 20000, 3);
    if (!res.ok) return "No se pudo acceder a la página (estado HTTP " + res.status + ").";
    const ctype = res.headers.get("content-type") || "";
    if (/image|video|audio|pdf|zip|octet-stream/i.test(ctype)) {
      return "La URL apunta a un archivo no textual (" + ctype + "), no se puede leer su contenido.";
    }
    const raw = await res.text();
    const clean = extractPageText(raw).slice(0, 6000);
    if (!clean) return "La página no contiene texto legible: " + u;
    return (
      "CONTENIDO DE: " + u + "\n\n" + clean +
      (raw.length > 6000 ? "\n\n[contenido truncado por límite de lectura]" : "")
    );
  } catch (err) {
    return describeWebError("la página", err);
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
      description: "Buscar libros y documentos públicos, audio y video en Internet Archive, o snapshots históricos de páginas web en Wayback Machine. NO es para noticias recientes ni para la web actual; para eso usa noticias o buscar_internet. Siempre disponible, no requiere configuración.",
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
    consultar_clima: {
      description: "Clima, temperatura, sensación térmica, humedad, lluvia y pronóstico de los próximos días para una ciudad. Usa SIEMPRE esta herramienta cuando pregunten por clima, tiempo, temperatura, pronóstico o lluvia. Gratuito, sin configuración ni clave.",
      params: {
        type: "object",
        properties: {
          ciudad: { type: "string", description: "Nombre de la ciudad, p. ej. 'Buenos Aires' o 'Londres'." },
        },
        required: ["ciudad"],
      },
      handler: async ({ ciudad }) => {
        emit("tool", { name: "consultar_clima", state: "running", preview: ciudad });
        const out = await webWeather(ciudad);
        emit("tool", { name: "consultar_clima", state: "done", preview: ciudad });
        return out;
      },
    },
    hora_mundial: {
      description: "Hora local actual, fecha y zona horaria de una ciudad del mundo. Usa SIEMPRE esta herramienta cuando pregunten por la hora, qué hora es, o la zona horaria de otra ciudad. Gratuito, sin configuración ni clave.",
      params: {
        type: "object",
        properties: {
          ciudad: { type: "string", description: "Nombre de la ciudad, p. ej. 'Tokio' o 'Ciudad de México'." },
        },
        required: ["ciudad"],
      },
      handler: async ({ ciudad }) => {
        emit("tool", { name: "hora_mundial", state: "running", preview: ciudad });
        const out = await worldTime(ciudad);
        emit("tool", { name: "hora_mundial", state: "done", preview: ciudad });
        return out;
      },
    },
    tipo_cambio: {
      description: "Conversión y tasas de cambio de divisas: dólar, euro, pesos u otras monedas (p. ej. cuánto vale 1 dólar en pesos, o convertir 100 EUR a USD). Usa SIEMPRE esta herramienta cuando pregunten por monedas, cambio de divisas o conversión. Gratuito, sin configuración ni clave.",
      params: {
        type: "object",
        properties: {
          base: { type: "string", description: "Código de la moneda base de 3 letras, p. ej. USD, EUR, ARS (por defecto USD)." },
          objetivo: { type: "string", description: "Código de la moneda destino de 3 letras (opcional; si se omite se listan tasas comunes)." },
          cantidad: { type: "number", description: "Cantidad a convertir (opcional, por defecto 1)." },
        },
        required: [],
      },
      handler: async ({ base, objetivo, cantidad }) => {
        emit("tool", { name: "tipo_cambio", state: "running", preview: base + "/" + (objetivo || "?") });
        const out = await currencyRates(base, objetivo, cantidad);
        emit("tool", { name: "tipo_cambio", state: "done", preview: base + "/" + (objetivo || "?") });
        return out;
      },
    },
    noticias: {
      description: "Titulares de noticias recientes y actualidad, opcionalmente filtrados por tema (p. ej. 'tecnología', 'fútbol', 'Argentina'). Usa SIEMPRE esta herramienta para noticias, actualidad o titulares recientes; NUNCA uses buscar_internet_archive para noticias actuales. Gratuito, sin configuración ni clave.",
      params: {
        type: "object",
        properties: {
          consulta: { type: "string", description: "Tema o palabras clave (opcional; p. ej. 'tecnología' o 'fútbol'). Si se omite, se obtienen noticias generales." },
        },
        required: [],
      },
      handler: async ({ consulta }) => {
        emit("tool", { name: "noticias", state: "running", preview: consulta || "general" });
        const out = await newsHeadlines(consulta);
        emit("tool", { name: "noticias", state: "done", preview: consulta || "general" });
        return out;
      },
    },
    informacion_pais: {
      description: "Datos de un país: capital, región, nivel de ingreso, código ISO y población. Gratuito, sin configuración ni clave.",
      params: {
        type: "object",
        properties: {
          pais: { type: "string", description: "Nombre o código ISO del país, p. ej. 'Argentina' o 'AR'." },
        },
        required: ["pais"],
      },
      handler: async ({ pais }) => {
        emit("tool", { name: "informacion_pais", state: "running", preview: pais });
        const out = await countryInfo(pais);
        emit("tool", { name: "informacion_pais", state: "done", preview: pais });
        return out;
      },
    },
    leer_pagina: {
      description: "Extraer el texto legible de una página web o URL. Gratuito, sin configuración ni clave.",
      params: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL completa que empiece por http:// o https://." },
        },
        required: ["url"],
      },
      handler: async ({ url }) => {
        emit("tool", { name: "leer_pagina", state: "running", preview: url });
        const out = await readPage(url);
        emit("tool", { name: "leer_pagina", state: "done", preview: url });
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
  checkInternet,
};
