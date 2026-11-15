"""Hugging Face Space start-up: download the private dataset copy (code, 0.2.0 tables, S1 index, descriptor cache)
from a private HF dataset repo instead of GitHub (no GitHub LFS bandwidth used).
Env: DATA_REPO (e.g. "<user>/geonexus-data") and HF_TOKEN (a read token; huggingface_hub picks it up itself)."""
import os
import shutil
from pathlib import Path

from huggingface_hub import snapshot_download

ROOT = Path(__file__).resolve().parents[1]
dest = ROOT / 'vendor' / 'mars_moon_earth_dataset'
token = os.environ.get('HF_TOKEN', '').strip() or None  # pasted secrets often carry a stray space or newline
print(f"HF_TOKEN: {'missing' if not token else f'{len(token)} chars, starts {token[:3]!r}'}")  # never the token itself
snapshot_download(os.environ.get('DATA_REPO', 'ikat5/geonexus-data'), repo_type='dataset', local_dir=dest, token=token)
(ROOT / '.cache').mkdir(exist_ok=True)
shutil.copy(dest / 'cache' / 'earth_descriptors.npz', ROOT / '.cache' / 'earth_descriptors.npz')  # pre-computed: fast first queries
print('dataset ready')
