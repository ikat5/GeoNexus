// node tests/selfcheck.mjs — estimator, NASA DEM sampler, live-weather atmosphere and similarity checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { WORLDS, liveEarthAtmosphere } from '../js/physics.js';
import { Rover } from '../js/rover.js';
import { NasaDemSampler } from '../js/dem_sampler.js';
import { similarity } from '../js/similarity.js';

const D2R = Math.PI / 180;
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
function run(world, heightAt, secs, { lockNorth = false, each } = {}) {
  const r = new Rover(world, heightAt, 0, 0, 0);
  if (lockNorth) { r.planT = Infinity; r.heading = r.targetHeading = 0; }
  for (let t = 0; t < secs; t += 0.05) { r.step(0.05); each?.(r); }
  return r;
}

// --- estimator -----------------------------------------------------------------------------------------------
let r = run(WORLDS.earth, () => 0, 120);
assert.ok(rel(r.est.rho, r.truth.rho) < 0.1, `earth rho ${r.est.rho} vs ${r.truth.rho}`);
assert.ok(Math.abs(r.est.T - r.truth.T) < 20, `earth T ${r.est.T} vs ${r.truth.T}`);
assert.ok(Math.abs(r.est.slope) < 0.02, `earth slope ${r.est.slope}`);

const [tLo, tHi] = WORLDS.mars.tBounds;
// Mars drag is ~1% of Earth's, so one run's temperature is noisy (worst case ~35 K off): bound every sample, average 5 runs
let tErr = 0;
for (let k = 0; k < 5; k++) {
  r = run(WORLDS.mars, () => 0, 120, { each: (x) => x.est.T == null || assert.ok(x.est.T >= tLo && x.est.T <= tHi, `mars T ${x.est.T} out of bounds`) });
  assert.ok(rel(r.est.rho, r.truth.rho) < 0.3, `mars rho ${r.est.rho} vs ${r.truth.rho}`);
  tErr += Math.abs(r.est.T - r.truth.T) / 5;
}
assert.ok(tErr < 20, `mars mean |T error| ${tErr} K`);

// 1. Moon: inferred density never negative, reported as vacuum (exactly 0)
const k = Math.tan(5 * D2R), R = WORLDS.moon.radii[0];
let slopeErr = 0; // averaged over the last 10 s: on the Moon one noisy sample can be ~0.7° off
r = run(WORLDS.moon, (lon, lat) => lat * R * k, 60, {
  lockNorth: true,
  each: (x) => {
    const [, , [, rho]] = x.telemetry(); assert.ok(rho === null || rho === 0, `moon inferred rho ${rho}`); assert.ok(x.est.rho == null || x.est.rho >= 0);
    if (x.t > 50) slopeErr += Math.abs(x.est.slope - x.pitch) / 200;
  },
});
assert.ok(r.est.vacuum, 'moon classified as vacuum');
assert.ok(slopeErr < 0.01, `moon mean |slope error| ${slopeErr} rad over the last 10 s`);
assert.ok(rel(r.est.h, r.h) < 0.05, `moon h ${r.est.h} vs ${r.h}`);

// live weather: rho = P / (287.05 T) at the station elevation, thinner and colder higher up
const atm = liveEarthAtmosphere({ T0: 288.15, p0: 101325, h0: 0 });
assert.ok(rel(atm(0).rho, 101325 / (287.05 * 288.15)) < 1e-9);
assert.ok(atm(3000).rho < atm(0).rho && atm(3000).T < atm(0).T);

// --- 2. NASA DEM sampler on the bundled PNGs ------------------------------------------------------------------
function readPng(path) {
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
const dem = (key) => { const { W, H, lum } = readPng(new URL(`../data/dem_${key}.png`, import.meta.url)); return new NasaDemSampler(WORLDS[key], lum, W, H, 'test'); };
const at = (s, lat, lon) => s.elevation(lon * D2R, lat * D2R);
const moon = dem('moon'), mars = dem('mars');
assert.ok(at(moon, 5.4, -158.6) > 8000, `moon highlands peak ${at(moon, 5.4, -158.6)}`);
assert.ok(at(moon, -70.3, -172.4) < -6000, `SPA / Antoniadi ${at(moon, -70.3, -172.4)}`);
assert.ok(at(mars, 18.65, -133.8) > 15000, `Olympus Mons ${at(mars, 18.65, -133.8)}`);
assert.ok(at(mars, -42.4, 70.5) < -5000, `Hellas ${at(mars, -42.4, 70.5)}`);
for (const s of [moon, mars]) {
  const hs = Array.from({ length: 2000 }, (_, i) => s.heightAt(((i * 0.618) % 1) * 2 * Math.PI - Math.PI, Math.asin(((i * 0.414) % 1) * 1.8 - 0.9)));
  const m = hs.reduce((a, x) => a + x, 0) / hs.length, sd = Math.sqrt(hs.reduce((a, x) => a + (x - m) ** 2, 0) / hs.length);
  assert.ok(sd > 1000 && hs.every((h) => h > s.lo - 500 && h < s.hi + 500), `${s.world.name} DEM sd ${sd.toFixed(0)} m`);
}

// --- 3. similarity score ----------------------------------------------------------------------------------------
const hist = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const earthFlat = hist(60, (i) => ({ h: 100 + Math.sin(i / 5), slope: Math.sin(i / 3), rho: 1.2, T: 288 }));
const moonRough = hist(60, (i) => ({ h: -2000 + 40 * Math.sin(i / 4), slope: 8 * Math.sin(i / 2), rho: 0, T: 380 }));
assert.equal(Math.round(similarity(earthFlat, earthFlat).overall), 100);
const sMoon = similarity(earthFlat, moonRough);
assert.ok(sMoon.overall < 30, `earth vs moon ${sMoon.overall}`);
assert.equal(similarity(earthFlat.slice(0, 3), moonRough), null);
for (let i = 0; i < 200; i++) {
  const rnd = () => hist(20, () => ({ h: Math.random() * 1e4 - 5e3, slope: Math.random() * 60 - 30, rho: Math.random() * (i % 3), T: 50 + Math.random() * 350 }));
  for (const v of Object.values(similarity(rnd(), rnd()))) assert.ok(v >= 0 && v <= 100, `similarity ${v}`);
}

// rover drives straight over the north pole: direction of travel (a 3D vector) never jumps more than 10° per step
{
  const { travel } = await import('../js/rover.js');
  const W = WORLDS.moon, R = W.radii[0];
  const r = new Rover(W, () => 0, 0.3, (89.997 * Math.PI) / 180, 0); // ~90 m from the pole; 12 m/s for 60 s crosses it
  r.planT = Infinity; r.heading = r.targetHeading = 0;
  const xyz = (la, lo) => [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let prev = xyz(r.lat, r.lon), prevDir = null, maxTurn = 0, maxLat = -Infinity;
  for (let t = 0; t < 60; t += 0.05) {
    r.step(0.05);
    const p = xyz(r.lat, r.lon), d = p.map((v, i) => v - prev[i]), n = Math.hypot(...d);
    if (n > 1e-12) {
      const u = d.map((v) => v / n);
      if (prevDir) maxTurn = Math.max(maxTurn, Math.acos(Math.min(1, u.reduce((a, v, i) => a + v * prevDir[i], 0))) * 180 / Math.PI);
      prevDir = u;
    }
    prev = p; maxLat = Math.max(maxLat, r.lat);
    assert.ok(Number.isFinite(r.lat) && Number.isFinite(r.lon) && Math.abs(r.lon) <= Math.PI + 1e-9, 'rover position stays finite and wrapped');
  }
  assert.ok(maxLat > (89.9999 * Math.PI) / 180 && r.lat < (89.997 * Math.PI) / 180, 'rover crossed the pole');
  assert.ok(maxTurn < 10, `direction of travel jumped ${maxTurn.toFixed(2)}°`);
  // the ±180° meridian
  const [, lon2] = travel(0, Math.PI - 1e-6, Math.PI / 2, 1e-5);
  assert.ok(lon2 < 0 && lon2 > -Math.PI, 'longitude wraps at ±180°');
}

// relative temperature: a Mars pole at 150 K and Arctic Earth at 250 K sit at similar positions in their own ranges
{
  const h = (n, T) => Array.from({ length: n }, (_, i) => ({ h: Math.sin(i), slope: Math.sin(i / 2), rho: 0.02, T }));
  const abs = similarity(h(20, 250), h(20, 150)).temperature;
  const relT = similarity(h(20, 250), h(20, 150), { rangeA: WORLDS.earth.tBounds, rangeB: WORLDS.mars.tBounds }).temperature;
  assert.ok(abs === 0 && relT > 40, `temperature absolute ${abs}, relative ${relT}`);
}

// the DEM has one height at each pole: a few metres across the pole never reads as a cliff
for (const s of [moon, mars]) {
  for (const pole of [Math.PI / 2, -Math.PI / 2]) {
    const sign = Math.sign(pole), at = (lon) => s.elevation(lon, pole - sign * 1e-6);
    const spread = Math.max(...[0, 1, 2, 3, 4, 5].map(at)) - Math.min(...[0, 1, 2, 3, 4, 5].map(at));
    assert.ok(spread < 1, `${s.world.name} pole ${sign > 0 ? 'N' : 'S'}: heights differ by ${spread.toFixed(1)} m around the pole`);
  }
}

console.log('selfcheck ok');
