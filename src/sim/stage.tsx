// The globes: persistent Cesium canvases inside HUD frames, the explore crosshair, and the readout strip.
import { useEffect, useRef } from 'react';
import { cn } from 'cn';
import { coord } from '@/lib/format';
import { Host, Readouts } from './bits';
import { earth, nodes, target, useStore, worldName } from './store';

const R2D = 180 / Math.PI;

// Crosshair over the target globe: lat/lon and the IAU feature under the pointer. Written straight to the DOM in a
// rAF (no React state at 60 Hz). Mouse only: on touch a tap is the pick.
function Crosshair() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!, host = el.parentElement!, xy = el.querySelector('b')!, nm = el.querySelector('span')!;
    let raf = 0, ev: PointerEvent | null = null;
    const draw = () => {
      raf = 0;
      if (!ev || !target) return;
      const b = host.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top, hit = target.pickAt(x, y);
      el.style.setProperty('--x', `${x}px`);
      el.style.setProperty('--y', `${y}px`);
      el.dataset.on = hit ? '1' : '0';
      if (hit) { xy.textContent = coord(hit[0], hit[1]); nm.textContent = target.placeAt(hit[0], hit[1]) ?? ''; }
    };
    const move = (e: PointerEvent) => { if (e.pointerType !== 'mouse') return; ev = e; raf ||= requestAnimationFrame(draw); };
    const leave = () => { ev = null; el.dataset.on = '0'; };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div ref={ref} className="crosshair" data-on="0" aria-hidden="true">
      <i className="ch-h" /><i className="ch-v" /><i className="ch-ring" />
      <div className="ch-read"><b className="mono" /><span /></div>
    </div>
  );
}

export function Globe({ which, crosshair, strip = true, className }: { which: 'target' | 'earth'; crosshair?: boolean; strip?: boolean; className?: string }) {
  const s = useStore(), pane = which === 'target' ? target : earth, world = which === 'target' ? s.body : 'earth', r = pane?.rover;
  const res = s.results[s.body];
  const role = which === 'earth' ? 'Earth twin' : s.page === 'drive' ? `${worldName(world)} rover` : `${worldName(world)} target`;
  const state = r ? coord(r.lat * R2D, r.lon * R2D, 3) : which === 'earth' ? (res?.state === 'loading' ? 'scanning for a match' : 'waiting for your pick') : pane?.isSpinning() ? 'turning · no site yet' : 'no site yet';
  return (
    <div className={cn('globe-frame', className)} data-world={world} data-scanning={which === 'earth' && res?.state === 'loading' ? '' : undefined}
      style={which === 'target' ? { viewTransitionName: 'target-globe' } : undefined}>
      <Host node={nodes[which]} className="globe-host" />
      {crosshair && <Crosshair />}
      <div className="hud-top"><span><i className={cn('dot', which === 'earth' ? 'earth' : 'target')} aria-hidden="true" />{role}</span><span className="mono">{state}</span></div>
      <span className="brk tl" aria-hidden="true" /><span className="brk tr" aria-hidden="true" /><span className="brk bl" aria-hidden="true" /><span className="brk br" aria-hidden="true" />
      {strip && <div className="hud-bottom"><Readouts pane={pane} world={world} /></div>}
      {!s.ready && <div className="boot" aria-hidden="true"><span className="boot-globe" /></div>}
    </div>
  );
}

export function Stage({ mode }: { mode: 'explore' | 'drive' | 'phone' }) {
  const s = useStore();
  return (
    <section className={cn('stage', `stage-${mode}`)} aria-label="Globes">
      <Globe which="target" crosshair={mode === 'explore'} strip={mode !== 'phone'} />
      {mode !== 'explore' && <Globe which="earth" strip={mode === 'drive'} className={mode === 'phone' ? 'inset' : undefined} />}
      {s.failed && <p className="engine-error" role="alert">The 3D globes could not load ({s.failed}). Check the connection to cdn.jsdelivr.net and reload.</p>}
    </section>
  );
}
