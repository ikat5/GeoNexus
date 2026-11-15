// Small HUD building blocks shared by the landing page and the console.
import NumberFlow from '@number-flow/react';
import { cn } from 'cn';
import type { ReactNode } from 'react';

const TIMING = { duration: 420, easing: 'cubic-bezier(.23,1,.32,1)' };

// Every changing number goes through here: tabular mono digits that roll to the new value (NumberFlow skips the roll
// under prefers-reduced-motion). null -> an em dash.
export function Num({ value, d = 0, suffix, className }: { value: number | null | undefined; d?: number; suffix?: string; className?: string }) {
  if (value == null || !Number.isFinite(value)) return <span className={cn('num', className)}>—</span>;
  return (
    <NumberFlow className={cn('num', className)} value={value} suffix={suffix} transformTiming={TIMING} spinTiming={TIMING}
      format={{ minimumFractionDigits: d, maximumFractionDigits: d }} />
  );
}

// The mark: a hairline orbit carrying Mars (amber) and Earth (teal), joined by the dotted twin arc.
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="11.5" stroke="currentColor" strokeOpacity=".35" />
      <path d="M6.6 19.6 Q 14 8 21.4 8.4" stroke="currentColor" strokeOpacity=".7" strokeDasharray="1.2 2.4" strokeLinecap="round" />
      <circle cx="6.6" cy="19.6" r="3" fill="var(--mars)" />
      <circle cx="21.4" cy="8.4" r="2.4" fill="var(--earth)" />
    </svg>
  );
}

export function Wordmark({ href = '/', compact = false }: { href?: string; compact?: boolean }) {
  return (
    <a className="wordmark" href={href} aria-label="GeoNexus home">
      <Mark />
      {!compact && <span>Geo<b>Nexus</b></span>}
    </a>
  );
}

// Glass panel. elevation 1–3; bracket = chamfered corner brackets (hero panel and the active asset only).
export function Panel({ as: Tag = 'section', level = 2, bracket, className, children, ...rest }:
  { as?: 'section' | 'div' | 'article' | 'aside'; level?: 1 | 2 | 3; bracket?: boolean; className?: string; children: ReactNode } & Record<string, unknown>) {
  return <Tag className={cn('panel', `glass-${level}`, bracket && 'bracket', className)} {...rest}>{children}</Tag>;
}

// A 0–100 bar; tone picks the fill (score mint by default, warn amber for disagreeing channels)
export function Meter({ value, tone = 'score', label }: { value: number | null; tone?: 'score' | 'warn' | 'mars' | 'earth'; label?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="meter" data-tone={tone} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <b style={{ transform: `scaleX(${v / 100})` }} />
    </span>
  );
}
