const os = require("node:os");
const { execFileSync } = require("node:child_process");

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

function runPowershell(script) {
  try {
    const raw = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, encoding: "utf8", timeout: 15000 }
    );
    return raw.trim();
  } catch {
    return null;
  }
}

function detectGPU() {
  const raw = runPowershell(
    "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,Status | ConvertTo-Json -Compress"
  );
  if (!raw) return [];

  try {
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data ? [data] : [];
    return items.map((g) => ({
      name: (g.Name || "Desconocido").trim(),
      vramBytes: g.FormatVersion ? Number(g.FormatVersion) || 0 : 0,
      vram: formatBytes(g.FormatVersion && g.AdapterRAM ? Number(g.AdapterRAM) : 0),
      vramRaw: Number(g.AdapterRAM) || 0,
      status: g.Status || "OK",
    }));
  } catch {
    return [];
  }
}

function detectCuda() {
  try {
    const r = runPowershell('nvidia-smi --query-gpu=name --format=csv,noheader 2>$null');
    return !!(r && r.length > 0);
  } catch {
    return false;
  }
}

function detectDiskFree(dataDir) {
  try {
    const fs = require("node:fs");
    const drive = dataDir ? dataDir.substring(0, 2) : "C:";
    const raw = runPowershell(
      `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'" | Select-Object FreeSpace,Size | ConvertTo-Json -Compress`
    );
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      drive,
      free: Number(d.FreeSpace) || 0,
      total: Number(d.Size) || 0,
      freeFormatted: formatBytes(d.FreeSpace),
      totalFormatted: formatBytes(d.Size),
    };
  } catch {
    return null;
  }
}

function profile(dataDir) {
  const cpus = os.cpus();
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const gpus = detectGPU();
  const cudaAvailable = detectCuda();
  const disk = detectDiskFree(dataDir);

  const vramTotal = gpus.reduce((acc, g) => acc + g.vramRaw, 0);
  const gpuNames = gpus.map((g) => g.name);

  return {
    cpu: {
      model: cpus.length ? cpus[0].model.trim() : "desconocido",
      logicalCores: cpus.length,
      platform: os.platform(),
      arch: os.arch(),
    },
    ram: {
      total: totalRam,
      free: freeRam,
      used: totalRam - freeRam,
      totalFormatted: formatBytes(totalRam),
      freeFormatted: formatBytes(freeRam),
    },
    gpu: {
      available: gpus.length > 0,
      devices: gpus,
      primary: gpus.length > 0 ? gpus[0] : null,
      vramTotal,
      vramTotalFormatted: formatBytes(vramTotal),
      cudaAvailable,
    },
    disk: disk || { total: 0, free: 0, totalFormatted: "desconocido", freeFormatted: "desconocido" },
    accelerationCapability: cudaAvailable ? "cuda" : gpus.length > 0 ? "possible-vulkan" : "cpu-only",
  };
}

module.exports = { profile, formatBytes };