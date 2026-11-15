// Console state: the old js/main.js, minus its DOM code. Click Mars/Moon -> GET /api/analog -> the Earth rover deploys
// at the best match. Globes, rovers and charts live for the whole session; React reads this module and re-renders on emit().
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { WORLDS } from '../../js/physics.js';
import { similarity } from '../../js/similarity.js';
import { earthPlace } from '../../js/labels.js';
import { coord, shortEarth } from '@/lib/format';
import { loadEngine, type Engine } from './engine';
import type { Analog, Body, ChartGroup, Live, Page, Pane, Result, View } from './types';

export const PAGES: Record<Page, string> = { explore: '/sim', result: '/sim/result', drive: '/sim/drive', sensors: '/sim/sensors' };
export const ORDER = Object.keys(PAGES) as Page[];
export const LABEL: Record<Page, string> = { explore: 'Explore', result: 'Model result', drive: 'Live drive', sensors: 'Sensors' };
export const INK = { mars: '#FF7A45', moon: '#C9C6BC', earth: '#46C2F2' };
const LIVE_KEYS = ['elevation', 'slope', 'density', 'temperature'] as const;
const D2R = Math.PI / 180;
const worldOf = (): Body => (new URLSearchParams(location.search).get('world') === 'moon' ? 'moon' : 'mars');
const pageOf = (): Page => ORDER.find((p) => PAGES[p] === location.pathname.replace(/\/$/, '')) ?? 'explore';
export const worldName = (b: string) => (WORLDS as Record<string, { name: string }>)[b].name;
export const the = (b: string) => (b === 'moon' ? 'the Moon' : worldName(b)); // in a sentence: "on the Moon", "on Mars"

// Persistent DOM nodes owned by Cesium and Chart.js for the whole session. React "hosts" move them between layouts
// (desktop rails, phone sheet), so a canvas is never destroyed by a re-render.
const div = (cls: string) => Object.assign(document.createElement('div'), { className: cls });
export const nodes = { target: div('pane'), earth: div('pane'), dock: div('charts four'), tCharts: div('charts two'), eCharts: div('charts two') };

export const S = {
  ready: false, failed: '', body: worldOf(), page: pageOf(),
  results: { mars: null, moon: null } as Record<Body, Result | null>, // last model run per world; survives page and world switches
  live: null as Live, sensorOf: 'target' as 'target' | 'earth', view: '3d' as View, labels: true, cmd: false,
};
export let earth: Pane | null = null, target: Pane | null = null;
let E: Engine, dock: ChartGroup | null = null, timer = 0, runs = 0, version = 0;
const subs = new Set<() => void>();
export const emit = () => { version++; subs.forEach((f) => f()); };
export function useStore() {
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);
  return S;
}
export const paused = () => !!E?.sim.paused;
export const href = (p: Page) => PAGES[p] + (S.body === 'moon' ? '?world=moon' : '');

// Nominatim allows 1 request/s: name candidates one after another
let geoQueue: Promise<unknown> = Promise.resolve();
const named = (lat: number, lon: number) => {
  const p = geoQueue.then(() => earthPlace(lat, lon, [])) as Promise<string>;
  geoQueue = p.then(() => new Promise((r) => setTimeout(r, 1100)));
  return p;
};

const onEvent = (world: string) => (type: string, detail: unknown) => {
  if (type === 'weather' && !detail) toast.warning('Live weather offline · using ISA', { id: 'wx', description: 'Earth air comes from the standard atmosphere until Open-Meteo answers.' });
  if (type === 'stall') toast.warning(`${worldName(world)} rover stalled · recovering`, { id: `stall-${world}`, description: 'Wheels below 0.3 m/s for 3 s; it turns around and replans.' });
};

let started = false;
export async function init() {
  if (started) return;
  started = true;
  // /sim?pin=lat,lon (the landing page's "Launch" button): pin that site and run the real model on it. Read before
  // setBody() rewrites the URL.
  const pin = new URLSearchParams(location.search).get('pin')?.split(',').map(Number);
  addEventListener('popstate', () => { const b = worldOf(); if (b !== S.body) setBody(b); else route(); });
  route();
  try {
    E = await loadEngine();
  } catch (e) {
    S.failed = (e as Error).message;
    return emit();
  }
  earth = E.createPane(nodes.earth, 'earth', {
    chartsEl: nodes.eCharts, onEvent: onEvent('earth'),
    // the user chose their own Earth site (click or analog preset): remembered so a world switch can put the rover back
    onClick: (lat: number, lon: number) => { const r = S.results[S.body]; if (r?.state === 'done') { r.driven = -1; r.own = [lat, lon]; emit(); } },
  });
  S.ready = true;
  setBody(S.body, true);
  if (pin?.length === 2 && Math.abs(pin[0]) <= 90 && Math.abs(pin[1]) <= 180) target!.ready.then(() => target!.pin(pin[0], pin[1]));
}

export function setBody(b: Body, first = false) {
  if (!S.ready || (b === S.body && !first)) return;
  S.body = b;
  clearInterval(timer);
  dock?.destroy();
  target?.destroy();
  S.live = null;
  document.documentElement.style.setProperty('--target', INK[b]);
  const t = (target = E.createPane(nodes.target, b, { chartsEl: nodes.tCharts, onEvent: onEvent(b), onClick: (lat: number, lon: number, place: Promise<string>) => runModel(b, lat, lon, place) }));
  if (S.view !== '3d') t.setView(S.view);
  if (!S.labels) t.ready.then(() => t.setLabels(false));
  dock = E.createChartGroup(nodes.dock, E.MERGED, [{ label: 'Earth', color: INK.earth, area: true }, { label: worldName(b), color: INK[b], area: true }], { max: 240, legend: false });
  const t0 = performance.now();
  timer = window.setInterval(() => {
    const e = earth!.history.at(-1), s = t.history.at(-1);
    if ((e || s) && !E.sim.paused) {
      dock!.push(`${((performance.now() - t0) / 1000).toFixed(0)}s`, [
        [e && earth!.rover ? e.h - earth!.rover.h0 : null, s && t.rover ? s.h - t.rover.h0 : null], // relief relative to each deploy point
        [e?.slope ?? null, s?.slope ?? null],
        [e ? Math.max(e.rho, 1e-5) : null, s ? Math.max(s.rho, 1e-5) : null], // log axis: vacuum sits on the 1e-5 floor
        [e?.T ?? null, s?.T ?? null],
      ]);
      // polar sites: no Earth place is as cold as a Mars/Moon pole, so temperature is compared as each value's
      // position within its own world's range ("relative") instead of in kelvin
      const rel = relative();
      S.live = similarity(earth!.history, t.history, rel ? { rangeA: WORLDS.earth.tBounds, rangeB: WORLDS[b].tBounds } : undefined) as Live;
      LIVE_KEYS.forEach((k, i) => dock!.note(i, S.live ? `${S.live[k].toFixed(0)}% similar${rel && k === 'temperature' ? ' (relative)' : ''}` : ''));
    }
    emit();
  }, 500);
  // coming back to a world that already has a result: put both rovers back where they were
  const r = S.results[b];
  if (r?.state === 'done') {
    t.deploy(r.lon * D2R, r.lat * D2R);
    const c = r.data!.candidates[r.driven];
    if (c) earth!.deploy(c.lon * D2R, c.lat * D2R, r.names[r.driven]);
    else if (r.own) earth!.deploy(r.own[1] * D2R, r.own[0] * D2R);
  } else if (!r) earth!.reset();
  history.replaceState(null, '', href(S.page));
  route();
}
export const relative = () => S.results[S.body]?.data?.query?.temperature_mode === 'relative';

async function runModel(b: Body, lat: number, lon: number, place: Promise<string>) {
  const id = ++runs, r: Result = (S.results[b] = { state: 'loading', lat, lon, place: null, t0: performance.now(), pick: 0, driven: -1, names: [], resolved: [] });
  E.sim.paused = false;
  toast(`Site pinned · ${coord(lat, lon, 1)}`, { id: 'pin', description: `${worldName(b)} · running the TerraTwin model` });
  emit();
  place.then((p) => { r.place = p; if (S.results[b] === r) emit(); });
  try {
    const res = await fetch(`/api/analog?body=${b}&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`);
    const data = (await res.json()) as Analog;
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    if (id !== runs) return; // a newer click superseded this one
    Object.assign(r, { state: 'done', data, ms: performance.now() - r.t0, pick: 0, driven: -1, names: [], resolved: [] });
    data.candidates.forEach((c, i) => {
      r.names[i] = named(c.lat, c.lon);
      r.names[i].then((n) => { r.resolved[i] = n; if (S.results[b] === r) emit(); });
    });
    const c0 = data.candidates[0];
    if (c0) {
      r.names[0].then((n) => { if (S.results[b] === r) toast.success(`Twin found · ${shortEarth(n)}`, { id: 'twin', description: `Terrain fit ${Math.round(c0.terrain_fit)}/100 · ${c0.landform} · ${data.candidates.length} matches` }); });
      if (b === S.body) driveTo(0);
    } else toast.warning('No Earth twin for this site', { id: 'twin', description: 'No Earth cell passed the terrain screen.' });
    emit();
  } catch (e) {
    console.warn('Model request failed', e); // shown in the UI and a toast; a warning keeps the console free of errors
    if (id === runs) {
      Object.assign(r, { state: 'error', message: (e as Error).message });
      toast.error('Model unavailable', { id: 'twin', description: (e as Error).message });
      emit();
    }
  }
}

// put the Earth rover on candidate i of the current world's result
export function driveTo(i: number) {
  const r = S.results[S.body]!, c = r.data!.candidates[i];
  if (r.driven === i && earth!.rover) return;
  r.pick = r.driven = i;
  earth!.deploy(c.lon * D2R, c.lat * D2R, r.names[i]);
  emit();
}
export function select(i: number) { S.results[S.body]!.pick = i; emit(); }

export function resetSite() {
  S.results[S.body] = null;
  runs++;
  E.sim.paused = false;
  S.live = null;
  target?.reset();
  earth?.reset();
  go('explore');
}

export function go(p: Page) {
  history.pushState(null, '', href(p));
  route();
  scrollTo(0, 0);
}
export function route() {
  S.page = pageOf();
  document.title = `${LABEL[S.page]} · GeoNexus`;
  emit();
}

// command palette and toolbar actions
export function pinTarget(lat: number, lon: number) { if (S.page !== 'explore') go('explore'); target?.pin(lat, lon); }
export function pinEarth(lat: number, lon: number) { earth?.pin(lat, lon); }
export function setPaused(p: boolean) { if (E) { E.sim.paused = p; emit(); } }
export function setSensor(s: 'target' | 'earth') { S.sensorOf = s; emit(); }
export function setView(v: View) { S.view = v; target?.setView(v); earth?.setView(v); emit(); }
export function nudge(dOrbit: number, zoomBy: number) { target?.nudge(dOrbit, zoomBy); earth?.nudge(dOrbit, zoomBy); }
export function follow() { target?.follow(); earth?.follow(); }
export function setLabels(on: boolean) { S.labels = on; target?.setLabels(on); emit(); }
export function setCmd(open: boolean) { S.cmd = open; emit(); }
export const shortPlace = () => (target?.place ?? '').split(' · ')[0].replace(/ \([^)]*\)$/, '');
