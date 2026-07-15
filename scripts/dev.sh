#!/usr/bin/env bash
# Dev launcher: FastAPI backend (:8177) + Vite dev server (:5173).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d server/.venv ]; then
  echo "· creating server venv"
  python3 -m venv server/.venv
  server/.venv/bin/pip install -q -r server/requirements.txt
fi
if [ ! -d client/node_modules ]; then
  echo "· installing client deps"
  (cd client && npm install)
fi
if [ ! -f client/public/world/city.json ]; then
  echo "· generating city"
  (cd server && .venv/bin/python -m worldgen.citygen --seed 1337 --out ../client/public/world/city.json)
fi

echo "· starting backend on :8177"
(cd server && .venv/bin/uvicorn main:app --port 8177 --reload) &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

echo "· starting client on :5173"
cd client && npm run dev
