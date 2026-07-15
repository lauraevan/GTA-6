#!/usr/bin/env bash
# Downloads the Higgsfield-generated GLB hero assets into client/public/models/.
# Run from the repo root: bash scripts/fetch-assets.sh
# (These URLs are the completed Higgsfield image_to_3d job outputs — see ASSETS.md.)
set -euo pipefail
cd "$(dirname "$0")/../client/public/models"

declare -A ASSETS=(
  [vehicle-falke.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/17fb3665-0a52-4f31-b642-8b0a6f025790.glb"
  [vehicle-cruiser.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/10186e88-36ba-4ede-b2f4-313d65c3d25a.glb"
  [vehicle-thunder.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/6d4a13f8-bf60-4ee1-82ef-a6b1eaccac70.glb"
  [vehicle-kurier.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/3f51f7c2-82f1-4e93-b5e3-795a51109f8b.glb"
  [ped-civilian-rigged.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/a1ce0ea0-38d6-45c0-b305-548ad29c8263.glb"
)

for name in "${!ASSETS[@]}"; do
  if [ -s "$name" ]; then
    echo "✔ $name already present ($(du -h "$name" | cut -f1))"
    continue
  fi
  echo "↓ $name"
  curl -fSL --retry 3 -o "$name" "${ASSETS[$name]}"
done
ls -la ./*.glb
