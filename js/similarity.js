// Planetary-analog similarity between two rolling telemetry histories of true values {h, slope (°), rho, T}.
// Each channel scores 0..100; overall = 100 · (1 − normalized RMSE of the per-channel dissimilarities).
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const ratio = (x, y, eps) => (Math.min(x, y) + eps) / (Math.max(x, y) + eps);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const pos = (t, [lo, hi]) => clamp01((t - lo) / (hi - lo));

// opts.rangeA / opts.rangeB ([lo, hi] K): compare temperature as each value's position within its own world's range
// (used for polar sites, whose temperatures have no Earth equivalent); a gap of 0.6 of the range scores 0.
export function similarity(a, b, opts) {
  if (a.length < 8 || b.length < 8) return null; // need ~2 s of each drive
  const col = (s, k) => s.map((r) => r[k]);
  const sa = col(a, 'slope'), sb = col(b, 'slope');
  const s = {
    elevation: ratio(std(col(a, 'h')), std(col(b, 'h')), 1),                                    // relief roughness
    slope: (ratio(mean(sa.map(Math.abs)), mean(sb.map(Math.abs)), 0.3) + ratio(std(sa), std(sb), 0.3)) / 2, // slope distribution
    density: clamp01(1 - Math.abs(Math.log10((mean(col(a, 'rho')) + 1e-5) / (mean(col(b, 'rho')) + 1e-5))) / 3), // 3 decades -> 0
    temperature: opts?.rangeA
      ? clamp01(1 - Math.abs(pos(mean(col(a, 'T')), opts.rangeA) - pos(mean(col(b, 'T')), opts.rangeB)) / 0.6)
      : clamp01(1 - Math.abs(mean(col(a, 'T')) - mean(col(b, 'T'))) / 100),                      // 100 K apart -> 0
  };
  const vals = Object.values(s);
  const overall = 1 - Math.sqrt(mean(vals.map((x) => (1 - x) ** 2)));
  return Object.fromEntries([...Object.entries(s), ['overall', overall]].map(([k, v]) => [k, 100 * clamp01(v)]));
}
