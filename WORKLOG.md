# Planetary Rover Sim — Work Log

Run: `.venv/bin/python serve.py` in this folder, open http://localhost:8642 (landing page; the simulator is at /sim) (needs internet for CDN libraries and map tiles).
Plain `python3 serve.py` still serves the page, but the model API then answers 503 because numpy/duckdb live in `.venv`.
Model check: `.venv/bin/python serve.py --check`.
Modes are also reachable by URL hash: `#earth`, `#moon`, `#mars`, `#earth_mars`, `#earth_moon`.
Tests: `node tests/selfcheck.mjs`. Data refresh: `node scripts/fetch_dem.mjs`, `node scripts/fetch_labels.mjs`.

---

## 2026-11-14 · Session 1 — initial build

- CesiumJS 1.140 + Tailwind + Chart.js, vanilla ES modules, no build step.
- Earth terrain: Cesium Ion's default token was rejected (401), so Earth uses **AWS Terrain Tiles (Terrarium PNG, SRTM/GMTED/ETOPO1)**, decoded client-side; keyless.
- Moon/Mars: NASA Trek WMTS imagery + procedural terrain (replaced in session 2).
- Rover: PI speed control with braking, gravity/rolling/drag dynamics, slope-avoiding autonomy, stall recovery.
- Onboard inverse estimator (drive command + odometry + IMU only): slope from gravity in the accelerometer, dead-reckoned elevation, density from unexplained drag, temperature from the ideal gas law.
- Bugs found in browser testing and fixed: rover "true" height jumping with render LOD (now a fixed z14 height grid); box entity stuck PENDING (callback properties); `trackedEntity` not following on non-WGS84 ellipsoids (custom follow camera); Mars sky-atmosphere crash; Esri "map data not yet available" tiles past z16.

## 2026-11-14 · Session 2 — six-part upgrade

### 1. Real NASA DEM terrain, crisp close-ups (`js/dem_sampler.js`, `js/globe.js`, `scripts/fetch_dem.mjs`)
- `scripts/fetch_dem.mjs` downloads keyless DEMs and writes 2880×1440 8-bit PNGs to `data/`:
  - Moon: LRO LOLA 16 ppd, NASA SVS CGI Moon Kit `ldem_16_uint.tif` (uint16 half-metres above 1727.4 km).
  - Mars: MGS MOLA MEGDR 16 ppd, PDS `megt90n000eb.img` (int16 MSB metres, rolled from 0°E to a −180° west edge).
  - Georeferencing verified on known extremes: Moon max 10,552 m at 5.4°N 158.7°W, min −8,729 m at Antoniadi (SPA); Mars max 21,159 m at Olympus Mons, min −8,135 m in Hellas.
- `NasaDemSampler` decodes the PNG through an offscreen canvas and maps luminance 0–255 bilinearly to Moon −9,100…+10,700 m and Mars −8,200…+21,200 m. If the PNG can't load, it synthesizes a cratered multi-octave fallback canvas.
- Terrain mesh: `CustomHeightmapTerrainProvider` at 64×64 fed by the sampler. Below the DEM's ~4–7 km pixels, synthetic detail (small craters + fBm, tens of metres) is added once tiles are fine enough to resolve it.
- Cesium does not light heightmap terrain (it has no vertex normals), so a **relief overlay layer** bakes hillshade from the same height field, a seamless micro-texture (zoom ≥ 10), and a **100 m / 1 km grid** (constant latitude spacing; E–W spacing shrinks by cos lat).
- `globe.enableLighting = true` with a directional light kept to the viewer's upper left.
- Imagery: Trek LRO WAC up to level 8 (level 9 is 404). Trek Viking MDIM up to level 7. Mars close-ups add the **MRO CTX ~5 m mosaic** (Esri OnMars, max level 12; level 13 returns 400 without CORS).
- Deploy camera: 2,500 m range, −35° pitch chase view.

### 2. Live Earth weather (`js/physics.js`, `js/pane.js`)
- Open-Meteo `current=temperature_2m,surface_pressure,relative_humidity_2m,wind_speed_10m` at each Earth deploy (CORS OK, keyless). Responses are validated for plausible ranges.
- `liveEarthAtmosphere`: the station T and P at the model-grid elevation are carried to the rover's elevation with the standard lapse rate, and ρ = P / (287.05·T). The HUD badge reads `LIVE OPEN-METEO WEATHER`, or `ISA ATMOSPHERE` when offline.

### 3. Estimator fixes (`js/rover.js`)
- Density: a 1 s least-squares window of unexplained drag (d = c·ρ·v²), only near cruise speed (> 8 m/s), raw ρ clamped ≥ 0, then EMA α = 0.15 per window.
- Vacuum: an airless world, or ρ̂ < 0.0005, is classified `Vacuum` (ρ̂ reported as 0.0000) and T̂ comes from the solar-incidence thermal model.
- Mars/Earth T̂ = P(ĥ)/(R·ρ̂), clamped to planetary bounds (Earth 180–340 K, Mars 130–310 K) and smoothed.
- Verified in the browser: Moon ρ̂ never below 0 and shown as Vacuum. Mars ρ̂ 0.0158 vs 0.0154 true, T̂ 241 vs 242 K.

### 4. Labels (`scripts/fetch_labels.mjs`, `js/labels.js`, `data/labels_*.json`)
- Pure-Node ZIP + dBASE reader over the USGS Gazetteer shapefiles. It keeps IAU-adopted primary features and drops satellite craters such as "Copernicus A".
  - Moon **2,043** features (incl. 6 IAU *Statio* landing sites), Mars **1,941**, each `[name, lat, lng, diameter_km, type]`.
  - Curated landing sites added: Apollo, Luna, Chang'e, Chandrayaan-3, SLIM, IM-1, Blue Ghost, approximate Artemis III regions; Viking through Zhurong, plus Oxia Planum (planned).
  - Earth: 39 curated analog sites, impact craters, volcanoes and landmarks. "Analog site" entries double as one-click Earth deploy presets.
- Rendering uses a `LabelCollection` with `DistanceDisplayCondition` = 25 × feature size (> 2,000 km always shown) and a `NearFarScalar` scale. Labels are depth-tested beyond 200 km so the far side stays hidden.

### 5. Dual-planet similarity modes (`js/main.js`, `js/pane.js`, `js/similarity.js`, `js/charts.js`)
- New `Earth ↔ Mars` and `Earth ↔ Moon` modes give a split screen of two independent globes and rovers, each with its own HUD and mini telemetry.
- The bottom dock has merged charts (relief Δh from deploy, slope, log air density, temperature), a per-channel similarity %, and an overall score in the dock and the header.
- Similarity works on the last 60 s of true telemetry: relief roughness (std ratio), slope distribution (mean |slope| and std ratios), log10 density gap (3 decades → 0), and mean temperature gap (100 K → 0). Overall = 100·(1 − RMS of the four dissimilarities).
- Browser results: Atacama vs Gale scored 86 / 96 / 39 / 46 → **59%**. Meteor Crater vs Apollo 11 scored 91 / 86 / 0 / 4 → **30%**.

### 6. Verification
- `node scripts/fetch_dem.mjs`, `node scripts/fetch_labels.mjs`: ran OK (outputs above).
- `node tests/selfcheck.mjs`: ok. It covers estimator accuracy, Moon ρ̂ never negative and reported as vacuum, Mars T̂ within bounds, the live-weather ρ formula, DEM georeferencing and non-flat elevation on the bundled PNGs, and similarity bounds (identical = 100, every score within 0–100).
- Browser: all five modes loaded with no console errors. A rover was deployed in each world.

## 2026-11-14 · Session 3 — fix: clicking Moon/Mars did not deploy a rover

- **Symptom (user report):** clicking the Moon or Mars started no rover.
- **Root cause:** Cesium's `scene.globe.pick` returns nothing for any ray that doesn't pass through the planet's centre when the globe uses a non-WGS84 ellipsoid. Only a dead-centre click deployed. All earlier automated tests clicked dead-centre, so they missed it. Measured on the Moon: centre → hit; 0.45/0.42/0.30/0.60 of the width → no hit, while a ray–ellipsoid intersection worked everywhere.
- **Fix (`js/globe.js` → `g.pick`):** DEM worlds intersect the click ray with the ellipsoid inflated to the DEM height at the hit, refined 5×, so the click lands on the terrain the user sees. Earth keeps `globe.pick`. The follow camera's "stay above ground" check now uses the DEM sampler, because `globe.getHeight` has the same ellipsoid problem.
- **Also found:** `python3 -m http.server` sends no cache headers, so a normal reload served a stale `globe.js` next to a fresh `pane.js` (`g.pick is not a function`). Added `serve.py`, which sends `Cache-Control: no-store`. Do one hard refresh (Ctrl+Shift+R) after switching servers.
- **Verified at 1920×1080:** off-centre clicks deploy and the rover drives (about 60 m in 5 s at 12 m/s) in Moon, Mars, Earth ↔ Moon and Earth ↔ Mars, from orbit and close-up (re-clicks relocate the rover). No console errors besides a favicon 404. Self-check ok.

## 2026-11-14 · Session 4 — map labels removed, place name shown in the telemetry box

- User request: no labels on the map; show the deploy location's name in the graph box for Earth, Moon and Mars.
- `js/labels.js` no longer draws anything. It now exports `loadFeatures`, `placeName` and `earthPlace`.
- Moon/Mars: the name is the smallest roughly-round USGS feature containing the click (craters, maria, terrae, montes…), plus the nearest feature with its distance when that is a different one. Landing sites and linear features (rilles, valleys, ridges) only count as "nearest". Checked: Apollo 11 → "Mare Tranquillitatis · 0 km from Apollo 11"; Perseverance → "Jezero · 0 km from Perseverance"; Tycho → "Tycho".
- Earth: keyless OpenStreetMap Nominatim reverse geocoding per deploy (the clicked coordinates are sent to it), falling back to the nearest curated landmark for open ocean or when offline.
- Browser check: Earth → "Ombu township, Nyima County, Nagqu City, Xizang, China"; Atacama preset → "Antofagasta … Chile"; Mars → "Terra Cimmeria (Terra) · 257 km from Elston (Crater)"; Moon → "74 km from Ariadaeus (Crater)". Self-check ok.

## 2026-11-15 · Session 5 — TerraTwin model wired in, page redesigned

- **Model source:** `github.com/ikat5/mars_moon_earth_dataset` (private), cloned to `vendor/mars_moon_earth_dataset`. The `ml/` folder holds S1, a SimCLR terrain-shape encoder. It is served as a precomputed index (`s1_index.npz`, 152 MB, release asset `ml-0.3.0`, SHA-256 verified) with a PCA-64 embedding of the 32×32 elevation patch (500 m spacing, ~16 km) around every cell: 921,600 Mars, 230,400 Moon, 1,079,622 Earth.
- **What the model needs:** only body + lat/lon. The repo's `processing.search.search` maps that to a dataset cell, reads its four terrain features (`slope_median_deg`, `slope_p90_deg`, `relief_m`, `roughness_rms_m`) from `prepared/0.2.0/*_features.parquet` (pulled with Git LFS), screens dry/barren Earth cells of similar area on those features (`dry_barren_terrain` profile), then orders the survivors by S1 cosine similarity.
- **Setup done:** `.venv` with `numpy` + `duckdb`; LFS pull of the three 0.2.0 feature tables (310 MB); index download via `gh release download`.
- **`serve.py`:** new `GET /api/analog?body=moon|mars&lat=&lon=` calling that engine (inputs validated; `/vendor` and `/.venv` are not served as files). About 0.2 s per query, ~700 MB RAM. `--check` asserts a sane Jezero result.
- **Flow:** click Mars/Moon → rover deploys there → API returns the cell's features and up to 5 Earth matches → the Earth rover deploys at match #1 → both drive. Other matches are clickable; clicking Earth yourself still works.
- **Page redesign (`index.html`, `css/styles.css`, `js/main.js`, `js/pane.js`):** one scrollable page in five numbered steps: (1) target globe, (2) Earth globe, (3) model result cards for Mars *and* Moon (features in, feature-by-feature match bars, terrain fit, shape similarity, named Earth matches), (4) live drive comparison charts, (5) rover sensors measured vs inferred. Tailwind and the old five-mode switcher were removed; the switch is now Mars | Moon.
- **Browser check (1500×950):** Mars click at Nepenthes Mensae → San Pedro de Atacama, Chile (fit 62, shape 0.81); Moon click in Mare Tranquillitatis → 5 matches (New Valley, Egypt first; shape 0.86), picking #2 moved the Earth rover to Iskushuban, Somalia; the Mars card stayed on the page. No console errors.
- **Test fix:** the Mars temperature assertion in `tests/selfcheck.mjs` failed about 1 run in 30 (single-run error up to 34 K against a 30 K limit). It now averages five runs (< 20 K); 30/30 passes.

## 2026-11-15 · Session 6 — fix: globe could not be rotated after deploying a rover

- **Cause:** the follow camera re-aimed at the rover on every frame, which undid any drag.
- **Fix (`js/pane.js`):** a drag (left, right, middle or pinch) frees the camera and shows a "Follow rover" button; the button or a new deploy locks it back on. Wheel zoom keeps following.
- **Verified in the browser (Moon and Earth panes; Mars shares the code):** after a drag the rover moved from screen centre (0.50, 0.49) to (0.88, 0.66) and stayed there, the rover kept driving, and "Follow rover" re-centred it.

## 2026-11-15 · Session 7 — place labels back on the Moon and Mars globes (not Earth)

- `js/labels.js` `addLabels` draws the USGS features again, called from `js/pane.js` for DEM worlds only.
- Tuned for the smaller globes: a label shows within 10× its feature's diameter (was 25×), text is centred on its dot, and the six IAU "Statio" entries are skipped because they duplicate the "Apollo N" labels.
- Far-side labels leaked around the limb, so labels are now hidden beyond the horizon. The first version of that test wrongly hid nearby labels in low terrain (mare floor at −1.9 km); the occluding sphere now sits 10 km below the reference radius.
- Browser check: Mars and Moon from orbit show only large features with nothing beyond the disc; a close-up at the Apollo 11 site shows the local labels; clicking through labels still deploys the rover; Earth has no labels; no console errors.

## 2026-11-15 · Session 8 — polar matching fix and full UI redesign

### Polar matching (`serve.py`, `js/globe.js`)
- **Cause:** the engine only kept Earth cells whose footprint was 2/3–1.5× the target cell's. Grid cells shrink by cos(lat), so a cell at 86.66°N on Mars (12.9 km²) had no Earth counterpart. Separately, the dry-barren Earth set has zero cells poleward of 60°.
- **Three modes by target latitude** (reported to the UI as `mode`):
  - `standard` (|lat| ≤ 60°): unchanged; falls back to `wide` if the footprint gate leaves nothing.
  - `wide` (60–65°): the same dry-barren screen with the footprint gate off. The derived profile lives in `.cache/profiles_0.2.0/` (symlinks to the release plus a rewritten `profiles.json`), so the vendored repo is untouched.
  - `polar` (> 65°): all ~600,000 terrain-eligible Earth cells poleward of 60°, loaded once, scored with the engine's own `normalized_fit`, weights, tolerances and minimum fit, with 100 km thinning. Result = best 3 cells plus the best 2 named analog sites (each by its best cell within 100 km), ordered by terrain fit. Shape similarity is attached for display where both cells are in the S1 index (≤ 80°).
- **Named sites:** McMurdo Dry Valleys, Devon Island (Haughton), Svalbard, Axel Heiberg, Peary Land (82°N 30°W), Summit Camp (listed separately at its real 72.58°N 38.46°W).
- **Grid:** the longitude step of the 100 m / 1 km grid is scaled by 1/max(0.15, cos lat), per 1° latitude band so lines stay continuous across tiles.
- **Checks:** `serve.py --check` asserts ok results for Mars 86.66°N, Moon 85°S, Mars 87°S, Moon 75°N (each in ~0.5 s, each including a named site) and Mars 62°N. Browser: a click at 86.9°N on Mars matched Evenkiysky Rayon, Siberia (fit 97, live weather −13.5 °C) with McMurdo and Svalbard listed as known analog sites.

### Redesign (`index.html`, `sim.html`, `css/styles.css`, `css/landing.css`, `js/main.js`, `js/pane.js`, `js/charts.js`)
- **Landing page at `/`:** nav, hero with a pure-CSS animated solar system (tilted orbit plane, counter-rotated planets, labelled Earth and Mars orbits), gravity strip (values read from `js/physics.js`), how-it-works, readouts, worlds, call to action, footer.
- **Simulator at `/sim`, `/sim/result`, `/sim/drive`, `/sim/sensors`:** one page shell with client-side routing, so the globes, rovers, charts and model result live for the whole session. `?world=moon` selects the Moon. `serve.py` serves `sim.html` for every `/sim*` path.
- **Explore:** both globes turn once a minute until picked; the target stops on click and gets a pulsing pin; Earth shows a blue scanning ring while the model runs, then flies to the match. Summary card with empty, loading and result states.
- **Model result:** title, three score cards, "what the model received", feature match bars, selectable match list with "Drive to …".
- **Live drive:** both rover views, overall similarity badge, Pause/Resume, four Earth-vs-target charts.
- **Sensors:** rover toggle and a 2×2 grid with current measured and inferred values in each chart title.
- **Empty state** on pages 2–4 when the selected world has no site. Switching worlds and coming back restores both rovers.
- Fonts from Google Fonts (Fraunces, Inter, JetBrains Mono); `prefers-reduced-motion` stops CSS animation, the globe spin, the pin pulse and the camera fly-in.
- **Browser checks (1440 px and 500 px wide):** every page, pause/resume, row selection, "Drive to", sensors toggle, Moon empty state, world switch and back, "Pick a new site", deep link to `/sim/result`; no horizontal overflow at 500 px.

## 2026-11-15 · Session 9 — Earth-twin matching: metric patches, polar support, landform re-ranking

### Phase 0 — what the code was doing
- **Cells:** lat/lon grids (Earth 0.125°, Mars 0.25°, Moon 0.5°). The footprint gate is `earth_target_area_ratio` [2/3, 1.5] in the `dry_barren_terrain` profile, applied in `processing/search.py` `search()` (`area_km2 BETWEEN`).
- **Elevation sources:**
  - Dataset features: ETOPO 2022 15" (Earth), MOLA MEGDR 128 ppd (Mars, 463 m), LOLA LDEM_64 (Moon, 473 m).
  - App's Earth tiles (AWS Terrarium): SRTM between 60°N and 56°S, GMTED2010 in the Arctic, and ETOPO1 *bedrock* (under the ice, ~1.8 km) in Antarctica. Nothing beyond 85.05° (Web Mercator).
- **S1 patches:** `ml/patches.py` `patch_coords` cuts a 32×32 local tangent plane at 500 m spacing, so the index embeddings were already metric. The index only covers |lat| ≤ 80°.
- **Where things live:** screen = the `eligible_dry_barren` column; ranking = `search()` plus `ml/serve.py` `LearnedIndex`; drive and temperature similarity = `js/similarity.js` (called from `js/main.js`); rover stepping = `js/rover.js`; grid = `js/globe.js` `reliefTile`; Model result UI = `js/main.js` `renderResult`.

### What changed
New package `matching/`; `serve.py` now calls `matching.pipeline.match` (the old matcher is kept as `serve.legacy_analog`).

- **Phase 1 — `matching/patches.py`:**
  - Every patch, on every body, is a 32×32 square at 500 m (16 km), azimuthal equidistant around the point, so it is valid over a pole.
  - Readers: Mars from the USGS MOLA 463 m mosaic by HTTP range (raster at byte 184,973); Moon from the LOLA 118 m mosaic read at every 4th pixel (472 m); Earth from Terrarium (native ≤ 620 m) for |lat| ≤ 56°, and **Copernicus DEM GLO-90** (keyless AWS open data, overview 4 ≈ 360 m) for |lat| > 56°.
  - The four terrain features are recomputed on these patches. The footprint gate is gone; a coverage check (≤ 5% no-data) replaces it.
- **Phase 2 — screens (`matching/pipeline.py`):**
  - Relaxation ladder: normal → cold-desert branch → relaxed ×1.5 → terrain only. Polar queries start at the cold-desert branch. Never empty; the step used is returned and shown as a badge.
  - The cold-desert branch adds 96,902 cells (90,486 above 56°).
  - `allow_ice_surfaces` defaults to false.
  - `reference_analogs` give "near <site> (NASA analog)" hints only; they are never forced into results.
  - Temperature for |lat| > 60° is compared as position within each world's range.
- **Phase 3 — `matching/landform_features.py`:** anisotropy (structure tensor on the 4 km high-pass), dominant orientation, pit and knob density, curvature and local-relief statistics, roughness at 0.5/2/8 km, and a rule-based class. All thresholds live in `matching/config.py`.
- **Phase 4 — two-stage ranking:**
  - Stage 1: model order, top 200 with 50 km thinning.
  - Stage 2: shape + fit − anisotropy, pit and roughness gaps − class penalty. Dunes are dropped for cratered/knobby queries. Final picks are ≥ 500 km apart and not near-duplicates (cosine ≤ 0.98).
  - Descriptor cache: `.cache/earth_descriptors.npz`, filled by `python -m matching.build_cache` (polar/cold set) or `--all`; anything else is filled lazily on first use.
- **Phase 5 — UI:** percentile "top x% of N", confidence badges (High needs a live drive ≥ 60% when one exists), landform class per site, NASA-analog hint, relaxed-match banner, and the new descriptor rows in the feature table.
- **Phase 6 — polar rendering and motion:**
  - Rover steps on great circles (`travel()` in `js/rover.js`).
  - The follow camera moves by parallel transport (no compass heading, so no flip at the pole).
  - Above 75° the lat/lon grid stops and a 500 m east/north grid is drawn around the rover.
  - The DEM sampler now has a single height at each pole (it used to read 83° false slopes at 89.99°).

### Verified
- `tests/test_matching.py` passes:
  - Patch extent and pixel size within 1% at 0°, 60°, 80°, 89° and 89.99° on all three bodies.
  - Mars and Earth share one resolution.
  - A crater at 85° keeps aspect 1.00 (the old degree grid gives 0.39).
  - Ridges have anisotropy > 0.7; bumps plus pits have anisotropy < 0.3 with pits > 0.
  - A flat plane has zero roughness.
- `tests/selfcheck.mjs` passes 15/15:
  - A 60 s drive from 89.997° crosses the pole with the direction of travel changing < 10° per step.
  - Longitude wraps at ±180°.
  - Relative temperature works.
  - Single pole heights in the DEM sampler.
- **Calibration on known sites:** Amazonis and Rub' al Khali → smooth plain; Apollo 11, lunar south pole and Meteor Crater → cratered; Svalbard, Dry Valleys and Devon Island → knobby/fractured; Olympia Cavi (next to the Olympia Undae dunes) → dunes/linear.
- **Avernus Colles (API):** the new top 5 are all knobby/fractured with high confidence; stage 2 takes 0.02 s once cached (18.8 s cold).
- **Browser:** the Model result page shows badges, percentiles and descriptor rows; the polar grid stays square at 89.99°.

### Not done / to run
- `scripts/eval_matching.py` (old vs new table) was **not run**. The pre-compute for hot-desert cells (`python -m matching.build_cache --all`, ~190k cells, ~45 min) was stopped by Claude Code because the 6 GB machine ran out of memory. Run both when nothing else is open.
- The **S1 encoder could not be re-run** on new patches: the model weights are not in the repo or release, only the index, and torch is not installed. Within ±80° the existing embeddings already use the same metric geometry; beyond 80° stage 1 orders by fit.
- The **headless rover verification** (Phase 4 option) is off: the drive engine is browser JS, and 15 s at 12 m/s covers 180 m, less than one 500 m pixel.
- **Antarctica has no land cover** in the dataset, so the cold-desert screen cannot see ice-free areas such as the Dry Valleys. They only appear with `allow_ice_surfaces` or at the terrain-only step.
- **Small dunes are invisible** at 500 m (Erg Chech dunes are 1–2 km apart). The Grand Erg Oriental reads as "cratered" (interdune hollows). The class rules separate large-scale texture only.
- **Rover pole test start point:** it starts at 89.997°, not 89.9°. At 12 m/s, 60 s covers 720 m, while 89.9° is 3 km from the Moon's pole.

### Known limits / shortcuts
- The model's scores are experimental terrain resemblance, not validated analog relevance (the repo says so itself). Cells beyond ±80° latitude are not in the model index, so polar matches are ranked by terrain fit only, and with the footprint gate off the compared cells differ in size.
- Near the poles the synthetic small-scale terrain detail is sheared (it is laid out in lon·cos(lat) coordinates), and the Viking imagery is stretched.
- CTX close-up imagery has gaps on Mars; missing tiles log CORS errors in the console and the globe falls back to the coarser layer.
- Some targets return fewer than 5 matches: the repo's engine stops at the first model-ranked cell that fails the terrain-fit minimum.
- Earth match names come from Nominatim at one request per second, so five names take about five seconds.
- Place names use each feature's centre and diameter, so irregular features (maria, terrae) are approximated as circles.
- Clicking Earth's open ocean shows Esri "Map data not yet available" placeholder tiles at high zoom (cosmetic).
- Sub-DEM detail (craters < ~4 km on the Moon, < ~7 km on Mars) is synthetic. The 8 ppd DEM is real but coarse.
- The OPM fallback for Mars imagery was skipped; Trek MDIM + CTX was used instead.
- Similarity compares statistics, not co-located terrain, because the two drives are independent.
- Not tested on phones (telemetry columns hide below 768 px; panes stack vertically).

## Session 10 — Render deployment
- Pushed to github.com/ikat5/GeoNexus (public, branch main). `.gitignore` keeps `.venv/`, `.cache/` and the private `vendor/` dataset out.
- `serve.py` binds 0.0.0.0:$PORT when PORT is set (Render); local runs unchanged (127.0.0.1:8642).
- `render.yaml` (Blueprint, plan standard: the server holds ~1.1 GB RAM), `requirements.txt`, `scripts/render_build.sh`.
- The build fetches the private dataset only if the `DATASET_TOKEN` secret is set (fine-grained GitHub token, read-only Contents on mars_moon_earth_dataset): shallow clone, LFS pull of the three 0.2.0 tables (~310 MB), and the `s1_index.npz` release asset (checksum-checked). Without the token, the site deploys and `/api/analog` returns 503 "Model unavailable".
- Tested locally: script syntax, release asset lookup, PORT startup without vendor (/ and /sim 200, /api 503, /vendor 404). Not tested: an actual Render build.
- Hugging Face Spaces (free CPU tier, enough RAM for the model): `huggingface/Dockerfile` + `huggingface/README.md` are copied into a Docker Space. The image clones GeoNexus and installs deps; the private dataset is fetched at container start with the `DATASET_TOKEN` Space secret, so it never lands in the (publicly pullable) image. Not tested: no Docker on this machine.
