// The mission console: top bar, a deck per step (rails around the globe), bottom bar, ⌘K and toasts.
// ≥1440 px the explore rails float over the globe; 900–1439 px they dock beside it; below 900 px a Vaul sheet holds them.
import { useEffect, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { Toaster } from 'sonner';
import { Drawer } from 'vaul';
import { Search } from 'lucide-react';
import { cn } from 'cn';
import { Panel, Wordmark } from '@/components/hud';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isMac } from '@/lib/format';
import { Host, Readouts, useMedia } from './bits';
import { CommandMenu } from './CommandMenu';
import { ActiveAsset, ControlPanel, EmptyState, LinkTo, MissionPanel, PauseButton, SensorSide, TwinCard } from './panels';
import { Candidates, QueryPanel, ResultMain } from './result';
import { Globe, Stage } from './stage';
import { go, init, LABEL, nodes, ORDER, paused, resetSite, S, setBody, setCmd, setPaused, setView, shortPlace, target, useStore, worldName } from './store';
import type { Body, Page, View } from './types';

const EASE = [0.23, 1, 0.32, 1] as const;

function StepNav() {
  const s = useStore();
  return (
    <nav className="steps" aria-label="Simulator steps">
      {ORDER.map((p) => (
        <LinkTo key={p} page={p} className={cn('step', s.page === p && 'is-on')} aria-current={s.page === p ? 'page' : undefined}>
          {s.page === p && <motion.span layoutId="step-pill" className="step-pill" transition={{ duration: 0.32, ease: EASE }} />}
          <span className="step-label">{LABEL[p]}</span>
        </LinkTo>
      ))}
    </nav>
  );
}

function UtcClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return <time className="utc mono" dateTime={t.toISOString()}>{t.toISOString().slice(11, 19)} UTC</time>;
}

function TopBar({ phone }: { phone: boolean }) {
  const s = useStore();
  return (
    <header className="topbar">
      <Wordmark compact={phone} />
      {!phone && <StepNav />}
      <div className="tb-right">
        <button className="cmd-btn" onClick={() => setCmd(true)} aria-label={phone ? 'Jump to a site' : undefined} aria-keyshortcuts="Meta+K Control+K">
          <Search aria-hidden="true" />{!phone && <><span>Jump to a site</span><kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd></>}
        </button>
        <ToggleGroup className="seg" value={[s.body]} onValueChange={(v) => v[0] && setBody(v[0] as Body)} aria-label="Target world" disabled={!s.ready}>
          <ToggleGroupItem value="mars"><i className="dot mars" aria-hidden="true" />Mars</ToggleGroupItem>
          <ToggleGroupItem value="moon"><i className="dot moon" aria-hidden="true" />Moon</ToggleGroupItem>
        </ToggleGroup>
        {!phone && <UtcClock />}
      </div>
      {phone && <StepNav />}
    </header>
  );
}

const hms = (t?: number) => { const x = Math.floor(t ?? 0); return [x / 3600, (x % 3600) / 60, x % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':'); };
function BottomBar() {
  const s = useStore(), t = target?.rover, i = ORDER.indexOf(s.page), prev = ORDER[i - 1], next = ORDER[i + 1];
  return (
    <footer className="bottombar">
      <Tooltip>
        <TooltipTrigger render={<div className="tb-group" />}>
          <ToggleGroup className="seg seg-sm" value={[s.view]} onValueChange={(v) => v[0] && setView(v[0] as View)} aria-label="Camera view" disabled={!t}>
            <ToggleGroupItem value="2d">2D</ToggleGroupItem>
            <ToggleGroupItem value="3d">3D</ToggleGroupItem>
            <ToggleGroupItem value="ground">Ground</ToggleGroupItem>
          </ToggleGroup>
        </TooltipTrigger>
        <TooltipContent side="top">{t ? 'Top-down map, chase view or low ground view, for both rovers' : 'Pin a site to deploy a rover first'}</TooltipContent>
      </Tooltip>
      <button className="live-pill" aria-pressed={!!t && !paused()} disabled={!t} onClick={() => setPaused(!paused())} aria-label={paused() ? 'Resume drive' : 'Pause drive'}>
        <i aria-hidden="true" />{!t ? 'Standby' : paused() ? 'Paused' : 'Live'}
      </button>
      <span className="met mono" aria-label="Mission elapsed time">T+ {hms(t?.t)}</span>
      <span className="bb-site dim">{t ? shortPlace() : ''}</span>
      <nav className="pager" aria-label="Previous and next step">
        {prev && <LinkTo page={prev} className="btn ghost sm">← {LABEL[prev]}</LinkTo>}
        {next ? <LinkTo page={next} className="btn ghost sm">{LABEL[next]} →</LinkTo> : <button className="btn ghost sm" onClick={resetSite}>Pick a new site</button>}
      </nav>
    </footer>
  );
}

function Rail({ side, page, children }: { side: 'left' | 'right'; page: Page; children: React.ReactNode }) {
  return (
    <motion.aside key={`${page}-${side}`} className={cn('rail', `rail-${side}`)} initial={{ opacity: 0, x: side === 'left' ? -10 : 10 }}
      animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.38, ease: EASE, delay: 0.1 }}>{children}</motion.aside>
  );
}

function DockCharts() {
  const s = useStore(), n = worldName(s.body);
  return (
    <Panel className="dock" aria-label={`Earth vs ${n}, last 60 seconds`}>
      <div className="card-head"><h2>Earth vs {n}, last 60 seconds</h2><span className="legend"><i className="line earth" />Earth <i className="line target" />{n}</span></div>
      <Host node={nodes.dock} />
    </Panel>
  );
}
function SensorCharts() {
  const s = useStore(), mine = s.sensorOf === 'target';
  return (
    <Panel className="sensor-charts">
      <div className="card-head"><h2>{mine ? worldName(s.body) : 'Earth'} rover · last 60 s</h2>
        <span className="legend"><i className={cn('line', mine ? 'target' : 'earth')} />measured <i className="line inferred" />inferred from its own motion</span></div>
      <Host node={mine ? nodes.tCharts : nodes.eCharts} />
    </Panel>
  );
}

function Deck({ float }: { float: boolean }) {
  const s = useStore(), P = s.page;
  if (P !== 'explore' && !s.results[s.body]) return <main id="deck" className="deck deck-empty"><EmptyState /></main>;
  return (
    <main id="deck" className={cn('deck', `deck-${P}`, float && P === 'explore' && 'is-float')}>
      {P === 'explore' && <>
        <Stage mode="explore" />
        <Rail side="left" page={P}><MissionPanel /></Rail>
        <Rail side="right" page={P}><ActiveAsset /><TwinCard globe={<Globe which="earth" strip={false} className="twin-globe" />} /></Rail>
      </>}
      {P === 'result' && <>
        <Rail side="left" page={P}><QueryPanel /></Rail>
        <div className="center"><ResultMain /></div>
        <Rail side="right" page={P}><Candidates /></Rail>
      </>}
      {P === 'drive' && <>
        <h1 className="sr-only">Live drive: Earth vs {worldName(s.body)}</h1>
        <div className="center drive-center"><Stage mode="drive" /><DockCharts /></div>
        <Rail side="right" page={P}><ControlPanel /></Rail>
      </>}
      {P === 'sensors' && <>
        <Rail side="left" page={P}><SensorSide /></Rail>
        <div className="center"><SensorCharts /></div>
      </>}
    </main>
  );
}

const SNAPS = [0.22, 0.5, 0.94];
function PhoneDeck() {
  const s = useStore(), P = s.page, gated = P !== 'explore' && !s.results[s.body];
  const [snap, setSnap] = useState<number | string | null>(SNAPS[1]);
  const mine = <Panel><Readouts pane={target} world={s.body} layout="grid" /></Panel>;
  return (
    // the globe ends where the sheet begins, so the chase camera keeps the rover in view (capped: always some globe)
    <main id="deck" className="deck deck-phone" style={{ '--sheet': `${Math.min(0.6, typeof snap === 'number' ? snap : SNAPS[1]) * 100}svh` } as React.CSSProperties}>
      <Stage mode="phone" />
      <Drawer.Root open modal={false} dismissible={false} snapPoints={SNAPS} activeSnapPoint={snap} setActiveSnapPoint={setSnap}>
        <Drawer.Portal>
          <Drawer.Content className="sheet">
            <Drawer.Handle className="sheet-handle" />
            <Drawer.Title className="sr-only">{LABEL[P]}</Drawer.Title>
            <Drawer.Description className="sr-only">Panels for this step. Drag the handle to resize.</Drawer.Description>
            <div className={cn('sheet-body', snap === SNAPS[2] ? 'can-scroll' : 'no-scroll')}>
              {gated ? <EmptyState /> : P === 'explore' ? <><MissionPanel />{mine}<TwinCard /></>
                : P === 'result' ? <><ResultMain /><Candidates /><QueryPanel /></>
                  : P === 'drive' ? <><ControlPanel />{mine}<DockCharts /></> : <><SensorSide /><SensorCharts /></>}
              <PauseButton className="sheet-pause" />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </main>
  );
}

export function App() {
  const s = useStore(), phone = useMedia('(max-width: 899px)'), wide = useMedia('(min-width: 1440px)');
  useEffect(() => { init(); }, []);
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delay={300}>
        <a className="skip" href="#deck">Skip to the console</a>
        <div className="console" data-page={s.page} data-phone={phone ? '' : undefined}>
          <TopBar phone={phone} />
          {phone ? <PhoneDeck /> : <Deck float={wide} />}
          {!phone && <BottomBar />}
        </div>
        <CommandMenu />
        <Toaster theme="dark" position={phone ? 'top-center' : 'bottom-left'} offset={phone ? 112 : 76} toastOptions={{ className: 'toast' }} />
      </TooltipProvider>
    </MotionConfig>
  );
}
