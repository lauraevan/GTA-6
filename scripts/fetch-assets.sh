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
  [ped-civilian-anim.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/6f8366b4-281a-4274-8cc0-4271c0cc026e.glb"
  [ped-civilian-idle.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/e6931bfd-d393-4b52-938b-c39910596520.glb"
  [ped-civilian-run.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/a14681cf-19e1-4da1-8a7a-b082edc50d4f.glb"
  [building-house-a.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/59385c33-260b-4464-aabd-f268649646d0.glb"
  [building-house-b.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/e43eb1d7-b305-4a8d-b339-a5f4514d9c76.glb"
  [building-apartment.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/fcb62eb1-69c0-42c5-99c7-6c3c2a6f230c.glb"
  [building-tower.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/2264bb90-b85b-4ca2-90fb-5f78db58f2d5.glb"
  [building-office.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/79f46308-4c8c-4160-9202-2bce22349f1d.glb"
  [building-shop.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/3ae03177-60c9-49fe-a09f-e113b595a40b.glb"
  [building-warehouse.glb]="https://d3u0tzju9qaucj.cloudfront.net/7d051b5a-7bfe-49fe-a484-24e7b3a9458a/df3e9031-cf43-45a4-9d22-0aed7b6bd6e3.glb"
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
