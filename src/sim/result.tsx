// Model result page: what the model received, the twin side by side, live per-channel agreement, and the match list.
import { useState } from 'react';
import { motion } from 'motion/react';
import { TriangleAlert, X } from 'lucide-react';
import { Meter, Num, Panel } from '@/components/hud';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { coord, num, shortEarth, shortSite } from '@/lib/format';
import { Channels, Failure, LinkTo, TaskRows } from './panels';
import { driveTo, earth, go, relative, S, select, target, useStore, worldName } from './store';
import type { Result, Sample } from './types';

const DECIMALS: Record<string, number> = { slope_median_deg: 2, slope_p90_deg: 2, relief_m: 0, roughness_rms_m: 1, anisotropy: 2, pit_density: 3, rough_1: 1, rough_4: 1, rough_16: 1 };
const QUERY_ROWS = [['slope_median_deg', 'Median slope', '°'], ['slope_p90_deg', 'Steep slope (90th pct)', '°'], ['relief_m', 'Relief (high − low)', ' m'],
  ['roughness_rms_m', 'Roughness (RMS)', ' m'], ['anisotropy', 'Anisotropy (0 round – 1 linear)', ''], ['pit_density', 'Pit density (crater proxy)', ' /km²']] as const;
const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const top = (p: number, passed: number) => `top ${p < 0.1 ? p.toFixed(2) : p.toFixed(1)}% of ${num(passed, 0)}`;

// the server checks landform class and anisotropy; with a live drive on this match, High also needs >= 60 % drive similarity
function confidence(r: Result, i: number) {
  const c = r.data!.candidates[i];
  return c.confidence === 'high' && i === r.driven && S.live && S.live.overall < 60 ? 'medium' : c.confidence;
}
function Badge({ r, i }: { r: Result; i: number }) {
  const k = confidence(r, i), c = r.data!.candidates[i], q = r.data!.query.landform;
  const why = k === 'low' ? `Statistical match only: landform differs (${q} vs ${c.landform})` : `${CONF[k]}: landform and anisotropy agree${k === 'medium' && i === r.driven ? ', live drive below 60%' : ''}`;
  return (
    <Tooltip>
      <TooltipTrigger render={<i className="conf" data-k={k} tabIndex={0} />}>{k === 'low' ? 'Statistical match only' : CONF[k]}</TooltipTrigger>
      <TooltipContent>{why}</TooltipContent>
    </Tooltip>
  );
}

export function ResultHeader({ r }: { r: Result }) {
  const q = r.data?.query?.landform, name = r.state === 'done' && r.data!.candidates.length ? shortEarth(r.resolved[r.pick]) : '…';
  return (
    <header className="result-head">
      <h1 className="h-display">{shortSite(r.place)} <span className="arrow" aria-label="matched to">→</span> <em className="earth">{name}</em></h1>
      <p className="mono dim">{worldName(S.body)} site · {coord(r.lat, r.lon)}{q ? ` · ${q}` : ''}</p>
    </header>
  );
}

// ------------------------------------------------------------------------------------------------ anomaly card
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const col = (h: Sample[], k: keyof Sample) => h.map((x) => x[k]);
function reason(k: string) {
  const e = earth!.history, t = target!.history, n = worldName(S.body);
  if (k === 'density') {
    const re = mean(col(e, 'rho')), rt = mean(col(t, 'rho'));
    return rt < 1e-4 ? `${n} has no atmosphere, so the Earth rover’s air (${re.toFixed(3)} kg/m³) has nothing to match. Density scores 0 here by design, not as an error.`
      : `${n} air at this site is ${rt.toFixed(4)} kg/m³, about ${Math.round(re / rt)}× thinner than at the Earth site (${re.toFixed(3)} kg/m³). Three orders of magnitude apart scores 0.`;
  }
  if (k === 'temperature') {
    const te = mean(col(e, 'T')), tt = mean(col(t, 'T'));
    return relative() ? `Compared as each value’s position in its own world’s range (polar site): ${tt.toFixed(0)} K on ${n} and ${te.toFixed(0)} K on Earth sit far apart.`
      : `Mean temperatures are ${Math.abs(te - tt).toFixed(0)} K apart (${tt.toFixed(0)} K on ${n}, ${te.toFixed(0)} K on Earth); 100 K apart scores 0.`;
  }
  if (k === 'elevation') return `Relief roughness differs: elevation varies by σ ${sd(col(t, 'h')).toFixed(1)} m on ${n} and σ ${sd(col(e, 'h')).toFixed(1)} m on Earth over the last 60 s.`;
  return `Slope spread differs: mean |slope| ${mean(col(t, 'slope').map(Math.abs)).toFixed(1)}° on ${n} vs ${mean(col(e, 'slope').map(Math.abs)).toFixed(1)}° on Earth.`;
}
const NAMES: Record<string, string> = { elevation: 'Relief', slope: 'Slope', density: 'Air density', temperature: 'Temperature' };
export function Anomaly({ r }: { r: Result }) {
  useStore();
  const [hidden, setHidden] = useState('');
  const L = S.live;
  if (!L || !earth?.history.length || !target?.history.length) return null;
  const k = (['density', 'temperature', 'elevation', 'slope'] as const).filter((x) => L[x] < 25).sort((a, b) => L[a] - L[b])[0];
  if (!k || hidden === k) return null;
  const next = r.data && r.driven + 1 < r.data.candidates.length ? r.driven + 1 : -1;
  return (
    <motion.div className="anomaly" role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}>
      <div className="an-head"><TriangleAlert aria-hidden="true" /><h3>Anomaly detected · {NAMES[k]} <Num value={L[k]} suffix="%" /></h3>
        <button className="icon-btn" onClick={() => setHidden(k)} aria-label="Dismiss"><X /></button></div>
      <p>{reason(k)}</p>
      <div className="an-actions">
        <button className="btn ghost" onClick={() => setHidden(k)}>Dismiss</button>
        {next >= 0 && <button className="btn warn" onClick={() => { driveTo(next); go('drive'); }}>Drive match {next + 1} instead</button>}
      </div>
    </motion.div>
  );
}

// ------------------------------------------------------------------------------------------------ centre column
export function ResultMain() {
  const s = useStore(), r = s.results[s.body]!;
  if (r.state !== 'done' || !r.data!.candidates.length) {
    return (
      <div className="result-main">
        <ResultHeader r={r} />
        <Panel>{r.state === 'loading' ? <><h2 className="h-sub">Running the model…</h2><p className="dim">Cutting 16 km elevation patches and comparing landforms.</p><TaskRows r={r} /></> : <Failure r={r} />}</Panel>
      </div>
    );
  }
  const d = r.data!, c = d.candidates[r.pick], n = worldName(s.body), q = d.query.landform;
  return (
    <div className="result-main">
      <ResultHeader r={r} />
      {d.relaxation.relaxed && <p className="relaxed"><b>Relaxed match</b> · no Earth cell passed the earlier screens, so this result uses step {d.relaxation.step} of 4: {d.relaxation.name}.</p>}
      <motion.div className="scores" key={r.pick} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22 }}>
        <Panel className="score"><b className="score-hero"><Num value={c.terrain_fit} /><small>/100</small></b><h3>Terrain fit</h3><p>4 features on matching 16 km patches · {top(c.percentile, d.passed)}</p></Panel>
        <Panel className="score"><b className="score-hero"><Num value={c.learned_similarity} d={2} /></b><h3>Shape similarity</h3><p>{c.learned_similarity == null ? 'Outside the model index (beyond ±80°)' : 'S1 model, cosine (max 1)'}</p></Panel>
        <Panel className="score"><LinkTo page="drive" className="score-link"><b className="score-hero"><Num value={s.live?.overall} suffix="%" /></b><h3>Live drive similarity ↗</h3><p>From both rovers, last 60 s{d.query.temperature_mode === 'relative' ? ' · temperature relative to each world’s range' : ''}</p></LinkTo></Panel>
      </motion.div>
      <div className="twin-grid">
        <Panel className="compare">
          <div className="card-head"><h2>Feature match · match {r.pick + 1}</h2><span className="mono dim">{q} vs {c.landform}</span></div>
          <table className="cmp">
            <thead><tr><th scope="col">Feature</th><th scope="col" className="t">{n}</th><th scope="col" className="e">Earth</th><th scope="col" colSpan={2}>Match</th></tr></thead>
            <tbody>{c.comparisons.map((x) => {
              const dp = DECIMALS[x.feature] ?? 2, m = Math.round(100 * x.match);
              return (<tr key={x.feature}><th scope="row">{x.label}</th><td className="t mono">{num(x.target_value, dp)}{x.unit}</td><td className="e mono">{num(x.earth_value, dp)}{x.unit}</td>
                <td className="b"><Meter value={m} tone={m < 25 ? 'warn' : 'score'} label={`${x.label} match`} /></td><td className="mono">{m}%</td></tr>);
            })}</tbody>
          </table>
          {(c.barren_fraction != null || c.aridity_index != null) && <p className="note">Earth cell is {[c.barren_fraction == null ? null : `${num(100 * c.barren_fraction, 0)}% barren land`, c.aridity_index == null ? null : `aridity index ${num(c.aridity_index, 3)} (below 0.05 is hyper-arid)`].filter(Boolean).join(', ')}.</p>}
        </Panel>
        <Panel className="live-ch">
          <div className="card-head"><h2>Live drive, per channel</h2><span className="mono dim">{s.live ? 'last 60 s' : 'waiting'}</span></div>
          {s.live ? <Channels /> : <p className="dim">Both rovers need about two seconds of driving before the channels can be compared.</p>}
          <Anomaly r={r} />
        </Panel>
      </div>
      <p className="note">Scores are experimental terrain resemblance from the TerraTwin dataset (release 0.2.0) and its S1 model. They are not a probability, an accuracy or a judgement that a site is suitable. Landform classes come from simple rules on 500 m elevation samples, which cannot resolve features smaller than about 1–2 km (most dunes and small craters).</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ rails
export function QueryPanel() {
  const s = useStore(), r = s.results[s.body]!, d = r.data;
  if (r.state !== 'done' || !d?.query) return <Panel className="query"><h2 className="h-sub">What the model receives</h2><p className="dim">A 16 km elevation patch around your site, 500 m per pixel, the same square in metres on every world.</p></Panel>;
  const qd = d.query.descriptors;
  return (
    <Panel className="query">
      <h2 className="h-sub">What the model received</h2>
      <p>A {num(d.query.patch_km, 0)} km elevation patch, {num(d.query.px_m, 0)} m per pixel, centred on the site · landform <span className="lf">{d.query.landform}</span></p>
      <ul className="feat">
        {QUERY_ROWS.map(([k, label, unit]) => <li key={k}><span>{label}</span><b className="mono">{num(qd[k], DECIMALS[k])}{unit}</b></li>)}
        <li><span>Terrain-shape embedding</span><b className="mono">{d.query.indexed ? '64 numbers' : 'not indexed'}</b></li>
      </ul>
      <p className="note">Every patch, on every world, is the same 16 km square in metres (azimuthal equidistant, so it is not squashed near the poles). Dataset cell <code>{d.target.feature_id}</code>.</p>
    </Panel>
  );
}

export function Candidates() {
  const s = useStore(), r = s.results[s.body]!, d = r.data;
  if (r.state !== 'done' || !d?.candidates.length) return null;
  const screen = `${num(d.screened, 0)} Earth cells screened (${d.relaxation.name}); ${num(d.passed, 0)} passed the terrain screen. The model’s top ${num(Math.min(d.passed, 200), 0)} were re-ranked by landform and spread out, so no two matches are within 500 km. `
    + (d.query.indexed ? 'First-stage order: S1 shape similarity.' : 'This site is outside the S1 index (beyond ±80°), so the first stage orders by terrain fit.');
  return (
    <Panel className="cands-panel">
      <div className="card-head"><h2>Earth matches</h2><span className="dim">pick one to drive there</span></div>
      <ol className="cands">
        {d.candidates.map((k, i) => (
          <li key={k.feature_id}>
            <button aria-pressed={i === r.pick} onClick={() => select(i)}>
              <span className="rank mono">{i + 1}</span>
              <span className="nm">{r.resolved[i] ?? 'Locating…'}
                <small className="mono">{coord(k.lat, k.lon)} · {k.landform} · {top(k.percentile, d.passed)}{i === r.driven ? ' · rover is here' : ''}</small>
              </span>
              <span className="sc mono"><Num value={k.terrain_fit} /><small>fit</small></span>
              <span className="sc mono">{k.learned_similarity == null ? '—' : num(k.learned_similarity, 2)}<small>shape</small></span>
            </button>
            <span className="tags"><Badge r={r} i={i} />{k.near_analog && <i className="tag">near {k.near_analog} (NASA analog)</i>}</span>
          </li>
        ))}
      </ol>
      <button className="btn primary wide" onClick={() => { driveTo(r.pick); go('drive'); }}>Drive to {shortEarth(r.resolved[r.pick]).split(',')[0]}</button>
      <p className="note">{screen}</p>
    </Panel>
  );
}
