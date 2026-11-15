# GeoNexus · design system

Living document for the 2026-11-15 redesign (see WORKLOG.md, session 11). Every token here exists
as a CSS variable in `src/styles/app.css`; Tailwind reads them through `@theme`.

## 0 · Brief

- **Subject:** GeoNexus. Click a place on Mars or the Moon and the TerraTwin model finds the
  terrain on Earth that is most alike; two simulated rovers then drive both sites.
- **Audience:** competition judges first (3 seconds to get the idea), then planetary-science
  students and analog-site researchers.
- **Job:** make the idea land instantly, invite the first click, and look like an instrument
  that handles real data: NASA LOLA/MOLA DEMs, USGS IAU names, live Open-Meteo weather,
  the TerraTwin matcher.
- **Constraints:** physics, estimator, similarity and matching logic are untouchable;
  `node tests/selfcheck.mjs` stays green; Render build keeps working; 60 fps on a mid laptop;
  reduced motion, keyboard focus and 44 px targets everywhere.
- **References (feel, not layout):** a satellite-fleet dashboard (one globe as hero, panels
  orbiting it, amber "anomaly" card, segmented pill controls) and a satellite video (teal glass
  slabs, glowing multi-line failure chart, glass D-pad with current/target speed, Earth night
  lights). No layout copied 1:1, no satellites, no brand marks.

## 1 · Concept

Three candidates (scored originality / fit / feasibility / portability, lower portability is better):

| Concept | Signature | O | F | Fe | P |
|---|---|---|---|---|---|
| **Twin arc.** The night a rover lands: one console, one planet, one line to home | Click Mars, a pin settles, an arc travels to a small Earth and the match score counts up | 4 | 5 | 5 | 1 |
| Stereo pair. Mars and Earth slides converge like a stereoscope viewer | Two DEM patches slide together until the relief lines align | 4 | 4 | 3 | 2 |
| Contour type. Headlines set in MOLA contour lines | Headline redraws as contours of the clicked site | 5 | 3 | 2 | 2 |

Picked: **Twin arc**, because it is the product's own mechanism, so it can't be moved to another site.

```
Idea:        Every crater has a twin on Earth; click one and meet it.
Metaphor:    A mission-control console on landing night: calm, precise, quietly cinematic.
Signature:   Hero Mars (WebGL, shaded from our own MOLA heights) → pin settles → arc to a small
             night-lit Earth → score counts up (NumberFlow). Click anywhere to retarget.
Emotion:     Hush, then recognition. The first 3 s read: "a planet, a line, a number".
Motion verb: settle like an instrument needle: fast out, damped in, never bouncy.
Screenshot:  Amber Mars, the dotted arc, the teal Earth, "Gale ↔ Atacama".
```

## 2 · System

### Color (dark only, so no light theme)

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#07090C` | page base, graphite near-black, never pure black |
| `--ground-2` | `#0B0F14` | rails behind glass |
| `--ink` | `#E8EDF2` | primary text |
| `--muted` | `#A3ADBB` | secondary text (AA on ground: 8.4:1) |
| `--dim` | `#7C8696` | tertiary, units (AA on ground: 5.3:1) |
| `--line` | `rgba(255,255,255,.08)` | hairline borders |
| `--mars` | `#FF7A45` | Mars, always (amber/orange family) |
| `--moon` | `#C9C6BC` | Moon |
| `--earth` | `#46C2F2` | Earth, always (cyan, on the way to teal) |
| `--score` | `#8FF0C0` | the one score/success accent (mint) |
| `--warn` | `#FFC24D` | warnings, anomaly card, weather-offline toast |
| `--danger` | `#FF5A5F` | real faults only (failed request) |

Glass, 3 elevations (`.glass-1/2/3`): `backdrop-filter: blur(14/18/24px)`, white fill 2.5/4/6%,
1 px inner top highlight `inset 0 1px 0 rgba(255,255,255,.06–.10)`, soft outer shadow, hairline
border at 7–10% white. No solid grey borders. Bloom (`drop-shadow`/canvas `shadowBlur`) only on
chart lines, the globe rim and the active element.

### Type

- **Display:** Oxanium 500/600 (Google Fonts). Wordmark, h1/h2, big scores. Squared, technical;
  a deliberate position against the inspo consensus (75% grotesk) because the console is an
  instrument, not a SaaS page. Tracking −0.02em at display sizes.
- **UI:** Geist 400/500/600. Body 16 px / 1.55.
- **Data:** Geist Mono 400/500 with `font-variant-numeric: tabular-nums`, only for live numbers,
  units and coordinates. Never decorative uppercase eyebrows.
- Fraunces is retired.

Fluid ramp: h1 `clamp(40px, 5.6vw, 76px)` · h2 `clamp(28px, 3.4vw, 44px)` · h3 20 px · body 16 px
· small 13.5 px · data 12–28 px.

### Space, radius, layout

- Spacing on a 4 px base; section rhythm `clamp(80px, 11vw, 150px)` everywhere on the landing page.
- Container 1240 px, `padding-inline: clamp(16px, 4vw, 48px)`.
- Radii: panels 18 px, inner cards 14 px, pills 999 px. Chamfered corner brackets (CSS
  `clip-path` + 1 px pseudo-element strokes) only on the hero panel and the active-asset card.
- Faint coordinate grid: 1 px lines every 64 px at 3% white, masked to fade out at the edges.

### Motion

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.23,1,.32,1)` | every enter, hover, press |
| `--ease-in-out` | `cubic-bezier(.77,0,.175,1)` | on-screen movement (tab indicator, camera) |
| `--d-ui` | 180 ms | hover, press, toggles |
| `--d-panel` | 380 ms | panel mount, step change |
| camera | 2.5 s (Cesium flight) | globe moves |

Rules: buttons `scale(.97)` on `:active`; popovers scale from their trigger; no `transition: all`;
no ease-in on enter; no fade-up on every section; nothing animates on ⌘K or keyboard shortcuts.
Reduced motion: opacity-only, no globe spin, no arc travel (it is drawn complete), numbers swap.

Choreography on /sim: globe first (0 ms), rails 100 ms after, numbers last (NumberFlow on value
change). Step change: the pill indicator slides (motion `layoutId`), panels cross-fade 220 ms.
Landing → sim: cross-document View Transition (`@view-transition { navigation: auto }`); the
hero Mars and the sim's target globe share `view-transition-name: target-globe`.

## 3 · Libraries (one per job)

| Job | Pick | Why / where |
|---|---|---|
| Primitives | Base UI (`@base-ui/react`) in shadcn-style wrappers | segmented toggles, tooltip, dialog |
| ⌘K | cmdk | jump to any IAU feature, landing site or Earth analog; actions |
| Toasts | Sonner | real events only |
| Phone sheet | Vaul | panels over the full-bleed globe |
| Numbers | NumberFlow | every changing number |
| Motion | motion | step indicator, panel enter/exit, result reveal |
| Charts | Chart.js, restyled with glow | **Liveline was evaluated and not used:** it has no log axis (air density spans Earth 1.2 → Moon 0 kg/m³) and cannot shade the measured-vs-inferred gap |
| Pipeline | Magic UI Animated Beam (source copied) | landing "how it works" |
| Hero accent | Aceternity-style background grid (CSS only) | landing hero only |
| Thinking state | Beautiful UI task-rows pattern (rebuilt, no dep) | /sim while `/api/analog` runs |

Radix enters only transitively (cmdk and Vaul are built on Radix Dialog); every primitive we
author ourselves is Base UI.

## 4 · Composition

```
LANDING
┌ nav: mark GeoNexus ............................ How it works · Worlds · [Launch mission console] ┐
│ HERO (100svh)                                                                                  │
│  h1 "Every crater has a twin on Earth."      ( WebGL Mars, dotted orbit rings )                │
│  lede · [Launch mission console]                    · pin ─ ─ ─ arc ─ ─ → (Earth)              │
│  readout: Gale Crater ↔ Atacama · fit 62 (preview)                                             │
├ GRAVITY: three glass gauges, hop indicator per world ─────────────────────────────────────────┤
├ HOW IT WORKS: Animated Beam  [Mars site] → [Terrain features] → [TerraTwin] → [Earth twin] ────┤
├ READOUTS: left copy · right mini-HUD replaying a recorded 20 s Gale drive ─────────────────────┤
├ WORLDS: two glass asset cards (sphere, stats, feature count, Explore) ─────────────────────────┤
└ CLOSING BAND + footer with every data credit ──────────────────────────────────────────────────┘

SIM (≥1280 px)
┌ top: mark · [Explore|Model result|Live drive|Sensors] ·········· ⌘K · [Mars|Moon] · UTC ┐
│ left rail          │ center: target globe (hero) + Earth globe        │ right rail        │
│ mission / site     │ crosshair + lat/lon + feature name under cursor  │ active asset      │
│ task rows / twin   │                                                  │ readouts + spark  │
│                    │                                                  │ anomaly card      │
└ bottom: [2D|3D|Ground] · ● Live · T+ mission time ──────────────────────────────────────┘
≥1440: rails float over the globe as glass · laptop: rails dock · phone: Vaul sheet.
```

## 5 · Genericness test

"Dark dashboard with glass cards" would be the generic answer. What moves it off that: the hero
globe is shaded from our own MOLA heights (not a stock texture), every number on the page is a
real measured or modelled value with its unit, the twin arc is the product's actual mechanism, and
the display face is squared Oxanium instead of the category's default grotesk.
