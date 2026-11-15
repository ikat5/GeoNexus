// Groups of four rolling Chart.js plots sharing a time axis; each chart plots one value per series.
export const TELEMETRY = [
  { title: 'Elevation', unit: 'm' }, { title: 'Slope', unit: '°' }, { title: 'Air density', unit: 'kg/m³' }, { title: 'Temperature', unit: 'K' },
];
export const MERGED = [
  { title: 'Relief Δh from deploy', unit: 'm' }, { title: 'Slope', unit: '°' }, { title: 'Air density', unit: 'kg/m³ · log', log: true }, { title: 'Temperature', unit: 'K' },
];
const axis = { ticks: { color: '#8A92A3', font: { size: 10, family: "'JetBrains Mono', monospace" }, maxTicksLimit: 4 }, grid: { color: 'rgba(255,255,255,.06)' }, border: { display: false } };

export function createChartGroup(el, defs, series, { max = 150, legend = true } = {}) {
  el.innerHTML = defs.map((d) => `<figure class="chart"><figcaption><span>${d.title} (${d.unit})</span><b class="note"></b></figcaption><div class="chart-box"><canvas></canvas></div></figure>`).join('');
  const notes = [...el.querySelectorAll('.note')];
  const charts = [...el.querySelectorAll('canvas')].map((cv, i) => new Chart(cv, {
    type: 'line',
    data: { labels: [], datasets: series.map((s) => ({ label: s.label, data: [], borderColor: s.color, borderWidth: 1.5, borderDash: s.dash ? [4, 3] : [], pointRadius: 0 })) },
    options: {
      animation: false, maintainAspectRatio: false, spanGaps: true,
      plugins: { legend: { display: legend, labels: { color: '#AEB5C4', boxWidth: 10, font: { size: 10 } } } },
      scales: { x: axis, y: defs[i].log ? { ...axis, type: 'logarithmic' } : axis },
    },
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
