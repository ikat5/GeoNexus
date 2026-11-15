"""Region + country names for Earth points from OpenStreetMap Nominatim (free; one request per second)."""
import json, time, urllib.request


def place(lat, lon):
    """Region and country in English ("Fars Province, Iran"): district names are often only in local script."""
    url = f'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=6&addressdetails=1&accept-language=en&lat={lat:.5f}&lon={lon:.5f}'
    req = urllib.request.Request(url, headers={'User-Agent': 'GeoNexus-build/1.0', 'Accept-Language': 'en'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            a = json.load(r).get('address', {})
        parts = [a.get('state') or a.get('region') or a.get('province') or a.get('county'), a.get('country')]
        return ', '.join(x for x in parts if x) or None
    except Exception as e:  # offline: coordinates only
        print('  nominatim:', e)
        return None
    finally:
        time.sleep(1.1)  # Nominatim policy: at most one request per second
