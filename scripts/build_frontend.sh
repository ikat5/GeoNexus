#!/usr/bin/env bash
# Builds the Vite front end into dist/ (served by serve.py). Used by Render (scripts/render_build.sh) and the Hugging
# Face Space (huggingface/app.py). Vite 8 needs Node >= 22.12: if the image has none (or an older one), fetch the
# official binary into /tmp, like render_build.sh does for git-lfs.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE=v22.12.0
if ! command -v node >/dev/null || ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'; then
  curl -fsSL "https://nodejs.org/dist/${NODE}/node-${NODE}-linux-x64.tar.xz" | tar xJ -C /tmp
  export PATH="/tmp/node-${NODE}-linux-x64/bin:$PATH"
fi
echo "node $(node -v), npm $(npm -v)"
npm ci --no-audit --no-fund
npm run build
