# .venv/bin/python serve.py — http://localhost:8642
# Static files (caching disabled so reloads never mix stale ES modules), the simulator routes (/sim, /sim/result,
# /sim/drive, /sim/sensors -> sim.html) and GET /api/analog, which runs the TerraTwin search engine and S1 terrain
# model from vendor/mars_moon_earth_dataset on a Moon/Mars coordinate.
#   .venv/bin/python serve.py --check   runs the matcher on Jezero and on polar sites and asserts the results are sane
import functools, http.server, json, math, os, sys, threading, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT / 'vendor' / 'mars_moon_earth_dataset'
DATA, PROFILE = REPO / 'prepared' / '0.2.0', 'dry_barren_terrain'
PROFILES = ROOT / '.cache' / 'profiles_0.2.0'  # DATA plus the two derived profiles below; rebuilt on every start
PRIVATE = ('/vendor', '/.venv', '/.cache')  # never served as static files
NO_AREA_GATE = [0.0, 1e12]
WIDE_LAT, POLAR_LAT, CAP_KM = 60.0, 65.0, 3336.0  # CAP_KM: great-circle distance from a pole to latitude 60
# Published polar / cryospheric planetary-analog field sites. Coordinates as supplied, except Summit Camp, which is
# listed separately at its real position (72.58N) because 82N 30W is Peary Land.
ANALOGS = [
    ('McMurdo Dry Valleys, Antarctica', -77.85, 161.00), ('Devon Island (Haughton Crater), Canada', 75.38, -89.68),
    ('Svalbard, Norway', 78.22, 15.63), ('Axel Heiberg Island, Canada', 79.40, -90.80),
    ('Peary Land, Greenland', 82.00, -30.00), ('Summit Camp, Greenland', 72.58, -38.46),
]


def build_profiles():
    """The engine reads its profile from <data_dir>/profiles.json, so the derived profile lives in a mirror of DATA
    (symlinks) instead of editing the vendored release.
      dry_barren_wide: dry_barren_terrain without the cell-footprint gate (60-65 deg, and as a fallback)."""
    PROFILES.mkdir(parents=True, exist_ok=True)
    for src in DATA.iterdir():
        dst = PROFILES / src.name
        if src.name != 'profiles.json' and not dst.exists():
            dst.symlink_to(src)
    doc = json.loads((DATA / 'profiles.json').read_text())
    doc['profiles']['dry_barren_wide'] = {**doc['profiles'][PROFILE], 'earth_target_area_ratio': NO_AREA_GATE}
    (PROFILES / 'profiles.json').write_text(json.dumps(doc))
    return doc['profiles']['terrain_screening']


try:
    sys.path.insert(0, str(REPO))
    import duckdb
    import numpy as np
    from processing.search import search, distances_km, normalized_fit, resolve_target
    from ml.serve import LearnedIndex, NPZ
    TERRAIN = build_profiles()  # the engine's plain terrain profile: features, weights, tolerances, minimum fit
    INDEX, MODEL_ERROR = LearnedIndex(NPZ), None
except Exception as e:  # missing venv, repo, LFS tables or index: the site still works, the API explains why not
    MODEL_ERROR = f'Model unavailable ({type(e).__name__}: {e}). Start with .venv/bin/python serve.py; see WORKLOG.md.'
_lock = threading.Lock()  # one request at a time: each search loads 100k+ Earth rows


def clean(v):
    """JSON-safe copy: NaN/inf -> null, NumPy scalars -> Python."""
    if isinstance(v, dict):
        return {k: clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [clean(x) for x in v]
    if hasattr(v, 'item') and not isinstance(v, (str, bytes)):
        v = v.item()
    return None if isinstance(v, float) and not math.isfinite(v) else v


def slim(c, analog=None):
    ctx = c['earth_environment_context']
    return {'feature_id': c['feature_id'], 'lat': c['lat'], 'lon': c['lon'], 'area_km2': c['area_km2'],
            'terrain_fit': c['observed_fit'], 'learned_similarity': c.get('learned_similarity'), 'analog': analog,
            'comparisons': [{k: x[k] for k in ('feature', 'target_value', 'earth_value', 'normalized_distance')} for x in c['comparisons']],
            'barren_fraction': ctx.get('landcover_barren_class_fraction'), 'aridity_index': ctx.get('aridity_index')}


_cold = None


def cold_cells():
    """Every terrain-eligible Earth cell poleward of 60 deg (about 600k rows), loaded once."""
    global _cold
    if _cold is None:
        cols = ['cell_id', 'lat', 'lon', 'area_km2', *TERRAIN['features'], 'landcover_barren_class_fraction', 'aridity_index']
        with duckdb.connect() as db:
            t = db.execute(f"SELECT {','.join(cols)} FROM read_parquet(?) WHERE eligible_terrain AND abs(lat) >= ? ORDER BY cell_id",
                           [str(DATA / 'earth_features.parquet'), WIDE_LAT]).fetchnumpy()
        _cold = {k: np.ma.filled(np.ma.asarray(v, dtype=float), np.nan) for k, v in t.items()}
        _cold['matrix'] = np.column_stack([_cold[f] for f in TERRAIN['features']])
    return _cold


def polar(body, lat, lon):
    """|lat| > 65: match against cold, high-latitude Earth terrain (both polar caps, no footprint gate), scored with
    the engine's own terrain fit. The named analog sites are always considered, each by its best cell within 100 km."""
    with duckdb.connect() as db:
        row, target = resolve_target(db, DATA, body, lat, lon)
    base = {'status': 'target_insufficient_evidence', 'dataset_version': '0.2.0', 'target': target}
    if not row['eligible_terrain']:
        return base, [], None, None
    E, feats = cold_cells(), list(TERRAIN['features'])
    weights = np.array([TERRAIN['features'][f]['weight'] for f in feats])
    tol = np.array([TERRAIN['features'][f]['tolerance'] for f in feats])
    t = np.array([row[f] for f in feats], dtype=float)
    scores, diffs = normalized_fit(E['matrix'], t, weights, tol)
    ok = scores >= TERRAIN['minimum_fit']
    apart = lambda i, chosen: all(distances_km(E['lat'][i], E['lon'][i], E['lat'][j], E['lon'][j]) >= TERRAIN['default_separation_km'] for j in chosen)
    best = []
    for i in np.lexsort((E['cell_id'], -scores)):  # best fit first, cell id breaks ties, 100 km thinning
        if not ok[i] or len(best) == 3:
            break
        if apart(i, best):
            best.append(int(i))
    named = []
    for name, alat, alon in ANALOGS:
        near = ok & (distances_km(alat, alon, E['lat'], E['lon']) <= 100)
        if near.any():
            i = int(np.argmax(np.where(near, scores, -np.inf)))
            if apart(i, best):
                named.append((i, name))
    named = sorted(named, key=lambda x: -scores[x[0]])[:2]
    picked = sorted([(i, None) for i in best] + named, key=lambda x: -scores[x[0]])
    cands = [{'feature_id': f"earth:{int(E['cell_id'][i])}", 'lat': E['lat'][i], 'lon': E['lon'][i], 'area_km2': E['area_km2'][i],
              'terrain_fit': scores[i], 'learned_similarity': None, 'analog': name,
              'comparisons': [{'feature': f, 'target_value': t[k], 'earth_value': E['matrix'][i, k], 'normalized_distance': diffs[i, k]} for k, f in enumerate(feats)],
              'barren_fraction': E['landcover_barren_class_fraction'][i], 'aridity_index': E['aridity_index'][i]} for i, name in picked]
    # shape similarity for display only, where both cells are in the S1 index (|lat| <= 80)
    sims = INDEX.similarity({'body': body, 'cell_id': row['cell_id']}, [int(E['cell_id'][i]) for i, _ in picked]) if picked else None
    for c, sim in zip(cands, sims if sims is not None else []):
        c['learned_similarity'] = sim
    base['status'] = 'ok' if cands else 'no_candidates_under_filters'
    return base, cands, len(scores), int(ok.sum())


def analog(body, lat, lon):
    """The Earth-twin matcher: metric patches, screening ladder, two-stage re-rank (matching/pipeline.py)."""
    from matching import pipeline
    pipeline._index = INDEX  # share the 150 MB index instead of loading it twice
    with _lock:
        return clean(pipeline.match(body, lat, lon))


def legacy_analog(body, lat, lon):
    """The previous matcher (session 8), kept for scripts/eval_matching.py's before/after comparison."""
    with _lock:
        if abs(lat) > POLAR_LAT:
            mode = 'polar'
            r, cands, screened, passed = polar(body, lat, lon)
            ranking, learned = 'physical_terrain_fit', None
        else:
            mode = 'wide' if abs(lat) > WIDE_LAT else 'standard'
            run = lambda profile: search(body, lat, lon, data_dir=PROFILES, profile=profile, limit=5, similarity=INDEX.similarity)
            r = run('dry_barren_wide' if mode == 'wide' else PROFILE)
            if mode == 'standard' and r['status'] == 'no_candidates_under_filters':
                mode, r = 'wide', run('dry_barren_wide')  # footprint gate left nothing: retry without it
            cands = [slim(c) for c in r['candidates']]
            screened, passed = r.get('eligible_after_area_filter'), r.get('above_minimum_fit')
            ranking, learned = r.get('ranking_method'), r.get('learned_status')
    t = r.get('target') or {}
    status = r['status'] if not cands or r['status'] != 'no_candidates_under_filters' else 'ok'
    return clean({
        'status': status, 'mode': mode, 'dataset_version': r['dataset_version'],
        'ranking_method': ranking, 'learned_status': learned,
        'model': INDEX.meta.get('model'), 'model_version': INDEX.meta.get('version'),
        'target': {k: t.get(k) for k in ('feature_id', 'cell_center', 'area_km2', 'core_terrain')},
        'screened': screened, 'passed': passed, 'candidates': cands,
    })


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def reply(self, code, obj):
        body = json.dumps(obj, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith(PRIVATE):
            return self.send_error(404)
        if url.path == '/sim' or url.path.startswith('/sim/'):  # client-side routes of the simulator
            self.path = '/sim.html'
            return super().do_GET()
        if url.path != '/api/analog':
            return super().do_GET()
        if MODEL_ERROR:
            return self.reply(503, {'error': MODEL_ERROR})
        q = urllib.parse.parse_qs(url.query)
        try:
            body, lat, lon = q['body'][0], float(q['lat'][0]), float(q['lon'][0])
            if body not in ('moon', 'mars') or not (-90 <= lat <= 90 and -540 <= lon <= 540):
                raise ValueError
        except (KeyError, ValueError):
            return self.reply(400, {'error': 'Expected body=moon|mars, lat in [-90,90], lon in [-540,540].'})
        try:
            self.reply(200, analog(body, lat, lon))
        except ValueError as e:  # engine-level input rejection
            self.reply(400, {'error': str(e)})
        except Exception as e:
            print('analog failed:', repr(e), file=sys.stderr)
            self.reply(500, {'error': 'The search engine failed unexpectedly.'})


if __name__ == '__main__':
    if '--check' in sys.argv:
        import time
        assert not MODEL_ERROR, MODEL_ERROR
        for body, lat, lon in (('mars', 18.41, 77.69), ('mars', 86.7, 171.2), ('mars', -85.0, 0.0), ('moon', -85.0, 0.0), ('moon', 89.5, 0.0)):
            t0 = time.time()
            r = analog(body, lat, lon)
            json.dumps(r, allow_nan=False)
            assert r['status'] == 'ok' and len(r['candidates']) == 5, (body, lat, r.get('status'), len(r.get('candidates', [])))
            assert all(0 <= c['terrain_fit'] <= 100 and 0 < c['percentile'] <= 100 for c in r['candidates'])
            print(f"ok {body} {lat},{lon} ({time.time() - t0:.1f}s, {r['relaxation']['name']}, query {r['query']['landform']}) ->",
                  '; '.join(f"{c['lat']:.1f},{c['lon']:.1f} {c['landform']} {c['confidence']}" for c in r['candidates']))
        sys.exit()
    print(MODEL_ERROR or f"Model ready: {INDEX.meta.get('model')}")
    port = int(os.environ.get('PORT', 8642))  # hosts like Render set PORT and need every interface
    print(f'Serving http://localhost:{port} (Ctrl+C to stop)')
    handler = functools.partial(Handler, directory=str(ROOT))
    http.server.ThreadingHTTPServer(('0.0.0.0' if 'PORT' in os.environ else '127.0.0.1', port), handler).serve_forever()
