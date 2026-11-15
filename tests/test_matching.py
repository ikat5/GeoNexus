"""Unit tests for the matcher's geometry and landform descriptors (no network).
    .venv/bin/python tests/test_matching.py
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from matching.landform_features import anisotropy, describe, landform_class, multiscale_roughness, pit_density  # noqa: E402
from matching.patches import PX_M, RADIUS_M, SIZE, patch_latlon  # noqa: E402

rng = np.random.default_rng(7)


def gc_m(body, la1, lo1, la2, lo2):
    p1, p2, dl = np.radians(la1), np.radians(la2), np.radians(lo2 - lo1)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * RADIUS_M[body] * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def spacing(body, lat0, lon0):
    lat, lon = patch_latlon(body, lat0, lon0)
    ew = gc_m(body, lat[:, :-1], lon[:, :-1], lat[:, 1:], lon[:, 1:])
    ns = gc_m(body, lat[:-1], lon[:-1], lat[1:], lon[1:])
    side = gc_m(body, lat[SIZE // 2, 0], lon[SIZE // 2, 0], lat[SIZE // 2, -1], lon[SIZE // 2, -1])
    return ew, ns, side


# 1. same metre extent and pixel size at every latitude (and through the pole)
for body in ('earth', 'mars', 'moon'):
    for lat in (0, 60, 80, 89, 89.99):
        ew, ns, side = spacing(body, lat, 30.0)
        assert abs(side / ((SIZE - 1) * PX_M) - 1) < 0.01, (body, lat, side)
        assert np.all(np.abs(ns / PX_M - 1) < 0.02), (body, lat, ns.min(), ns.max())
        assert np.all(np.abs(ew / PX_M - 1) < 0.02), (body, lat, ew.min(), ew.max())  # off-axis rows bend slightly (azimuthal grid)

# 2. Mars and Earth patches share one metric resolution
assert abs(spacing('mars', 18.4, 77.5)[1].mean() - spacing('earth', 23.8, -2.4)[1].mean()) < 1.0


# 3. a circular crater stays circular after reprojection at 85 degrees
def crater_aspect(lat, lon):
    w = np.exp(-(gc_m('mars', 85.0, 40.0, lat, lon) / 2500.0) ** 2)
    w = w / w.sum()
    yy, xx = np.mgrid[:w.shape[0], :w.shape[1]]
    cx, cy = (w * xx).sum(), (w * yy).sum()
    cxy = (w * (xx - cx) * (yy - cy)).sum()
    ev = np.linalg.eigvalsh(np.array([[(w * (xx - cx) ** 2).sum(), cxy], [cxy, (w * (yy - cy) ** 2).sum()]]))
    return float(np.sqrt(ev[0] / ev[1]))


aspect = crater_aspect(*patch_latlon('mars', 85.0, 40.0))
assert 0.9 <= aspect <= 1.1, aspect
# the old way (a square in degrees) visibly squashes it east-west at 85 degrees
deg = np.degrees(PX_M / RADIUS_M['mars'])
g = (np.arange(SIZE) - (SIZE - 1) / 2) * deg
naive = crater_aspect(*np.meshgrid(85.0 - g, 40.0 + g, indexing='ij'))
assert naive < 0.6, naive

# 4. parallel sine ridges are strongly anisotropic and read as linear
x = np.arange(SIZE) * PX_M
ridges = 20 * np.sin(2 * np.pi * x / 3000.0)[None, :].repeat(SIZE, 0)
assert anisotropy(ridges) > 0.7, anisotropy(ridges)
assert landform_class(describe(ridges, PX_M)) == 'dunes/linear', landform_class(describe(ridges, PX_M))

# 5. random bumps plus circular pits: isotropic, with pits
yy, xx = np.mgrid[:SIZE, :SIZE] * PX_M
bumpy = np.zeros((SIZE, SIZE))
for _ in range(40):
    cx, cy = rng.uniform(0, SIZE * PX_M, 2)
    r, h = rng.uniform(600, 1500), rng.uniform(-30, 30)
    bumpy += h * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / r ** 2)
for cx, cy in rng.uniform(3000, (SIZE - 6) * PX_M, (6, 2)):
    bumpy -= 60 * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / 700.0 ** 2)
assert anisotropy(bumpy) < 0.3, anisotropy(bumpy)
assert pit_density(bumpy, PX_M) > 0

# 6. a flat (tilted) plane has no roughness and reads as a smooth plain
plane = 0.01 * xx + 0.02 * yy
assert max(multiscale_roughness(plane, PX_M)) < 1e-6, multiscale_roughness(plane, PX_M)
d = describe(plane, PX_M)
assert d['roughness_rms_m'] < 1e-6 and pit_density(plane, PX_M) == 0

print(f'test_matching ok (crater aspect at 85°: reprojected {aspect:.2f}, degree grid {naive:.2f})')
