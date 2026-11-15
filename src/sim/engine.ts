// Loads CesiumJS from its CDN only on /sim, then the vanilla globe/rover/chart modules (globe.js subclasses a Cesium
// class at import time, so they must come after Cesium). The console shell paints first; the globes fade in after.
import type { ChartGroup, Pane } from './types';

const CESIUM = 'https://cdn.jsdelivr.net/npm/cesium@1.140.0/Build/Cesium/';
const script = (src: string) => new Promise<void>((resolve, reject) => {
  const s = Object.assign(document.createElement('script'), { src, onload: () => resolve(), onerror: () => reject(new Error(`Could not load ${src}`)) });
  document.head.append(s);
});

export async function loadEngine() {
  Object.assign(window, { CESIUM_BASE_URL: CESIUM });
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${CESIUM}Widgets/widgets.css` }));
  await script(`${CESIUM}Cesium.js`);
  const [pane, charts] = await Promise.all([import('../../js/pane.js'), import('../../js/charts.js')]);
  return {
    sim: pane.sim as { paused: boolean },
    createPane: pane.createPane as unknown as (el: HTMLElement, world: string, o: object) => Pane,
    createChartGroup: charts.createChartGroup as unknown as (el: HTMLElement, defs: object[], series: object[], o?: object) => ChartGroup,
    MERGED: charts.MERGED as object[],
  };
}
export type Engine = Awaited<ReturnType<typeof loadEngine>>;
