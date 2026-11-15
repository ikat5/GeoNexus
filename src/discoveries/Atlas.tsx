// /discoveries: Earth places the TerraTwin matcher pairs with Mars and Moon terrain, split into analog sites already in
// use (data/known_analogs.json, every one sourced) and candidates that are not. Static JSON only: no model call here.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { Drawer } from 'vaul';
import { BookOpen, Copy, Dices, Map as MapIcon, Rocket } from 'lucide-react';
import { cn } from 'cn';
import { Num, Panel, Wordmark } from '@/components/hud';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { coord } from '@/lib/format';
import { Planet } from '@/landing/planet';
import earthNight from '../../data/earth_night.jpg';
import marsDem from '../../data/dem_mars_1k.png';
import moonDem from '../../data/dem_moon_1k.png';
import { CLASS_LABEL, placeOf, whyItMatches, whyItMatters, type Atlas as AtlasData, type Cluster, type KnownSite } from './data';

const EARTH = { kind: 'night' as const, rim: '#46C2F2' };
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
type Show = 'all' | 'new' | 'known'; type Bodies = 'any' | 'mars' | 'moon' | 'both'; type Sort = 'score' | 'twins' | 'distance';
const CONF_RANK = { low: 0, medium: 1, high: 2 };

// ---------------------------------------------------------------------------------------------- globe with markers
function Globe({ clusters, known, sel, hover, onPick, fly }: { clusters: Cluster[]; known: KnownSite[]; sel: Cluster | null; hover: string | null; onPick: (c: Cluster) => void; fly: { lat: number; lon: number; t: number } | null }) {
  const cv = useRef<HTMLCanvasElement>(null), layer = useRef<HTMLDivElement>(null), P = useRef<Planet | null>(null), view = useRef({ lon: 20, lat: 15 });
  const draw = useRef<() => void>(() => {});
  useEffect(() => {
    let p: Planet;
    try { p = new Planet(cv.current!, earthNight, EARTH, () => draw.current()); } catch { return; }
    P.current = p;
    return () => p.dispose();
  }, []);
  draw.current = () => {
    const p = P.current;
    if (!p) return;
    p.lon = view.current.lon; p.lat = view.current.lat; p.render();
    const W = cv.current!.clientWidth, s = 0.5 * W * 0.86;
    for (const el of Array.from(layer.current!.children) as HTMLElement[]) {
      const pr = p.project(Number(el.dataset.lat), Number(el.dataset.lon));
      el.style.transform = `translate(${pr.x}px, ${pr.y}px)`;
      el.style.opacity = pr.front > 0.05 ? '' : '0';
      el.style.pointerEvents = pr.front > 0.05 ? '' : 'none';
      if (el.dataset.r) el.style.setProperty('--d', `${Math.max(8, (2 * Number(el.dataset.r) / 6371) * s)}px`); // ring at the site's real radius
    }
  };
  useEffect(() => { draw.current(); });
  // fly: an eased arc to the target over 1.2 s (a cut under reduced motion)
  useEffect(() => {
    if (!fly) return;
    const from = { ...view.current }, to = { lon: fly.lon, lat: Math.max(-60, Math.min(60, fly.lat)) };
    to.lon = from.lon + ((((to.lon - from.lon) % 360) + 540) % 360) - 180;
    const t0 = performance.now(), dur = REDUCED ? 0 : 1200;
    let raf = 0;
    const step = (now: number) => {
      const k = dur ? ease(Math.min(1, (now - t0) / dur)) : 1;
      view.current = { lon: from.lon + (to.lon - from.lon) * k, lat: from.lat + (to.lat - from.lat) * k };
      draw.current();
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fly]);
  // drag to turn the globe
  const drag = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null);
  return (
    <div className="atlas-globe" onPointerDown={(e) => { if ((e.target as HTMLElement).closest('button')) return; drag.current = { x: e.clientX, y: e.clientY, ...view.current }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { const d = drag.current; if (!d) return; const k = 180 / (cv.current!.clientWidth || 1); view.current = { lon: d.lon - (e.clientX - d.x) * k, lat: Math.max(-70, Math.min(70, d.lat + (e.clientY - d.y) * k)) }; draw.current(); }}
      onPointerUp={() => { drag.current = null; }}>
      <span className="planet-fallback" aria-hidden="true" />
      <canvas ref={cv} role="img" aria-label="Earth at night. Rings: analog sites already in use. Dots: candidate sites. Use the list to reach every site by keyboard." />
      <div ref={layer} className="markers" aria-hidden="true">
        {known.map((k) => <span key={k.id} className="mk known" data-lat={k.lat} data-lon={k.lon} data-r={k.radius_km} title={k.name} />)}
        {clusters.map((c) => (
          <button key={c.id} tabIndex={-1} className={cn('mk', c.class, sel?.id === c.id && 'sel', hover === c.id && 'hov')} data-lat={c.lat} data-lon={c.lon}
            style={{ '--s': `${Math.min(22, 7 + 2.2 * c.twin_count)}px`, '--pulse': `${Math.max(1.4, 4 - 2 * c.discovery_score)}s` } as React.CSSProperties}
            onClick={() => onPick(c)} title={placeOf(c)} />
        ))}
      </div>
    </div>
  );
}

// a DEM patch of the Mars/Moon query site, cut from the bundled 1440x720 DEM (about 1° across), shaded as relief
const demImg: Record<string, Promise<HTMLImageElement>> = {};
const loadDem = (b: string) => (demImg[b] ??= new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = b === 'mars' ? marsDem : moonDem; }));
function DemThumb({ body, lat, lon }: { body: string; lat: number; lon: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    loadDem(body).then((img) => {
      const c = ref.current;
      if (!c) return;
      const x = ((lon + 180) / 360) * img.width, y = ((90 - lat) / 180) * img.height, w = 8;
      const g = c.getContext('2d')!;
      g.imageSmoothingEnabled = true;
      g.filter = body === 'mars' ? 'sepia(1) saturate(2.2) hue-rotate(-18deg) contrast(1.6)' : 'contrast(1.6)';
      g.drawImage(img, x - w / 2, y - w / 2, w, w, 0, 0, c.width, c.height);
    });
  }, [body, lat, lon]);
  return <canvas ref={ref} width={72} height={72} className="thumb-patch" aria-hidden="true" />;
}
const tile = (lat: number, lon: number, z = 9) => {
  const n = 2 ** z, x = Math.floor(((lon + 180) / 360) * n), r = (lat * Math.PI) / 180, y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
};

function Detail({ c, onSurprise }: { c: Cluster; onSurprise: () => void }) {
  const best = c.twins[0];
  const drive = best ? `/sim/drive?pin=${best.lat},${best.lon}&earth=${c.lat},${c.lon}${best.body === 'moon' ? '&world=moon' : ''}` : '/sim';
  return (
    <Panel level={3} bracket className="detail" aria-live="polite">
      <div className="d-head">
        <span className={cn('cls', c.class)}>{CLASS_LABEL[c.class]}</span>
        <h2 className="h-display">{placeOf(c)}</h2>
        <p className="mono dim">{coord(c.lat, c.lon)}</p>
        {c.nearest_known && <p className="d-dist"><Num value={c.nearest_known.distance_km} /> km from {c.nearest_known.name}</p>}
        {c.citation && <p className="d-cite">Already studied as an analog: <a href={c.citation.url} rel="noopener" target="_blank">{c.citation.title}</a></p>}
      </div>
      <div className="d-stats">
        <div><b className="score-big"><Num value={c.twin_count} /></b><span>Mars/Moon sites it twins</span></div>
        <div><b className="score-big"><Num value={c.best_score} d={2} /></b><span>best final score</span></div>
        <div><b className="score-big"><Num value={c.discovery_score} d={2} /></b><span>discovery score</span></div>
      </div>
      <p className="d-why"><b>Why it could matter.</b> {whyItMatters(c)}</p>
      <div className="d-actions">
        <a className="btn primary" href={drive}><Rocket aria-hidden="true" />Drive it</a>
        <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(`${c.lat}, ${c.lon}`).then(() => toast('Coordinates copied', { description: coord(c.lat, c.lon) }), () => toast.warning('Clipboard unavailable', { description: `${c.lat}, ${c.lon}` })); }}><Copy aria-hidden="true" />Copy coordinates</button>
        <a className="btn ghost" href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=9/${c.lat}/${c.lon}`} target="_blank" rel="noopener"><MapIcon aria-hidden="true" />Open in maps</a>
        <button className="btn quiet" onClick={onSurprise}><Dices aria-hidden="true" />Another</button>
      </div>
      <h3 className="d-sub">Its twins on Mars and the Moon <span className="dim">({c.twin_count})</span></h3>
      <ol className="twins">
        {c.twins.slice(0, 8).map((t) => (
          <li key={`${t.body}${t.lat}${t.lon}`}>
            <DemThumb body={t.body} lat={t.lat} lon={t.lon} />
            <img className="thumb-patch" src={tile(c.lat, c.lon)} alt="" loading="lazy" width={72} height={72} />
            <div className="tw-body">
              <p><i className={cn('dot', t.body)} aria-hidden="true" /><b>{t.name}</b> <span className="dim">{t.body === 'mars' ? 'Mars' : 'Moon'} · {t.query_landform}</span></p>
              <p className="mono dim">score {t.final_score.toFixed(2)} · fit {t.terrain_fit.toFixed(0)} · {t.confidence}</p>
              <p className="tw-why">{whyItMatches(t)}</p>
            </div>
          </li>
        ))}
        {c.twins.length > 8 && <li className="dim more">and {c.twins.length - 8} more</li>}
      </ol>
    </Panel>
  );
}

export function AtlasPage() {
  const [data, setData] = useState<AtlasData | null>(null), [known, setKnown] = useState<KnownSite[]>([]), [err, setErr] = useState('');
  const [show, setShow] = useState<Show>('all'), [bodies, setBodies] = useState<Bodies>('any'), [conf, setConf] = useState('low'), [landform, setLandform] = useState('any'), [sort, setSort] = useState<Sort>('score');
  const [sel, setSel] = useState<Cluster | null>(null), [hover, setHover] = useState<string | null>(null), [fly, setFly] = useState<{ lat: number; lon: number; t: number } | null>(null), [limit, setLimit] = useState(60);
  const bag = useRef<string[]>([]);
  useEffect(() => {
    Promise.all([fetch('/data/discoveries.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`discoveries.json: HTTP ${r.status}`)))),
      fetch('/data/known_analogs.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`known_analogs.json: HTTP ${r.status}`))))])
      .then(([d, k]) => { setData(d); setKnown(k.sites); })
      .catch((e) => { console.warn(e); setErr((e as Error).message); });
  }, []);
  const rejected = useMemo(() => new Set((data?.rejected ?? []).map((r) => r.id)), [data]);
  const all = useMemo(() => (data?.clusters ?? []).filter((c) => !rejected.has(c.id)), [data, rejected]);
  const list = useMemo(() => all
    .filter((c) => show === 'all' || (show === 'new' ? c.class === 'new' : c.class === 'known'))
    .filter((c) => bodies === 'any' || c.bodies === bodies || (bodies !== 'both' && c.bodies === 'both'))
    .filter((c) => CONF_RANK[c.confidence] >= CONF_RANK[conf as 'low'])
    .filter((c) => landform === 'any' || c.dominant_landform === landform)
    .sort((a, b) => (sort === 'twins' ? b.twin_count - a.twin_count : sort === 'distance' ? (b.nearest_known?.distance_km ?? 0) - (a.nearest_known?.distance_km ?? 0) : b.discovery_score - a.discovery_score)),
  [all, show, bodies, conf, landform, sort]);
  const landforms = useMemo(() => [...new Set(all.map((c) => c.dominant_landform))].sort(), [all]);
  const nNew = all.filter((c) => c.class === 'new').length;
  const pick = (c: Cluster) => { setSel(c); setFly({ lat: c.lat, lon: c.lon, t: performance.now() }); };
  const surprise = () => {
    const pool = all.filter((c) => c.class === 'new' && c.confidence === 'high');
    const src = pool.length ? pool : all.filter((c) => c.class === 'new');
    if (!src.length) { toast.warning('No new candidates in this atlas'); return; }
    if (!bag.current.length) bag.current = src.map((c) => c.id).sort(() => Math.random() - 0.5); // no repeats until every one was shown
    const id = bag.current.pop(), c = src.find((x) => x.id === id)!;
    pick(c);
    const m = c.twins.filter((t) => t.body === 'mars').length, n = c.twins.length - m;
    toast(`New candidate · twins ${m ? `${m} Martian` : ''}${m && n ? ' and ' : ''}${n ? `${n} lunar` : ''} site${c.twin_count > 1 ? 's' : ''}`,
      { id: 'surprise', description: `${placeOf(c)} · no known analog site within ${c.nearest_known?.distance_km ?? '∞'} km` });
  };
  useEffect(() => {
    if (!data) return;
    const q = new URLSearchParams(location.search);
    if (q.get('surprise')) surprise();
    else if (q.get('c')) { const c = all.find((x) => x.id === q.get('c')); if (c) pick(c); }
    const key = (e: KeyboardEvent) => { if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !(e.target as Element).closest?.('input, select, textarea')) surprise(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = data?.validation;
  return (
    <div className="atlas">
      <a className="skip" href="#atlas-list">Skip to the site list</a>
      <header className="site-nav wrap">
        <Wordmark />
        <nav aria-label="Main"><a href="/">Home</a><a href="/discoveries" aria-current="page">Discoveries</a><a className="btn primary" href="/sim">Launch mission console</a></nav>
      </header>
      <main className="wrap atlas-main">
        <section className="atlas-hero" aria-labelledby="atlas-title">
          <h1 id="atlas-title" className="h-display">We asked a terrain model to find Mars and the Moon on Earth. It found the analog sites already in use, and <em><Num value={data ? nNew : null} /></em> it doesn’t use yet.</h1>
          <div className="atlas-cta">
            <button className="btn primary lg" onClick={surprise} disabled={!data} aria-keyshortcuts="S"><Dices aria-hidden="true" />Surprise me</button>
            <span className="dim small">or press <kbd>S</kbd></span>
          </div>
        </section>
        {err && <Panel className="failure" role="alert"><p>The atlas data could not load ({err}). The rest of GeoNexus still works: <a href="/sim">open the console</a>.</p></Panel>}
        {v && (
          <Panel className="validation">
            <p><b>Rediscovered <Num value={v.known_sites_rediscovered} /> of <Num value={v.known_sites} /> known analog sites</b> from {data!.n_queries} Mars and Moon query sites, without being told where they are.</p>
            <p className="dim">High-confidence matches land on a known site <Num value={100 * v.high_conf_on_known_share} d={1} suffix="%" /> of the time; random eligible Earth cells do <Num value={100 * v.random_cell_on_known_share} d={1} suffix="%" />.</p>
            <Method atlas={data!} known={known} />
          </Panel>
        )}
        <div className="filters" role="group" aria-label="Filter the atlas">
          <ToggleGroup className="seg seg-sm" value={[show]} onValueChange={(x) => x[0] && setShow(x[0] as Show)} aria-label="Show">
            <ToggleGroupItem value="all">All</ToggleGroupItem><ToggleGroupItem value="new">New</ToggleGroupItem><ToggleGroupItem value="known">Known</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup className="seg seg-sm" value={[bodies]} onValueChange={(x) => x[0] && setBodies(x[0] as Bodies)} aria-label="Twins of">
            <ToggleGroupItem value="any">Any</ToggleGroupItem><ToggleGroupItem value="mars">Mars</ToggleGroupItem><ToggleGroupItem value="moon">Moon</ToggleGroupItem><ToggleGroupItem value="both">Both</ToggleGroupItem>
          </ToggleGroup>
          <label className="sel">Landform <select value={landform} onChange={(e) => setLandform(e.target.value)}><option value="any">any</option>{landforms.map((l) => <option key={l}>{l}</option>)}</select></label>
          <label className="sel">Confidence ≥ <select value={conf} onChange={(e) => setConf(e.target.value)}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
          <label className="sel">Sort <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="score">discovery score</option><option value="twins">twin count</option><option value="distance">novelty distance</option></select></label>
        </div>
        <div className="atlas-grid">
          <Globe clusters={list} known={known} sel={sel} hover={hover} onPick={pick} fly={fly} />
          <div className="atlas-side">
            {sel ? <Detail c={sel} onSurprise={surprise} /> : <Panel className="legend-panel"><p><span className="mk-key ring" /> analog site already in use, drawn at its real extent</p><p><span className="mk-key dot" /> candidate site: size = number of twins, pulse = discovery score</p><p><span className="mk-key half" /> near a known site, or already studied elsewhere</p><p className="dim">Pick a site in the list or on the globe.</p></Panel>}
            <Panel className="atlas-list-panel">
              <h2 className="h-sub" id="atlas-list">{list.length} {show === 'known' ? 'known sites matched' : 'places'} <span className="dim small">· sorted by {sort === 'score' ? 'discovery score' : sort === 'twins' ? 'twin count' : 'distance to the nearest known site'}</span></h2>
              {data && !list.length && <p className="dim">No place matches these filters.</p>}
              <ol className="atlas-list">
                {list.slice(0, limit).map((c) => (
                  <li key={c.id}>
                    <button aria-pressed={sel?.id === c.id} onClick={() => pick(c)} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(c.id)}>
                      <span className={cn('mk-key', c.class === 'known' ? 'ring' : c.class === 'new' ? 'dot' : 'half')} aria-hidden="true" />
                      <span className="al-name">{placeOf(c)}<small className="mono">{CLASS_LABEL[c.class]} · {c.twin_count} twin{c.twin_count > 1 ? 's' : ''} · {c.dominant_landform}{c.nearest_known ? ` · ${c.nearest_known.distance_km} km to ${c.nearest_known.name}` : ''}</small></span>
                      <span className="al-score mono">{c.discovery_score.toFixed(2)}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {list.length > limit && <button className="btn ghost wide" onClick={() => setLimit(limit + 60)}>Show {Math.min(60, list.length - limit)} more</button>}
            </Panel>
          </div>
        </div>
      </main>
      <Toaster theme="dark" position="bottom-left" toastOptions={{ className: 'toast' }} />
    </div>
  );
}

function Method({ atlas, known }: { atlas: AtlasData; known: KnownSite[] }) {
  return (
    <Drawer.Root direction="right">
      <Drawer.Trigger className="btn ghost sm"><BookOpen aria-hidden="true" />Method, sources and limits</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="method-overlay" />
        <Drawer.Content className="method glass-3">
          <Drawer.Title className="h-display">How the atlas was made</Drawer.Title>
          <Drawer.Description className="dim">Every number here comes from scripts/build_discoveries.py over the real matcher.</Drawer.Description>
          <div className="method-body">
            <p>{atlas.n_queries} query sites on Mars and the Moon (every landing site plus a fixed-seed sample of IAU features by type and latitude) went through the same TerraTwin pipeline as the console. Each returned up to five Earth matches; matches within {atlas.cluster_km} km of each other are one place.</p>
            <p><b>Discovery score</b> = {atlas.score_formula}. Novelty is shown separately: the distance to the nearest known analog site.</p>
            <p><b>Classes.</b> Known: inside a known site’s extent. Near: within that extent plus up to 150 km more. New: farther than that, and not found in the analog literature we searched. “New” means a <b>candidate</b> analog site, not a confirmed one.</p>
            <p><b>Limits.</b> Matches compare 16 km elevation patches at 500 m per pixel: nothing smaller than about 1–2 km is seen (most dunes and small craters). Scores measure terrain resemblance, not accessibility, permits or geology. The planetary DEM thumbnails are cut from 8 px-per-degree global maps.</p>
            <h3 className="h-sub">Known analog sites ({known.length})</h3>
            <ul className="method-sites">{known.map((k) => <li key={k.id}><a href={k.source_url} target="_blank" rel="noopener">{k.name}</a> <span className="dim">· {k.country} · {k.used_by.join(', ')} · {k.radius_km} km</span></li>)}</ul>
            {atlas.rejected.length > 0 && <><h3 className="h-sub">Dropped after inspection</h3><ul className="method-sites">{atlas.rejected.map((r) => <li key={r.id}>{r.id}: <span className="dim">{r.reason}</span></li>)}</ul></>}
          </div>
          <Drawer.Close className="btn ghost">Close</Drawer.Close>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
