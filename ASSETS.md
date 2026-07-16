# Asset pipeline — Higgsfield AI

The game is **fully playable with procedural models** (built from primitives at
runtime). Hero GLB assets generated with Higgsfield AI upgrade the look where
it matters most. `client/src/core/assets.js` loads anything listed in
`client/public/models/manifest.json` and transparently falls back to the
procedural builder per asset.

## Generated set (v2) — the city itself

Batch 2 replaced the procedural building boxes with a Higgsfield-generated
architecture library, instanced across every chunk by archetype
(`client/src/world/glbBuildings.js`):

| Asset key | Drives archetypes | Look |
| --- | --- | --- |
| `building-tower` | glass ×4 | 40-story blue curtain-wall skyscraper |
| `building-office` | office ×3, concrete ×2, art deco, civic | 12-story precast office |
| `building-apartment` | brick ×3, rowhouse | weathered brick tenement, fire escapes, awnings |
| `building-shop` | shopfront | corner store, glass front + awning |
| `building-house-a` | house A/C | two-story suburban, porch + garage |
| `building-house-b` | house B/D | stucco Mediterranean bungalow |
| `building-warehouse` | warehouse ×2 | rusty corrugated harbor shed |
| `ped-civilian-anim` | civilian NPCs | **skinned walk cycle** (Casual_Walk, Meshy auto-rig) |
| `ped-civilian-idle` | civilian NPCs | idle clip, crossfaded by speed |

A hash-stable share of lots (40% downtown, 15% low-rise) intentionally keeps
the procedural meshes so the night skyline still has emissive lit windows —
generated GLB textures are unlit at night. Tune in `glbBuildings.js`
(`PROCEDURAL_SHARE`).

## Generated set (v1)

Pipeline per asset: `generate_image` (nano-banana-pro concept, clean studio
shot) → `generate_3d` (`image_to_3d`, Meshy, `should_texture: true`,
`symmetry_mode: on`; ped adds `enable_rigging + pose_mode: a-pose`).

| Asset key | File | Source | Notes |
| --- | --- | --- | --- |
| `vehicle-falke` | `vehicle-falke.glb` | silver wedge supercar concept | Adler Falke S |
| `vehicle-kurier` | `vehicle-kurier.glb` | blue executive sport sedan | Adler Kurier RS |
| `vehicle-thunder` | `vehicle-thunder.glb` | matte-black 70s muscle coupe | Kestrel Thunderhead |
| `vehicle-cruiser` | `vehicle-cruiser.glb` | navy police interceptor, lightbar | NBPD Interceptor |
| `ped-civilian-rigged` | `ped-civilian-rigged.glb` | a-pose civilian, **auto-rigged skeleton** (1.75 m) | reserved for the skinned-character upgrade |

Download: `bash scripts/fetch-assets.sh` (or the `fetch-assets` GitHub Action,
which commits them to the branch).

### Manifest schema

```json
{
  "assets": {
    "vehicle-falke": { "file": "vehicle-falke.glb", "fit": [2.02, 0.98, 4.5], "yaw": 0 }
  }
}
```

- `fit: [w,h,l]` — uniformly rescales the GLB so its footprint length matches
  the gameplay size from `entities/catalog.js`, and recenters it at the origin.
- `yaw` — radians, rotates the model so the nose faces **+Z** (the game's
  forward convention).
- `ground: true` — origin at the bounding-box bottom (props/characters)
  instead of the centre (vehicles).

Vehicle GLBs replace the procedural *body*; wheels remain procedural so
spin/steer/burst animation keeps working.

## Prompt sheet (regeneration / expansion)

Concept-image prompt skeleton (keeps outputs image-to-3D friendly and IP-safe):

> Studio product photo of an original fictional **{subject}**, {design notes},
> 3/4 front-left view, entire {subject} fully in frame and centered, plain
> light gray seamless studio background, soft even lighting, **no logos, no
> badges, no text, no watermark, no people**, slightly simplified stylized
> game-asset look

Recommended `image_to_3d` params: `should_texture: true`,
`symmetry_mode: "on"` (vehicles), `target_polycount: 30000` (default). For
characters: `enable_rigging: true`, `pose_mode: "a-pose"`,
`rigging_height_meters: 1.75`; add a clip with `enable_animation: true` +
`animation_action_id` (0 = idle, 30 = casual walk, 16 = run — see the
`animation_actions` catalog).

Wishlist for the next batch: `vehicle-stadt` (compact hatch), `vehicle-steinbock`
(offroad pickup), `vehicle-vagon` (panel van), `vehicle-sturm` (SWAT van),
`weapon-rook9` (compact pistol), `weapon-lancer` (rifle), `prop-container`,
`prop-crane`, cop/SWAT/clerk character variants.

## ⏳ Pending: animated walk cycle (blocked on credits)

The runtime already ships the full skinned-NPC path (SkeletonUtils cloning,
AnimationMixer walk with speed-matched timeScale, ragdoll swap on death) —
it activates automatically when `ped-civilian-anim` appears in the manifest.
Producing that GLB is **one 8-credit call** on the already-generated rig:

```
generate_3d(model="3d_rigging", enable_animation=true,
            animation_action_id=30,   # Casual_Walk (see animation_actions)
            model_url="544261ba-08fb-4ece-8a3b-6074696057eb")
```

then add the file + manifest entry:

```json
"ped-civilian-anim": { "file": "ped-civilian-anim.glb", "fit": [0.5, 1.75, 0.5],
                       "fitAxis": "y", "ground": true }
```

> As of the last session the Higgsfield workspace reported **0 usable
> credits** (`Out of credits in the selected workspace`) even though the
> account balance endpoint showed 105 — check the workspace/plan on
> higgsfield.ai and re-run the call above once credits are available.
> Wishlist order when topped up: animated ped (8 cr) → idle clip (8 cr) →
> `vehicle-stadt`, `vehicle-steinbock`, `vehicle-vagon` (≈32 cr each,
> image + textured `image_to_3d`).

## Rigged pedestrian — integration status

`ped-civilian-rigged.glb` ships with a humanoid skeleton (Meshy auto-rig,
a-pose). The runtime currently animates pedestrians procedurally (named box
parts drive the walk cycle **and** the ragdoll system re-parents those parts on
death), so the skinned mesh is bundled but not yet driven. The upgrade path:

1. Load the GLB via `assets.getModel('ped-civilian-rigged')`.
2. Drive locomotion with `THREE.AnimationMixer` (generate clips via Higgsfield
   `enable_animation`, or retarget any humanoid clip onto the rig).
3. On death, swap the skinned mesh for the existing part-based ragdoll.
