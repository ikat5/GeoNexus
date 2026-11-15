"""Novelty of an Earth site against the curated known analog sites (data/known_analogs.json, the single source of truth).
Used by scripts/build_discoveries.py (batch) and serve.py (live /api/analog badges).
  known       inside a known site's radius_km: the model rediscovered an analog already in use
  near_known  within radius_km + min(radius_km, 150) of one
  new         farther than that: a candidate analog site, not a confirmed one"""
import json, math
from pathlib import Path

KNOWN_FILE = Path(__file__).resolve().parent.parent / 'data' / 'known_analogs.json'
CONF_WEIGHT = {'high': 1.0, 'medium': 0.7, 'low': 0.4}
CLUSTER_KM = 50.0


def known_sites():
    return json.loads(KNOWN_FILE.read_text())['sites'] if KNOWN_FILE.exists() else []


def gc_km(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    c = math.sin(p1) * math.sin(p2) + math.cos(p1) * math.cos(p2) * math.cos(dl)
    return 6371.0 * math.acos(max(-1.0, min(1.0, c)))


def classify(lat, lon, sites=None):
    """-> (class, nearest site dict or None, distance km). Distance is to the site's centre."""
    sites = known_sites() if sites is None else sites
    if not sites:
        return 'new', None, None
    s, d = min(((s, gc_km(lat, lon, s['lat'], s['lon'])) for s in sites), key=lambda x: x[1])
    r = s.get('radius_km', 50.0)
    cls = 'known' if d <= r else 'near_known' if d <= r + min(r, 150.0) else 'new'
    return cls, s, d


def discovery_score(best_score, confidence, twin_count):
    """best final_score x confidence weight x log(1 + number of Mars/Moon sites it twins). Novelty is NOT in here."""
    return float(best_score) * CONF_WEIGHT.get(confidence, 0.4) * math.log1p(twin_count)


def cluster(points, km=CLUSTER_KM):
    """Greedy, order-stable: points sorted by score (desc) seed clusters; a point joins the first cluster whose running
    centroid is within km. points: dicts with lat, lon, score. Returns lists of points."""
    out = []
    for p in sorted(points, key=lambda p: -p['score']):
        for c in out:
            if gc_km(p['lat'], p['lon'], c['lat'], c['lon']) <= km:
                c['members'].append(p)
                n = len(c['members'])
                c['lat'] += (p['lat'] - c['lat']) / n
                c['lon'] += (p['lon'] - c['lon']) / n
                break
        else:
            out.append({'lat': p['lat'], 'lon': p['lon'], 'members': [p]})
    return out
