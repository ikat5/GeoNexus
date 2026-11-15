// ⌘K: jump to any IAU feature or landing site on the current world, an Earth analog site, or run an action.
import { useEffect, useMemo, useState } from 'react';
import { Dices, Globe2, MapPin, Pause, Play, Rocket, Tags, Footprints, Sparkles } from 'lucide-react';
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command';
import { coord } from '@/lib/format';
import { earth, go, LABEL, ORDER, paused, pinEarth, pinTarget, S, setBody, setCmd, setLabels, setPaused, target, useStore, worldName } from './store';
import type { Feature } from './types';

export function CommandMenu() {
  const s = useStore();
  const [q, setQ] = useState(''), [disc, setDisc] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { // the atlas's top places, for "Go to discovery" (small static file written by build_discoveries.py)
    if (s.cmd && !disc.length) fetch('/data/discoveries_summary.json').then((r) => (r.ok ? r.json() : null)).then((j) => j && setDisc(j.top)).catch(() => {});
  }, [s.cmd]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd(!S.cmd); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  const feats = target?.features ?? [], ql = q.trim().toLowerCase(), n = worldName(s.body);
  // 2,000 features: pre-filter here and show 40, instead of rendering every row into cmdk
  const sites = useMemo(() => {
    if (!ql) return [...feats.filter((f) => f[4] === 'Landing site'), ...feats.filter((f) => f[4] !== 'Landing site').sort((a, b) => b[3] - a[3]).slice(0, 12)];
    const hit = (f: Feature) => f[0].toLowerCase().indexOf(ql);
    return feats.filter((f) => hit(f) >= 0).sort((a, b) => (hit(a) === 0 ? 0 : 1) - (hit(b) === 0 ? 0 : 1) || b[3] - a[3]).slice(0, 40);
  }, [feats, ql]);
  const analogs = (earth?.features ?? []).filter((f) => f[4] === 'Analog site' && (!ql || f[0].toLowerCase().includes(ql)));
  const other = s.body === 'mars' ? 'moon' : 'mars';
  const actions = [
    { label: 'Surprise me: a new candidate analog site', icon: Dices, run: () => { location.href = '/discoveries?surprise=1'; } },
    ...disc.map((d) => ({ label: `Go to discovery: ${d.name}`, icon: Sparkles, run: () => { location.href = `/discoveries?c=${d.id}`; } })),
    { label: `Switch to ${worldName(other)}`, icon: Globe2, run: () => setBody(other) },
    { label: paused() ? 'Resume drive' : 'Pause drive', icon: paused() ? Play : Pause, run: () => setPaused(!paused()) },
    { label: s.labels ? 'Hide feature labels' : 'Show feature labels', icon: Tags, run: () => setLabels(!s.labels) },
    ...ORDER.map((p) => ({ label: `Go to ${LABEL[p]}`, icon: Footprints, run: () => go(p) })),
  ].filter((a) => !ql || a.label.toLowerCase().includes(ql));
  const run = (fn: () => void) => { setCmd(false); setQ(''); fn(); };
  return (
    <CommandDialog open={s.cmd} onOpenChange={(o) => { setCmd(o); if (!o) setQ(''); }} title="Jump to a site" description={`Search ${n} features, landing sites, Earth analog sites and actions`} className="cmdk">
      <Command shouldFilter={false} loop>
        <CommandInput placeholder={`Search ${n} craters, landing sites, Earth analogs…`} value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>{feats.length ? `Nothing on ${n} or in the Earth analogs matches “${q}”.` : 'Feature names are still loading.'}</CommandEmpty>
          {sites.length > 0 && (
            <CommandGroup heading={ql ? `${n} features` : `${n} landing sites and largest features`}>
              {sites.map((f, i) => (
                <CommandItem key={`${f[0]}-${i}`} value={`t-${i}`} onSelect={() => run(() => pinTarget(f[1], f[2]))}>
                  {f[4] === 'Landing site' ? <Rocket /> : <MapPin />}<span className="cmd-name">{f[0]}</span>
                  <CommandShortcut className="mono">{f[4]} · {coord(f[1], f[2], 1)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {analogs.length > 0 && (
            <CommandGroup heading="Earth analog sites · drives the Earth rover there">
              {analogs.map((f, i) => (
                <CommandItem key={f[0]} value={`e-${i}`} onSelect={() => run(() => pinEarth(f[1], f[2]))}>
                  <Globe2 className="earth-ic" /><span className="cmd-name">{f[0]}</span><CommandShortcut className="mono">{coord(f[1], f[2], 1)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {actions.length > 0 && (
            <CommandGroup heading="Actions">
              {actions.map((a) => <CommandItem key={a.label} value={a.label} onSelect={() => run(a.run)}><a.icon /><span className="cmd-name">{a.label}</span></CommandItem>)}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
