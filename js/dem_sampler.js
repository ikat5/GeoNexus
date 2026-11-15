// NasaDemSampler: real equirectangular NASA DEM (LOLA / MOLA) read through an offscreen canvas.
// Luminance 0..255 maps linearly to the body's elevation range; lookups are bilinear.
import { detailHeight, proceduralHeight } from './physics.js';

export class NasaDemSampler {
  constructor(world, lum, W, H, source) {
    Object.assign(this, { world, lum, W, H, source });
    [this.lo, this.hi] = world.dem.range;
    const rowMean = (r) => { let sum = 0; for (let x = 0; x < W; x++) sum += lum[r * W + x]; return sum / W; };
    this.poles = [rowMean(0), rowMean(H - 1)]; // each pole is one point: its height is the mean of the edge row
  }

  // browser only: decode data/dem_*.png via canvas; if it can't load, synthesize a cratered fallback canvas
  static async load(world) {
    try {
      const res = await fetch(world.dem.url);
      if (!res.ok) throw new Error(`${world.dem.url}: HTTP ${res.status}`);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const rgba = ctx.getImageData(0, 0, bmp.width, bmp.height).data, lum = new Uint8Array(bmp.width * bmp.height);
      for (let i = 0; i < lum.length; i++) lum[i] = rgba[i * 4];
      return new NasaDemSampler(world, lum, bmp.width, bmp.height, world.dem.name);
    } catch (e) {
      console.warn('NASA DEM unavailable, generating procedural fallback (run node scripts/fetch_dem.mjs)', e);
      return NasaDemSampler.fallback(world);
    }
  }

  static fallback(world, W = 720, H = 360) {
    const [lo, hi] = world.dem.range, ctx = new OffscreenCanvas(W, H).getContext('2d'), img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h = proceduralHeight(world, ((x + 0.5) / W) * 2 * Math.PI - Math.PI, Math.PI / 2 - ((y + 0.5) / H) * Math.PI);
      const v = Math.round(Math.min(1, Math.max(0, (h - lo) / (hi - lo))) * 255), i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const lum = new Uint8Array(W * H);
    for (let i = 0; i < lum.length; i++) lum[i] = img.data[i * 4];
    return new NasaDemSampler(world, lum, W, H, 'procedural cratered fallback (offline)');
  }

  // DEM elevation in metres (west edge -180°, north row first)
  elevation = (lon, lat) => {
    const { W, H, lum } = this;
    const raw = ((Math.PI / 2 - lat) / Math.PI) * H - 0.5;
    const px = ((lon + Math.PI) / (2 * Math.PI)) * W - 0.5, py = Math.min(H - 1, Math.max(0, raw));
    const x0 = Math.floor(px), y0 = Math.min(H - 2, Math.floor(py)), fx = px - x0, fy = py - y0;
    const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W, r0 = y0 * W, r1 = r0 + W;
    let l = (lum[r0 + xa] * (1 - fx) + lum[r0 + xb] * fx) * (1 - fy) + (lum[r1 + xa] * (1 - fx) + lum[r1 + xb] * fx) * fy;
    // inside the outermost half-row the pixel centres fan out around the pole: blend to the pole's single height,
    // so two points a few metres apart across the pole no longer read different pixels (false cliffs)
    if (raw < 0.5) l = this.poles[0] + (l - this.poles[0]) * Math.max(0, raw + 0.5);
    else if (raw > H - 1.5) l = this.poles[1] + (l - this.poles[1]) * Math.max(0, H - 0.5 - raw);
    return this.lo + (l / 255) * (this.hi - this.lo);
  };

  // what the rover and the close-up terrain mesh use: real DEM + synthetic detail below DEM resolution
  heightAt = (lon, lat) => this.elevation(lon, lat) + detailHeight(this.world, lon, lat);
}
