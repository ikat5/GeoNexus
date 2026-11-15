// One globe + rover. Renders the globe into `el`, five stat tiles into `statsEl` and measured-vs-inferred charts into `chartsEl`.
import { WORLDS, fetchEarthWeather, liveEarthAtmosphere } from './physics.js';
import { createGlobe } from './globe.js';
import { loadFeatures, placeName, earthPlace, addLabels } from './labels.js';
import { Rover } from './rover.js';
import { createChartGroup, TELEMETRY } from './charts.js';

export const sim = { paused: false }; // shared by every pane: the Pause drive button
const DT = 0.05, HISTORY = 240, D = 180 / Math.PI; // history: 60 s at 4 Hz
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPIN = (2 * Math.PI) / 60; // idle globes turn once a minute
const fmt = (x, d) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));

// onClick(latDeg, lonDeg, placePromise): the user clicked the globe and a rover was deployed there
export function createPane(el, worldKey, { statsEl, chartsEl, onClick } = {}) {
  const w = WORLDS[worldKey];
  el.innerHTML = `
    <div class="globe"></div>
    <p class="chip place" hidden></p>
    <p class="chip wx" hidden></p>
    <p class="chip status" role="status" aria-live="polite"></p>
    <button class="follow" hidden>Follow rover</button>`;
  const $ = (s) => el.querySelector(s);
  const charts = createChartGroup(chartsEl, TELEMETRY, [{ label: 'Measured', color: '#22d3ee' }, { label: 'Inferred', color: '#FCD34D', dash: true }], { legend: false });
  const pane = { worldKey, rover: null, history: [], place: null };
  const pose = { pos: null, q: null };
  const idleText = worldKey === 'earth' ? 'Waiting for your pick · still turning' : `Click anywhere on ${w.name} to start`;
  let g = null, features = [], dead = false, following = false, spinning = !REDUCED, flight = null, deploys = 0,
    roverEntity, trailEntity, trail = [], last = performance.now(), acc = 0, nextSample = 0;
  const status = (m) => { $('.status').textContent = m; };
  const roverPos = () => Cesium.Cartesian3.fromRadians(pane.rover.lon, pane.rover.lat, pane.rover.h + 0.8, g.ellipsoid);
  const home = () => g.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(w.view.lon, w.view.lat, w.radii[0] * 2.2, g.ellipsoid) });
  pane.isSpinning = () => spinning && !pane.rover;
  stats(null);

  // Lock the camera onto the rover in a chase view. From orbit it flies in; close up (or with reduced motion) it cuts.
  // The camera then follows until the user drags the globe; the Follow button or a new deploy locks it back on.
  function chase() {
    const cam = g.viewer.camera, rover = pane.rover;
    const offset = new Cesium.HeadingPitchRange(rover.heading, Cesium.Math.toRadians(-35), 2500);
    $('.follow').hidden = true;
    cam.cancelFlight();
    if (REDUCED || cam.positionCartographic.height < 2e5) {
      cam.lookAt(pose.pos, offset);
      cam.lookAtTransform(Cesium.Matrix4.IDENTITY);
      following = true;
      return;
    }
    following = false;
    flight = rover;
    cam.flyToBoundingSphere(new Cesium.BoundingSphere(pose.pos, 1), {
      offset, duration: 2.5, complete: () => { if (flight === rover && pane.rover === rover) following = true; flight = null; },
    });
  }

  // name: optional Promise<string> when the caller already knows the place (avoids a second geocoder request)
  pane.deploy = async (lon, lat, name) => {
    await pane.ready;
    if (dead || !g) return;
    const id = ++deploys;
    recall();
    spinning = false;
    status('Deploying rover…');
    const wxReq = worldKey === 'earth' ? fetchEarthWeather(lat * D, lon * D).catch((e) => { console.warn('Live weather unavailable, using ISA', e); return null; }) : null;
    name ??= worldKey === 'earth' ? earthPlace(lat * D, lon * D, features)
      : Promise.resolve(placeName(features, lat * D, lon * D, w.radii[0]) ?? 'Unnamed terrain');
    await g.preload?.(lon, lat);
    if (dead || id !== deploys) return; // superseded by a newer deploy or a reset
    const { viewer } = g, rover = new Rover(w, g.heightAt, lon, lat, 0);
    Object.assign(pane, { rover, history: [], place: null });
    trail = [];
    nextSample = 0;
    charts.reset();
    pose.pos = roverPos();
    pose.q = Cesium.Quaternion.IDENTITY;
    // callback properties: reassigning constant ones every frame keeps the box geometry pending forever
    roverEntity = viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => pose.pos, false),
      orientation: new Cesium.CallbackProperty(() => pose.q, false),
      box: { dimensions: new Cesium.Cartesian3(4, 2.5, 1.6), material: Cesium.Color.ORANGE, outline: true, outlineColor: Cesium.Color.BLACK },
      point: { // the pin: a yellow dot that pulses
        pixelSize: new Cesium.CallbackProperty(() => (REDUCED ? 11 : 11 + 3 * Math.sin(performance.now() / 260)), false),
        color: Cesium.Color.fromCssColorString('#FDE047'), outlineColor: Cesium.Color.BLACK, outlineWidth: 2, disableDepthTestDistance: Infinity,
      },
    });
    trailEntity = viewer.entities.add({
      polyline: { positions: new Cesium.CallbackProperty(() => trail, false), width: 3, material: Cesium.Color.CYAN, arcType: Cesium.ArcType.NONE },
    });
    chase(); // tick() keeps re-aiming at the rover (trackedEntity misbehaves on non-WGS84 ellipsoids)
    status(`Rover driving · deployed at ${fmt(lat * D, 3)}°, ${fmt(lon * D, 3)}°`);
    const showPlace = (text) => { if (!dead && pane.rover === rover) { $('.place').hidden = false; $('.place').textContent = text; } };
    showPlace('Locating…');
    name.then((n) => { if (pane.rover === rover) pane.place = n; showPlace(n); });
    wxReq?.then((wx) => {
      if (dead || pane.rover !== rover) return;
      if (wx) rover.atmosphere = liveEarthAtmosphere(wx);
      const p = $('.wx');
      p.hidden = false;
      p.classList.toggle('live', !!wx);
      p.textContent = wx ? `Live weather · ${fmt(wx.T0 - 273.15, 1)} °C · ${fmt(wx.p0 / 100, 0)} hPa · wind ${fmt(wx.wind, 0)} km/h` : 'Standard atmosphere (live weather offline)';
    });
    return name;
  };

  function recall() {
    if (!pane.rover) return;
    g.viewer.entities.remove(roverEntity);
    g.viewer.entities.remove(trailEntity);
    clearGrid();
    gridAt = null;
    Object.assign(pane, { rover: null, history: [], place: null });
    flight = null;
    $('.place').hidden = $('.wx').hidden = $('.follow').hidden = true;
  }

  // back to the idle state: no rover, orbit view, turning again
  pane.reset = () => {
    if (dead || !g) return;
    deploys++; // drops a deploy that is still waiting on terrain
    recall();
    g.viewer.camera.cancelFlight();
    home();
    following = false;
    spinning = !REDUCED;
    charts.reset();
    TELEMETRY.forEach((_, i) => charts.note(i, ''));
    stats(null);
    status(idleText);
  };

  function tick() {
    const now = performance.now(), dt = Math.min(0.2, (now - last) / 1000), rover = pane.rover;
    last = now;
    if (!rover) {
      if (spinning) g.viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN * dt); // orbit the camera about the spin axis
      return;
    }
    if (!sim.paused) for (acc += dt; acc >= DT; acc -= DT) rover.step(DT);

    const cam = g.viewer.camera, prev = pose.pos;
    const pos = (pose.pos = roverPos());
    if (following) follow(cam, prev, pos);
    pose.q = Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(rover.heading - Math.PI / 2, rover.pitch, 0), g.ellipsoid);

    if (rover.t >= nextSample) {
      nextSample = rover.t + 0.25;
      if (trail.length === 0 || rover.t % 1 < 0.25) { trail.push(pos); if (trail.length > 1500) trail.shift(); }
      polarGrid(rover);
      const tel = rover.telemetry();
      charts.push(`${rover.t.toFixed(0)}s`, tel);
      [0, 1, 4, 0].forEach((dp, i) => charts.note(i, `now ${fmt(tel[i][0], dp)} · inf. ${fmt(tel[i][1], dp)}`));
      pane.history.push({ h: tel[0][0], slope: tel[1][0], rho: tel[2][0], T: tel[3][0] });
      if (pane.history.length > HISTORY) pane.history.shift();
      stats(rover, tel);
    }
  }

  // Follow the rover by parallel transport: move the camera with it and rotate it by the change in the surface
  // normal. No compass heading is involved, so the view never flips or spins when the rover passes a pole.
  const n0 = new Cesium.Cartesian3(), n1 = new Cesium.Cartesian3(), axis = new Cesium.Cartesian3(), off = new Cesium.Cartesian3();
  const q = new Cesium.Quaternion(), m = new Cesium.Matrix3();
  function follow(cam, prev, pos) {
    g.ellipsoid.geodeticSurfaceNormal(prev, n0);
    g.ellipsoid.geodeticSurfaceNormal(pos, n1);
    Cesium.Cartesian3.cross(n0, n1, axis);
    const s = Cesium.Cartesian3.magnitude(axis);
    if (s > 1e-12) Cesium.Matrix3.fromQuaternion(Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.normalize(axis, axis), Math.asin(Math.min(1, s)), q), m);
    else Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY, m);
    Cesium.Cartesian3.subtract(cam.positionWC, prev, off);
    const p = Cesium.Cartesian3.add(pos, Cesium.Matrix3.multiplyByVector(m, off, off), new Cesium.Cartesian3());
    const dir = Cesium.Matrix3.multiplyByVector(m, cam.directionWC, new Cesium.Cartesian3());
    const up = Cesium.Matrix3.multiplyByVector(m, cam.upWC, new Cesium.Cartesian3());
    // keep at least 50 m above the ground under the camera (climb out of hillsides)
    const c = Cesium.Cartographic.fromCartesian(p, g.ellipsoid);
    const ground = c && (g.heightAt(c.longitude, c.latitude) ?? g.viewer.scene.globe.getHeight(c)); // globe.getHeight shares globe.pick's ellipsoid bug
    if (ground !== undefined && c.height < ground + 50) Cesium.Cartesian3.add(p, Cesium.Cartesian3.multiplyByScalar(n1, ground + 50 - c.height, off), p);
    cam.setView({ destination: p, orientation: { direction: dir, up } });
  }

  // Above 75° (Moon and Mars) the lat/lon grid would bunch up, so draw a local east/north grid instead: 500 m squares
  // over 10 km, draped on the terrain, re-centred when the rover is 3 km from the middle.
  let grid = [], gridAt = null;
  const clearGrid = () => { grid.forEach((e) => g.viewer.entities.remove(e)); grid = []; };
  const GRID_N = 10, GRID_M = 500, GRID_LAT = (75 * Math.PI) / 180;
  function polarGrid(rover) {
    if (!g.sampler || Math.abs(rover.lat) <= GRID_LAT) { clearGrid(); gridAt = null; return; }
    if (gridAt && Cesium.Cartesian3.distance(gridAt, pose.pos) < 3000) return;
    clearGrid();
    gridAt = Cesium.Cartesian3.clone(pose.pos);
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(gridAt, g.ellipsoid), tmp = new Cesium.Cartesian3();
    const pt = (x, y) => {
      const c = Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(enu, new Cesium.Cartesian3(x, y, 0), tmp), g.ellipsoid);
      return Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, g.heightAt(c.longitude, c.latitude) + 8, g.ellipsoid);
    };
    // drawn through the terrain too: near a pole the coarse terrain mesh can sit above the sampled heights
    const thin = Cesium.Color.fromCssColorString('rgba(125,211,252,0.35)'), bold = Cesium.Color.fromCssColorString('rgba(125,211,252,0.7)');
    for (let i = -GRID_N; i <= GRID_N; i++) {
      const ew = [], ns = [];
      for (let j = -GRID_N * 5; j <= GRID_N * 5; j++) { // a point every 100 m so the line follows the terrain instead of cutting through it
        ew.push(pt((j * GRID_M) / 5, i * GRID_M)); ns.push(pt(i * GRID_M, (j * GRID_M) / 5));
      }
      const color = i % 2 ? thin : bold; // every other line = 1 km
      for (const positions of [ew, ns]) {
        grid.push(g.viewer.entities.add({ polyline: { positions, width: i % 2 ? 1 : 1.5, material: color, depthFailMaterial: color, arcType: Cesium.ArcType.NONE } }));
      }
    }
  }

  // stat tiles: measured value on top, the rover's own inference underneath
  function stats(rover, tel) {
    const [[h, hE], [s, sE], [rho, rhoE], [T, TE]] = tel ?? [[], [], [], []], vac = rover?.est.vacuum;
    const cells = [
      ['Speed', rover ? fmt(rover.v, 1) : '—', 'm/s', `gravity ${w.g.toFixed(2)} m/s²`],
      ['Elevation', fmt(h, 0), 'm', `inferred ${fmt(hE, 0)}`],
      ['Slope', fmt(s, 1), '°', `inferred ${fmt(sE, 1)}°`],
      ['Air density', vac ? 'Vacuum' : fmt(rho, 4), vac ? '' : 'kg/m³', vac ? 'inferred 0 kg/m³' : `inferred ${fmt(rhoE, 4)}`],
      ['Temperature', fmt(T, 0), 'K', `inferred ${fmt(TE, 0)} K`],
    ];
    statsEl.innerHTML = cells.map(([k, v, unit, sub]) => `<div class="stat"><dt>${k}</dt><dd>${v}<small>${unit}</small></dd><span>${sub}</span></div>`).join('');
  }

  pane.ready = (async () => {
    status(`Loading ${w.name}…`);
    g = await createGlobe($('.globe'), w);
    if (dead) return g.viewer.destroy();
    const v = g.viewer;
    v.screenSpaceEventHandler.setInputAction((e) => {
      const c = g.pick(e.position);
      if (!c) return;
      const named = pane.deploy(c.longitude, c.latitude);
      onClick?.(c.latitude * D, c.longitude * D, named);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    // any press stops the idle spin; with a rover out, a drag (rotate, pan, tilt, pinch) also frees the camera.
    // A plain click redeploys, which follows again.
    const free = () => {
      spinning = false;
      if (pane.rover) { following = false; flight = null; $('.follow').hidden = false; }
    };
    for (const t of ['LEFT_DOWN', 'RIGHT_DOWN', 'MIDDLE_DOWN', 'PINCH_START']) v.screenSpaceEventHandler.setInputAction(free, Cesium.ScreenSpaceEventType[t]);
    $('.follow').addEventListener('click', () => pane.rover && chase());
    v.clock.onTick.addEventListener(tick);
    features = await loadFeatures(worldKey);
    if (g.sampler && !dead) addLabels(v, features, g.ellipsoid, g.sampler.heightAt); // Moon and Mars only
    if (!pane.rover) status(idleText);
  })().catch((e) => { console.error(e); g = null; status(`Failed to load ${w.name}: ${e.message}`); });

  pane.destroy = () => {
    dead = true;
    charts.destroy();
    if (g && !g.viewer.isDestroyed()) g.viewer.destroy();
  };
  return pane;
}
