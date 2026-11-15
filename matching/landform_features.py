"""Landform descriptors of a metric elevation patch. Pure numpy; every function takes a 2D array of metres
(row 0 north) and, where scale matters, the pixel size in metres."""
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .config import CONFIG

CLASSES = ('dunes/linear', 'cratered', 'knobby/fractured', 'smooth plain', 'icy/layered', 'mixed')
# order of the cached per-cell vector (matching/pipeline.py)
KEYS = ('slope_median_deg', 'slope_p90_deg', 'relief_m', 'roughness_rms_m', 'anisotropy', 'orientation_deg',
        'pit_density', 'knob_density', 'laplacian_mean', 'laplacian_std', 'local_relief_mean', 'local_relief_std',
        'local_relief_skew', 'rough_1', 'rough_4', 'rough_16')


def _windows(dem, k):
    """k x k neighbourhoods of every pixel (edges replicated)."""
    return sliding_window_view(np.pad(dem, k // 2, mode='edge'), (k, k))


def _detrended(dem):
    n, m = dem.shape
    yy, xx = np.mgrid[:n, :m]
    A = np.c_[xx.ravel(), yy.ravel(), np.ones(n * m)]
    return dem - (A @ np.linalg.lstsq(A, dem.ravel(), rcond=None)[0]).reshape(n, m)


def basic_terrain(dem, px_m):
    """The four screening features, with the same definitions as the dataset / ml.patches.descriptors."""
    gy, gx = np.gradient(dem, px_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    return {'slope_median_deg': float(np.median(slope)), 'slope_p90_deg': float(np.quantile(slope, 0.9)),
            'relief_m': float(dem.max() - dem.min()), 'roughness_rms_m': float(_detrended(dem).std())}


def _structure_tensor(dem):
    # texture only: subtract a 9x9 (4 km) moving mean, so regional slopes, volcano flanks and valley walls do not
    # dominate; what is left is the grain of the surface (dune crests, crater rims, knobs)
    flat = _detrended(dem)  # remove the plane first, so the edge-padded moving mean adds no false relief
    detail = flat - _windows(flat, 9).mean((-1, -2))
    gy, gx = np.gradient(detail)
    return (gx * gx).mean(), (gx * gy).mean(), (gy * gy).mean()


def anisotropy(dem):
    """(λ1 − λ2) / (λ1 + λ2) of the gradient structure tensor, 0..1. Parallel ridges ~1; craters and knobs ~0."""
    jxx, jxy, jyy = _structure_tensor(dem)
    total = jxx + jyy
    return 0.0 if total < 1e-12 else float(np.hypot(jxx - jyy, 2 * jxy) / total)


def dominant_orientation(dem):
    """Compass bearing (0..180°) along which slopes mostly face; ridges and dunes run at right angles to it. Display only."""
    jxx, jxy, jyy = _structure_tensor(dem)
    theta = 0.5 * np.arctan2(2 * jxy, jxx - jyy)       # from +x (east), with y pointing down (south)
    return float((90.0 + np.degrees(theta)) % 180.0)   # -> clockwise from north


def pit_density(dem, px_m, min_depth_m=None):
    """Closed depressions per km²: strict 3x3 local minima at least min_depth_m below their 5x5 mean. A rough crater proxy."""
    depth = CONFIG['pit_min_depth_m'] if min_depth_m is None else min_depth_m
    w3 = _windows(dem, 3).reshape(*dem.shape, 9)
    is_min = (dem[..., None] <= w3).all(-1) & ((dem[..., None] < w3).sum(-1) == 8)
    deep = _windows(dem, 5).mean((-1, -2)) - dem >= depth
    core = np.zeros_like(is_min)
    core[2:-2, 2:-2] = True  # the border has no full neighbourhood
    area_km2 = core.sum() * (px_m / 1000.0) ** 2
    return float((is_min & deep & core).sum() / area_km2)


def curvature_stats(dem, px_m=1.0):
    """Mean/std of the Laplacian (1/m) and mean/std/skewness of 3x3 local relief (m)."""
    p = np.pad(dem, 1, mode='edge')
    lap = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] - 4 * dem) / px_m ** 2
    w = _windows(dem, 3)
    lr = (w.max((-1, -2)) - w.min((-1, -2))).ravel()
    sd = lr.std()
    return {'laplacian_mean': float(lap.mean()), 'laplacian_std': float(lap.std()), 'local_relief_mean': float(lr.mean()),
            'local_relief_std': float(sd), 'local_relief_skew': float(((lr - lr.mean()) ** 3).mean() / sd ** 3) if sd > 1e-9 else 0.0}


def multiscale_roughness(dem, px_m=None, windows_px=None):
    """RMS height (m) left after removing the trend at each window size: a (2w+1)-pixel moving mean, or a plane
    when the window covers the patch."""
    out, flat = [], _detrended(dem)
    for w in windows_px or CONFIG['roughness_windows_px']:
        k = 2 * w + 1
        out.append(float((flat if k >= min(dem.shape) else flat - _windows(flat, k).mean((-1, -2))).std()))
    return out


def describe(dem, px_m):
    """All descriptors of one patch as a dict keyed by KEYS."""
    d = basic_terrain(dem, px_m)
    d['anisotropy'], d['orientation_deg'] = anisotropy(dem), dominant_orientation(dem)
    d['pit_density'], d['knob_density'] = pit_density(dem, px_m), pit_density(-dem, px_m)  # knobs are pits upside down
    d.update(curvature_stats(dem, px_m))
    d['rough_1'], d['rough_4'], d['rough_16'] = multiscale_roughness(dem, px_m, (1, 4, 16))
    return d


def landform_class(f, ice=False, thresholds=None):
    """Explainable rule-based label. `ice`: the surface is known or presumed to be ice (Earth land cover, or a
    polar-cap query); rules are checked top to bottom."""
    t = thresholds or CONFIG['landform']
    if ice and f['rough_4'] <= t['icy_max_rough4_m']:
        return 'icy/layered'
    if f['relief_m'] <= t['smooth_max_relief_m'] and f['rough_4'] <= t['smooth_max_rough4_m']:
        return 'smooth plain'
    if f['anisotropy'] >= t['linear_min_anisotropy']:
        return 'dunes/linear'
    if f['anisotropy'] <= t['round_max_anisotropy']:
        pits, knobs = f['pit_density'] >= t['cratered_min_pits_per_km2'], f['knob_density'] >= t['knobby_min_knobs_per_km2']
        if pits and f['pit_density'] >= f['knob_density']:
            return 'cratered'
        if knobs:
            return 'knobby/fractured'
    return 'mixed'
