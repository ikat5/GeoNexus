"""Discovery Atlas batch: run the real TerraTwin matcher on ~300 Mars/Moon query sites, classify every Earth candidate
against data/known_analogs.json, cluster them into Earth places and write data/discoveries.json (static, committed).
  .venv/bin/python scripts/build_discoveries.py            match (resumable cache in .cache/discoveries/), then build
  .venv/bin/python scripts/build_discoveries.py --build    rebuild the JSON from the cache only (no model)"""
import json, math, random, sys, time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from matching import novelty  # noqa: E402

CACHE = ROOT / '.cache' / 'discoveries'
DATA = ROOT / 'data'
GROUPS = {  # IAU feature types sampled per latitude band
    'crater': {'Crater'}, 'mons': {'Mons', 'Tholus', 'Patera'}, 'valley': {'Vallis', 'Rima', 'Fossa', 'Catena', 'Chasma', 'Labyrinthus'},
    'plain': {'Planitia', 'Planum', 'Mare', 'Vastitas', 'Lacus', 'Palus', 'Sinus', 'Terra'}, 'ridge': {'Dorsum', 'Rupes', 'Scopulus', 'Sulcus'},
    'chaos': {'Chaos', 'Mensa', 'Collis', 'Cavus', 'Unda', 'Fluctus'},
}


def queries():
    """Deterministic query set (seed 42): eval sites, every landing site, then a stratified IAU sample."""
    f = DATA / 'discovery_queries.json'
    if f.exists():
        return json.loads(f.read_text())
    rng, out = random.Random(42), []
    from eval_matching import SITES  # noqa: E402  (label, body, lat, lon)
    out += [{'name': n, 'body': b, 'lat': la, 'lon': lo, 'type': 'eval'} for n, b, la, lo in SITES]
    for body, per in (('mars', 4), ('moon', 3)):
        feats = json.loads((DATA / f'labels_{body}.json').read_text())
        out += [{'name': n, 'body': body, 'lat': la, 'lon': lo, 'type': t} for n, la, lo, d, t in feats if t == 'Landing site']
        for g, types in GROUPS.items():
            for band in range(-90, 90, 30):
                pool = [x for x in feats if x[4] in types and band <= x[1] < band + 30 and (g != 'crater' or x[3] >= 20)]
                for n, la, lo, d, t in rng.sample(pool, min(per, len(pool))):
                    out.append({'name': n, 'body': body, 'lat': la, 'lon': lo, 'type': t})
    seen, uniq = set(), []
    for q in out:
        k = (q['body'], round(q['lat'], 2), round(q['lon'], 2))
        if k not in seen:
            seen.add(k); uniq.append(q)
    f.write_text(json.dumps(uniq, indent=0))
    return uniq


def run_matches(qs):
    import serve  # noqa: E402  loads the TerraTwin index exactly as the server does
    CACHE.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for i, q in enumerate(qs):
        f = CACHE / f"{q['body']}_{q['lat']:.3f}_{q['lon']:.3f}.json"
        if not f.exists():
            try:
                r = serve.analog(q['body'], q['lat'], q['lon'])
            except Exception as e:  # one failed site must not stop the batch
                r = {'status': 'error', 'error': repr(e), 'candidates': []}
            f.write_text(json.dumps(r))
        done = i + 1
        print(f"\r[{'#' * (30 * done // len(qs)):<30}] {done}/{len(qs)} {time.time() - t0:7.0f}s {q['name'][:30]:<30}", end='', flush=True)
    print()
    return time.time() - t0


def baseline(n, sites, rng):
    """Share of n random terrain-eligible Earth cells that fall on a known site (the 'random guess' comparison)."""
    from matching import pipeline as P  # noqa: E402
    E = P.earth()
    idx = rng.sample(range(len(E['lat'])), n)
    return sum(novelty.classify(float(E['lat'][i]), float(E['lon'][i]), sites)[0] == 'known' for i in idx) / max(1, n)


def build(qs, runtime):
    sites, pts, used = novelty.known_sites(), [], 0
    for q in qs:
        f = CACHE / f"{q['body']}_{q['lat']:.3f}_{q['lon']:.3f}.json"
        if not f.exists():
            continue
        r = json.loads(f.read_text())
        if r.get('status') != 'ok':
            continue
        used += 1
        for rank, c in enumerate(r['candidates']):
            cmp_ = sorted(c['comparisons'], key=lambda x: -x['match'])[:3]
            pts.append({'lat': c['lat'], 'lon': c['lon'], 'score': c['final_score'], 'conf': c['confidence'], 'landform': c['landform'],
                        'barren': c.get('barren_fraction'), 'arid': c.get('aridity_index'), 'rank': rank + 1,
                        'twin': {'name': q['name'], 'body': q['body'], 'lat': q['lat'], 'lon': q['lon'], 'query_landform': r['query']['landform'],
                                 'final_score': round(c['final_score'], 3), 'terrain_fit': round(c['terrain_fit'], 1), 'confidence': c['confidence'],
                                 'landform': c['landform'], 'top': [{'label': x['label'], 'match': round(x['match'], 2)} for x in cmp_]}})
    clusters = []
    for k, c in enumerate(novelty.cluster(pts)):
        m = c['members']
        twins = {}
        for p in m:  # one entry per query site (its best candidate in this place)
            key = (p['twin']['body'], p['twin']['lat'], p['twin']['lon'])
            if key not in twins or p['score'] > twins[key]['final_score']:
                twins[key] = p['twin']
        tw = sorted(twins.values(), key=lambda t: -t['final_score'])
        best = max(m, key=lambda p: p['score'])
        cls, near, d = novelty.classify(c['lat'], c['lon'], sites)
        lf = max(set(p['landform'] for p in m), key=[p['landform'] for p in m].count)
        bodies = sorted(set(t['body'] for t in tw))
        clusters.append({
            'id': f'c{k:03d}', 'lat': round(c['lat'], 3), 'lon': round(c['lon'], 3), 'name': None, 'country': None,
            'class': cls, 'nearest_known': near and {'id': near['id'], 'name': near['name'], 'distance_km': round(d)},
            'twin_count': len(tw), 'best_score': round(best['score'], 3), 'mean_score': round(sum(p['score'] for p in m) / len(m), 3),
            'confidence': best['conf'], 'bodies': bodies[0] if len(bodies) == 1 else 'both', 'dominant_landform': lf,
            'barren_fraction': best['barren'], 'aridity_index': best['arid'],
            'discovery_score': round(novelty.discovery_score(best['score'], best['conf'], len(tw)), 3), 'twins': tw[:40]})
    clusters.sort(key=lambda c: -c['discovery_score'])
    pub = json.loads((DATA / 'published_elsewhere.json').read_text())['sites'] if (DATA / 'published_elsewhere.json').exists() else []
    for c in clusters:  # the honesty check: a "new" place already used in the analog literature is not new
        hit = next((x for x in pub if novelty.gc_km(c['lat'], c['lon'], x['lat'], x['lon']) < 30), None)
        if hit and c['class'] == 'new':
            c['class'], c['citation'] = 'published_elsewhere', {'title': hit['title'], 'url': hit['url']}
    # validation: recall of known sites, and how often high-confidence candidates land on one vs random eligible cells
    hits = {c['nearest_known']['id'] for c in clusters if c['class'] == 'known'}
    high = [p for p in pts if p['conf'] == 'high']
    share = sum(novelty.classify(p['lat'], p['lon'], sites)[0] == 'known' for p in high) / max(1, len(high))
    base = baseline(max(200, len(high)), sites, random.Random(7))
    old = json.loads((DATA / 'discoveries.json').read_text()) if (DATA / 'discoveries.json').exists() else {}
    for c in clusters:  # keep names already looked up for an unchanged cluster position
        n = next((v for o in old.get('clusters', []) if abs(o['lat'] - c['lat']) < 0.05 and abs(o['lon'] - c['lon']) < 0.05 for v in [(o.get('name'), o.get('country'))]), None)
        if n:
            c['name'], c['country'] = n
    from geo import place  # noqa: E402
    names_f = CACHE / 'names.json'  # Nominatim answers cached by position, so a rerun never asks twice
    names = json.loads(names_f.read_text()) if names_f.exists() else {}
    # shortcut: only the top 150 places and every known-site match get a name (1 request/s); the rest show coordinates
    for k, c in enumerate(clusters):
        key = f"{c['lat']:.2f},{c['lon']:.2f}"
        if key not in names and (k < 150 or c['class'] != 'new'):
            names[key] = place(c['lat'], c['lon'])
            names_f.write_text(json.dumps(names))
        n = names.get(key)
        c['name'], c['country'] = (n.rsplit(', ', 1) + [None])[:2] if n else (None, None)
    out = {'version': '1', 'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'dataset_version': '0.2.0',
           'model_version': 'S1 (ml-0.3.0)', 'n_queries': used, 'runtime_s': round(runtime), 'cluster_km': novelty.CLUSTER_KM,
           'score_formula': 'best final_score x confidence weight (high 1, medium 0.7, low 0.4) x ln(1 + twin_count)',
           'validation': {'known_sites': len(sites), 'known_sites_rediscovered': len(hits), 'recall': round(len(hits) / max(1, len(sites)), 3),
                          'high_conf_candidates': len(high), 'high_conf_on_known_share': round(share, 4), 'random_cell_on_known_share': round(base, 4)},
           'rejected': old.get('rejected', []), 'clusters': clusters}
    (DATA / 'discoveries.json').write_text(json.dumps(out, separators=(',', ':')))
    new = [c for c in clusters if c['class'] == 'new' and c['id'] not in {r['id'] for r in out['rejected']}]
    summary = {'n_new': len(new), 'n_clusters': len(clusters), 'validation': out['validation'], 'n_queries': used,
               'top': [{'id': c['id'], 'name': c['name'] or f"{c['lat']:.2f}, {c['lon']:.2f}", 'country': c['country'], 'twin_count': c['twin_count'],
                        'landform': c['dominant_landform'], 'distance_km': c['nearest_known'] and c['nearest_known']['distance_km'],
                        'bodies': c['bodies'], 'score': c['discovery_score']} for c in new[:12]]}
    (DATA / 'discoveries_summary.json').write_text(json.dumps(summary, separators=(',', ':')))  # landing teaser + console palette
    by = {}
    for c in clusters:
        by[c['class']] = by.get(c['class'], 0) + 1
    print(f"{used} queries, {len(pts)} candidates, {len(clusters)} clusters {by}; recall {len(hits)}/{len(sites)}; high-conf on known {share:.1%} vs random {base:.1%}")


if __name__ == '__main__':
    sys.path.insert(0, str(ROOT / 'scripts'))
    qs = queries()
    print(len(qs), 'queries')
    rt = 0 if '--build' in sys.argv else run_matches(qs)
    if '--match' not in sys.argv:
        build(qs, rt)
