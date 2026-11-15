// Simulator shell: four client-side pages (Explore, Model result, Live drive, Sensors) over one shared state.
// Click Mars/Moon -> dataset features + S1 model (GET /api/analog) -> the Earth rover deploys at the best match.
// The globes, rovers and charts live for the whole session, so moving between pages never loses anything.
import { WORLDS } from './physics.js';
import { createPane, sim } from './pane.js';
import { createChartGroup, MERGED } from './charts.js';
import { earthPlace } from './labels.js';
import { similarity } from './similarity.js';

const BODIES = { mars: '#FF7A45', moon: '#C9C6BC' };
const EARTH = '#4FB3FF';
const PAGES = { explore: '/sim', result: '/sim/result', drive: '/sim/drive', sensors: '/sim/sensors' };
const ORDER = Object.keys(PAGES);
const LABEL = { explore: 'Explore', result: 'Model result', drive: 'Live drive', sensors: 'Sensors' };
const DECIMALS = { slope_median_deg: 2, slope_p90_deg: 2, relief_m: 0, roughness_rms_m: 1, anisotropy: 2, pit_density: 3, rough_1: 1, rough_4: 1, rough_16: 1 };
const QUERY_ROWS = [['slope_median_deg', 'Median slope', '°'], ['slope_p90_deg', 'Steep slope (90th pct)', '°'], ['relief_m', 'Relief (high − low)', ' m'],
  ['roughness_rms_m', 'Roughness (RMS)', ' m'], ['anisotropy', 'Anisotropy (0 round – 1 linear)', ''], ['pit_density', 'Pit density (crater proxy)', ' /km²']];
const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const LIVE_KEYS = ['elevation', 'slope', 'density', 'temperature'];
const D2R = Math.PI / 180;
const PIN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/></svg>';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const num = (x, d) => (x == null ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const coord = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
const shortSite = (p) => (p ?? 'Locating…').split(' · ')[0].replace(/ \([^)]*\)$/, ''); // "Amazonis Planitia (Planitia) · 437 km from…" -> "Amazonis Planitia"
const shortEarth = (n) => { const a = (n ?? 'Locating…').split(', '); return a.length > 2 ? `${a[0]}, ${a.at(-1)}` : a.join(', '); };

const results = { mars: null, moon: null }; // last model run per world; survives page and world switches
const pageOf = () => ORDER.find((p) => PAGES[p] === location.pathname.replace(/\/$/, '')) ?? 'explore';
let body = null, page = pageOf(), target = null, dock = null, timer = null, runs = 0, live = null, sensorOf = 'target';
const earth = createPane($('earth-pane'), 'earth', { statsEl: $('earth-stats'), chartsEl: $('earth-charts'), onClick: () => {
  const r = results[body];
  if (r?.state === 'done') { r.driven = -1; renderAll(); } // the user chose their own Earth site
} });
const name = () => WORLDS[body].name;
const href = (p) => PAGES[p] + (body === 'moon' ? '?world=moon' : '');

// Nominatim allows 1 request/s: name candidates one after another
let geoQueue = Promise.resolve();
const named = (lat, lon) => {
  const p = geoQueue.then(() => earthPlace(lat, lon, []));
  geoQueue = p.then(() => new Promise((r) => setTimeout(r, 1100)));
  return p;
};

function setBody(b) {
  if (b === body) return;
  body = b;
  clearInterval(timer);
  dock?.destroy();
  target?.destroy();
  live = null;
  document.querySelectorAll('[data-body]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.body === b));
  document.documentElement.style.setProperty('--target', BODIES[b]);
  document.querySelectorAll('.w-name').forEach((x) => { x.textContent = name(); });
  target = createPane($('target-pane'), b, { statsEl: $('target-stats'), chartsEl: $('target-charts'), onClick: (lat, lon, place) => runModel(b, lat, lon, place) });
  dock = createChartGroup($('dock-charts'), MERGED, [{ label: 'Earth', color: EARTH }, { label: name(), color: BODIES[b] }], { max: 240, legend: false });
  const t0 = performance.now();
  timer = setInterval(() => {
    const e = earth.history.at(-1), t = target.history.at(-1);
    if ((e || t) && !sim.paused) {
      dock.push(`${((performance.now() - t0) / 1000).toFixed(0)}s`, [
        [e && earth.rover ? e.h - earth.rover.h0 : null, t && target.rover ? t.h - target.rover.h0 : null], // relief relative to each deploy point
        [e?.slope ?? null, t?.slope ?? null],
        [e ? Math.max(e.rho, 1e-5) : null, t ? Math.max(t.rho, 1e-5) : null], // log axis: vacuum sits on the 1e-5 floor
        [e?.T ?? null, t?.T ?? null],
      ]);
      // polar sites: no Earth place is as cold as a Mars/Moon pole, so temperature is compared as each value's
      // position within its own world's range ("relative") instead of in kelvin
      const rel = results[body]?.data?.query?.temperature_mode === 'relative';
      live = similarity(earth.history, target.history, rel ? { rangeA: WORLDS.earth.tBounds, rangeB: WORLDS[body].tBounds } : undefined);
      LIVE_KEYS.forEach((k, i) => dock.note(i, live ? `${live[k].toFixed(0)}% similar${rel && k === 'temperature' ? ' (relative)' : ''}` : ''));
    }
    tickUI();
  }, 500);
  // coming back to a world that already has a result: put both rovers back where they were
  const r = results[b];
  if (r?.state === 'done') {
    target.deploy(r.lon * D2R, r.lat * D2R);
    const c = r.data.candidates[r.driven];
    if (c) earth.deploy(c.lon * D2R, c.lat * D2R, r.names[r.driven]);
  } else if (!r) earth.reset();
  history.replaceState(null, '', href(page));
  route();
}

async function runModel(b, lat, lon, place) {
  const id = ++runs, r = (results[b] = { state: 'loading', lat, lon, place: null });
  sim.paused = false;
  renderAll();
  place.then((p) => { r.place = p; if (results[b] === r) renderAll(); });
  try {
    const res = await fetch(`/api/analog?body=${b}&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`), data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    if (id !== runs) return; // a newer click superseded this one
    Object.assign(r, { state: 'done', data, pick: 0, driven: -1, names: [], resolved: [] });
    data.candidates.forEach((c, i) => {
      r.names[i] = named(c.lat, c.lon);
      r.names[i].then((n) => { r.resolved[i] = n; if (results[b] === r) renderAll(); });
    });
    if (data.candidates.length && b === body) driveTo(0);
    renderAll();
  } catch (e) {
    console.error(e);
    if (id === runs) { Object.assign(r, { state: 'error', message: e.message }); renderAll(); }
  }
}

// put the Earth rover on candidate i of the current world's result
function driveTo(i) {
  const r = results[body], c = r.data.candidates[i];
  if (r.driven === i && earth.rover) return;
  r.pick = r.driven = i;
  earth.deploy(c.lon * D2R, c.lat * D2R, r.names[i]);
}

function resetSite() {
  results[body] = null;
  runs++;
  sim.paused = false;
  live = null;
  target.reset();
  earth.reset();
  go('explore');
}

// ---------------------------------------------------------------------------------------------------- routing
function go(p) { history.pushState(null, '', href(p)); route(); scrollTo(0, 0); }

function route() {
  page = pageOf();
  document.title = `${LABEL[page]} · Rover Sim`;
  document.querySelectorAll('[data-tab]').forEach((a) => {
    a.setAttribute('href', href(a.dataset.tab));
    if (a.dataset.tab === page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const i = ORDER.indexOf(page), prev = $('prev'), next = $('next');
  prev.hidden = i === 0;
  if (i > 0) { prev.setAttribute('href', href(ORDER[i - 1])); prev.textContent = `← ${LABEL[ORDER[i - 1]]}`; }
  next.hidden = i === ORDER.length - 1;
  if (i < ORDER.length - 1) { next.setAttribute('href', href(ORDER[i + 1])); next.textContent = `${LABEL[ORDER[i + 1]]} →`; }
  $('newsite').hidden = i !== ORDER.length - 1;
  $('t-title').textContent = page === 'drive' ? `${name()} rover` : `Your site on ${name()}`;
  $('e-title').textContent = page === 'drive' ? 'Earth rover' : 'Closest match on Earth';
  renderAll();
}

function renderAll() {
  const r = results[body], gated = page !== 'explore' && !r; // pages 2–4 need a site on the current world
  document.querySelectorAll('[data-pages]').forEach((el) => { el.hidden = gated || !el.dataset.pages.split(' ').includes(page); });
  $('empty').hidden = !gated;
  if (gated) {
    $('empty').innerHTML = `<span class="icon">${PIN}</span><div><h2>No ${name()} site chosen yet</h2>
      <p>Pick a spot on the ${name()} globe first. The model result, live drive and sensor pages open up once there is a site.</p></div>
      <a class="btn primary" data-link href="${href('explore')}">Go to Explore</a>`;
  }
  $('earth-pane').classList.toggle('scanning', r?.state === 'loading');
  renderSummary(r);
  renderResult(r);
  tickUI();
}

// light text updates, twice a second (never rebuilds markup, so focus and hover survive)
function tickUI() {
  const r = results[body], drive = page === 'drive', run = sim.paused ? 'paused' : 'live';
  $('t-state').textContent = target.rover ? (drive ? run : 'site pinned') : target.isSpinning() ? 'turning · no site yet' : 'no site yet';
  $('e-state').textContent = earth.rover ? (drive ? run : r?.driven === -1 ? 'your own site' : 'match found')
    : r?.state === 'loading' ? 'scanning for a match…' : earth.isSpinning() ? 'turning · waiting' : 'waiting';
  document.querySelectorAll('.live-score').forEach((x) => { x.textContent = live ? `${live.overall.toFixed(0)}%` : '—'; });
  $('pause').textContent = sim.paused ? 'Resume drive' : 'Pause drive';
  $('pause').setAttribute('aria-pressed', sim.paused);
  $('drive-sub').textContent = `${shortSite(target.place)}, ${name()} and ${shortEarth(earth.place)}, driven side by side.`;
  const pane = sensorOf === 'target' ? target : earth;
  $('sensor-title').textContent = `${sensorOf === 'target' ? name() : 'Earth'} rover · ${pane.rover ? (sensorOf === 'target' ? shortSite(pane.place) : shortEarth(pane.place)) : 'not deployed yet'}`;
}

// ---------------------------------------------------------------------------------------------------- Explore summary
function renderSummary(r) {
  const el = $('summary');
  const site = r ? `${esc(r.place ?? 'Locating…')} · <span class="mono">${coord(r.lat, r.lon)}</span>` : '';
  if (!r) {
    el.innerHTML = `<span class="icon">${PIN}</span><div><h2>No ${name()} site chosen yet</h2>
      <p>Click the ${name()} globe. The model result, live drive and sensor pages open up once there is a match.</p></div>`;
  } else if (r.state === 'loading') {
    el.innerHTML = `<span class="icon">${PIN}</span><div class="grow"><h2>Finding Earth’s twin…</h2><p>${site}</p>
      <div class="shimmer" role="progressbar" aria-label="Running the terrain model"></div></div>`;
  } else if (r.state === 'error' || !r.data.candidates.length) {
    el.innerHTML = `<span class="icon">${PIN}</span><div class="grow"><h2>No match for this site</h2><p>${site}</p><p class="bad">${esc(failure(r))}</p></div>
      <button class="btn ghost" data-act="reset">Pick another site</button>`;
  } else {
    const c = r.data.candidates[0];
    el.innerHTML = `<div class="grow"><p class="eyebrow">Match #1 · ${esc(c.landform)}${c.near_analog ? ` · near ${esc(c.near_analog)} (NASA analog)` : ''}${r.data.relaxation.relaxed ? ' · relaxed match' : ''}</p>
        <h2>${esc(shortEarth(r.resolved[0]))}</h2><p>${esc(shortSite(r.place))}, ${name()} → <span class="mono">${coord(c.lat, c.lon)}</span></p></div>
      <div class="mini"><b>${num(c.terrain_fit, 0)}<small>/100</small></b><span>Terrain fit</span></div>
      <div class="mini"><b>${c.learned_similarity == null ? '—' : num(c.learned_similarity, 2)}</b><span>Shape similarity</span></div>
      <div class="actions"><button class="btn ghost" data-act="reset">Pick another site</button>
        <a class="btn ghost" data-link href="${href('result')}">Model result</a>
        <a class="btn primary" data-link href="${href('drive')}">Start the drive →</a></div>`;
  }
}

const failure = (r) => (r.state === 'error' ? `The model request failed: ${r.message}`
  : r.data.status === 'no_elevation_data' ? r.data.error
  : r.data.status === 'target_insufficient_evidence' ? 'The dataset has no complete terrain measurements for this cell, so the model cannot be run on it.'
    : 'No Earth cell passed the terrain screen for this cell.');

// ---------------------------------------------------------------------------------------------------- Model result
function confidence(r, i) {
  // the server checks landform class and anisotropy; with a live drive on this match, High also needs >= 60 % drive similarity
  const c = r.data.candidates[i];
  return c.confidence === 'high' && i === r.driven && live && live.overall < 60 ? 'medium' : c.confidence;
}
const badge = (r, i, q) => {
  const k = confidence(r, i), c = r.data.candidates[i];
  const why = k === 'low' ? `Statistical match only — landform differs (${q} vs ${c.landform})` : CONF[k];
  return `<i class="conf ${k}" title="${esc(why)}">${k === 'low' ? 'Statistical match only' : CONF[k]}</i>`;
};
const top = (c, d) => `top ${c.percentile < 0.1 ? c.percentile.toFixed(2) : c.percentile.toFixed(1)}% of ${num(d.passed, 0)}`;

function renderResult(r) {
  const head = $('result-head'), el = $('result');
  if (!r) return;
  const eyebrow = '<p class="eyebrow">Step 2 of 4 · Model result</p>';
  const q = r.data?.query?.landform;
  const sub = `<p class="mono sub">${name()} site · ${esc(r.place ?? 'Locating…')} · ${coord(r.lat, r.lon)}${q ? ` · <span class="lf">${esc(q)}</span>` : ''}</p>`;
  const change = `<a class="btn ghost" data-link href="${href('explore')}">Change site</a>`;
  if (r.state !== 'done' || !r.data.candidates.length) {
    head.innerHTML = `<div>${eyebrow}<h1>${esc(shortSite(r.place))} → <em class="earth">…</em></h1>${sub}</div>${change}`;
    el.innerHTML = r.state === 'loading'
      ? '<div class="card"><h2>Running the model…</h2><p class="muted">Cutting 16 km elevation patches and comparing landforms.</p><div class="shimmer"></div></div>'
      : `<div class="card"><h2>No match for this site</h2><p class="bad">${esc(failure(r))}</p></div>`;
    return;
  }
  const d = r.data, c = d.candidates[r.pick], n = name(), rel = d.relaxation;
  head.innerHTML = `<div>${eyebrow}<h1>${esc(shortSite(r.place))} <span class="arrow">→</span> <em class="earth">${esc(shortEarth(r.resolved[r.pick]))}</em></h1>${sub}</div>${change}`;
  const rows = c.comparisons.map((x) => {
    const dp = DECIMALS[x.feature] ?? 2, match = Math.round(100 * x.match);
    return `<tr><th scope="row">${esc(x.label)}</th><td class="t">${num(x.target_value, dp)}${x.unit}</td><td class="e">${num(x.earth_value, dp)}${x.unit}</td>
      <td class="b"><div class="bar"><b style="width:${match}%"></b></div></td><td>${match}%</td></tr>`;
  }).join('');
  const list = d.candidates.map((k, i) => `<li><button data-act="select" data-i="${i}" aria-pressed="${i === r.pick}">
      <span class="rank">${i + 1}</span>
      <span class="nm">${esc(r.resolved[i] ?? 'Locating…')}<small>${coord(k.lat, k.lon)} · ${esc(k.landform)} · ${top(k, d)}${i === r.driven ? ' · rover is here' : ''}</small>
        <span class="tags">${badge(r, i, q)}${k.near_analog ? `<i class="tag">near ${esc(k.near_analog)} (NASA analog)</i>` : ''}</span></span>
      <span class="sc">${num(k.terrain_fit, 0)}<small>fit</small></span>
      <span class="sc">${k.learned_similarity == null ? '—' : num(k.learned_similarity, 2)}<small>shape</small></span></button></li>`).join('');
  const qd = d.query.descriptors;
  const screen = `${num(d.screened, 0)} Earth cells screened (${esc(rel.name)}); ${num(d.passed, 0)} passed the terrain screen. `
    + `The model’s top ${num(Math.min(d.passed, 200), 0)} were re-ranked by landform and spread out, so no two matches are within 500 km. `
    + (d.query.indexed ? 'First-stage order: S1 shape similarity.' : 'This site is outside the S1 index (beyond ±80°), so the first stage orders by terrain fit.');
  const land = [c.barren_fraction == null ? null : `${num(100 * c.barren_fraction, 0)}% barren land`,
    c.aridity_index == null ? null : `aridity index ${num(c.aridity_index, 3)} (below 0.05 is hyper-arid)`].filter(Boolean).join(', ');
  el.innerHTML = `
    ${rel.relaxed ? `<p class="relaxed"><b>Relaxed match</b> · no Earth cell passed the earlier screens, so this result uses step ${rel.step} of 4: ${esc(rel.name)}.</p>` : ''}
    <div class="scores">
      <div class="card score"><b>${num(c.terrain_fit, 0)}<small>/100</small></b><h3>Terrain fit</h3><p>4 features on matching 16 km patches · ${top(c, d)}</p></div>
      <div class="card score"><b>${c.learned_similarity == null ? '—' : num(c.learned_similarity, 2)}</b><h3>Shape similarity</h3>
        <p>${c.learned_similarity == null ? 'Outside the model index (beyond ±80°)' : 'S1 model, cosine (max 1)'}</p></div>
      <a class="card score" data-link href="${href('drive')}"><b class="live-score">—</b><h3>Live drive similarity ↗</h3><p>From both rovers, last 60 s${d.query.temperature_mode === 'relative' ? ' · temperature compared relative to each world’s range' : ''}</p></a>
    </div>
    <div class="cols2">
      <div class="stack">
        <section class="card"><p class="eyebrow">What the model received</p>
          <p class="lead">A ${num(d.query.patch_km, 0)} km elevation patch, ${num(d.query.px_m, 0)} m per pixel, centred on the site · landform <span class="lf">${esc(q)}</span></p>
          <ul class="feat">${QUERY_ROWS.map(([k, label, unit]) => `<li><span>${label}</span><b>${num(qd[k], DECIMALS[k])}${unit}</b></li>`).join('')}
            <li><span>Terrain-shape embedding</span><b>${d.query.indexed ? '64 numbers' : 'not indexed'}</b></li></ul>
          <p class="note">Every patch, on every world, is the same 16 km square in metres (azimuthal equidistant, so it is not squashed near the poles). Dataset cell <code>${esc(d.target.feature_id)}</code>.</p></section>
        <section class="card"><p class="eyebrow">Feature match with match #${r.pick + 1} · ${esc(q)} vs ${esc(c.landform)}</p>
          <table class="cmp"><thead><tr><th></th><th>${n}</th><th>Earth</th><th colspan="2">Match</th></tr></thead><tbody>${rows}</tbody></table>
          ${land ? `<p class="note">Earth cell is ${land}.</p>` : ''}</section>
      </div>
      <section class="card"><p class="eyebrow">Earth matches the model returned</p>
        <p class="lead muted">Pick one to drive there</p>
        <ol class="cands">${list}</ol>
        <p class="note">${screen}</p>
        <button class="btn primary wide" data-act="drive">Drive to ${esc(shortEarth(r.resolved[r.pick]).split(',')[0])} →</button></section>
    </div>
    <p class="note">Scores are experimental terrain resemblance from the TerraTwin dataset (release 0.2.0) and its S1 model. They are not a probability, an accuracy or a judgement that a site is suitable. Landform classes come from simple rules on 500 m elevation samples, which cannot resolve features smaller than about 1–2 km (most dunes and small craters).</p>`;
}

// ---------------------------------------------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button)) {
    e.preventDefault();
    history.pushState(null, '', a.getAttribute('href'));
    route();
    scrollTo(0, 0);
    return;
  }
  const act = e.target.closest('[data-act]'), r = results[body];
  if (!act) return;
  if (act.dataset.act === 'reset') resetSite();
  if (act.dataset.act === 'select') { r.pick = Number(act.dataset.i); renderAll(); }
  if (act.dataset.act === 'drive') { driveTo(r.pick); go('drive'); }
});
addEventListener('popstate', () => {
  const b = new URLSearchParams(location.search).get('world') === 'moon' ? 'moon' : 'mars';
  if (b !== body) setBody(b); else route();
});
document.querySelectorAll('[data-body]').forEach((x) => x.addEventListener('click', () => setBody(x.dataset.body)));
document.querySelectorAll('[data-rover]').forEach((x) => x.addEventListener('click', () => {
  sensorOf = x.dataset.rover;
  document.querySelectorAll('[data-rover]').forEach((y) => y.setAttribute('aria-pressed', y === x));
  $('target-charts').hidden = sensorOf !== 'target';
  $('earth-charts').hidden = sensorOf !== 'earth';
  tickUI();
}));
$('pause').addEventListener('click', () => { sim.paused = !sim.paused; tickUI(); });
setBody(new URLSearchParams(location.search).get('world') === 'moon' ? 'moon' : 'mars');
