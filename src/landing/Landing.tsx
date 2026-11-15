// The landing page: one idea (every crater has a twin on Earth), one signature (the twin arc), then the proof.
import { useEffect, useRef, useState } from 'react';
import { Cpu, Globe2, MapPin, Mountain } from 'lucide-react';
import { WORLDS } from '../../js/physics.js';
import { Mark, Num, Panel, Wordmark } from '@/components/hud';
import { Beams } from './Beam';
import { Hero, pinHref, SiteRail, SITES, type Site } from './Hero';
import { Planet } from './planet';
import { Replay } from './Replay';
import atlas from '../../data/discoveries_summary.json';
import marsDem from '../../data/dem_mars_1k.png';
import moonDem from '../../data/dem_moon_1k.png';

const HOP = 2; // m/s: the same small hop on every world
const W3 = [['earth', 'Earth'], ['mars', 'Mars'], ['moon', 'Moon']] as const;
const g = (k: string) => (WORLDS as Record<string, { g: number }>)[k].g;
const H_MOON = (HOP * HOP) / (2 * g('moon'));

function Gauge({ k, name }: { k: string; name: string }) {
  const air = (2 * HOP) / g(k), peak = (HOP * HOP) / (2 * g(k));
  return (
    <div className="gauge-card glass-2" data-world={k}>
      <div className="hop" aria-hidden="true" style={{ '--t': `${air.toFixed(3)}s`, '--rise': `${((peak / H_MOON) * 50).toFixed(1)}px` } as React.CSSProperties}><i /></div>
      <div>
        <p className="g-name"><i className={`dot ${k}`} aria-hidden="true" />{name}</p>
        <p className="g-val"><Num value={g(k)} d={2} /><small>m/s²</small></p>
        <p className="g-sub mono">a {HOP} m/s hop: {air.toFixed(2)} s airborne, {peak.toFixed(2)} m high</p>
      </div>
    </div>
  );
}

function Pipeline() {
  const box = useRef<HTMLDivElement>(null), refs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const nodes = [
    [MapPin, 'Your site on Mars', 'One click on Mars or the Moon: a latitude and longitude.', 'mars'],
    [Mountain, '16 km of real terrain', 'A 32 × 32 elevation patch at 500 m per pixel: slope, relief, roughness, pits.', ''],
    [Cpu, 'TerraTwin model', 'A terrain screen and the S1 shape encoder search 1,079,622 Earth cells, then re-rank by landform.', 'core'],
    [Globe2, 'Its twin on Earth', 'Five matches at least 500 km apart, named, with a rover driving the best one.', 'earth'],
  ] as const;
  return (
    <div className="pipeline" ref={box}>
      <Beams box={box} nodes={refs} />
      {nodes.map(([Icon, title, body, tone], i) => (
        <div key={title} className="pipe-node" data-tone={tone || undefined}>
          <div ref={refs[i]} className="pipe-ic glass-2"><Icon aria-hidden="true" /></div>
          <h3>{title}</h3>
          <p>{body}</p>
        </div>
      ))}
    </div>
  );
}

function Thumb({ src, style }: { src: string; style: ConstructorParameters<typeof Planet>[2] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let p: Planet, raf = 0, on = false;
    try { p = new Planet(ref.current!, src, style); } catch { return; }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    p.lat = 12;
    const tick = (now: number) => { p.lon = now / 220; p.render(); raf = on && !reduced ? requestAnimationFrame(tick) : 0; };
    const io = new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on && !raf) raf = requestAnimationFrame(tick); });
    io.observe(ref.current!);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [src, style]);
  return <><span className="planet-fallback" aria-hidden="true" /><canvas ref={ref} className="thumb" aria-hidden="true" /></>;
}
const MARS_STYLE = { kind: 'dem' as const, rim: '#FF7A45', lo: '#240b05', mid: '#9c4220', hi: '#ffbe94', bump: 7 };
const MOON_STYLE = { kind: 'dem' as const, rim: '#C9C6BC', lo: '#1c1c1b', mid: '#6d6b66', hi: '#e2dfd6', bump: 9 };

export function Landing() {
  const [site, setSite] = useState<Site>(SITES[0]), [pick, setPick] = useState<Site>();
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-nav wrap">
        <Wordmark />
        <nav aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#readouts">Readouts</a>
          <a href="#worlds">Worlds</a>
          <a href="/discoveries">Discoveries</a>
          <a className="btn primary" href="/sim">Launch mission console</a>
        </nav>
      </header>
      <main id="main">
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title" className="h-display">Every crater has a <em>twin</em> on <em className="earth">Earth</em>.</h1>
            <p className="lede">Click a place on Mars or the Moon. The TerraTwin model reads 16 km of real elevation around it and finds the terrain on Earth that is most alike. Then two rovers drive both sites, side by side.</p>
            <div className="cta">
              <a className="btn primary lg" href={pinHref(site)}>Launch mission console</a>
              <a className="btn ghost lg" href="#how">How it works</a>
            </div>
            <SiteRail site={site} onPick={setPick} />
            <p className="hero-hint"><span className="on-hover">Or click anywhere on Mars.</span><span className="on-touch">Or tap anywhere on Mars.</span> The console then runs the full model on <b>{site.name}</b>.</p>
          </div>
          <Hero onSite={setSite} pick={pick} />
        </section>

        <section className="gravity" aria-labelledby="g-title">
          <div className="wrap g-row">
            <h2 id="g-title" className="h-display">Same rover. <span>Three gravities.</span></h2>
            {W3.map(([k, n]) => <Gauge key={k} k={k} name={n} />)}
          </div>
        </section>

        <section className="wrap block" id="how" aria-labelledby="how-title">
          <h2 id="how-title" className="h-display sec-title">From one click to two rovers on the move.</h2>
          <p className="lede sec-lede">Every world gets the same 16 km square of terrain in metres, so a crater floor near the Martian equator and a high desert on Earth are measured on equal terms.</p>
          <Pipeline />
        </section>

        <section className="wrap block split" id="readouts" aria-labelledby="ro-title">
          <div>
            <h2 id="ro-title" className="h-display sec-title">Read the ground like a mission team.</h2>
            <p className="lede">Each rover reports speed, elevation, slope, air density and temperature, and works out four of them again from nothing but its drive force, wheel odometry and an accelerometer.</p>
            <ul className="facts">
              <li><b>Slope</b> from gravity leaking into the accelerometer.</li>
              <li><b>Air density</b> from the drag the wheels cannot explain.</li>
              <li><b>Temperature</b> from pressure and density, by the ideal gas law.</li>
            </ul>
          </div>
          <Replay />
        </section>

        <section className="wrap block" id="atlas" aria-labelledby="atlas-tease-title">
          <h2 id="atlas-tease-title" className="h-display sec-title">It found NASA’s sites. Then <em className="ink-mars"><Num value={atlas.n_new} /></em> more.</h2>
          <p className="lede sec-lede">We ran the matcher on {atlas.n_queries} sites across Mars and the Moon. It rediscovered {atlas.validation.known_sites_rediscovered} of {atlas.validation.known_sites} analog sites already in use, without being told where they are, and kept pointing at places nobody uses yet. These are candidates, not confirmed sites.</p>
          <div className="atlas-tease">
            {atlas.top.slice(0, 3).map((c) => (
              <a key={c.id} className="asset-card glass-2 tease-card" href={`/discoveries?c=${c.id}`}>
                <span className="cls new">New candidate</span>
                <h3 className="h-display">{c.name}{c.country ? `, ${c.country}` : ''}</h3>
                <p className="mono dim">{c.twin_count} twin{c.twin_count > 1 ? 's' : ''} on {c.bodies === 'both' ? 'Mars and the Moon' : c.bodies === 'mars' ? 'Mars' : 'the Moon'} · {c.landform}</p>
                <p className="dim small">{c.distance_km != null ? `${c.distance_km.toLocaleString('en-US')} km from the nearest known analog site` : ''}</p>
              </a>
            ))}
          </div>
          <div className="cta"><a className="btn primary lg" href="/discoveries?surprise=1">Surprise me</a><a className="btn ghost lg" href="/discoveries">Open the Discovery Atlas</a></div>
        </section>

        <section className="wrap block" id="worlds" aria-labelledby="w-title">
          <h2 id="w-title" className="h-display sec-title">Choose where to land.</h2>
          <div className="worlds">
            <a className="asset-card glass-2" href="/sim" data-world="mars">
              <div className="thumb-wrap"><Thumb src={marsDem} style={MARS_STYLE} /></div>
              <div className="ac-body">
                <h3 className="h-display">Mars</h3>
                <dl className="ac-stats">
                  <div><dt>Gravity</dt><dd className="mono">3.72 m/s²</dd></div>
                  <div><dt>Radius</dt><dd className="mono">3,396 km</dd></div>
                  <div><dt>Air at datum</dt><dd className="mono">699 Pa</dd></div>
                  <div><dt>Named features</dt><dd className="mono">1,941</dd></div>
                </dl>
                <p className="ac-src">Terrain: NASA MGS MOLA. 13 landing sites, Viking 1 to Zhurong.</p>
                <span className="ac-go">Explore Mars <span aria-hidden="true">→</span></span>
              </div>
            </a>
            <a className="asset-card glass-2" href="/sim?world=moon" data-world="moon">
              <div className="thumb-wrap"><Thumb src={moonDem} style={MOON_STYLE} /></div>
              <div className="ac-body">
                <h3 className="h-display">The Moon</h3>
                <dl className="ac-stats">
                  <div><dt>Gravity</dt><dd className="mono">1.62 m/s²</dd></div>
                  <div><dt>Radius</dt><dd className="mono">1,737 km</dd></div>
                  <div><dt>Air</dt><dd className="mono">vacuum</dd></div>
                  <div><dt>Named features</dt><dd className="mono">2,043</dd></div>
                </dl>
                <p className="ac-src">Terrain: NASA LRO LOLA. 28 landing sites, Apollo to SLIM.</p>
                <span className="ac-go">Explore the Moon <span aria-hidden="true">→</span></span>
              </div>
            </a>
          </div>
        </section>

        <section className="wrap block">
          <div className="band glass-2">
            <Mark size={40} />
            <h2 className="h-display">Pick a spot. <em>Meet its twin.</em></h2>
            <p className="lede">The console opens on Mars with both globes turning. One click starts the model.</p>
            <a className="btn primary lg" href="/sim">Launch mission console</a>
          </div>
        </section>
      </main>
      <footer className="site-foot wrap">
        <Wordmark />
        <p>Globes rendered with <a href="https://cesium.com/platform/cesiumjs/" rel="noopener">CesiumJS</a>. Imagery: Esri World Imagery; NASA Moon and Mars Trek (LRO WAC, Viking MDIM 2.1); MRO CTX via Esri OnMars. Terrain: AWS Terrain Tiles (SRTM, GMTED, ETOPO1), NASA LRO LOLA and MGS MOLA. Night lights: NASA VIIRS Black Marble via NASA GIBS. Place names: USGS Gazetteer of Planetary Nomenclature (IAU) and OpenStreetMap Nominatim. Live weather: Open-Meteo. Matching: TerraTwin dataset 0.2.0 and its S1 model.</p>
      </footer>
    </>
  );
}
