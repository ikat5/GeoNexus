// The result page's visual anchor: the target world and Earth as two small planets (the landing page's renderer),
// each centred on its point, joined by the twin arc. Rendered on demand, never on a loop.
import { useEffect, useRef } from 'react';
import { Planet } from '@/landing/planet';
import marsDem from '../../data/dem_mars_1k.png';
import moonDem from '../../data/dem_moon_1k.png';
import earthNight from '../../data/earth_night.jpg';

const STYLE = {
  mars: { kind: 'dem' as const, rim: '#FF7A45', lo: '#240b05', mid: '#9c4220', hi: '#ffbe94', bump: 7 },
  moon: { kind: 'dem' as const, rim: '#C9C6BC', lo: '#1c1c1b', mid: '#6d6b66', hi: '#e2dfd6', bump: 9 },
  earth: { kind: 'night' as const, rim: '#46C2F2' },
};
const tilt = (lat: number) => Math.max(-50, Math.min(50, lat * 0.85));

export function TwinPair({ body, site, twin }: { body: 'mars' | 'moon'; site: [number, number]; twin: [number, number] }) {
  const box = useRef<HTMLDivElement>(null), a = useRef<HTMLCanvasElement>(null), b = useRef<HTMLCanvasElement>(null);
  const pa = useRef<HTMLSpanElement>(null), pb = useRef<HTMLSpanElement>(null), arc = useRef<SVGPathElement>(null);
  useEffect(() => {
    let A: Planet, B: Planet;
    const draw = () => {
      if (!A || !B) return;
      A.lon = site[1]; A.lat = tilt(site[0]); B.lon = twin[1]; B.lat = tilt(twin[0]);
      A.render(); B.render();
      const p = A.project(site[0], site[1]), q = B.project(twin[0], twin[1]);
      const x1 = a.current!.offsetLeft + p.x, y1 = a.current!.offsetTop + p.y, x2 = b.current!.offsetLeft + q.x, y2 = b.current!.offsetTop + q.y;
      pa.current!.style.transform = `translate(${x1}px, ${y1}px)`; pb.current!.style.transform = `translate(${x2}px, ${y2}px)`;
      arc.current!.setAttribute('d', `M${x1},${y1} Q${(x1 + x2) / 2},${Math.min(y1, y2) - 0.3 * Math.abs(x2 - x1)} ${x2},${y2}`);
    };
    try { A = new Planet(a.current!, body === 'mars' ? marsDem : moonDem, STYLE[body], draw); B = new Planet(b.current!, earthNight, STYLE.earth, draw); }
    catch { return; } // no WebGL2: the header still says everything in text
    const ro = new ResizeObserver(draw);
    ro.observe(box.current!);
    return () => { ro.disconnect(); A.dispose(); B.dispose(); };
  }, [body, site[0], site[1], twin[0], twin[1]]);
  return (
    <div className="twin-pair" ref={box} aria-hidden="true" data-world={body}>
      <canvas ref={a} className="tp-a" /><canvas ref={b} className="tp-b" />
      <svg className="tp-arc"><path ref={arc} /></svg>
      <span ref={pa} className="tp-pin" /><span ref={pb} className="tp-pin earth" />
    </div>
  );
}
