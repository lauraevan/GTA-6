// Vehicle lifecycle: registry, parked-car population per chunk, wreck cleanup,
// driverless-car settling, player headlight spotlights, owned-car spawning.

import * as THREE from 'three';
import { Rng } from '../core/mathx.js';
import { VehicleEntity } from './vehicleEntity.js';
import { PARKED_POOL, TRAFFIC_COLORS } from './catalog.js';
import { DISTRICT } from '../world/cityData.js';

export class VehicleManager {
  constructor(G) {
    this.G = G;
    this.vehicles = new Set();
    this.parkedByChunk = new Map();

    // headlight pool for the player's car
    this.spots = [];
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight(0xfff2d0, 0, 46, 0.42, 0.5, 1.2);
      s.castShadow = false;
      const t = new THREE.Object3D();
      G.scene.add(s, t);
      s.target = t;
      this.spots.push(s);
    }
  }

  spawn(model, pos, ry = 0, opts = {}) {
    const v = new VehicleEntity(this.G, model, pos, ry, opts);
    this.vehicles.add(v);
    return v;
  }

  remove(v) {
    v.dispose();
    this.vehicles.delete(v);
  }

  onChunkLoad(cx, cz, data) {
    const { G } = this;
    const key = `${cx},${cz}`;
    if (this.parkedByChunk.has(key)) return;
    const city = G.city;
    const rng = new Rng((cx * 73856093) ^ (cz * 19349663) ^ city.meta.seed);
    const list = [];
    const cb = city.meta.chunkBlocks;
    for (let bz = cz * cb; bz < (cz + 1) * cb; bz++) {
      for (let bx = cx * cb; bx < (cx + 1) * cb; bx++) {
        const d = city.districts[bz]?.[bx];
        if (d !== DISTRICT.COMMERCIAL && d !== DISTRICT.RESIDENTIAL && d !== DISTRICT.DOWNTOWN) continue;
        const n = rng.int(0, 2);
        for (let i = 0; i < n && list.length < 7; i++) {
          const lineX = city.linePos(bx);
          const x = lineX + 4.7;
          const z = -city.half + bz * city.blockSize + rng.range(10, 50);
          const model = rng.pick(PARKED_POOL);
          const v = this.spawn(model, new THREE.Vector3(x, 0, z), rng.chance(0.5) ? 0 : Math.PI, {
            mode: 'parked',
            paint: rng.pick(TRAFFIC_COLORS),
            locked: rng.chance(0.4),
            chunkKey: key,
          });
          list.push(v);
        }
      }
    }
    this.parkedByChunk.set(key, list);
  }

  onChunkUnload(cx, cz) {
    const key = `${cx},${cz}`;
    const list = this.parkedByChunk.get(key);
    if (!list) return;
    for (const v of list) {
      const untouched = v.mode === 'parked' && !v.dead && v.driver !== 'player' && !v.owned;
      if (untouched) this.remove(v);
      else v.chunkKey = null; // stolen/moved cars live on until far cleanup
    }
    this.parkedByChunk.delete(key);
  }

  /** nearest vehicle the player could enter */
  findNearestEnterable(pos, maxDist = 3.4) {
    let best = null, bd = maxDist;
    for (const v of this.vehicles) {
      if (v.dead) continue;
      if (v.driver === 'player') continue;
      if (v.mode === 'wreck') continue;
      const d = v.position.distanceTo(pos) - Math.max(v.def.size[0], v.def.size[2]) * 0.32;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  update(dt) {
    const { G } = this;
    const playerPos = G.player?.position;
    for (const v of [...this.vehicles]) {
      v.update(dt);

      // driverless driven cars settle back to parked once stopped
      if (v.mode === 'driven' && !v.driver) {
        v.controls.throttle = 0; v.controls.brake = 0.6; v.controls.handbrake = true;
        if (v.speed < 0.6) {
          v._settleT = (v._settleT ?? 1.2) - dt;
          if (v._settleT <= 0) { v.setMode('parked'); v._settleT = undefined; }
        }
      }

      // far cleanup of wrecks & orphans
      if (playerPos) {
        const d = v.position.distanceTo(playerPos);
        if (v.dead && (v.wreckT ?? 0) <= 0 && d > 55) this.remove(v);
        else if (!v.owned && !v.chunkKey && v.driver == null && v.mode !== 'traffic' && d > 340) this.remove(v);
        else if (v.position.y < -25) {
          if (v.driver === 'player') { /* player.update handles */ } else this.remove(v);
        }
      }
    }

    // player headlights
    const pv = G.player?.vehicle;
    const night = (G.daynight?.sunFactor ?? 1) < 0.35;
    if (pv && night && !pv.dead) {
      const fwd = pv.forward(new THREE.Vector3());
      const base = pv.position.clone().add(new THREE.Vector3(0, 0.6, 0));
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(pv.mesh.quaternion);
      this.spots.forEach((s, i) => {
        const side = i === 0 ? -1 : 1;
        s.position.copy(base).addScaledVector(right, side * pv.def.size[0] * 0.32)
          .addScaledVector(fwd, pv.def.size[2] * 0.45);
        s.target.position.copy(s.position).addScaledVector(fwd, 24).add(new THREE.Vector3(0, -2.2, 0));
        s.intensity = 85;
      });
    } else {
      for (const s of this.spots) s.intensity = 0;
    }
  }

  /** spawn (or move) an owned car onto the garage pad */
  spawnOwned(record, pad) {
    if (this.ownedSpawn && !this.ownedSpawn.dead) this.remove(this.ownedSpawn);
    this.ownedSpawn = this.spawn(record.model, new THREE.Vector3(pad.x, 0, pad.z), pad.ry ?? 0, {
      mode: 'parked', paint: record.paint, mods: { ...record.mods }, owned: true, locked: false,
    });
    return this.ownedSpawn;
  }

  collectSave() {
    return null; // owned car records live in G.garage
  }
}
