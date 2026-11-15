// Rail panels of the console: mission (site, model run, twin summary), active asset, Earth twin, drive control, sensors.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Crosshair, MapPin, Pause, Play } from 'lucide-react';
import { cn } from 'cn';
import { ROVER } from '../../js/rover.js';
import { Meter, Num, Panel } from '@/components/hud';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { coord, isMac, num, shortEarth, shortSite } from '@/lib/format';
import { Readouts, Spark } from './bits';
import { earth, follow, go, href, INK, nudge, paused, resetSite, S, setPaused, setSensor, target, useStore, worldName } from './store';
import type { Analog, Result } from './types';

const R2D = 180 / Math.PI;
export const LinkTo = ({ page, className, children }: { page: Parameters<typeof go>[0]; className?: string; children: React.ReactNode }) => (
  <a className={className} href={href(page)} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); go(page); }}>{children}</a>
);

// ------------------------------------------------------------------------------------------------ model run rows
const stages = (d?: Analog) => Object.entries(d?.timing_s ?? {}).filter(([k]) => k.startsWith('step')).map(([, v]) => v as { stage1_s: number; stage2_s: number });
export function TaskRows({ r }: { r: Result }) {
  const done = r.state === 'done', d = r.data, st = stages(d);
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    if (r.state !== 'loading') return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [r.state]);
  const rows: [string, number | undefined][] = [
    ['Sampling a 16 km elevation patch', d?.timing_s.patch],
    ['Extracting landform features', d?.timing_s.features],
    [d ? `Screening ${num(d.screened, 0)} Earth cells` : 'Screening Earth terrain cells', st.reduce((a, s) => a + s.stage1_s, 0)],
    ['Ranking candidates by landform', st.reduce((a, s) => a + s.stage2_s, 0)],
  ];
  return (
    <ol className="tasks" aria-live="polite" data-state={r.state}>
      {rows.map(([label, t], i) => (
        <li key={label.slice(0, 12)} style={{ '--i': i } as React.CSSProperties}>
          <span className="tk-dot" aria-hidden="true" />
          <span className="tk-label">{label}</span>
          <span className="tk-t mono">{done && t != null ? `${t.toFixed(2)} s` : ''}</span>
        </li>
      ))}
      <li className="tk-total mono">
        {r.state === 'loading' ? `TerraTwin running · ${((now - r.t0) / 1000).toFixed(1)} s` : done ? `Round trip ${((r.ms ?? 0) / 1000).toFixed(2)} s · server ${d!.timing_s.total.toFixed(2)} s` : 'Stopped'}
      </li>
    </ol>
  );
}

const failure = (r: Result) => (r.state === 'error' ? `The model request failed: ${r.message}`
  : r.data!.status === 'no_elevation_data' ? r.data!.error!
  : r.data!.status === 'target_insufficient_evidence' ? 'The dataset has no complete terrain measurements for this cell, so the model cannot be run on it.'
    : 'No Earth cell passed the terrain screen for this cell.');
export function Failure({ r }: { r: Result }) {
  return (
    <div className="failure" role="alert">
      <p>{failure(r)}</p>
      <button className="btn ghost" onClick={resetSite}>Pick another site</button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ explore: left rail
export function MissionPanel() {
  const s = useStore(), r = s.results[s.body], n = worldName(s.body);
  const c = r?.state === 'done' ? r.data!.candidates[0] : undefined;
  return (
    <Panel className="mission">
      <h1 className="h-display">Find Earth’s twin for a place on <em>{n}</em></h1>
      {!r ? (
        <>
          <p className="lede">Click anywhere on {n}. The TerraTwin model reads a 16 km elevation patch around the point and searches Earth for the terrain that is most alike.</p>
          <p className="hint"><MapPin aria-hidden="true" /><span>Or press <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd> to jump to a named crater or landing site.</span></p>
        </>
      ) : (
        <div className="site">
          <p className="site-name">{shortSite(r.place)}</p>
          <p className="mono dim">{coord(r.lat, r.lon)}{r.data?.query ? ` · ${r.data.query.landform}` : ''}</p>
        </div>
      )}
      {r && r.state !== 'error' && <TaskRows r={r} />}
      {r && (r.state === 'error' || (r.state === 'done' && !c)) && <Failure r={r} />}
      {c && (
        <div className="twin-summary">
          <p className="ts-kicker">Match 1 of {r!.data!.candidates.length} · {c.landform}{c.near_analog ? ` · near ${c.near_analog} (NASA analog)` : ''}{r!.data!.relaxation.relaxed ? ' · relaxed match' : ''}</p>
          <h2 className="ts-name">{shortEarth(r!.resolved[0])}</h2>
          <p className="mono dim">{coord(c.lat, c.lon)}</p>
          <div className="ts-scores">
            <div><b className="score-big"><Num value={c.terrain_fit} /><small>/100</small></b><span>Terrain fit</span></div>
            <div><b className="score-big"><Num value={c.learned_similarity} d={2} /></b><span>Shape similarity</span></div>
          </div>
          <div className="actions">
            <LinkTo page="drive" className="btn primary">Start the drive</LinkTo>
            <LinkTo page="result" className="btn ghost">Model result</LinkTo>
            <button className="btn quiet" onClick={resetSite}>Pick another site</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ right rail
export function ActiveAsset() {
  const s = useStore(), r = target?.rover, n = worldName(s.body);
  const state = !r ? 'Standby' : paused() ? 'Paused' : 'Nominal';
  return (
    <Panel bracket className="asset">
      <div className="asset-head"><span>Active asset</span><span className="badge" data-state={state.toLowerCase()}>{state}</span></div>
      <h2 className="h-display">{r ? `${n} rover` : `${n} · no rover yet`}</h2>
      <p className="mono dim">{r ? `${coord(r.lat * R2D, r.lon * R2D, 3)} · heading ${Math.round(r.heading * R2D)}°` : 'Pin a site to deploy a rover'}</p>
      <Spark values={(target?.history ?? []).map((h) => h.h)} color={INK[s.body]} label="Elevation, last 60 s" />
    </Panel>
  );
}

export function TwinCard({ globe }: { globe?: React.ReactNode }) {
  const s = useStore(), r = s.results[s.body];
  const state = earth?.rover ? (r?.driven === -1 ? 'your own site' : 'match found') : r?.state === 'loading' ? 'scanning…' : 'waiting';
  return (
    <Panel className="twin-card" aria-label="Closest match on Earth">
      <div className="card-head"><h2><i className="dot earth" aria-hidden="true" />Closest match on Earth</h2><span className="mono dim">{state}</span></div>
      {globe}
      <Readouts pane={earth} world="earth" layout="grid" />
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ drive control
const CHANNELS = [['elevation', 'Relief'], ['slope', 'Slope'], ['density', 'Air density'], ['temperature', 'Temperature']] as const;
export function Channels() {
  const s = useStore(), L = s.live;
  return (
    <ul className="channels">
      {CHANNELS.map(([k, label]) => (
        <li key={k}><span>{label}</span><Meter value={L ? L[k] : null} tone={L && L[k] < 25 ? 'warn' : 'score'} label={`${label} similarity`} /><Num value={L?.[k]} suffix="%" /></li>
      ))}
    </ul>
  );
}

function SpeedGauge() {
  useStore();
  const max = 15, mark = (v: number | undefined) => `${(1 - Math.min(max, v ?? 0) / max) * 100}%`;
  const t = target?.rover, e = earth?.rover;
  return (
    <div className="gauge">
      <div className="ruler" aria-hidden="true">
        {[15, 10, 5, 0].map((v) => <span key={v} style={{ top: mark(v) }}>{v}</span>)}
        <i className="tick target-speed" style={{ top: mark(ROVER.vTarget) }} />
        {t && <i className="tick world" style={{ top: mark(t.v), background: 'var(--target)' }} />}
        {e && <i className="tick world" style={{ top: mark(e.v), background: 'var(--earth)' }} />}
      </div>
      <div className="gauge-read">
        <p><b className="score-big"><Num value={t?.v} d={1} /></b><small>m/s</small><span>Current speed · {worldName(S.body)}</span></p>
        <p><b className="score-big"><Num value={e?.v} d={1} /></b><small>m/s</small><span>Current speed · Earth</span></p>
        <p><b className="score-big dim"><Num value={ROVER.vTarget} d={1} /></b><small>m/s</small><span>Target speed (PI controller)</span></p>
      </div>
    </div>
  );
}

// D-pad: orbits and zooms both chase cameras; the centre re-locks them on the rovers
function DPad() {
  const k = 'dpad-btn';
  return (
    <div className="dpad" role="group" aria-label="Chase camera">
      <button className={cn(k, 'up')} onClick={() => nudge(0, 0.7)} aria-label="Zoom in"><ChevronUp /></button>
      <button className={cn(k, 'left')} onClick={() => nudge(-Math.PI / 6, 1)} aria-label="Orbit left"><ChevronLeft /></button>
      <button className={cn(k, 'mid')} onClick={follow} aria-label="Follow rovers"><Crosshair /></button>
      <button className={cn(k, 'right')} onClick={() => nudge(Math.PI / 6, 1)} aria-label="Orbit right"><ChevronRight /></button>
      <button className={cn(k, 'down')} onClick={() => nudge(0, 1.4)} aria-label="Zoom out"><ChevronDown /></button>
    </div>
  );
}

export function PauseButton({ className }: { className?: string }) {
  useStore();
  const p = paused(), live = !!target?.rover;
  return (
    <button className={cn('btn pause', className)} aria-pressed={p} disabled={!live} onClick={() => setPaused(!p)}>
      {p ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}{p ? 'Resume drive' : 'Pause drive'}
    </button>
  );
}

export function ControlPanel() {
  const s = useStore();
  return (
    <Panel bracket className="control">
      <div className="card-head"><h2>Drive control</h2><span className="mono dim">{s.live ? 'last 60 s' : 'warming up'}</span></div>
      <div className="overall"><b className="score-hero"><Num value={s.live?.overall} suffix="%" /></b><span>Overall similarity, Earth vs {worldName(s.body)}</span></div>
      <Channels />
      <SpeedGauge />
      <div className="control-row">
        <DPad />
        <div className="control-side">
          <p className="dim small">Camera: arrows orbit and zoom both chase views; the centre follows the rovers again.</p>
          <PauseButton />
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ sensors
const SENSOR_ROWS = [['Elevation', 0, 'm'], ['Slope', 1, '°'], ['Air density', 4, 'kg/m³'], ['Temperature', 0, 'K']] as const;
export function SensorSide() {
  const s = useStore(), pane = s.sensorOf === 'target' ? target : earth, tel = pane?.rover?.telemetry(), n = worldName(s.body);
  const place = pane?.rover ? (s.sensorOf === 'target' ? shortSite(pane.place) : shortEarth(pane.place)) : 'not deployed yet';
  return (
    <Panel className="sensor-side">
      <h1 className="h-display">Measured <span className="dim">vs</span> <em className="inferred">inferred</em></h1>
      <p className="lede">Each rover measures its surroundings and also infers them from its own motion: drive force, wheel odometry and an accelerometer. Where the lines agree, it understands its terrain.</p>
      <ToggleGroup className="seg" value={[s.sensorOf]} onValueChange={(v) => v[0] && setSensor(v[0] as 'target' | 'earth')} aria-label="Which rover">
        <ToggleGroupItem value="target"><i className="dot target" aria-hidden="true" />{n} rover</ToggleGroupItem>
        <ToggleGroupItem value="earth"><i className="dot earth" aria-hidden="true" />Earth rover</ToggleGroupItem>
      </ToggleGroup>
      <p className="mono dim">{place}</p>
      <table className="sense">
        <thead><tr><th scope="col">Channel</th><th scope="col">Measured</th><th scope="col">Inferred</th></tr></thead>
        <tbody>
          {SENSOR_ROWS.map(([k, d, unit], i) => (
            <tr key={k}><th scope="row">{k} <small>{unit}</small></th>
              <td><Num value={tel?.[i][0]} d={d} /></td><td className="inferred"><Num value={tel?.[i][1]} d={d} /></td></tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function EmptyState() {
  const n = worldName(S.body);
  return (
    <Panel className="empty" level={2}>
      <MapPin aria-hidden="true" className="empty-ic" />
      <h1 className="h-display">No {n} site chosen yet</h1>
      <p className="lede">Pick a spot on the {n} globe first. The model result, live drive and sensor pages open up once there is a site.</p>
      <LinkTo page="explore" className="btn primary">Go to Explore</LinkTo>
    </Panel>
  );
}
