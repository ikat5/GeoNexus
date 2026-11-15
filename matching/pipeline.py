"""Earth-twin matching: metric patches -> screen (with a relaxation ladder) -> stage 1 (S1 shape order, top 200)
-> stage 2 (landform re-rank + diversity). Every number lives in matching/config.py."""
import json
import math
import sys
import threading
import time
from pathlib import Path

import numpy as np

from .config import CONFIG
from .landform_features import KEYS, describe, landform_class
from concurrent.futures import ThreadPoolExecutor

from .patches import CACHE, PX_M, cut_patch

_outer = ThreadPoolExecutor(16)  # per-patch jobs; tile fetches run on patches._pool (one shared pool deadlocks)

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT / 'vendor' / 'mars_moon_earth_dataset'
DATA = REPO / 'prepared' / '0.2.0'
sys.path.insert(0, str(REPO))
from processing.search import distances_km, normalized_fit, resolve_target  # noqa: E402  (the engine's own scoring)

FEATS = ('slope_median_deg', 'slope_p90_deg', 'relief_m', 'roughness_rms_m')
LABELS = {'slope_median_deg': ('Median slope', '°'), 'slope_p90_deg': ('Steep slope (90th pct)', '°'),
          'relief_m': ('Relief (high − low)', ' m'), 'roughness_rms_m': ('Roughness (RMS)', ' m')}
STEPS = ('normal screen', 'cold-desert branch', 'relaxed thresholds (x1.5)', 'terrain only (no climate screen)')
_lock = threading.Lock()
_E = _profile = _index = None


# ------------------------------------------------------------------ data loaded once
def earth():
    """Every terrain-eligible Earth cell with the columns the screens need, as numpy arrays (about 1.3M rows)."""
    global _E, _profile
    with _lock:
        if _E is None:
            import duckdb
            cols = ['cell_id', 'lat', 'lon', 'elev_mean_m', *FEATS, 'eligible_dry_barren', 'landcover_strict_area_coverage',
                    'landcover_snow_ice_class_fraction', 'landcover_barren_class_fraction', 'landcover_grass_class_fraction',
                    'landcover_shrub_class_fraction', 'landcover_forest_class_fraction', 'landcover_water_class_fraction',
                    'aridity_index', 'tsurf_mean_k']
            with duckdb.connect() as db:
                t = db.execute(f"SELECT {','.join(cols)} FROM read_parquet(?) WHERE eligible_terrain ORDER BY cell_id",
                               [str(DATA / 'earth_features.parquet')]).fetchnumpy()
            E = {k: np.ma.filled(np.ma.asarray(v, dtype=float), np.nan) for k, v in t.items()}
            E['cell_id'] = E['cell_id'].astype(np.int64)
            E['eligible_dry_barren'] = E['eligible_dry_barren'] == 1
            E['matrix'] = np.column_stack([E[f] for f in FEATS])
            _profile = json.loads((DATA / 'profiles.json').read_text())['profiles']['dry_barren_terrain']
            _E = E
    return _E


def index():
    global _index
    if _index is None:
        from ml.serve import LearnedIndex, NPZ
        _index = LearnedIndex(NPZ)
    return _index


# ------------------------------------------------------------------ descriptor cache (Earth cells are reused)
_desc = {}       # cell_id -> np.array(len(KEYS)) or None (no valid patch)
_desc_new = {}   # computed since the last flush
DESC_FILE = CACHE / 'earth_descriptors.npz'


def _load_desc():
    if not _desc and DESC_FILE.exists():
        z = np.load(DESC_FILE)
        for i, row, ok in zip(z['cell_id'], z['desc'], z['ok']):
            _desc[int(i)] = row if ok else None


def flush_desc():
    """Rewrite the on-disk cache when new descriptors were computed."""
    if not _desc_new:
        return
    ids = np.array(sorted(_desc), np.int64)
    rows = np.array([_desc[i] if _desc[i] is not None else np.full(len(KEYS), np.nan) for i in ids])
    ok = np.array([_desc[i] is not None for i in ids])
    DESC_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = DESC_FILE.with_name('earth_descriptors.tmp.npz')
    np.savez(tmp, cell_id=ids, desc=rows, ok=ok)
    tmp.replace(DESC_FILE)
    _desc_new.clear()


def earth_descriptors(ids, lats, lons):
    """Descriptor vectors for Earth cells, computing the missing ones in parallel (patches cut on the cell centre)."""
    _load_desc()
    todo = [k for k, i in enumerate(ids) if int(i) not in _desc]

    def one(k):
        z = cut_patch('earth', float(lats[k]), float(lons[k]))
        return None if z is None else np.array([describe(z, PX_M)[key] for key in KEYS])
    for k, d in zip(todo, _outer.map(one, todo)):
        _desc[int(ids[k])] = _desc_new[int(ids[k])] = d
    return [_desc[int(i)] for i in ids]


# ------------------------------------------------------------------ screens and the ladder
def _cold(E, t, f=1.0):
    """Cold-desert branch: ice-free, sparsely vegetated land that is high-latitude or high-altitude, and dry or frozen.
    f > 1 loosens every threshold by that factor (ladder step 3)."""
    sparse = np.nansum([E['landcover_barren_class_fraction'], E['landcover_grass_class_fraction'], E['landcover_shrub_class_fraction']], axis=0)
    snow, forest, water = (np.nan_to_num(E[k]) for k in ('landcover_snow_ice_class_fraction', 'landcover_forest_class_fraction', 'landcover_water_class_fraction'))
    where = (np.abs(E['lat']) >= t['min_abs_lat'] / f) | (E['elev_mean_m'] >= t['min_elevation_m'] / f)
    land = (np.nan_to_num(E['landcover_strict_area_coverage']) >= t['min_landcover_coverage'] / f) & (snow <= t['max_snow_ice_fraction'] * f) \
        & (sparse >= t['min_sparse_fraction'] / f) & (forest <= t['max_forest_fraction'] * f) & (water <= t['max_water_fraction'] * f)
    dry_or_frozen = (E['tsurf_mean_k'] <= t['max_mean_surface_temp_k'] + 10 * (f - 1)) | (E['aridity_index'] < 0.2 * f)
    return where & land & dry_or_frozen


def _ice(lat, snow):
    """Ice surfaces: ice-dominated land cover, or Antarctica (south of 60 S the dataset has no land cover)."""
    return (np.nan_to_num(snow) >= CONFIG['landform']['icy_min_snow_ice_fraction']) | (lat < -60)


def ladder(E, polar):
    """[(step index, Earth mask, tolerance factor)] in the order they are tried. Polar queries start at the cold-desert branch."""
    c, f = CONFIG['cold_desert'], CONFIG['relax_factor']
    ice = _ice(E['lat'], E['landcover_snow_ice_class_fraction'])
    allowed_ice = ice if CONFIG['allow_ice_surfaces'] else np.zeros(len(ice), bool)
    normal = E['eligible_dry_barren'] | allowed_ice
    cold = normal | _cold(E, c)
    relaxed = cold | _cold(E, c, f) | ((E['aridity_index'] < 0.2 * f) & (np.nan_to_num(E['landcover_barren_class_fraction']) >= 0.5 / f) & ~ice)
    terrain = np.ones(len(ice), bool) if CONFIG['allow_ice_surfaces'] else ~ice
    steps = [(0, normal, 1.0), (1, cold, 1.0), (2, relaxed, f), (3, terrain, f)]
    return steps[1:] if polar else steps


# ------------------------------------------------------------------ scoring pieces
def _rough_dist(q, e):
    """Mean |ln ratio| of the roughness scales, scaled so a factor-of-10 difference is 1."""
    return min(1.0, float(np.mean([abs(math.log((a + 1) / (b + 1))) for a, b in zip(q, e)])) / math.log(10))


def _pit_gap(q, e):
    return abs(q - e) / max(q, e, 0.005)


def _vec(d):
    """Descriptor vector used for the near-duplicate (cosine) check."""
    return np.array([d[4], d[6], d[7], math.log1p(d[13]), math.log1p(d[14]), math.log1p(d[15]), d[0], d[1], math.log1p(d[2])])


def _cmp(feature, label, unit, q, e, m):
    return {'feature': feature, 'label': label, 'unit': unit, 'target_value': float(q), 'earth_value': float(e), 'match': float(np.clip(m, 0, 1))}


def match(body, lat, lon, legacy_order=False):
    """Up to 5 Earth twins for a Moon/Mars coordinate. legacy_order=True skips stage 2 (the "Phase 1 only" column
    of scripts/eval_matching.py): screens and metric features are new, the order is the model's."""
    t0 = time.perf_counter()
    E = earth()
    lat, lon = float(lat), float((lon + 180) % 360 - 180)
    qz = cut_patch(body, lat, lon)
    if qz is None:
        return {'status': 'no_elevation_data', 'error': f'No valid {body} elevation data at {lat:.3f}, {lon:.3f}.'}
    qd = describe(qz, PX_M)
    polar = abs(lat) > CONFIG['polar_query_lat']
    icy_query = body == 'mars' and abs(lat) >= CONFIG['landform']['icy_query_min_abs_lat']
    qclass = landform_class(qd, ice=icy_query)
    q4 = np.array([qd[f] for f in FEATS])
    w_prof = np.array([_profile['features'][f]['weight'] for f in FEATS])
    tol0 = np.array([_profile['features'][f]['tolerance'] for f in FEATS])
    import duckdb
    with duckdb.connect() as db:
        row, target = resolve_target(db, DATA, body, lat, lon)
    shape_all = index().similarity({'body': body, 'cell_id': row['cell_id']}, E['cell_id'])  # None: query outside the index (|lat| > 80)
    shape = np.asarray(shape_all, float) if shape_all is not None else np.full(len(E['lat']), np.nan)
    W = CONFIG['weights']
    timings, tried, chosen = {}, [], []
    for step, mask, f in ladder(E, polar):
        tried.append(step)
        ts = time.perf_counter()
        fit = np.full(len(mask), -np.inf)
        fit[mask], _ = normalized_fit(E['matrix'][mask], q4, w_prof, tol0 * f)  # query: metric patch; Earth: dataset cells
        ok = mask & (fit >= _profile['minimum_fit'])
        n_screened, n_passed = int(mask.sum()), int(ok.sum())
        if n_passed == 0:
            continue
        # stage 1: the model's order (S1 shape similarity; cells outside the index follow, by fit)
        key = np.where(ok, np.where(np.isfinite(shape), 2.0 + shape, fit / 100.0), -np.inf)
        order = np.argsort(-key, kind='stable')[:n_passed]
        rank = np.empty(len(key), np.int64)
        rank[order] = np.arange(1, n_passed + 1)
        pick = []
        for i in order:  # top-k with 50 km thinning, so stage 2 sees more than one dune field
            if len(pick) == CONFIG['stage1_top_k']:
                break
            if not pick or np.min(distances_km(E['lat'][i], E['lon'][i], E['lat'][pick], E['lon'][pick])) >= 50:
                pick.append(int(i))
        t1 = time.perf_counter()
        # stage 2: landform descriptors on metric patches, re-rank, rules, diversity
        descs = earth_descriptors(E['cell_id'][pick], E['lat'][pick], E['lon'][pick])
        cands = []
        for i, d in zip(pick, descs):
            if d is None:  # the Earth patch is more than 5% no-data (coast, missing tile): fails the coverage check
                continue
            ed = dict(zip(KEYS, d))
            mfit, mdist = normalized_fit(np.array([[ed[k] for k in FEATS]]), q4, w_prof, tol0 * f)
            ecls = landform_class(ed, ice=bool(_ice(E['lat'][i], E['landcover_snow_ice_class_fraction'][i])))
            s = float(shape[i]) if np.isfinite(shape[i]) else None
            d_an, d_pit = abs(qd['anisotropy'] - ed['anisotropy']), _pit_gap(qd['pit_density'], ed['pit_density'])
            d_rough = _rough_dist([qd['rough_1'], qd['rough_4'], qd['rough_16']], [ed['rough_1'], ed['rough_4'], ed['rough_16']])
            final = W['shape'] * (s if s is not None else mfit[0] / 100) + W['fit'] * mfit[0] / 100 - W['aniso'] * d_an \
                - W['pit'] * d_pit - W['rough'] * d_rough - W['class'] * (qclass != ecls)
            same = qclass == ecls
            cands.append({
                'feature_id': f"earth:{int(E['cell_id'][i])}", 'lat': float(E['lat'][i]), 'lon': float(E['lon'][i]),
                'terrain_fit': float(mfit[0]), 'dataset_fit': float(fit[i]), 'learned_similarity': s, 'final_score': float(final),
                'stage1_rank': int(rank[i]), 'percentile': 100.0 * rank[i] / n_passed,
                'landform': ecls, 'orientation_deg': float(ed['orientation_deg']),
                'confidence': 'high' if same and d_an < CONFIG['confidence_max_delta_anisotropy'] else 'medium' if same else 'low',
                'near_analog': next((n for n, a, b in CONFIG['reference_analogs']
                                     if distances_km(a, b, E['lat'][i], E['lon'][i]) <= CONFIG['reference_analog_radius_km']), None),
                'comparisons': [_cmp(k, *LABELS[k], qd[k], ed[k], 1 - mdist[0][j]) for j, k in enumerate(FEATS)] + [
                    _cmp('anisotropy', 'Anisotropy (0 round – 1 linear)', '', qd['anisotropy'], ed['anisotropy'], 1 - d_an),
                    _cmp('pit_density', 'Pit density (crater proxy)', ' /km²', qd['pit_density'], ed['pit_density'], 1 - d_pit)] + [
                    _cmp(f'rough_{w}', f'Roughness at {w * PX_M / 1000:g} km', ' m', qd[f'rough_{w}'], ed[f'rough_{w}'],
                         1 - _rough_dist([qd[f'rough_{w}']], [ed[f'rough_{w}']])) for w in (1, 4, 16)],
                'barren_fraction': E['landcover_barren_class_fraction'][i], 'aridity_index': E['aridity_index'][i],
                '_vec': _vec(d)})
        if legacy_order:
            cands.sort(key=lambda c: c['stage1_rank'])
        else:
            cands.sort(key=lambda c: -c['final_score'])
            if CONFIG['drop_dunes_for_rough_queries'] and qclass in ('cratered', 'knobby/fractured'):
                keep = [c for c in cands if c['landform'] != 'dunes/linear']
                cands = keep if len(keep) >= CONFIG['min_results'] else cands
        chosen = _diverse(cands)
        timings[f'step{step + 1}'] = {'stage1_s': round(t1 - ts, 3), 'stage2_s': round(time.perf_counter() - t1, 3)}
        if len(chosen) >= CONFIG['min_results']:
            break
    flush_desc()
    for c in chosen:
        c.pop('_vec', None)
    step = tried[-1]
    return {
        'status': 'ok' if chosen else 'no_candidates_under_filters', 'mode': 'polar' if polar else 'standard',
        'relaxation': {'step': step + 1, 'name': STEPS[step], 'tried': [STEPS[s] for s in tried], 'relaxed': step > (1 if polar else 0)},
        'query': {'landform': qclass, 'descriptors': {k: float(qd[k]) for k in KEYS}, 'patch_km': CONFIG['patch_size_px'] * PX_M / 1000,
                  'px_m': PX_M, 'indexed': shape_all is not None, 'temperature_mode': 'relative' if polar else 'absolute'},
        'target': {'feature_id': target['feature_id'], 'cell_center': target['cell_center'], 'area_km2': target['area_km2'],
                   'core_terrain': {k: float(qd[k]) for k in FEATS}},
        'screened': n_screened if tried else 0, 'passed': n_passed if tried else 0, 'candidates': chosen,
        'ranking_method': 'stage1_only' if legacy_order else 'two_stage', 'learned_status': 'used' if shape_all is not None else None,
        'timing_s': {'total': round(time.perf_counter() - t0, 3), **timings},
    }


def _diverse(cands):
    """Greedy pick of up to min_results that are >= diversity_km apart and not near-identical in descriptor space;
    tops up with the next best (>= 100 km apart) when too few qualify."""
    n, out = CONFIG['min_results'], []
    if not cands:
        return out
    V = np.array([c['_vec'] for c in cands])
    V = (V - V.mean(0)) / (V.std(0) + 1e-9)
    unit = V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)
    for limit_km, check_cos in ((CONFIG['diversity_km'], True), (100.0, False)):
        for k, c in enumerate(cands):
            if len(out) == n:
                break
            if any(c is o for o, _ in out):
                continue
            if all(distances_km(c['lat'], c['lon'], o['lat'], o['lon']) >= limit_km for o, _ in out) and \
                    (not check_cos or all(unit[k] @ unit[j] <= CONFIG['diversity_max_cosine'] for _, j in out)):
                out.append((c, k))
    return [c for c, _ in out]
