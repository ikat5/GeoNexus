// A 20 s drive replayed from data/trace_gale.json: the real rover over the real MOLA DEM at Curiosity's landing site,
// recorded by scripts/record_trace.mjs. Measured values on top, what the rover inferred from its own motion below.
import { useEffect, useRef, useState } from 'react';
import trace from '../../data/trace_gale.json';
import { Num, Panel } from '@/components/hud';

const R = trace.rows as (number | null)[][]; // t, v, h, hE, slope, slopeE, rho, rhoE, T, TE
const W = 320, H = 90;
const rhoMax = Math.max(...R.flatMap((r) => [r[6] ?? 0, r[7] ?? 0])) * 1.15;
const y = (v: number | null) => (v == null ? null : H - 6 - (v / rhoMax) * (H - 12));
const line = (k: number, upto: number) => R.slice(0, upto + 1).map((r, i) => (y(r[k]) == null ? null : `${((i / (R.length - 1)) * W).toFixed(1)},${y(r[k])!.toFixed(1)}`)).filter(Boolean).join(' ');

export function Replay() {
  const box = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(R.length - 1);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; // a still, complete frame
    let id = 0;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(id);
      if (e.isIntersecting) { setI(0); id = window.setInterval(() => setI((x) => (x + 1) % R.length), 250); } // 4 Hz, as recorded
    });
    io.observe(box.current!);
    return () => { io.disconnect(); clearInterval(id); };
  }, []);
  const r = R[i];
  const cells: [string, number | null, number, string, number | null][] = [
    ['Speed', r[1], 1, 'm/s', null], ['Elevation', r[2], 0, 'm', r[3]], ['Slope', r[4], 1, '°', r[5]],
    ['Air density', r[6], 4, 'kg/m³', r[7]], ['Temperature', r[8], 0, 'K', r[9]],
  ];
  return (
    <div ref={box}>
      <Panel level={3} bracket className="replay">
        <div className="card-head"><h3>Mars rover · Gale Crater</h3><span className="mono dim">replay T+ {(r[0] ?? 0).toFixed(1).padStart(4, '0')} s</span></div>
        <dl className="replay-grid">
          {cells.map(([k, v, d, unit, inf]) => (
            <div key={k} className="ro"><dt>{k}</dt><dd><Num value={v} d={d} /><small>{unit}</small></dd>
              <span className="ro-sub">{k === 'Speed' ? 'target 12.0 m/s' : <>inferred <Num value={inf} d={d} /></>}</span></div>
          ))}
        </dl>
        <figure className="replay-chart">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Air density: measured, and inferred by the rover converging on it">
            <polyline points={line(6, i)} className="rl-measured" />
            <polyline points={line(7, i)} className="rl-inferred" />
          </svg>
          <figcaption><span><i className="line target" />measured air density</span><span><i className="line inferred" />inferred from drag on the wheels</span></figcaption>
        </figure>
      </Panel>
      <p className="note">Recorded from the simulator’s own rover and estimator over NASA MOLA terrain, played back at 4 Hz.</p>
    </div>
  );
}
