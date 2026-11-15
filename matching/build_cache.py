"""Pre-compute Earth landform descriptors so stage 2 is a cache lookup. Resumable; safe to stop and restart.
    .venv/bin/python -m matching.build_cache            # cold-desert / polar candidates (|lat| > 56 or high altitude)
    .venv/bin/python -m matching.build_cache --all      # every cell any screen can return (~288k; about an hour)
Cells left out are computed on first use and added to the same cache.
"""
import sys
import time
from multiprocessing import Pool

import numpy as np

from . import pipeline as P
from .landform_features import KEYS, describe
from .patches import PX_M, cut_patch


def work(chunk):
    out = []
    for i, la, lo in chunk:
        z = cut_patch('earth', la, lo)
        out.append((i, None if z is None else np.array([describe(z, PX_M)[k] for k in KEYS])))
    return out


if __name__ == '__main__':
    E = P.earth()
    steps = P.ladder(E, polar=False)
    mask = steps[2][1] if '--all' in sys.argv else (steps[1][1] & ~steps[0][1])  # relaxed set, or cold-desert additions only
    P._load_desc()
    have = np.fromiter(P._desc.keys(), np.int64, len(P._desc))
    todo = np.flatnonzero(mask & ~np.isin(E['cell_id'], have))
    todo = todo[np.lexsort((E['lon'][todo], np.round(E['lat'][todo]), ~(np.abs(E["lat"][todo]) > 56)))]  # polar first, then by tile
    chunks = [[(int(E['cell_id'][k]), float(E['lat'][k]), float(E['lon'][k])) for k in todo[s:s + 250]] for s in range(0, len(todo), 250)]
    print(f'{mask.sum():,} cells in scope, {len(todo):,} still to compute in {len(chunks)} chunks', flush=True)
    t0, done = time.time(), 0
    with Pool(10) as pool:
        for n, res in enumerate(pool.imap(work, chunks), 1):
            for i, d in res:
                P._desc[i] = P._desc_new[i] = d
            done += len(res)
            if n % 20 == 0 or n == len(chunks):
                P.flush_desc()
                rate = done / (time.time() - t0)
                print(f'{done:,}/{len(todo):,}  {rate:.0f} cells/s  eta {(len(todo) - done) / rate / 60:.1f} min', flush=True)
    P.flush_desc()
    print(f'done in {(time.time() - t0) / 60:.1f} min; {P.DESC_FILE} {P.DESC_FILE.stat().st_size / 1e6:.1f} MB, {len(P._desc):,} cells')
