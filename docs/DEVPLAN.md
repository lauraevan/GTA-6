# GRAND THEFT AUDI — Development Plan / Status

Working title: **Grand Theft Audi** — original open-world crime/driving game set in the
fictional city of **Neustadt Bay**. All brands, vehicles, characters and music are
original (fictional automaker: **Adler Motors**). No real-world trademarks or likenesses.

## Architecture

- `client/` — Vite + Three.js + cannon-es browser client (the game).
- `server/` — FastAPI + SQLAlchemy/SQLite backend: saves, leaderboards, asset manifest,
  procedural world generator (single source of truth for city layout, exported as JSON).
- `desktop/` — Electron shell that packages the built client (+ optional local server)
  as a Windows desktop app (NSIS installer / portable exe).

## Phase checklist

- [x] Repo scaffold (this file, README, gitignore, configs)
- [x] Python procedural city generator → `client/public/world/city.json`
- [x] Client core: config, events, input, math/RNG, asset library (GLB-or-procedural)
- [x] Engine: renderer (+bloom/vignette), camera rig, day/night cycle, weather, particles
- [x] Physics: cannon-es world, raycast vehicle model (per-class tuning), ragdolls
- [x] World: chunk streaming, building/road/prop factories, interiors, nav graph
- [x] Entities: vehicle catalog + damage model, player (on foot / driving), peds, weapons, pickups
- [x] AI: traffic (lane following, intersections, panic), pedestrians (state machines),
      police director (wanted 1–5★: pursuit, PIT, roadblocks, spikes, helicopter, SWAT, bust)
- [x] Gameplay: crimes/heat, robbery (shops), carjacking/lockpick, economy, garage/customization
- [x] Missions: scripting framework + story chain (incl. multi-stage bank heist) + side
      activities (street races, stunt jumps, delivery gigs, theft list)
- [x] UI: HUD (minimap+GPS, wanted stars, health/armor, cash, speedo), weapon wheel,
      big map, menus, garage screen, notifications, cinematic letterbox
- [x] Audio: Web Audio synth engine sounds, gunfire, sirens, ambient, dynamic music
      (calm/chase/combat) + in-car radio stations (generative, license-free)
- [x] Save/progression: REST client (`/api/save`, `/api/load`, `/api/leaderboard`)
      with localStorage fallback
- [x] FastAPI backend + SQLite models + pytest smoke tests
- [x] Electron desktop shell + electron-builder Windows config
- [x] Headless smoke test (Playwright + SwiftShader) proving the game boots & plays
- [x] ASSETS.md — Higgsfield prompt sheet for GLB replacements of procedural models

## Post-v0 ideas (not blocking)

- Replace procedural meshes with Higgsfield GLBs (pipeline + manifest already in place)
- Interiors for more building types; subway; water vehicles
- Multiplayer race ghosts via leaderboard replay data
- Gamepad support (Gamepad API), photo mode
