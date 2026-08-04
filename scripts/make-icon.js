const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 256;

function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}

function setPixel(canvas, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  canvas.data[i] = r;
  canvas.data[i + 1] = g;
  canvas.data[i + 2] = b;
  canvas.data[i + 3] = a;
}

function fillCircle(canvas, cx, cy, radius, r, g, b, baseAlpha) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(canvas.size - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(canvas.size - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const falloff = Math.pow(1 - dist / radius, 2);
      const a = Math.round(baseAlpha * falloff);
      if (a <= 0) continue;
      const i = (y * canvas.size + x) * 4;
      const srcA = canvas.data[i + 3] / 255;
      const outA = a / 255 + srcA * (1 - a / 255);
      if (outA <= 0) continue;
      canvas.data[i] = Math.round((r * a / 255 + canvas.data[i] * srcA * (1 - a / 255)) / outA);
      canvas.data[i + 1] = Math.round((g * a / 255 + canvas.data[i + 1] * srcA * (1 - a / 255)) / outA);
      canvas.data[i + 2] = Math.round((b * a / 255 + canvas.data[i + 2] * srcA * (1 - a / 255)) / outA);
      canvas.data[i + 3] = Math.round(outA * 255);
    }
  }
}

function drawStar(canvas, cx, cy, outer, inner, r, g, b, a, rotation = 0) {
  const points = 4;
  const pts = [];
  for (let i = 0; i < points * 2; i += 1) {
    const rad = i % 2 === 0 ? outer : inner;
    const ang = rotation + (Math.PI / points) * i;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  const minX = Math.max(0, Math.floor(cx - outer));
  const maxX = Math.min(canvas.size - 1, Math.ceil(cx + outer));
  const minY = Math.max(0, Math.floor(cy - outer));
  const maxY = Math.min(canvas.size - 1, Math.ceil(cy + outer));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let inside = false;
      let j = pts.length - 1;
      for (let i = 0; i < pts.length; i += 1) {
        const xi = pts[i][0];
        const yi = pts[i][1];
        const xj = pts[j][0];
        const yj = pts[j][1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
        j = i;
      }
      if (inside) {
        const i = (y * canvas.size + x) * 4;
        const srcA = canvas.data[i + 3] / 255;
        const outA = a + srcA * (1 - a);
        canvas.data[i] = Math.round((r * a + canvas.data[i] * srcA * (1 - a)) / outA);
        canvas.data[i + 1] = Math.round((g * a + canvas.data[i + 1] * srcA * (1 - a)) / outA);
        canvas.data[i + 2] = Math.round((b * a + canvas.data[i + 2] * srcA * (1 - a)) / outA);
        canvas.data[i + 3] = Math.round(outA * 255);
      }
    }
  }
}

function encodePNG(canvas) {
  const { size, data } = canvas;
  const header = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    header[y * (size * 4 + 1)] = 0;
    data.copy(header, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks = [];
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(makeChunk("IHDR", ihdr));
  chunks.push(makeChunk("IDAT", zlib.deflateSync(header, { level: 9 })));
  chunks.push(makeChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  const bytes = Buffer.concat([Buffer.from(type, "ascii"), data]);
  for (const b of bytes) {
    crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

function makeICO(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

function build() {
  const c = makeCanvas(SIZE);
  fillCircle(c, SIZE / 2, SIZE / 2, SIZE * 0.72, 6, 10, 24, 1.0);
  fillCircle(c, SIZE / 2 - 18, SIZE / 2 - 14, SIZE * 0.5, 20, 70, 200, 0.55);
  fillCircle(c, SIZE / 2 + 22, SIZE / 2 + 16, SIZE * 0.34, 74, 140, 255, 0.5);
  fillCircle(c, SIZE / 2 + 6, SIZE / 2 - 30, SIZE * 0.3, 120, 170, 255, 0.4);
  drawStar(c, SIZE / 2, SIZE / 2, SIZE * 0.33, SIZE * 0.11, 215, 235, 255, 0.98, -Math.PI / 4);
  fillCircle(c, SIZE / 2, SIZE / 2, SIZE * 0.06, 255, 255, 255, 0.95);
  drawStar(c, SIZE * 0.24, SIZE * 0.3, 9, 3.5, 200, 225, 255, 0.7);
  drawStar(c, SIZE * 0.76, SIZE * 0.68, 7, 2.6, 190, 220, 255, 0.6);
  drawStar(c, SIZE * 0.8, SIZE * 0.22, 6, 2.2, 210, 235, 255, 0.5);
  drawStar(c, SIZE * 0.2, SIZE * 0.72, 5, 1.9, 205, 230, 255, 0.5);

  const png = encodePNG(c);
  const ico = makeICO(png, SIZE);
  const outDir = path.join(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });
  const icoPath = path.join(outDir, "icon.ico");
  fs.writeFileSync(icoPath, ico);
  fs.writeFileSync(path.join(outDir, "icon.png"), png);
  console.log("Icono generado:", icoPath, ico.length, "bytes");
}

build();
