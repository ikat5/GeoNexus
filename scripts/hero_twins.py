"""Precompute the landing page's "preview" twins: the real matcher's #1 Earth match for a set of named Mars sites.
The landing page snaps a click to the nearest of these sites (labelled "preview"); the full model runs in /sim.
  .venv/bin/python scripts/hero_twins.py           -> data/hero_twins.json   (Earth names from OpenStreetMap Nominatim)
  .venv/bin/python scripts/hero_twins.py --names   re-runs only the Nominatim naming on the existing file"""
import json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'scripts'))
from geo import place  # noqa: E402

SITES = [  # USGS Gazetteer names and centres (data/labels_mars.json); rover sites use their landing coordinates
    ('Gale Crater', -4.59, 137.44), ('Jezero Crater', 18.41, 77.69), ('Olympus Mons', 18.65, -133.80),
    ('Hellas Planitia', -42.43, 70.50), ('Utopia Planitia', 46.74, 117.52), ('Valles Marineris', -14.01, -58.59),
    ('Meridiani Planum', -1.95, -5.53), ('Arabia Terra', 21.25, 5.72), ('Acidalia Planitia', 49.76, -20.74),
    ('Argyre Planitia', -49.84, -43.31), ('Arsia Mons', -8.26, -120.09), ('Chryse Planitia', 22.27, -47.95),
    ('Syrtis Major Planum', 9.20, 67.10), ('Terra Cimmeria', -32.68, 147.75), ('Amazonis Planitia', 25.75, -162.91),
    ('Isidis Planitia', 13.94, 88.38), ('Noctis Labyrinthus', -6.36, -101.19), ('Avernus Colles', -1.73, 171.02),
    ('Phoenix landing site', 68.22, -125.75), ('Planum Boreum', 87.32, 54.96),
]


if '--names' in sys.argv:
    out = json.loads((ROOT / 'data' / 'hero_twins.json').read_text())
    for site in out:
        site['twin']['name'] = place(site['twin']['lat'], site['twin']['lon'])
        print(site['name'], '->', site['twin']['name'], flush=True)
    (ROOT / 'data' / 'hero_twins.json').write_text(json.dumps(out, indent=1))
    sys.exit()

import serve  # noqa: E402  loads the TerraTwin index exactly as the server does
out = []
for name, lat, lon in SITES:
    t0 = time.time()
    r = serve.analog('mars', lat, lon)
    if r.get('status') != 'ok' or not r['candidates']:
        print('skip', name, r.get('status'))
        continue
    c = r['candidates'][0]
    twin = {'lat': round(c['lat'], 3), 'lon': round(c['lon'], 3), 'name': place(c['lat'], c['lon']), 'fit': round(c['terrain_fit']),
            'shape': None if c['learned_similarity'] is None else round(c['learned_similarity'], 2), 'landform': c['landform']}
    out.append({'name': name, 'lat': lat, 'lon': lon, 'landform': r['query']['landform'], 'twin': twin})
    print(f"{name}: {twin['name']} fit {twin['fit']} ({time.time() - t0:.1f}s)", flush=True)
    (ROOT / 'data' / 'hero_twins.json').write_text(json.dumps(out, indent=1))  # after every site, so a stop keeps progress
