// Small console pieces: DOM hosts for the persistent Cesium/Chart.js nodes, media queries, sparkline, readouts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import { WORLDS } from '../../js/physics.js';
import { Num } from '@/components/hud';
import { useStore } from './store';
import type { Pane } from './types';

// Moves a persistent node (a Cesium globe or a chart group) into this spot of the React tree, and out again on unmount.
export function Host({ node, className }: { node: HTMLElement; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    el.appendChild(node);
    return () => { if (node.parentNode === el) el.removeChild(node); };
  }, [node]);
  return <div ref={ref} className={cn('host', className)} />;
}

export function useMedia(q: string) {
  const [m, set] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q), f = () => set(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 }).replace('-', '−');
// Elevation profile of the last 60 s, glowing in the world's colour.
export function Spark({ values, color, label }: { values: number[]; color: string; label: string }) {
  const W = 240, H = 56;
  if (values.length < 2) return <div className="spark spark-empty" aria-label={label}>No telemetry yet</div>;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - lo) / span) * (H - 8)).toFixed(1)}`).join(' ');
  return (
    <figure className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${lo.toFixed(0)} to ${hi.toFixed(0)} m`}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      </svg>
      <figcaption><span>{label}</span><span className="mono">{fmt(lo)} to {fmt(hi)} m</span></figcaption>
    </figure>
  );
}

// The five readouts of one rover: measured on top, the rover's own inference underneath.
export function Readouts({ pane, world, layout = 'strip' }: { pane: Pane | null; world: string; layout?: 'strip' | 'grid' }) {
  useStore();
  const r = pane?.rover, tel = r?.telemetry(), vac = r?.est.vacuum, g = (WORLDS as Record<string, { g: number }>)[world].g;
  const sub = (v: number | null | undefined, d: number, unit = '') => <>inferred <Num value={v} d={d} suffix={unit} live /></>;
  const cells: [string, number | null | undefined, number, string, React.ReactNode][] = [
    ['Speed', r?.v, 1, 'm/s', <>g <Num value={g} d={2} /> m/s²</>],
    ['Elevation', tel?.[0][0], 0, 'm', sub(tel?.[0][1], 0)],
    ['Slope', tel?.[1][0], 1, '°', sub(tel?.[1][1], 1, '°')],
    ['Air density', vac ? null : tel?.[2][0], 4, 'kg/m³', vac ? 'inferred 0 kg/m³' : sub(tel?.[2][1], 4)],
    ['Temperature', tel?.[3][0], 0, 'K', sub(tel?.[3][1], 0, ' K')],
  ];
  return (
    <dl className={cn('readouts', `readouts-${layout}`)} data-world={world}>
      {cells.map(([k, v, d, unit, s]) => (
        <div key={k} className="ro">
          <dt>{k}</dt>
          <dd>{k === 'Air density' && vac ? <span className="num">Vacuum</span> : <Num value={r ? v : null} d={d} live />}{!(k === 'Air density' && vac) && <small>{unit}</small>}</dd>
          <span className="ro-sub">{r ? s : '—'}</span>
        </div>
      ))}
    </dl>
  );
}
