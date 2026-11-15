// The signature moment: Mars (shaded from our MOLA heights) settles, a pinned site pulses, an arc travels to the
// night-lit Earth and the model's terrain fit counts up. Clicking Mars snaps to the nearest of 20 sites the real
// TerraTwin matcher was run on (scripts/hero_twins.py), so the landing page stays light; /sim runs the model live.
import { useEffect, useRef, useState } from 'react';
import { cn } from 'cn';
import twins from '../../data/hero_twins.json';
import marsDem from '../../data/dem_mars_1k.png';
import earthNight from '../../data/earth_night.jpg';
import { Num } from '@/components/hud';
import { coord } from '@/lib/format';
import { Planet } from './planet';

export type Site = (typeof twins)[number];
const D2R = Math.PI / 180;
const MARS = { kind: 'dem' as const, rim: '#FF7A45', lo: '#240b05', mid: '#9c4220', hi: '#ffbe94', bump: 7 };
const EARTH = { kind: 'night' as const, rim: '#46C2F2' };
const QUICK = ['Gale Crater', 'Jezero Crater', 'Olympus Mons', 'Hellas Planitia', 'Utopia Planitia', 'Valles Marineris'];
const ease = (t: number) => 1 - (1 - t) ** 3; // ease-out cubic: the needle settles
const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const gc = (a: number, b: number, c: number, d: number) => Math.acos(Math.min(1, Math.sin(a * D2R) * Math.sin(c * D2R) + Math.cos(a * D2R) * Math.cos(c * D2R) * Math.cos((b - d) * D2R)));
const nearest = (lat: number, lon: number) => twins.reduce((best, s) => (gc(lat, lon, s.lat, s.lon) < gc(lat, lon, best.lat, best.lon) ? s : best));
// framing: the Mars site sits left of centre and its twin left of Earth's centre, so the arc reads left to right
const frameMars = (s: Site) => ({ lon: s.lon + 26, lat: Math.max(-45, Math.min(45, s.lat * 0.7)) });
const frameEarth = (s: Site) => ({ lon: s.twin.lon + 30, lat: Math.max(-40, Math.min(40, s.twin.lat * 0.7)) });
export const earthName = (s: Site) => s.twin.name ?? coord(s.twin.lat, s.twin.lon, 1);
export const pinHref = (s: Site) => `/sim?pin=${s.lat},${s.lon}`;
export const SITES = twins;

export function Hero({ onSite }: { onSite: (s: Site) => void }) {
  const box = useRef<HTMLDivElement>(null), marsCv = useRef<HTMLCanvasElement>(null), earthCv = useRef<HTMLCanvasElement>(null);
  const pin = useRef<HTMLSpanElement>(null), tpin = useRef<HTMLSpanElement>(null), arc = useRef<SVGPathElement>(null), dot = useRef<SVGCircleElement>(null);
  const hover = useRef<HTMLDivElement>(null), marsP = useRef<Planet | null>(null), api = useRef<((s: Site) => void) | null>(null);
  const [site, setSite] = useState<Site>(twins[0]);
  const [score, setScore] = useState<number | null>(null);
  const [gl, setGl] = useState(true);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let mars: Planet, earth: Planet;
    try { mars = new Planet(marsCv.current!, marsDem, MARS); earth = new Planet(earthCv.current!, earthNight, EARTH); }
    catch { setGl(false); setScore(twins[0].twin.fit); return; }
    marsP.current = mars;
    let cur = twins[0], t0 = performance.now(), dur = reduced ? 0 : 1800, arcAt = t0 + dur + (reduced ? 0 : 250), scored = false, raf = 0, visible = true;
    let mTo = frameMars(cur), eTo = frameEarth(cur), settle = ease;
    let mFrom = reduced ? mTo : { lon: mTo.lon + 80, lat: mTo.lat + 12 }, eFrom = reduced ? eTo : { lon: eTo.lon - 50, lat: eTo.lat };
    const place = (el: HTMLElement | null, cv: HTMLCanvasElement, p: { x: number; y: number; front: number }) => {
      const x = cv.offsetLeft + p.x, y = cv.offsetTop + p.y;
      if (el) { el.style.transform = `translate(${x}px, ${y}px)`; el.style.opacity = p.front > 0.08 ? '1' : '0'; }
      return { x, y };
    };
    const frame = (now: number) => {
      raf = 0;
      const k = dur ? settle(Math.min(1, (now - t0) / dur)) : 1;
      const idle = reduced ? 0 : Math.sin(now / 5200) * 3.5 * Math.min(1, Math.max(0, (now - t0 - dur) / 1500)); // slow drift at rest
      mars.lon = mFrom.lon + (mTo.lon - mFrom.lon) * k + idle; mars.lat = mFrom.lat + (mTo.lat - mFrom.lat) * k;
      earth.lon = eFrom.lon + (eTo.lon - eFrom.lon) * k - idle * 0.6; earth.lat = eFrom.lat + (eTo.lat - eFrom.lat) * k;
      mars.render(); earth.render();
      const a = place(pin.current, marsCv.current!, mars.project(cur.lat, cur.lon));
      const b = place(tpin.current, earthCv.current!, earth.project(cur.twin.lat, cur.twin.lon));
      // the twin arc: a quadratic curve lifted above the chord, drawn in over 800 ms once the globes settle
      const p = reduced ? 1 : Math.max(0, Math.min(1, (now - arcAt) / 800)), q = ease(p);
      const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 0.28 * Math.hypot(b.x - a.x, b.y - a.y) };
      const B = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
      const end = B(q), c1 = { x: a.x + (c.x - a.x) * q, y: a.y + (c.y - a.y) * q };
      arc.current?.setAttribute('d', q > 0 ? `M${a.x},${a.y} Q${c1.x},${c1.y} ${end.x},${end.y}` : '');
      if (dot.current) {
        const s = B((((now - arcAt - 800) / 2600) % 1 + 1) % 1);
        dot.current.setAttribute('cx', `${s.x}`); dot.current.setAttribute('cy', `${s.y}`);
        dot.current.style.opacity = !reduced && p >= 1 ? '1' : '0';
      }
      if (p >= 1 && !scored) { scored = true; setScore(cur.twin.fit); }
      if (visible && (!reduced || now - t0 < 300)) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    api.current = (s) => {
      if (s === cur) return;
      const now = performance.now();
      cur = s; mFrom = { lon: mars.lon, lat: mars.lat }; mTo = frameMars(s); eFrom = { lon: earth.lon, lat: earth.lat }; eTo = frameEarth(s);
      const wrap = (from: number, to: number) => from + ((((to - from) % 360) + 540) % 360) - 180; // shortest way round
      mTo.lon = wrap(mFrom.lon, mTo.lon); eTo.lon = wrap(eFrom.lon, eTo.lon);
      t0 = now; dur = reduced ? 0 : 1200; settle = easeIO; arcAt = now + dur + (reduced ? 0 : 120); scored = false;
      setScore(reduced ? s.twin.fit : 0);
      kick();
    };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); });
    io.observe(box.current!);
    const ro = new ResizeObserver(() => { t0 = Math.min(t0, performance.now() - 1); kick(); });
    ro.observe(box.current!);
    kick();
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); };
  }, []);

  const choose = (s: Site) => { setSite(s); onSite(s); api.current?.(s); };
  const at = (e: React.MouseEvent<HTMLCanvasElement>) => marsP.current?.unproject(e.nativeEvent.offsetX, e.nativeEvent.offsetY) ?? null;
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const h = hover.current, ll = e.pointerType === 'mouse' ? at(e) : null;
    if (!h) return;
    h.style.opacity = ll ? '1' : '0';
    if (!ll) return;
    h.style.transform = `translate(${e.nativeEvent.offsetX + e.currentTarget.offsetLeft + 16}px, ${e.nativeEvent.offsetY + e.currentTarget.offsetTop + 14}px)`;
    h.firstElementChild!.textContent = coord(ll[0], ll[1], 1);
    h.lastElementChild!.textContent = `nearest computed site: ${nearest(ll[0], ll[1]).name}`;
  };
  return (
    <div className="hero-vis" ref={box} data-gl={gl ? undefined : 'off'}>
      <svg className="orbits" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ellipse cx="40" cy="60" rx="48" ry="16" /><ellipse cx="40" cy="60" rx="58" ry="22" />
      </svg>
      <div className="planet-fallback mars" aria-hidden="true" />
      <canvas ref={marsCv} className="planet mars" style={{ viewTransitionName: 'target-globe' }} role="img"
        aria-label="Mars, shaded from NASA MOLA elevation. Click a place to preview its Earth twin."
        onPointerMove={onMove} onPointerLeave={() => { if (hover.current) hover.current.style.opacity = '0'; }}
        onClick={(e) => { const ll = at(e); if (ll) choose(nearest(ll[0], ll[1])); }} />
      <canvas ref={earthCv} className="planet earth" role="img" aria-label="Earth at night, NASA VIIRS Black Marble" />
      <svg className="arc" aria-hidden="true"><path ref={arc} /><circle ref={dot} r="3" /></svg>
      <span ref={pin} className="pin mars" aria-hidden="true"><i /></span>
      <span ref={tpin} className="pin earth" aria-hidden="true"><i /></span>
      <div ref={hover} className="hover-read" aria-hidden="true"><b className="mono" /><span /></div>
      <div className="twin-read glass-3 bracket" aria-live="polite">
        <p className="tr-top"><span className="tag-preview">Preview</span><span>TerraTwin match 1, computed ahead</span></p>
        <p className="tr-pair"><span className="ink-mars">{site.name}</span><span className="tr-arrow" aria-label="twin of">↔</span><span className="ink-earth">{earthName(site)}</span></p>
        <p className="mono dim tr-coords">{coord(site.lat, site.lon, 1)} → {coord(site.twin.lat, site.twin.lon, 1)}</p>
        <div className="tr-score"><b className="score-hero"><Num value={score} /><small>/100</small></b><span>terrain fit{site.twin.shape != null ? ` · shape ${site.twin.shape.toFixed(2)}` : ''} · {site.twin.landform}</span></div>
      </div>
      <div className="quick" role="group" aria-label="Preview another Mars site">
        {QUICK.map((n) => {
          const s = twins.find((t) => t.name === n)!;
          return <button key={n} className={cn('chip-btn', s === site && 'on')} aria-pressed={s === site} onClick={() => choose(s)}>{n.replace(/ (Crater|Planitia)$/, '')}</button>;
        })}
      </div>
    </div>
  );
}
