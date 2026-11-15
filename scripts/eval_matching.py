"""Old vs new Earth-twin matching, side by side.
    .venv/bin/python scripts/eval_matching.py            # all sites
    .venv/bin/python scripts/eval_matching.py --quick    # skip the legacy column
Columns: OLD = previous matcher (serve.legacy_analog); PHASE 1 = new geometry and screens, model order only;
NEW = full two-stage pipeline. Asserts the acceptance criteria and exits non-zero if one fails."""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import numpy as np  # noqa: E402

import serve  # noqa: E402  (loads the S1 index once; legacy matcher)
from matching import pipeline as P  # noqa: E402
from matching.landform_features import KEYS, landform_class  # noqa: E402

P._index = serve.INDEX
SITES = [  # (label, body, lat, lon)
    ('Avernus Colles', 'mars', -1.78, 170.98),
    ('Amazonis Planitia', 'mars', 5.07, -172.17),
    ('Jezero crater', 'mars', 18.41, 77.69),
    ('Gale crater', 'mars', -5.40, 137.80),
    ('Hellas Planitia floor', 'mars', -42.40, 70.50),
    ('Olympia Cavi', 'mars', 86.70, 171.20),
    ('Mars south polar 85S', 'mars', -85.0, 0.0),
    ('Moon south pole 85S', 'moon', -85.0, 0.0),
    ('Moon 89.5N', 'moon', 89.5, 0.0),
]


def fmt(x):
    return ' n/a' if x is None else f'{x:.2f}'


def legacy_rows(body, lat, lon):
    r = serve.legacy_analog(body, lat, lon)
    if not r.get('candidates'):
        return f"ERROR: {r['status']}", []
    ids = [int(c['feature_id'].split(':')[1]) for c in r['candidates']]
    E = P.earth()
    pos = np.clip(np.searchsorted(E['cell_id'], ids), 0, len(E['cell_id']) - 1)
    descs = P.earth_descriptors(ids, E['lat'][pos], E['lon'][pos])
    rows = [f"{c['lat']:6.1f},{c['lon']:7.1f} fit {c['terrain_fit']:3.0f} shape {fmt(c.get('learned_similarity'))} "
            f"{landform_class(dict(zip(KEYS, d))) if d is not None else 'no-data'}" for c, d in zip(r['candidates'], descs)]
    return r['status'], rows


def new_rows(r):
    return [f"{c['lat']:6.1f},{c['lon']:7.1f} fit {c['terrain_fit']:3.0f} shape {fmt(c['learned_similarity'])} {c['landform']:16s} "
            f"top {c['percentile']:5.2f}% {c['confidence']:6s}{' near ' + c['near_analog'] if c['near_analog'] else ''}" for c in r['candidates']]


if __name__ == '__main__':
    quick, failures = '--quick' in sys.argv, []
    for label, body, lat, lon in SITES:
        print(f"\n=== {label} ({body} {lat}, {lon}) " + '=' * 40)
        if not quick:
            status, old = legacy_rows(body, lat, lon)
            print(f'OLD     ({status})')
            for k, row in enumerate(old, 1):
                print(f'  {k}. {row}')
        if label == 'Amazonis Planitia':
            p1 = P.match(body, lat, lon, legacy_order=True)
            print(f"PHASE 1 ({p1['status']}, query {p1['query']['landform']}, {p1['relaxation']['name']})")
            for k, row in enumerate(new_rows(p1), 1):
                print(f'  {k}. {row}')
        t0 = time.perf_counter()
        r = P.match(body, lat, lon)
        wall = time.perf_counter() - t0
        stage2 = sum(v['stage2_s'] for k, v in r.get('timing_s', {}).items() if k.startswith('step'))
        rel = r.get('relaxation', {})
        print(f"NEW     ({r['status']}, query {r.get('query', {}).get('landform')}, {rel.get('name')}"
              f"{' [RELAXED]' if rel.get('relaxed') else ''}; stage 2 {stage2:.2f}s, total {wall:.1f}s)")
        for k, row in enumerate(new_rows(r) if r['status'] == 'ok' else [r.get('error', r['status'])], 1):
            print(f'  {k}. {row}')
        if r['status'] != 'ok' or len(r['candidates']) != 5:
            failures.append(f"{label}: expected 5 matches, got {r['status']} / {len(r.get('candidates', []))}")
        if label == 'Avernus Colles' and r.get('candidates') and r['candidates'][0]['landform'] == 'dunes/linear':
            failures.append('Avernus Colles: #1 is a dunes/linear cell')
        if stage2 > 2.0:
            failures.append(f'{label}: stage 2 took {stage2:.2f}s (> 2 s)')
    P.flush_desc()
    print('\n' + ('ALL CRITERIA MET' if not failures else 'FAILED:\n  ' + '\n  '.join(failures)))
    sys.exit(1 if failures else 0)
