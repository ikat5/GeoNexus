// Groups of four rolling Chart.js plots sharing a time axis; each chart plots one value per series.
// Chart.js, not a streaming-chart library: air density needs a log axis and the sensor charts shade the gap between lines.
import Chart from 'chart.js/auto';
export const TELEMETRY = [
  { title: 'Elevation', unit: 'm' }, { title: 'Slope', unit: '°' }, { title: 'Air density', unit: 'kg/m³' }, { title: 'Temperature', unit: 'K' },
];
export const MERGED = [
  { title: 'Relief Δh from deploy', unit: 'm' }, { title: 'Slope', unit: '°' }, { title: 'Air density', unit: 'kg/m³ · log', log: true }, { title: 'Temperature', unit: 'K' },
];
const axis = { ticks: { color: '#7C8696', font: { size: 10, family: "'Geist Mono Variable', ui-monospace, monospace" }, maxTicksLimit: 4 }, grid: { color: 'rgba(255,255,255,.05)' }, border: { display: false } };
// soft bloom on the data lines only (the HUD rule: glow belongs to data, not chrome)
const glow = {
  id: 'glow',
  beforeDatasetDraw(c, { meta }) { c.ctx.save(); c.ctx.shadowColor = meta.dataset.options.borderColor; c.ctx.shadowBlur = 12; },
  afterDatasetDraw(c) { c.ctx.restore(); },
};

// series.area: a vertical gradient under the line, from 22% of its colour to nothing
const fade = (hex) => ({ chart }) => {
  const { ctx, chartArea: a } = chart;
  if (!a) return 'transparent';
  const g = ctx.createLinearGradient(0, a.top, 0, a.bottom);
  g.addColorStop(0, `${hex}38`); g.addColorStop(1, `${hex}00`);
  return g;
};
export function createChartGroup(el, defs, series, { max = 150, legend = true } = {}) {
  el.innerHTML = defs.map((d) => `<figure class="chart"><figcaption><span>${d.title} (${d.unit})</span><b class="note"></b></figcaption><div class="chart-box"><canvas></canvas></div></figure>`).join('');
  const notes = [...el.querySelectorAll('.note')];
  const charts = [...el.querySelectorAll('canvas')].map((cv, i) => new Chart(cv, {
    type: 'line',
    data: { labels: [], datasets: series.map((s) => ({ label: s.label, data: [], borderColor: s.color, borderWidth: 1.75, borderDash: s.dash ? [4, 3] : [], pointRadius: 0, fill: s.fill ? '-1' : s.area ? 'start' : false, backgroundColor: s.fill ?? (s.area ? fade(s.color) : undefined) })) },
    options: {
      animation: false, maintainAspectRatio: false, spanGaps: true,
      plugins: { legend: { display: legend, labels: { color: '#A3ADBB', boxWidth: 10, font: { size: 10 } } } },
      scales: { x: axis, y: defs[i].log ? { ...axis, type: 'logarithmic' } : axis },
    },
    plugins: [glow],
  }));
  return {
    // rows[i] = one value per series for chart i (null = gap)
    push(label, rows) {
      charts.forEach((c, i) => {
        c.data.labels.push(label);
        c.data.datasets.forEach((d, k) => d.data.push(rows[i][k]));
        if (c.data.labels.length > max) { c.data.labels.shift(); c.data.datasets.forEach((d) => d.data.shift()); }
        c.update('none');
      });
    },
    reset() { charts.forEach((c) => { c.data.labels = []; c.data.datasets.forEach((d) => { d.data = []; }); c.update('none'); }); },
    note(i, text) { notes[i].textContent = text; },
    destroy() { charts.forEach((c) => c.destroy()); },
  };
}
