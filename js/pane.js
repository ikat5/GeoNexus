// One globe + rover. Renders the globe into `el` (plus place, weather and status chips) and measured-vs-inferred charts
// into `chartsEl`. The React console reads pane.rover / pane.history directly for its readouts.
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
export const INK = { earth: '#46C2F2', mars: '#FF7A45', moon: '#C9C6BC' };
// the 2D / 3D / Ground toggle: chase-camera pitch (°) and range (m). "2D" is a top-down camera, not Cesium's 2D scene
// mode, which would need a per-world map projection and breaks picking on the non-WGS84 ellipsoids.
export const VIEWS = { '2d': [-89, 5000], '3d': [-35, 2500], ground: [-12, 140] };

// onClick(latDeg, lonDeg, placePromise): a rover was deployed by a click or by pane.pin
// onEvent(type, detail): 'weather' (live obs or null when offline), 'stall' (the rover turned around after stalling)
export function createPane(el, worldKey, { chartsEl, onClick, onEvent } = {}) {
  const w = WORLDS[worldKey], ink = INK[worldKey];
  el.innerHTML = `
    <div class="globe"></div>
    <p class="chip place" hidden></p>
    <p class="chip wx" hidden></p>
    <p class="chip status" role="status" aria-live="polite"></p>
    <button class="follow" hidden>Follow rover</button>`;
  const $ = (s) => el.querySelector(s);
  const charts = createChartGroup(chartsEl, TELEMETRY, [{ label: 'Measured', color: ink }, { label: 'Inferred', color: '#E8EDF2', dash: true, fill: `${ink}26` }], { legend: false });
  const pane = { worldKey, rover: null, history: [], place: null, wx: undefined, features: [] };
  const pose = { pos: null, q: null };
  const idleText = worldKey === 'earth' ? 'Waiting for your pick · still turning' : `Click anywhere on ${w.name} to start`;
  let g = null, dead = false, following = false, spinning = !REDUCED, flight = null, deploys = 0, view = '3d', orbit = 0, zoom = 1,
    roverEntity, ringEntity, trailEntity, trail = [], last = performance.now(), acc = 0, nextSample = 0, stalls = 0, toggleLabels = null;
  const status = (m) => { $('.status').textContent = m; };
  const roverPos = () => Cesium.Cartesian3.fromRadians(pane.rover.lon, pane.rover.lat, pane.rover.h + 0.8, g.ellipsoid);
  const home = () => g.viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(w.view.lon, w.view.lat, w.radii[0] * 2.2, g.ellipsoid) });
  pane.isSpinning = () => spinning && !pane.rover;

  // Lock the camera onto the rover in a chase view. From orbit it flies in; close up (or with reduced motion) it cuts.
  // The camera then follows until the user drags the globe; the Follow button or a new deploy locks it back on.
  function chase() {
    const cam = g.viewer.camera, rover = pane.rover, [pitch, range] = VIEWS[view];
    const offset = new Cesium.HeadingPitchRange(rover.heading + orbit, Cesium.Math.toRadians(pitch), range * zoom);
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
    name ??= worldKey === 'earth' ? earthPlace(lat * D, lon * D, pane.features)
      : Promise.resolve(placeName(pane.features, lat * D, lon * D, w.radii[0]) ?? 'Unnamed terrain');
    await g.preload?.(lon, lat);
    if (dead || id !== deploys) return; // superseded by a newer deploy or a reset
    const { viewer } = g, rover = new Rover(w, g.heightAt, lon, lat, 0), color = Cesium.Color.fromCssColorString(ink), t0 = performance.now();
    Object.assign(pane, { rover, history: [], place: null, wx: undefined });
    trail = [];
    nextSample = 0;
    stalls = 0;
    charts.reset();
    pose.pos = roverPos();
    pose.q = Cesium.Quaternion.IDENTITY;
    // callback properties: reassigning constant ones every frame keeps the box geometry pending forever
    roverEntity = viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => pose.pos, false),
      orientation: new Cesium.CallbackProperty(() => pose.q, false),
      box: { dimensions: new Cesium.Cartesian3(4, 2.5, 1.6), material: color, outline: true, outlineColor: Cesium.Color.BLACK },
      point: { // the pin: a dot in the world's colour that breathes
        pixelSize: new Cesium.CallbackProperty(() => (REDUCED ? 11 : 11 + 2.5 * Math.sin(performance.now() / 300)), false),
        color, outlineColor: Cesium.Color.fromCssColorString('#07090C'), outlineWidth: 2, disableDepthTestDistance: Infinity,
      },
    });
    // the pin settling: a hairline ring contracts onto the point (450 ms ease-out), then fades
    ringEntity = viewer.entities.add({
      position: new Cesium.CallbackPositionProperty(() => pose.pos, false),
      point: {
        show: new Cesium.CallbackProperty(() => !REDUCED && performance.now() - t0 < 900, false),
        pixelSize: new Cesium.CallbackProperty(() => 14 + 50 * (1 - Math.min(1, (performance.now() - t0) / 450)) ** 3, false),
        color: Cesium.Color.TRANSPARENT, outlineWidth: 1.5, disableDepthTestDistance: Infinity,
        outlineColor: new Cesium.CallbackProperty(() => color.withAlpha(Math.max(0, 1 - Math.max(0, performance.now() - t0 - 450) / 450)), false),
      },
    });
    trailEntity = viewer.entities.add({
      polyline: { positions: new Cesium.CallbackProperty(() => trail, false), width: 2.5, material: color.withAlpha(0.85), arcType: Cesium.ArcType.NONE },
    });
    chase(); // tick() keeps re-aiming at the rover (trackedEntity misbehaves on non-WGS84 ellipsoids)
    status(`Rover driving · deployed at ${fmt(lat * D, 3)}°, ${fmt(lon * D, 3)}°`);
    const showPlace = (text) => { if (!dead && pane.rover === rover) { $('.place').hidden = false; $('.place').textContent = text; } };
    showPlace('Locating…');
    name.then((n) => { if (pane.rover === rover) pane.place = n; showPlace(n); });
    wxReq?.then((wx) => {
      if (dead || pane.rover !== rover) return;
      if (wx) rover.atmosphere = liveEarthAtmosphere(wx);
      pane.wx = wx;
      onEvent?.('weather', wx);
      const p = $('.wx');
      p.hidden = false;
      p.classList.toggle('live', !!wx);
      p.textContent = wx ? `Live weather · ${fmt(wx.T0 - 273.15, 1)} °C · ${fmt(wx.p0 / 100, 0)} hPa · wind ${fmt(wx.wind, 0)} km/h` : 'Standard atmosphere (live weather offline)';
    });
    return name;
  };

  function recall() {
    if (!pane.rover) return;
    for (const e of [roverEntity, ringEntity, trailEntity]) g.viewer.entities.remove(e);
    clearGrid();
    gridAt = null;
    Object.assign(pane, { rover: null, history: [], place: null, wx: undefined });
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
    status(idleText);
  };

  // what a click does, callable from the command palette: deploy at a coordinate and tell the console
  pane.pin = (latDeg, lonDeg) => {
    const named = pane.deploy(lonDeg / D, latDeg / D);
    onClick?.(latDeg, lonDeg, named);
  };
  // screen point (CSS px inside the pane) -> [latDeg, lonDeg] on the visible surface, or null over space
  pane.pickAt = (x, y) => {
    const c = g?.pick(new Cesium.Cartesian2(x, y));
    return c ? [c.latitude * D, c.longitude * D] : null;
  };
  // IAU name under a coordinate (Moon and Mars; Earth names need the network, so not on hover)
  pane.placeAt = (latDeg, lonDeg) => (g?.sampler ? placeName(pane.features, latDeg, lonDeg, w.radii[0]) : null);
  pane.setView = (v) => { view = v; orbit = 0; zoom = 1; if (pane.rover && g) chase(); };
  // D-pad: orbit the chase camera (radians) and scale its range; a cut, never an animation (it is pressed repeatedly)
  pane.nudge = (dOrbit, zoomBy) => { orbit += dOrbit; zoom = Math.min(6, Math.max(0.25, zoom * zoomBy)); if (pane.rover && g) chase(); };
  pane.follow = () => pane.rover && g && chase();
  pane.setLabels = (show) => toggleLabels?.(show);

  function tick() {
    const now = performance.now(), dt = Math.min(0.2, (now - last) / 1000), rover = pane.rover;
    last = now;
    if (!rover) {
      if (spinning) g.viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN * dt); // orbit the camera about the spin axis
      return;
    }
    if (!sim.paused) for (acc += dt; acc >= DT; acc -= DT) rover.step(DT);
    if (rover.stalls !== stalls) { stalls = rover.stalls; onEvent?.('stall'); }

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

  pane.ready = (async () => {
    status(`Loading ${w.name}…`);
    g = await createGlobe($('.globe'), w);
    if (dead) return g.viewer.destroy();
    const v = g.viewer;
    v.screenSpaceEventHandler.setInputAction((e) => {
      const c = g.pick(e.position);
      if (c) pane.pin(c.latitude * D, c.longitude * D);
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
    pane.features = await loadFeatures(worldKey);
    if (g.sampler && !dead) toggleLabels = addLabels(v, pane.features, g.ellipsoid, g.sampler.heightAt); // Moon and Mars only
    if (!pane.rover) status(idleText);
  })().catch((e) => { console.error(e); g = null; status(`Failed to load ${w.name}: ${e.message}`); });

  pane.destroy = () => {
    dead = true;
    charts.destroy();
    if (g && !g.viewer.isDestroyed()) g.viewer.destroy();
  };
  return pane;
}
