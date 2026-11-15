"""Metric elevation patches: a fixed square in metres around a point, on every body, at the geometry the S1 model
was trained on (32 x 32 samples, 500 m apart). The projection is azimuthal equidistant centred on the point, so a
patch is the same shape at the equator and at a pole.

Elevation sources (all keyless, read on demand and cached under .cache/):
  earth  |lat| <= 56: AWS Terrain Tiles (Terrarium PNG; SRTM, GMTED2010), native pixel <= 620 m.
         |lat| >  56: Copernicus DEM GLO-90 (keyless AWS open data, 1x1 degree COGs) read at overview 4 (~360 m).
         Terrarium alone would give ETOPO1 *bedrock* under the Antarctic ice and nothing beyond 85.05 N.
  mars   USGS MOLA MEGDR mosaic, 128 px/deg (463 m), simple cylindrical, read by HTTP range.
  moon   USGS LOLA LDEM mosaic, 256 px/deg (118 m), read at every 4th row and column (472 m).
"""
import http.client
import io
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

from .config import CONFIG

SIZE, PX_M = CONFIG['patch_size_px'], CONFIG['patch_px_m']
RADIUS_M = {'earth': 6371000.0, 'moon': 1737400.0, 'mars': 3396190.0}
CACHE = Path(__file__).resolve().parents[1] / '.cache'
UA = {'User-Agent': 'Mozilla/5.0'}  # the USGS front end rejects default Python clients
_pool = ThreadPoolExecutor(32)
_local = threading.local()


def patch_latlon(body, lat0, lon0):
    """Lat/lon (degrees) of the SIZE x SIZE sample grid around (lat0, lon0); row 0 is north. Accepts arrays of centres
    and returns [..., SIZE, SIZE]. Exact inverse azimuthal-equidistant projection on the sphere, so it is valid over a pole."""
    off = (np.arange(SIZE) - (SIZE - 1) / 2) * PX_M
    x, y = np.meshgrid(off, -off)                      # x east, y north
    c, az = np.hypot(x, y) / RADIUS_M[body], np.arctan2(x, y)
    p0 = np.radians(np.asarray(lat0, dtype=float))[..., None, None]
    l0 = np.radians(np.asarray(lon0, dtype=float))[..., None, None]
    lat = np.arcsin(np.clip(np.sin(p0) * np.cos(c) + np.cos(p0) * np.sin(c) * np.cos(az), -1, 1))
    lon = l0 + np.arctan2(np.sin(az) * np.sin(c) * np.cos(p0), np.cos(c) - np.sin(p0) * np.sin(lat))
    return np.degrees(lat), (np.degrees(lon) + 180.0) % 360.0 - 180.0


def _get(host, path, headers=None):
    """GET over a per-thread keep-alive connection; returns (status, bytes)."""
    conns = _local.__dict__.setdefault('conns', {})
    for attempt in range(3):
        try:
            c = conns.get(host) or conns.setdefault(host, http.client.HTTPSConnection(host, timeout=30))
            c.request('GET', path, headers={**UA, **(headers or {})})
            r = c.getresponse()
            return r.status, r.read()
        except (OSError, http.client.HTTPException):
            conns.pop(host, None)
            if attempt == 2:
                raise


def _bilinear(z, r, c):
    """z[r, c] with bilinear interpolation; NaN outside the array or next to NaN."""
    H, W = z.shape
    r0, c0 = np.floor(r).astype(int), np.floor(c).astype(int)
    bad = (r0 < 0) | (c0 < 0) | (r0 >= H - 1) | (c0 >= W - 1)
    r0, c0 = np.clip(r0, 0, H - 2), np.clip(c0, 0, W - 2)
    fr, fc = r - r0, c - c0
    v = (z[r0, c0] * (1 - fc) + z[r0, c0 + 1] * fc) * (1 - fr) + (z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c0 + 1] * fc) * fr
    return np.where(bad, np.nan, v)


# ------------------------------------------------------------------ Earth: Terrarium tiles
_tiles = OrderedDict()  # (z, x, y) -> float32 [256, 256] or None when the tile does not exist
_tiles_lock = threading.Lock()


def earth_zoom(lat):
    """Smallest zoom whose native pixel at this latitude is no coarser than earth_max_native_px_m."""
    px0 = 156543.03 * max(np.cos(np.radians(lat)), 1e-6)
    return int(np.clip(np.ceil(np.log2(px0 / CONFIG['earth_max_native_px_m'])), 0, 12))


def _tile(key):
    with _tiles_lock:
        if key in _tiles:
            _tiles.move_to_end(key)
            return _tiles[key]
    z, x, y = key
    f = CACHE / 'terrarium' / str(z) / str(x) / f'{y}.png'
    if f.exists():
        raw = f.read_bytes()
    else:
        status, raw = _get('s3.amazonaws.com', f'/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png')
        raw = raw if status == 200 else b''
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(raw)  # an empty file remembers "no such tile"
    arr = None
    if raw:
        from PIL import Image
        rgb = np.asarray(Image.open(io.BytesIO(raw)).convert('RGB'), dtype=np.float32)
        arr = rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
    with _tiles_lock:
        _tiles[key] = arr
        while len(_tiles) > 600:
            _tiles.popitem(last=False)
    return arr


def _earth(lat, lon, lat0):
    z = earth_zoom(lat0)
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n * 256 - 0.5
    y = (1 - np.arcsinh(np.tan(np.radians(np.clip(lat, -89.9, 89.9)))) / np.pi) / 2 * n * 256 - 0.5
    x = x - np.floor((x.min() + 0.5) / 256) * 256 if np.ptp(x) < n * 128 else np.where(x < n * 128, x + n * 256, x)  # antimeridian
    tx0, tx1, ty0, ty1 = int(x.min() // 256), int(x.max() // 256) + 0, int(y.min() // 256), int(y.max() // 256)
    base_x = int(np.floor(((lon + 180.0) / 360.0 * n * 256 - 0.5).min() / 256)) if np.ptp(x) < n * 128 else 0
    keys = [(z, (base_x + i) % n if np.ptp(x) < n * 128 else i % n, j) for j in range(ty0, ty1 + 1) for i in range(tx0, tx1 + 1)]
    tiles = list(_pool.map(lambda k: _tile(k) if 0 <= k[2] < n else None, keys))
    w = tx1 - tx0 + 1
    rows = [np.hstack([t if t is not None else np.full((256, 256), np.nan, np.float32) for t in tiles[r * w:(r + 1) * w]])
            for r in range(ty1 - ty0 + 1)]
    return _bilinear(np.vstack(rows), y - ty0 * 256, x - tx0 * 256)


# ------------------------------------------------------------------ Mars / Moon: USGS cylindrical mosaics by HTTP range
HOST = 'asc-pds-services.s3.us-west-2.amazonaws.com'
MOSAIC = {  # uncompressed little-endian int16, one row per strip, lon -180..180, lat 90..-90
    'mars': {'path': '/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif', 'W': 46080, 'H': 23040, 'row0': 184973, 'step': 1, 'scale': 1.0},
    'moon': {'path': '/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif', 'W': 92160, 'H': 46080, 'row0': None, 'step': 4, 'scale': 0.5},
}


def _row0(m):
    """Byte offset of the first raster row. The Moon file is BigTIFF with its strip table at the front."""
    if m['row0'] is None:
        import struct
        _, d = _get(HOST, m['path'], {'Range': 'bytes=0-65535'})
        ifd = struct.unpack('<Q', d[8:16])[0]
        for i in range(struct.unpack('<Q', d[ifd:ifd + 8])[0]):
            e = d[ifd + 8 + i * 20:ifd + 28 + i * 20]
            if struct.unpack('<H', e[:2])[0] == 273:  # StripOffsets
                table = struct.unpack('<Q', e[12:20])[0]
                _, t = _get(HOST, m['path'], {'Range': f'bytes={table}-{table + 15}'})
                first, second = struct.unpack('<QQ', t)
                assert second - first == m['W'] * 2, 'unexpected strip layout'
                m['row0'] = first
    return m['row0']


def _planet(body, lat, lon):
    m = MOSAIC[body]
    s, W, H = m['step'], m['W'] // m['step'], m['H'] // m['step']   # work on a grid decimated by `step`
    r = (90.0 - lat) / 180.0 * H - 0.5
    c = (lon + 180.0) / 360.0 * W - 0.5
    r0 = np.clip(np.floor(r).astype(int), 0, H - 2)
    rows = np.unique(np.r_[r0, r0 + 1])
    wrap = np.ptp(c) > W / 2  # the patch straddles the antimeridian or contains a pole: read whole rows
    c_lo, c_hi = (0, W - 1) if wrap else (max(int(np.floor(c.min())), 0), min(int(np.floor(c.max())) + 1, W - 1))
    base = _row0(m)

    def read(row):
        a = base + (row * s) * m['W'] * 2 + c_lo * s * 2
        status, d = _get(HOST, m['path'], {'Range': f'bytes={a}-{a + (c_hi - c_lo) * s * 2 + 1}'})
        if status != 206:
            raise OSError(f'{body} elevation mosaic: HTTP {status}')
        return np.frombuffer(d, '<i2')[::s].astype(np.float32)

    z = np.vstack(list(_pool.map(read, rows))) * m['scale']
    z[z < -30000] = np.nan  # no-data
    if wrap:  # one extra column so interpolation can cross the seam
        z, cc = np.hstack([z, z[:, :1]]), np.mod(c, W)
    else:
        cc = c - c_lo
    return _bilinear(z, np.searchsorted(rows, r0) + (r - r0), cc)


# ------------------------------------------------------------------ Earth, |lat| > 56: Copernicus GLO-90
_cop = OrderedDict()
_cop_lock = threading.Lock()
POLAR_EARTH_LAT = 56.0


def _cop_tile(la, lo):
    """1x1 degree tile with south-west corner (la, lo), read at overview 4 and cached on disk; None where there is
    no land (the bucket has no tile)."""
    key = (la, lo)
    with _cop_lock:
        if key in _cop:
            return _cop[key]
    name = f"Copernicus_DSM_COG_30_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM"
    f = CACHE / 'cop90' / f'{name}.npy'
    if f.exists():
        z = np.load(f)
        z = None if z.size == 0 else z
    else:
        import rasterio
        from rasterio.enums import Resampling
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'), \
                    rasterio.open(f'/vsicurl/https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif') as ds:
                z = ds.read(1, out_shape=(max(ds.height // 4, 2), max(ds.width // 4, 2)), resampling=Resampling.average).astype(np.float32)
        except rasterio.errors.RasterioIOError as e:
            if '404' not in str(e) and 'does not exist' not in str(e):
                raise
            z = None
        f.parent.mkdir(parents=True, exist_ok=True)
        np.save(f, z if z is not None else np.zeros(0, np.float32))
    with _cop_lock:
        _cop[key] = z
        while len(_cop) > 400:
            _cop.popitem(last=False)
    return z


def _earth_polar(lat, lon):
    out = np.full(lat.shape, np.nan, np.float32)
    la, lo = np.floor(lat).astype(int), np.floor(lon).astype(int)
    keys = sorted(set(zip(la.ravel().tolist(), lo.ravel().tolist())))
    for (a, b), z in zip(keys, _pool.map(lambda k: _cop_tile(*k), keys)):
        if z is None:
            continue
        m = (la == a) & (lo == b)
        H, W = z.shape  # pixel-is-area grid, row 0 at the tile's north edge
        r = np.clip((a + 1 - lat[m]) * H - 0.5, 0, H - 1.000001)
        c = np.clip((lon[m] - b) * W - 0.5, 0, W - 1.000001)
        out[m] = _bilinear(np.pad(z, ((0, 1), (0, 1)), mode='edge'), r, c)
    return out


def cut_patch(body, lat0, lon0):
    """Elevation (m) on the metric grid around (lat0, lon0): float32 [SIZE, SIZE], or None when more than
    max_nodata_share of it has no data."""
    lat, lon = patch_latlon(body, lat0, lon0)
    if body == 'earth':
        z = _earth_polar(lat, lon) if abs(lat0) > POLAR_EARTH_LAT else _earth(lat, lon, lat0)
    else:
        z = _planet(body, lat, lon)
    bad = ~np.isfinite(z)
    if bad.mean() > CONFIG['max_nodata_share']:
        return None
    if bad.any():
        z = np.where(bad, np.nanmean(z), z)
    return z.astype(np.float32)
