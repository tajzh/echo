// Generates the app + tray icons without any image dependency: an "echo" ripple (dot + two rings).
//   node scripts/make-icons.mjs
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// Supersampled coverage of the ripple shape at (u,v) in [0,1]².
function ripple(u, v, { dot = 0.13, rings = [[0.26, 0.05], [0.42, 0.045]] } = {}) {
  let hit = 0; const N = 4;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = u + ((i + 0.5) / N - 0.5) / 64, y = v + ((j + 0.5) / N - 0.5) / 64;
    const d = Math.hypot(x - 0.5, y - 0.5);
    if (d <= dot) hit++;
    else for (const [r, w] of rings) if (Math.abs(d - r) <= w && x >= 0.5 - r * 0.15) hit++; // rings open slightly to the left: an echo going out
  }
  return hit / (N * N);
}
const roundedSquare = (u, v, rad = 0.22) => {
  const x = Math.abs(u - 0.5) - (0.5 - rad), y = Math.abs(v - 0.5) - (0.5 - rad);
  return Math.hypot(Math.max(x, 0), Math.max(y, 0)) <= rad ? 1 : 0;
};

const out = (rel, buf) => { fs.mkdirSync(path.dirname(rel), { recursive: true }); fs.writeFileSync(rel, buf); console.log("wrote", rel, buf.length, "bytes"); };

// App icon: cyan ripple on the app's dark panel colour, rounded square.
out("build/icon.png", png(512, (u, v) => {
  const bg = roundedSquare(u, v); if (!bg) return [0, 0, 0, 0];
  const c = ripple(u, v);
  return [Math.round(23 + (94 - 23) * c), Math.round(26 + (211 - 26) * c), Math.round(33 + (243 - 33) * c), 255];
}));
fs.mkdirSync("app/assets", { recursive: true }); fs.copyFileSync("build/icon.png", "app/assets/icon.png");
// Tray: macOS template (black + alpha), and a light-on-transparent version for Windows/Linux.
out("app/assets/trayTemplate.png", png(22, (u, v) => [0, 0, 0, Math.round(255 * ripple(u, v))]));
out("app/assets/trayTemplate@2x.png", png(44, (u, v) => [0, 0, 0, Math.round(255 * ripple(u, v))]));
out("app/assets/tray.png", png(32, (u, v) => [230, 230, 230, Math.round(255 * ripple(u, v))]));
