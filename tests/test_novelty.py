"""python3 tests/test_novelty.py — known / near_known / new boundaries, clustering and the discovery score."""
import math, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from matching.novelty import classify, cluster, discovery_score, gc_km  # noqa: E402

SITES = [{'id': 'a', 'name': 'A', 'lat': 0.0, 'lon': 0.0, 'radius_km': 50.0}, {'id': 'b', 'name': 'B', 'lat': 0.0, 'lon': 90.0, 'radius_km': 400.0}]
km = lambda d: d / 111.195  # degrees of latitude for d km

assert abs(gc_km(0, 0, 0, 1) - 111.195) < 0.01
assert classify(km(49), 0, SITES)[0] == 'known'
assert classify(km(51), 0, SITES)[0] == 'near_known'            # 50 < d <= 50 + 50
assert classify(km(101), 0, SITES)[0] == 'new'
assert classify(km(399), 90, SITES)[0] == 'known'
assert classify(km(549), 90, SITES)[0] == 'near_known'          # big site: the extra margin is capped at 150 km
assert classify(km(551), 90, SITES)[0] == 'new'
cls, site, d = classify(km(300), 0, SITES)
assert site['id'] == 'a' and abs(d - 300) < 0.5
assert classify(10, 10, [])[0] == 'new'                         # no known list: everything is a candidate

pts = [{'lat': 0, 'lon': 0, 'score': 0.9}, {'lat': km(30), 'lon': 0, 'score': 0.5}, {'lat': km(200), 'lon': 0, 'score': 0.8}]
cs = cluster(pts)
assert len(cs) == 2 and len(cs[0]['members']) == 2 and abs(cs[0]['lat'] - km(15)) < 1e-9  # running centroid

assert discovery_score(0.8, 'high', 1) == 0.8 * math.log(2)
assert discovery_score(0.8, 'low', 3) < discovery_score(0.8, 'high', 3)
assert discovery_score(0.8, 'high', 6) > discovery_score(0.8, 'high', 2)
print('test_novelty ok')
