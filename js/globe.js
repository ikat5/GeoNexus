// Builds a Cesium viewer for one world: ellipsoid, imagery, terrain, relief overlay, lighting, height sampler.
import { NasaDemSampler } from './dem_sampler.js';

export async function createGlobe(container, w) {
  const ellipsoid = new Cesium.Ellipsoid(...w.radii);
  const geo = new Cesium.GeographicTilingScheme({ ellipsoid });
  const layers = w.imagery.map((im) => new Cesium.ImageryLayer(new Cesium.UrlTemplateImageryProvider({
    url: im.url, maximumLevel: im.maximumLevel, credit: im.credit, tileWidth: im.tile ?? 256, tileHeight: im.tile ?? 256,
    tilingScheme: im.geographic ? geo : new Cesium.WebMercatorTilingScheme({ ellipsoid }),
  }), { minimumTerrainLevel: im.minimumTerrainLevel, alpha: im.alpha ?? 1 }));

  let terrainProvider, heightAt, preload, sampler, terrainName;
  if (w.dem) {
    sampler = await NasaDemSampler.load(w);
    heightAt = sampler.heightAt;
    terrainName = sampler.source;
    terrainProvider = new Cesium.CustomHeightmapTerrainProvider({
      width: 64, height: 64, ellipsoid, tilingScheme: geo,
      callback(x, y, level) {
        const r = geo.tileXYToRectangle(x, y, level), N = 64, out = new Float32Array(N * N);
        // synthetic sub-DEM detail only once tiles are fine enough to resolve it (avoids aliasing noise from orbit)
        const f = (r.north - r.south) / (N - 1) * w.radii[0] < 2000 ? sampler.heightAt : sampler.elevation;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
          out[j * N + i] = f(r.west + (r.east - r.west) * i / (N - 1), r.north - (r.north - r.south) * j / (N - 1));
        return out;
      },
    });
    layers.push(new Cesium.ImageryLayer(new ReliefProvider(geo, sampler)));
  } else {
    const tt = terrarium(w.terrarium, ellipsoid, 32);
    ({ provider: terrainProvider, sample: heightAt, preload } = tt);
    terrainName = 'AWS Terrain Tiles (SRTM / GMTED / ETOPO1)';
  }

  const viewer = new Cesium.Viewer(container, {
    ellipsoid, terrainProvider, baseLayer: layers[0],
    baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    animation: false, timeline: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
  });
  layers.slice(1).forEach((l) => viewer.imageryLayers.add(l));
  const { scene, camera } = viewer;
  scene.globe.depthTestAgainstTerrain = true;
  if (w.key !== 'earth') scene.globe.showGroundAtmosphere = false; // Cesium's ground haze is Earth-blue

  // directional "sun" from the viewer's upper left, so the visible side is always lit and the limb falls into shadow
  scene.globe.enableLighting = true;
  scene.light = new Cesium.DirectionalLight({ direction: new Cesium.Cartesian3(1, 0, 0), intensity: 2.2 });
  const up = new Cesium.Cartesian3(), dir = new Cesium.Cartesian3();
  scene.preRender.addEventListener(() => {
    Cesium.Cartesian3.normalize(camera.positionWC, up);
    Cesium.Cartesian3.add(Cesium.Cartesian3.negate(up, dir), Cesium.Cartesian3.multiplyByScalar(camera.rightWC, 0.6, new Cesium.Cartesian3()), dir);
    scene.light.direction = Cesium.Cartesian3.normalize(dir, new Cesium.Cartesian3());
  });
  camera.setView({ destination: Cesium.Cartesian3.fromDegrees(w.view.lon, w.view.lat, w.radii[0] * 2.2, ellipsoid) });

  // Screen position -> surface Cartographic. Cesium's globe.pick misses every off-centre ray on non-WGS84
  // ellipsoids, so DEM worlds intersect the ray with the ellipsoid inflated to the sampled height, refined.
  const pick = (screenPos) => {
    const ray = camera.getPickRay(screenPos);
    if (!ray) return undefined;
    if (!w.dem) { const hit = scene.globe.pick(ray, scene); return hit && Cesium.Cartographic.fromCartesian(hit, ellipsoid); }
    let c, h = 0;
    for (let i = 0; i < 5; i++) {
      const t = Cesium.IntersectionTests.rayEllipsoid(ray, new Cesium.Ellipsoid(w.radii[0] + h, w.radii[1] + h, w.radii[2] + h));
      if (!t) break; // clicked space (or grazed the limb)
      c = Cesium.Cartographic.fromCartesian(Cesium.Ray.getPoint(ray, t.start), ellipsoid);
      h = heightAt(c.longitude, c.latitude);
    }
    return c;
  };
  return { viewer, ellipsoid, heightAt, preload, sampler, terrainName, pick };
}

// Relief overlay for DEM worlds. Cesium can't light heightmap terrain (no vertex normals), so crater relief is
// baked here: hillshade from the same height field the mesh uses, a micro-texture, and a 100 m / 1 km grid.
class ReliefProvider extends Cesium.GridImageryProvider {
  constructor(tilingScheme, sampler) { super({ tilingScheme, tileWidth: 256, tileHeight: 256 }); this.sampler = sampler; }
  requestImage(x, y, level) { return Promise.resolve(reliefTile(this.tilingScheme.tileXYToRectangle(x, y, level), x, y, level, this.sampler)); }
}

const SUN = [-0.579, 0.579, 0.574]; // light from the NW at 35° elevation (east, north, up)
function reliefTile(rect, tx, ty, level, sampler) {
  const S = 64, R = sampler.world.radii[0], dLon = (rect.east - rect.west) / S, dLat = (rect.north - rect.south) / S;
  const dy = dLat * R, dx = dLon * R * Math.cos((rect.north + rect.south) / 2);
  const f = dy < 1000 ? sampler.heightAt : sampler.elevation; // same anti-aliasing rule as the mesh
  const hs = new Float32Array((S + 2) ** 2);
  for (let j = 0; j < S + 2; j++) for (let i = 0; i < S + 2; i++) hs[j * (S + 2) + i] = f(rect.west + (i - 0.5) * dLon, rect.north - (j - 0.5) * dLat);

  const small = document.createElement('canvas');
  small.width = small.height = S;
  const sctx = small.getContext('2d'), img = sctx.createImageData(S, S), ex = 2; // 2x vertical exaggeration
  for (let j = 1; j <= S; j++) for (let i = 1; i <= S; i++) {
    const at = (a, b) => hs[b * (S + 2) + a];
    const gx = ex * (at(i + 1, j) - at(i - 1, j)) / (2 * dx), gy = ex * (at(i, j - 1) - at(i, j + 1)) / (2 * dy);
    const s = (-gx * SUN[0] - gy * SUN[1] + SUN[2]) / Math.hypot(gx, gy, 1) - SUN[2], p = ((j - 1) * S + i - 1) * 4;
    if (s < 0) img.data[p + 3] = Math.min(0.8, -s * 1.8) * 255;
    else { img.data[p] = img.data[p + 1] = img.data[p + 2] = 255; img.data[p + 3] = Math.min(0.35, s) * 255; }
  }
  sctx.putImageData(img, 0, 0);

  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, 256, 256);

  if (level >= 10) { // micro-texture keyed to global pixel coordinates, so it is seamless across tiles
    const n = ctx.createImageData(256, 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const gx = tx * 256 + i, gy = ty * 256 + j, v = 0.5 * hash(gx >> 1, gy >> 1, level) + 0.5 * hash(gx, gy, level + 50);
      n.data[(j * 256 + i) * 4 + 3] = v > 0.6 ? (v - 0.6) * 90 : 0;
    }
    const nc = document.createElement('canvas');
    nc.width = nc.height = 256;
    nc.getContext('2d').putImageData(n, 0, 0);
    ctx.drawImage(nc, 0, 0);
  }

  // grid: 100 m / 1 km squares. The longitude step widens by 1/cos(lat) so cells stay square instead of pinching
  // toward the poles; cos is taken per 1-degree latitude band (so lines stay continuous across tiles) and capped at 0.15.
  const lonScale = 1 / Math.max(0.15, Math.cos(Math.round((rect.north + rect.south) / 2 * 180 / Math.PI) * Math.PI / 180));
  // above 75° the latitude/longitude grid stops; pane.js draws a local east/north grid in metres around the rover
  if (Math.max(Math.abs(rect.north), Math.abs(rect.south)) > (75 * Math.PI) / 180) return c;
  for (const [m, style] of [[100, 'rgba(125, 211, 252, 0.28)'], [1000, 'rgba(125, 211, 252, 0.6)']]) {
    const step = m / R, lonStep = step * lonScale;
    if ((rect.north - rect.south) / step > 40) continue; // too dense at this zoom
    ctx.strokeStyle = style;
    ctx.lineWidth = m === 1000 ? 1.5 : 1;
    ctx.beginPath();
    for (let k = Math.ceil(rect.south / step); k * step <= rect.north; k++) { const yy = ((rect.north - k * step) / (rect.north - rect.south)) * 256; ctx.moveTo(0, yy); ctx.lineTo(256, yy); }
    for (let k = Math.ceil(rect.west / lonStep); k * lonStep <= rect.east; k++) { const xx = ((k * lonStep - rect.west) / (rect.east - rect.west)) * 256; ctx.moveTo(xx, 0); ctx.lineTo(xx, 256); }
    ctx.stroke();
  }
  return c;
}
function hash(i, j, s) { const h = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); }

// Terrarium PNG tiles (height = R*256 + G + B/256 - 32768): a Cesium heightmap provider for rendering
// (levels past 15 resample the z15 ancestor), plus a synchronous z14 sampler (~10 m/px) for the rover.
function terrarium(url, ellipsoid, N) {
  const cache = new Map(), ready = new Map(), Z = 14;
  const load = (z, x, y) => {
    const k = `${z}/${x}/${y}`;
    if (!cache.has(k)) {
      if (cache.size > 400) { const old = cache.keys().next().value; cache.delete(old); ready.delete(old); }
      cache.set(k, fetch(url.replace('{z}', z).replace('{x}', x).replace('{y}', y))
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`terrain ${k}: ${r.status}`))))
        .then(createImageBitmap)
        .then((bmp) => {
          const c = new OffscreenCanvas(256, 256).getContext('2d');
          c.drawImage(bmp, 0, 0);
          const d = c.getImageData(0, 0, 256, 256).data;
          ready.set(k, d);
          return d;
        }));
    }
    return cache.get(k);
  };
  const hgt = (d, i) => d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  const bilinear = (d, px, py) => {
    const x0 = Math.min(254, Math.max(0, Math.floor(px))), y0 = Math.min(254, Math.max(0, Math.floor(py))), fx = px - x0, fy = py - y0;
    const a = hgt(d, y0 * 256 + x0), b = hgt(d, y0 * 256 + x0 + 1), c = hgt(d, (y0 + 1) * 256 + x0), e = hgt(d, (y0 + 1) * 256 + x0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  };
  // fractional z14 tile coordinates of lon/lat (radians), slippy-map convention
  const tileXY = (lon, lat) => [(lon / (2 * Math.PI) + 0.5) * 2 ** Z, (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2 * 2 ** Z];
  const preload = (lon, lat) => { const [fx, fy] = tileXY(lon, lat); return load(Z, Math.floor(fx), Math.floor(fy)).catch(() => {}); };
  const sample = (lon, lat) => {
    const [fx, fy] = tileXY(lon, lat), tx = Math.floor(fx), ty = Math.floor(fy);
    const d = ready.get(`${Z}/${tx}/${ty}`);
    if (!d) { load(Z, tx, ty).catch(() => {}); return undefined; } // rover holds its last height until the tile lands
    return bilinear(d, (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5);
  };
  const provider = new Cesium.CustomHeightmapTerrainProvider({
    width: N, height: N, ellipsoid, tilingScheme: new Cesium.WebMercatorTilingScheme({ ellipsoid }),
    async callback(x, y, level) {
      const z = Math.min(level, 15), s = 2 ** (level - z), out = new Float32Array(N * N);
      let d;
      try { d = await load(z, Math.floor(x / s), Math.floor(y / s)); }
      catch (e) { console.warn(e); return out; } // flat tile rather than a hole
      const ox = (x % s) * 255 / s, oy = (y % s) * 255 / s, span = 255 / s;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out[j * N + i] = bilinear(d, ox + span * i / (N - 1), oy + span * j / (N - 1));
      return out;
    },
  });
  return { provider, sample, preload };
}
