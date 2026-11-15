// Minimal reader for the bundled 8-bit greyscale DEM PNGs (data/dem_*.png): filter-0 rows only, as written by fetch_dem.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPng(path) {
  const b = readFileSync(path), idat = [];
  let W, H;
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { W = data.readUInt32BE(0); H = data.readUInt32BE(4); assert.ok(data[8] === 8 && data[9] === 0, '8-bit gray'); }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), lum = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { assert.equal(raw[y * (W + 1)], 0, 'PNG filter 0'); lum.set(raw.subarray(y * (W + 1) + 1, (y + 1) * (W + 1)), y * W); }
  return { W, H, lum };
}
