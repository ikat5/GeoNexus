// Animated beam between pipeline nodes (the Magic UI "Animated Beam" idea, rebuilt for this page): a hairline path per
// pair, with an amber-to-teal pulse travelling from the Mars side to the Earth side. Static gradient under reduced motion.
import { useEffect, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'motion/react';

type Seg = { d: string; from: [number, number]; to: [number, number] };
export function Beams({ box, nodes }: { box: RefObject<HTMLElement | null>; nodes: RefObject<HTMLElement | null>[] }) {
  const [segs, setSegs] = useState<Seg[]>([]), [size, setSize] = useState([0, 0]), reduced = useReducedMotion();
  useEffect(() => {
    const calc = () => {
      const c = box.current!.getBoundingClientRect();
      const pts = nodes.map((n) => { const r = n.current!.getBoundingClientRect(); return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2, w: r.width / 2, h: r.height / 2 }; });
      setSize([c.width, c.height]);
      setSegs(pts.slice(1).map((b, i) => {
        const a = pts[i], row = Math.abs(b.x - a.x) > Math.abs(b.y - a.y); // a row on desktop, a column on phones
        const from: [number, number] = row ? [a.x + a.w, a.y] : [a.x, a.y + a.h], to: [number, number] = row ? [b.x - b.w, b.y] : [b.x, b.y - b.h];
        return { d: `M${from[0]},${from[1]} L${to[0]},${to[1]}`, from, to };
      }));
    };
    const ro = new ResizeObserver(calc);
    ro.observe(box.current!);
    calc();
    return () => ro.disconnect();
  }, [box, nodes]);
  return (
    <svg className="beams" width={size[0]} height={size[1]} viewBox={`0 0 ${size[0]} ${size[1]}`} aria-hidden="true">
      <defs>
        {segs.map(({ from: [x1, y1], to: [x2, y2] }, i) => {
          const L = Math.hypot(x2 - x1, y2 - y1) * 0.35, ux = (x2 - x1) / (Math.hypot(x2 - x1, y2 - y1) || 1), uy = (y2 - y1) / (Math.hypot(x2 - x1, y2 - y1) || 1);
          return reduced
            ? <linearGradient key={i} id={`beam-${i}`} gradientUnits="userSpaceOnUse" x1={x1} y1={y1} x2={x2} y2={y2}><stop stopColor="#FF7A45" /><stop offset="1" stopColor="#46C2F2" /></linearGradient>
            : <motion.linearGradient key={i} id={`beam-${i}`} gradientUnits="userSpaceOnUse"
                initial={{ x1: x1 - L * ux, y1: y1 - L * uy, x2: x1, y2: y1 }}
                animate={{ x1: [x1 - L * ux, x2], y1: [y1 - L * uy, y2], x2: [x1, x2 + L * ux], y2: [y1, y2 + L * uy] }}
                transition={{ duration: 1.6, delay: 0.55 * i, repeat: Infinity, repeatDelay: 0.55 * (segs.length - 1) + 0.8, ease: [0.23, 1, 0.32, 1] }}>
                <stop stopColor="#FF7A45" stopOpacity="0" /><stop offset=".45" stopColor="#FF7A45" /><stop offset=".7" stopColor="#46C2F2" /><stop offset="1" stopColor="#46C2F2" stopOpacity="0" />
              </motion.linearGradient>;
        })}
      </defs>
      {segs.map((s, i) => <g key={i}><path d={s.d} className="beam-base" /><path d={s.d} className="beam-glow" stroke={`url(#beam-${i})`} /></g>)}
    </svg>
  );
}
