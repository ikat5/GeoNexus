// Planet constants, atmosphere/thermal models, live Earth weather, and procedural terrain detail.
// SI units, angles in radians unless noted.
const D2R = Math.PI / 180;
const TREK = (body, layer, ext = 'jpg') => `https://trek.nasa.gov/tiles/${body}/EQ/${layer}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;

export const WORLDS = {
  earth: {
    key: 'earth', name: 'Earth', radii: [6378137, 6378137, 6356752.3142], g: 9.80665, gasR: 287.05, tBounds: [180, 340],
    imagery: [{ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', geographic: false, maximumLevel: 16, credit: 'Esri World Imagery' }],
    // real elevation (SRTM/GMTED/ETOPO1), public and token-free; PNG-encoded heights
    terrarium: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    view: { lon: 86.9, lat: 27.9 },
    // ISA troposphere with a latitude-dependent surface temperature (offline fallback for live weather)
    atmosphere(h, lat) {
      const T = 300 - 40 * Math.sin(lat) ** 2 - 0.0065 * h;
      const p = 101325 * Math.max(0, 1 - 2.25577e-5 * h) ** 5.25588;
      return { T, p, rho: p / (287.05 * T) };
    },
  },
  moon: {
    key: 'moon', name: 'Moon', radii: [1737400, 1737400, 1737400], g: 1.62, gasR: null, tBounds: [100, 390], // tBounds: thermal-model range
    imagery: [{ url: TREK('Moon', 'LRO_WAC_Mosaic_Global_303ppd_v02'), geographic: true, maximumLevel: 8, credit: 'NASA Moon Trek · LRO WAC' }],
    dem: { url: '/data/dem_moon.png', range: [-9100, 10700], name: 'NASA LRO LOLA DEM (8 ppd)' },
    detail: { amp: 60, craters: 0.35 }, relief: 1500, craters: 0.35, view: { lon: 23.5, lat: 0.7 },
    // fallback-only gaussian basins [lat°, lon°, radius°, height m] so named features sit in real places offline
    features: [[32.8, -15.6, 9, -2500], [28, 17.5, 6, -2000], [17, 59.1, 4.5, -3000], [-53, -169, 35, -6000], [-43.31, -11.36, 1.3, -3500], [9.62, -20.08, 1.5, -3000]],
    // airless: radiative-equilibrium surface temperature from solar incidence, subsolar point fixed at 0°,0°
    atmosphere(h, lat, lon) {
      const c = Math.cos(lat) * Math.cos(lon);
      return { T: c > 0 ? Math.max(100, 390 * c ** 0.25) : 100, p: 0, rho: 0 };
    },
  },
  mars: {
    key: 'mars', name: 'Mars', radii: [3396190, 3396190, 3376200], g: 3.721, gasR: 191.8, tBounds: [130, 310],
    imagery: [
      { url: TREK('Mars', 'Mars_Viking_MDIM21_ClrMosaic_global_232m'), geographic: true, maximumLevel: 7, credit: 'NASA Mars Trek · Viking MDIM 2.1' },
      // ~5 m/px CTX mosaic for close-ups (Esri OnMars, same geographic 2x1 root grid, 512 px tiles)
      { url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{z}/{y}/{x}', geographic: true, tile: 512, maximumLevel: 12, minimumTerrainLevel: 9, alpha: 0.75, credit: 'MRO CTX · Esri OnMars' }, // level 13 returns 400 without CORS
    ],
    dem: { url: '/data/dem_mars.png', range: [-8200, 21200], name: 'NASA MGS MOLA DEM (8 ppd)' },
    detail: { amp: 50, craters: 0.2 }, relief: 2000, craters: 0.2, view: { lon: 137.8, lat: -5.4 },
    features: [[18.65, -133.8, 4, 21000], [0, -110, 20, 7000], [-8.26, -120.09, 2.5, 12000], [1.48, -112.96, 2.5, 12000], [11.92, -104.08, 2.5, 12000], [25.02, 147.21, 2.5, 9000], [-42.4, 70.5, 15, -7000], [70, 0, 30, -4000]],
    // NASA Glenn Mars atmosphere model, cooled toward the poles
    atmosphere(h, lat) {
      const T = 273.15 + (h < 7000 ? -31 - 0.000998 * h : -23.4 - 0.00222 * h) - 30 * Math.sin(lat) ** 2;
      const p = 699 * Math.exp(-0.00009 * h);
      return { T, p, rho: p / (191.8 * T) };
    },
  },
};

// --- live Earth weather (Open-Meteo, keyless) -------------------------------------------------------------
export async function fetchEarthWeather(latDeg, lonDeg) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latDeg.toFixed(4)}&longitude=${lonDeg.toFixed(4)}`
    + '&current=temperature_2m,surface_pressure,relative_humidity_2m,wind_speed_10m';
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const j = await res.json(), c = j.current ?? {};
  const wx = { T0: c.temperature_2m + 273.15, p0: c.surface_pressure * 100, h0: j.elevation, rh: c.relative_humidity_2m, wind: c.wind_speed_10m, time: c.time };
  // trust boundary: reject anything that isn't a plausible surface observation
  if (![wx.T0, wx.p0, wx.h0].every(Number.isFinite) || wx.T0 < 170 || wx.T0 > 340 || wx.p0 < 25000 || wx.p0 > 110000) throw new Error('Open-Meteo: implausible values');
  return wx;
}

// live surface obs at the model-grid elevation h0, carried to rover elevation h with the standard lapse rate;
// rho = P / (287.05 · T)
export function liveEarthAtmosphere({ T0, p0, h0 }) {
  return (h) => {
    const T = Math.max(150, T0 - 0.0065 * (h - h0));
    const p = p0 * (T / T0) ** 5.25588;
    return { T, p, rho: p / (287.05 * T) };
  };
}

// --- procedural terrain -------------------------------------------------------------------------------------
function hash(i, j, s) { const h = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, f, amp, octaves, seed) {
  let h = 0;
  for (let o = 0; o < octaves; o++, amp *= 0.5, f *= 2.1) h += (vnoise(x * f, y * f, seed + o) - 0.5) * amp;
  return h;
}
// bowl-and-rim craters on a jittered grid; x, y and cells share units, toM converts that unit to metres
function craters(x, y, cells, density, toM) {
  let h = 0;
  for (const cell of cells) {
    const gx = x / cell, gy = y / cell;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const i = Math.floor(gx) + di, j = Math.floor(gy) + dj;
      if (hash(i, j, cell) > density) continue;
      const r = 0.1 + 0.35 * hash(i, j, cell + 3);
      const d = Math.hypot(gx - i - hash(i, j, cell + 1), gy - j - hash(i, j, cell + 2)) / r;
      if (d >= 1.5) continue;
      const depth = Math.min(4000, 0.2 * r * cell * toM);
      h += d < 1 ? depth * (d * d - 0.8) : 0.2 * depth * (1 - (d - 1) / 0.5) ** 2;
    }
  }
  return h;
}

// Detail below the DEM's resolution (DEM pixels are ~4–7 km): small craters + fBm, tens of metres.
// shortcut: synthetic, not measured; replace with a higher-ppd DEM tile pyramid if one becomes keyless.
export function detailHeight(w, lon, lat) {
  if (!w.detail) return 0;
  const R = w.radii[0], x = lon * R * Math.cos(lat), y = lat * R;
  return fbm(x, y, 1 / 2000, w.detail.amp, 6, 20) + craters(x, y, [4000, 1000, 250], w.detail.craters, 1);
}

// Offline-only global heightmap (used to synthesize a DEM canvas when data/dem_*.png can't load).
export function proceduralHeight(w, lon, lat) {
  const x = lon / D2R, y = lat / D2R;
  let h = fbm(x, y, 0.5, w.relief, 6, 0) + craters(x, y, [6, 1.5, 0.4], w.craters, w.radii[0] * D2R);
  for (const [flat, flon, r, fh] of w.features) {
    const c = Math.sin(lat) * Math.sin(flat * D2R) + Math.cos(lat) * Math.cos(flat * D2R) * Math.cos(lon - flon * D2R);
    const d = Math.acos(Math.min(1, c)) / D2R / r;
    h += fh * Math.exp(-d * d);
  }
  return h;
}
