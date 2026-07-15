# GRAND THEFT AUDI — Unreal Engine 5.7 track (C++)

This folder is the **native C++ port starter** for the AAA track. It shares the
same source of truth as the web build: the Python world generator's
`city.json` and the Higgsfield GLB assets.

> ⚠️ **Honesty note:** this was authored in a cloud sandbox with no Unreal
> toolchain, so it has **not been compiled**. It follows standard UE 5.x
> patterns (Enhanced Input, ChaosVehicles, ISM instancing, JsonUtilities) and
> is intentionally small — expect at most minor include/API fixes on first
> build, not architectural rework.

## What's here

| File | Purpose |
| --- | --- |
| `GrandTheftAudi.uproject` | UE **5.7** project, ChaosVehicles + EnhancedInput enabled |
| `Config/DefaultEngine.ini` | **Lumen** GI + reflections, **Nanite** enabled, **TSR** anti-aliasing, HW ray tracing, cinematic bloom/motion-blur defaults |
| `Source/.../GTACityImporter.*` | Editor button that reads `Content/City/city.json` and instances the whole city — buildings (with setback tiers, one ISM per archetype for per-style materials), road runs, bay water cells |
| `Source/.../GTAVehiclePawn.*` | ChaosVehicles pawn: chase cam with lag + speed FOV, Enhanced Input throttle/brake/steer/handbrake |
| `Source/.../GTAWantedSubsystem.*` | 1–5★ heat system, direct port of the web `wantedSystem.js`, Blueprint-facing events |
| `Source/.../GTAGameMode.*` | default pawn wiring |

## First-run checklist (on your machine)

1. Install **UE 5.7** + Visual Studio 2022 (Desktop C++, Windows SDK).
2. Right-click `GrandTheftAudi.uproject` → *Generate Visual Studio project files* → build → open.
3. Copy the city: `client/public/world/city.json` → `Content/City/city.json`
   (regenerate any seed with `python -m worldgen.citygen --seed N`).
4. New empty level → drag in a `GTACityImporter` → assign `BoxMesh` (engine
   *Cube*), optionally 22 style materials → click **Build City**.
5. Import the Higgsfield GLBs (`client/public/models/*.glb`) by dragging them
   into the Content Browser (Interchange imports GLB natively; enable Nanite
   on the meshes in bulk via right-click → Nanite → Enable).
6. Vehicles: create a Blueprint subclass of `GTAVehiclePawn`, assign a
   skeletal vehicle mesh + `ChaosWheeledVehicleMovementComponent` wheel
   setups, plus Input Actions/Mapping Context (WASD + Space) for the four
   exposed actions.
7. For the animated pedestrians, import `ped-civilian-rigged.glb` — the
   skeleton comes in via Interchange; retarget any humanoid AnimBP.

## Porting roadmap (web → UE)

- [x] World data contract (city.json) + importer
- [x] Wanted/heat subsystem
- [x] Vehicle pawn + camera feel
- [ ] Traffic/ped AI (port `trafficSystem.js` / `pedManager.js` onto
      MassEntity or simple AActor pools)
- [ ] Police director (pursuit `AIController` + roadblocks/heli)
- [ ] Missions (port `missionDirector.js` step machine to a UObject graph)
- [ ] Saves → `USaveGame` or keep the FastAPI backend via HTTP module

The Python generator and Higgsfield asset pipeline stay engine-agnostic —
that's the deliberate architecture bet: gameplay data and assets outlive the
renderer choice.
