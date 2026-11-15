# Cook brief: GeoNexus redesign

- **Target:** the GeoNexus landing page and mission console (`/`, `/sim/*`) on the production build (`npm run build && .venv/bin/python serve.py`).
- **References** (in `cook/refs/`, git-ignored: third-party brand material): R01 a "satellite fleet" dashboard screenshot; V01 nine frames from a satellite-console video (teal glass slabs, glowing failure chart, glass D-pad, Earth with night lights).
- **What to match:** the feel, never the layout 1:1, the satellites or any brand. One globe as hero with panels orbiting it, glass depth, panel density, calm amber/teal accent discipline, a glowing multi-line chart, an amber "anomaly" card.
- **Bar (from the user's prompt):** fresh-context critics score composition, light, color, materials/glass, detail density and motion feel out of 10; target 9 or more on each.
- **Rules:** physics, estimator, similarity and matching logic untouched; `node tests/selfcheck.mjs` green; Mars amber, Earth cyan, one mint score accent; tabular numerals; reduced motion; 44 px targets; no purple, beige, decorative orbs, particles, 01/02/03 counters or decorative mono eyebrows.
- **Time:** bounded by this session (the user is waiting); rounds are logged honestly in ROUNDS.md, including where the bar was not met.
- **Deliverable:** the code on branch `redesign`; nothing is published or deployed from the loop.
