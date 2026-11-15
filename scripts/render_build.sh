#!/usr/bin/env bash
# Render build step. Installs Python deps, then (only if DATASET_TOKEN is set) fetches the private
# mars_moon_earth_dataset into vendor/: code, the three 0.2.0 feature tables (Git LFS) and the S1 index (release asset).
# Without the token the site still deploys; /api/analog then answers "Model unavailable".
set -euo pipefail
pip install -r requirements.txt

if [ -z "${DATASET_TOKEN:-}" ]; then echo "DATASET_TOKEN not set: deploying without the Earth-twin model"; exit 0; fi
REPO=ikat5/mars_moon_earth_dataset DEST=vendor/mars_moon_earth_dataset
rm -rf "$DEST" && mkdir -p vendor

if ! command -v git-lfs >/dev/null; then  # Render's image may lack git-lfs: use the official static binary
  curl -fsSL https://github.com/git-lfs/git-lfs/releases/download/v3.6.1/git-lfs-linux-amd64-v3.6.1.tar.gz | tar xz -C /tmp
  export PATH="/tmp/git-lfs-3.6.1:$PATH"
fi
AUTH="https://x-access-token:${DATASET_TOKEN}@github.com/${REPO}.git"
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 "$AUTH" "$DEST"
git -C "$DEST" lfs pull --include "prepared/0.2.0/earth_features.parquet,prepared/0.2.0/mars_features.parquet,prepared/0.2.0/moon_features.parquet"
git -C "$DEST" remote set-url origin "https://github.com/${REPO}.git"  # don't leave the token in .git/config

API="https://api.github.com/repos/${REPO}/releases/tags/ml-0.3.0"
ASSET=$(curl -fsSL -H "Authorization: Bearer ${DATASET_TOKEN}" "$API" \
  | python -c "import json,sys; print(next(a['url'] for a in json.load(sys.stdin)['assets'] if a['name']=='s1_index.npz'))")
curl -fsSL -H "Authorization: Bearer ${DATASET_TOKEN}" -H "Accept: application/octet-stream" "$ASSET" \
  -o "$DEST/prepared/ml_0.3.0/s1_index.npz"
python -c "import hashlib,json; d='$DEST/prepared/ml_0.3.0/'; m=json.load(open(d+'s1_index.json')); \
assert hashlib.sha256(open(d+'s1_index.npz','rb').read()).hexdigest()==m['sha256'], 's1_index.npz checksum mismatch'; print('dataset ready')"
