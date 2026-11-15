// Records the landing page's telemetry replay: the real Rover (js/rover.js) driving 20 s over the real MOLA DEM at
// Curiosity's landing site in Gale Crater, after a 5 s warm-up so the onboard estimator has settled.
//   node scripts/record_trace.mjs   -> data/trace_gale.json  (rows: t s, v m/s, [h, slope °, rho, T K] measured + inferred)
import { writeFileSync } from 'node:fs';
import { WORLDS } from '../js/physics.js';
import { Rover } from '../js/rover.js';
import { NasaDemSampler } from '../js/dem_sampler.js';
import { readPng } from './png.mjs';

const D2R = Math.PI / 180, { W, H, lum } = readPng(new URL('../data/dem_mars.png', import.meta.url));
const dem = new NasaDemSampler(WORLDS.mars, lum, W, H, 'MOLA');
const r = new Rover(WORLDS.mars, dem.heightAt, 137.4417 * D2R, -4.5895 * D2R, 0), rows = [];
const round = (x, d) => (x == null ? null : Number(x.toFixed(d)));
for (let i = 0; i < 25 * 20; i++) {
  r.step(0.05);
  if (r.t > 5 && i % 5 === 4) { // 4 Hz, like the simulator's telemetry
    const [[h, hE], [s, sE], [rho, rhoE], [T, TE]] = r.telemetry();
    rows.push([round(r.t - 5, 2), round(r.v, 2), round(h, 1), round(hE, 1), round(s, 2), round(sE, 2), round(rho, 5), round(rhoE, 5), round(T, 1), round(TE, 1)]);
  }
}
writeFileSync(new URL('../data/trace_gale.json', import.meta.url), JSON.stringify({ site: 'Gale Crater (Curiosity landing site)', lat: -4.5895, lon: 137.4417, columns: ['t', 'v', 'h', 'hE', 'slope', 'slopeE', 'rho', 'rhoE', 'T', 'TE'], rows }));
console.log(`${rows.length} rows, v ${rows.at(-1)[1]} m/s, rho ${rows.at(-1)[6]} vs inferred ${rows.at(-1)[7]}, T ${rows.at(-1)[8]} vs ${rows.at(-1)[9]} K`);
