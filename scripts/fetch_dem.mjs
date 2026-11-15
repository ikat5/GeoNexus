// node scripts/fetch_dem.mjs — downloads real NASA DEMs (keyless) and writes 8-bit equirectangular PNGs to data/.
//   Moon: LRO LOLA 16 ppd (NASA SVS CGI Moon Kit, uint16 half-metres above 1727.4 km)
//   Mars: MGS MOLA MEGDR 16 ppd (PDS Geosciences, int16 MSB metres, first sample at 0°E)
// Output: 2880x1440 (8 ppd), west edge -180°, north row first, luminance 0..255 = range[0]..range[1] metres.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const OUT = new URL('../data/', import.meta.url);
const SOURCES = {
  moon: {
    url: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif',
    range: [-9100, 10700], decode: (buf) => tiff(buf, (v) => v / 2 - 10000), lon0: -180,
  },
  mars: {
    url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img',
    range: [-8200, 21200], decode: (buf) => ({ W: 5760, H: 2880, h: Float32Array.from({ length: 5760 * 2880 }, (_, i) => buf.readInt16BE(i * 2)) }), lon0: 0,
  },
};

// minimal uncompressed single-band TIFF reader (uint16 strips)
function tiff(buf, toMetres) {
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = u32(4), tags = {};
  for (let i = 0, n = u16(ifd); i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4), size = type === 3 ? 2 : 4;
    if (![256, 257, 258, 259, 273, 279].includes(tag)) continue; // only SHORT/LONG geometry + strip tags are needed
    const at = count * size > 4 ? u32(e + 8) : e + 8;
    tags[tag] = Array.from({ length: count }, (_, k) => (size === 2 ? u16(at + k * 2) : u32(at + k * 4)));
  }
  const W = tags[256][0], H = tags[257][0];
  if ((tags[259]?.[0] ?? 1) !== 1 || tags[258][0] !== 16) throw new Error('expected uncompressed 16-bit TIFF');
  const h = new Float32Array(W * H);
  let i = 0;
  tags[273].forEach((off, s) => { for (let b = 0; b < tags[279][s]; b += 2) h[i++] = toMetres(u16(off + b)); });
  if (i !== W * H) throw new Error(`TIFF pixel count ${i} != ${W * H}`);
  return { W, H, h };
}

// 8-bit grayscale PNG, filter 0 on every row (tests/selfcheck.mjs relies on that)
function png(W, H, gray) {
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0; // 8-bit grayscale
  const raw = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < H; y++) gray.copy(raw, y * (W + 1) + 1, y * W, (y + 1) * W);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
for (const [body, src] of Object.entries(SOURCES)) {
  console.log(`${body}: downloading ${src.url}`);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`${body}: HTTP ${res.status}`);
  const { W, H, h } = src.decode(Buffer.from(await res.arrayBuffer()));
  const w = W / 2, hh = H / 2, shift = Math.round(((-180 - src.lon0) / 360) * w); // roll so the west edge is -180°
  const [lo, hi] = src.range, gray = Buffer.alloc(w * hh);
  let max = -Infinity, min = Infinity, argmax = 0, argmin = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
    const sx = (((x + shift) % w) + w) % w * 2, sy = y * 2; // 2x2 box downsample
    const m = (h[sy * W + sx] + h[sy * W + sx + 1] + h[(sy + 1) * W + sx] + h[(sy + 1) * W + sx + 1]) / 4;
    if (m > max) { max = m; argmax = y * w + x; }
    if (m < min) { min = m; argmin = y * w + x; }
    gray[y * w + x] = Math.round(Math.min(1, Math.max(0, (m - lo) / (hi - lo))) * 255);
  }
  const ll = (i) => `${(90 - ((Math.floor(i / w) + 0.5) * 180) / hh).toFixed(1)}°, ${(-180 + (((i % w) + 0.5) * 360) / w).toFixed(1)}°`;
  writeFileSync(new URL(`dem_${body}.png`, OUT), png(w, hh, gray));
  console.log(`${body}: ${w}x${hh} written · max ${max.toFixed(0)} m at ${ll(argmax)} · min ${min.toFixed(0)} m at ${ll(argmin)}`);
}
