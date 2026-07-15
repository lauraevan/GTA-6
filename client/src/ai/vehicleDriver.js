// Steering brain for AI-controlled `driven` vehicles (cop cruisers, racers):
// path following, pursuit with lead prediction + PIT/ram, obstacle avoidance,
// stuck recovery.

import * as THREE from 'three';
import { clamp } from '../core/mathx.js';

export class VehicleDriver {
  constructor(G, vehicle) {
    this.G = G;
    this.v = vehicle;
    this.mode = 'idle';
    this.path = null;
    this.pathIdx = 0;
    this.loop = false;
    this.targetFn = null;
    this.speedMul = 1;
    this.aggression = 0.6;
    this.stuckT = 0;
    this.reverseT = 0;
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  followPath(points, { loop = false, speedMul = 1 } = {}) {
    this.mode = 'path';
    this.path = points;
    this.pathIdx = 0;
    this.loop = loop;
    this.speedMul = speedMul;
  }

  chase(targetFn, aggression = 0.7) {
    this.mode = 'chase';
    this.targetFn = targetFn;
    this.aggression = aggression;
  }

  stop() { this.mode = 'idle'; }

  /** current world target point or null */
  _target() {
    if (this.mode === 'path' && this.path) {
      const pt = this.path[this.pathIdx];
      if (!pt) return null;
      const t = this._v1.set(pt[0], 0, pt[1]);
      const d = Math.hypot(t.x - this.v.position.x, t.z - this.v.position.z);
      if (d < 7.5) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) {
          if (this.loop) this.pathIdx = 0;
          else { this.mode = 'idle'; return null; }
        }
      }
      return t;
    }
    if (this.mode === 'chase' && this.targetFn) {
      const { pos, vel } = this.targetFn();
      // lead the target
      return this._v1.copy(pos).addScaledVector(vel ?? this._v2.set(0, 0, 0), 0.55);
    }
    return null;
  }

  update(dt) {
    const v = this.v;
    const c = v.controls;
    if (this.mode === 'idle' || v.dead) {
      c.throttle = 0; c.brake = 0.4; c.steer = 0; c.handbrake = false;
      return;
    }
    const target = this._target();
    if (!target) { c.throttle = 0; c.brake = 0.5; return; }

    // reverse recovery
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.throttle = 0; c.brake = 1; // reverse
      c.steer = this._recoverSteer;
      if (this.reverseT <= 0) this.stuckT = 0;
      return;
    }

    // local-space heading error
    const toT = this._v2.subVectors(target, v.position);
    toT.y = 0;
    const dist = toT.length();
    const fwd = v.forward(this._v1).setY(0).normalize();
    const angle = Math.atan2(
      fwd.x * toT.z - fwd.z * toT.x,   // cross.y (signed)
      fwd.x * toT.x + fwd.z * toT.z);  // dot
    // NOTE: steer>0 turns left in our physics (positive steering value)
    let steer = clamp(angle * 1.6, -1, 1);

    const speed = v.speed;
    let desired = 0;
    if (this.mode === 'chase') {
      desired = v.def.maxSpeed * this.speedMul;
      if (dist < 14) desired = Math.max(10, dist * 1.4);
      // PIT/ram: if right beside the target, steer into it
      if (dist < 6 && speed > 10) steer = clamp(angle * 4, -1, 1);
    } else {
      // slow for corners
      const cornerFactor = 1 - Math.min(Math.abs(angle) / 1.4, 0.75);
      desired = v.def.maxSpeed * this.speedMul * (0.45 + 0.55 * cornerFactor);
    }

    // obstacle rays (static geometry): brake/steer around
    const origin = v.position.clone().setY(0.7);
    const lookAhead = Math.max(7, speed * 0.75);
    const rightDir = this._v2.set(fwd.z, 0, -fwd.x);
    let blocked = 0;
    for (const side of [-0.5, 0, 0.5]) {
      const dir = fwd.clone().addScaledVector(rightDir, side * 0.5).normalize();
      const hit = this.G.physics.raycast(origin, origin.clone().addScaledVector(dir, lookAhead), { skipDynamic: true });
      if (hit) {
        blocked++;
        steer += side === 0 ? (steer >= 0 ? 0.55 : -0.55) : -side * 0.8;
      }
    }
    if (blocked >= 2) desired = Math.min(desired, 6);

    // target behind → aggressive turn, maybe reverse
    if (Math.abs(angle) > 2.4 && dist > 4 && speed < 6) {
      this._recoverSteer = steer > 0 ? -1 : 1;
      this.reverseT = 0.9;
      return;
    }

    c.steer = clamp(steer, -1, 1);
    if (speed < desired) { c.throttle = 1; c.brake = 0; }
    else if (speed > desired * 1.15) { c.throttle = 0; c.brake = 0.6; }
    else { c.throttle = 0.25; c.brake = 0; }
    c.handbrake = Math.abs(angle) > 1.1 && speed > 14;

    // stuck detection
    if (speed < 0.8 && c.throttle > 0.5) {
      this.stuckT += dt;
      if (this.stuckT > 1.6) {
        this._recoverSteer = Math.random() < 0.5 ? -1 : 1;
        this.reverseT = 1.0;
      }
    } else this.stuckT = Math.max(0, this.stuckT - dt);
  }
}
