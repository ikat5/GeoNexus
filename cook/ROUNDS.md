# Cook ledger: GeoNexus redesign

Started: 2026-11-15 16:45 (local) | Time: bounded by this session (the user is waiting), no 8 h floor
Bar (from the user's prompt): composition 9 | light 9 | color 9 | materials 9 | detail 9 | motion 9 (out of 10, critic median)
Calibration offset: none (no user estimate yet)
Gate: stills approved [no] (no final render in this project: the deliverable is the site itself)
Best so far: rounds 2–3 (tied), `cook/stills/r03/`, commit 6c39d58

Stills and references live in `cook/stills/` and `cook/refs/`, both git-ignored (the references are third-party brand material).
Critics are fresh subagents that see only the two references, the stills and the rubric; every round uses new ones.

## Decisions

- Scores are for the references' feel (glass, light, panel density, accent discipline), not similarity: the brief forbids copying their layout, satellites or brands.
- Side-by-side composites were skipped: the skill's script needs ffmpeg, and running a downloaded ffmpeg binary was blocked here. Critics get each reference and each still as separate images.
- Motion cannot be judged from stills; critics give an inferred number and it is reported as such.

---

## Round 01

Focus: first full build (landing, four console steps, phone).
Stills: `cook/stills/r01/` (S01 landing hero, S02 explore, S03 drive, S04 Moon result, S05 phone)

Scores, eyeballed: mean of 2 critics (Opus, Sonnet; never more than 1 apart), no calibration

| Shot | Comp | Light | Color | Materials | Detail |
|---|---|---|---|---|---|
| S01 | 6 | 5.5 | 5.5 | 4.5 | 4.5 |
| S02 | 5.5 | 4.5 | 5 | 5 | 6 |
| S03 | 6 | 4.5 | 5 | 4.5 | 6 |
| S04 | 5 | 3.5 | 5 | 4.5 | 6 |
| S05 | 6 | 4.5 | 5 | 4.5 | 5.5 |

Motion (inferred from stills): 5 and 5.

Top gaps from critics (both agreed):
1. Materials: every panel read as flat opaque charcoal; no visible blur, no teal tint, no inner highlight.
2. Light: the grey CTX terrain was the brightest thing on screen, inverting the references' bright-object-in-darkness.
3. The two-corner orange bracket looked like a render glitch; NumberFlow digits caught mid-roll looked broken; the result page had no visual anchor.

## Round 02

Changes (commit 06490e9):
- Teal-tinted glass (three elevations) with a cyan-white hairline and top highlight; a coordinate grid and teal haze behind the console so the blur has something to show.
- Four-corner HUD marks replace the two-corner bracket.
- Globe frames: vignette and darker centre; an amber colour wash puts the panchromatic CTX close-ups of Mars back in Mars colours.
- Dock charts: stronger bloom and gradient area fills; glass D-pad disc with a lit centre key; speed ruler with a lit fill and an amber target tick.
- Tinted-glass primary buttons (R01's "Respond"), amber anomaly card with an icon tile and a lit action, moved above the feature table.
- Result page: Moon or Mars and Earth as two small planets (the landing renderer) joined by the twin arc.
- Landing: raking light toward Earth (terminator plus lit limb), labels riding the pins, site chips as one segmented rail, warm and cool bloom.
- Live telemetry digits swap instead of rolling (twice-a-second rolls read as noise).

Stills: `cook/stills/r02/`

Scores, eyeballed: mean of 2 new critics (Opus, Sonnet)

| Shot | Comp | Light | Color | Materials | Detail |
|---|---|---|---|---|---|
| S01 | 7 | 5.5 | 6.5 | 5.5 | 5.5 |
| S02 | 6 | 5.5 | 5.5 | 6 | 7 |
| S03 | 6.5 | 5.5 | 6.5 | 6.5 | 7.5 |
| S04 | 6 | 5 | 6.5 | 6 | 7 |
| S05 | 6 | 5 | 6 | 5.5 | 6 |

Motion (inferred): 5 and 6. Up about one point everywhere; light still weakest.

## Round 03

Changes (commit 6c39d58): cooler, denser glass with a specular top edge on every slab; hard terminator and a hot lit limb on the hero planets, Earth 1.3x larger with brighter city lights, an orbit crossing in front with node dots; D-pad 1.25x; current speed in white against a dim target; amber agreement bar in the anomaly card; scores in white with a mint glow (one accent); short match names; no native scrollbars in rails; phone sheet peek shows the twin and score instead of the run log.

Stills: `cook/stills/r03/` (S04 and S05 were taken on the round-3 build just before the last small fix, after which the test browser ran out of memory)

| Shot | Comp | Light | Color | Materials | Detail |
|---|---|---|---|---|---|
| S01 | 6 | 6 | 6.5 | 5 | 5.5 |
| S02 | 6 | 4.5 | 5.5 | 5 | 6.5 |
| S03 | 6.5 | 5 | 6 | 6 | 7.5 |
| S04 | 6.5 | 5.5 | 7 | 6 | 7 |
| S05 | 5.5 | 4.5 | 5.5 | 5 | 4.5 |

Motion (inferred): 5 and 5.

Stop check: bar 9 NOT met (best cells 7–7.5, light 4.5–6). Stopped at the session's limit, not at the bar.
Plateau diagnosis: rounds 2 and 3 are flat. What the critics keep asking for is (1) a lit hero globe in the console after a pin, where the product deliberately shows a close-up chase view of Cesium terrain that Cesium lights flatly (heightmap terrain has no normals), and (2) more depth in the glass. Next step if continued: a Cesium post-process stage (vignette, bloom, colour grade) and an orbit-scale explore camera before the chase, then re-score.
