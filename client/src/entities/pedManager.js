// Pedestrian population: spawning near the player, sidewalk wandering along the
// road graph, and state-machine brains (idle/walk/flee/panic/call-police/clerk).
// Also detects vehicles ploughing into peds.

import * as THREE from 'three';
import { Ped } from './pedestrian.js';
import { PED_OUTFITS, CLERK_OUTFIT } from './catalog.js';
import { DISTRICT, KIND } from '../world/cityData.js';
import { CFG } from '../core/config.js';

const DENSITY = {
  [DISTRICT.DOWNTOWN]: 22, [DISTRICT.COMMERCIAL]: 18, [DISTRICT.RESIDENTIAL]: 12,
  [DISTRICT.INDUSTRIAL]: 6, [DISTRICT.PARK]: 16, [DISTRICT.RURAL]: 2, [DISTRICT.WATER]: 0,
};

export class PedManager {
  constructor(G) {
    this.G = G;
    this.peds = [];
    this.clerks = new Map(); // zoneId -> ped
    this.spawnT = 0;

    G.events.on('gunshot', ({ pos }) => this.alarm(pos, 32, true));
    G.events.on('explosion', ({ pos }) => this.alarm(pos, 60, true));
    G.events.on('carjack', ({ vehicle }) => this.alarm(vehicle.position, 18, false));
    G.events.on('zoneRegistered', (z) => this.onZone(z));
    G.events.on('zoneUnregistered', (z) => this.offZone(z));
  }

  onZone(zone) {
    if ((zone.kind === KIND.SHOP || zone.kind === KIND.GUNSHOP || zone.kind === KIND.BANK) && zone.clerkPos) {
      const ped = new Ped(this.G, zone.clerkPos.clone(), CLERK_OUTFIT, { isClerk: true });
      ped.state = 'clerk';
      ped.zone = zone;
      if (zone.counterFront) ped.faceToward(zone.counterFront.x, zone.counterFront.z);
      this.peds.push(ped);
      this.clerks.set(zone.id, ped);
    }
  }

  offZone(zone) {
    const ped = this.clerks.get(zone.id);
    if (ped) {
      this.clerks.delete(zone.id);
      this.removePed(ped);
    }
  }

  clerkFor(zone) {
    const ped = this.clerks.get(zone.id);
    return ped && !ped.dead ? ped : null;
  }

  alarm(pos, radius, hard) {
    for (const ped of this.peds) {
      if (ped.dead || ped.state === 'clerk') continue;
      const d = ped.position.distanceTo(pos);
      if (d < radius) {
        ped.threat = pos.clone();
        ped.state = d < radius * 0.5 && hard ? 'panic' : 'flee';
        ped.stateT = 0;
      }
    }
  }

  anyWitnessNear(pos, radius) {
    for (const ped of this.peds) {
      if (!ped.dead && ped.position.distanceTo(pos) < radius) return true;
    }
    return false;
  }

  removePed(ped) {
    const i = this.peds.indexOf(ped);
    if (i >= 0) this.peds.splice(i, 1);
    if (!ped.dead) ped.dispose();
  }

  _spawnOne() {
    const { G } = this;
    const p = G.player.position;
    const edge = G.nav.randomEdgeNear(p.x, p.z, 45, 110);
    if (!edge) return;
    const a = G.nav.nodes[edge.a], b = G.nav.nodes[edge.b];
    const t = Math.random();
    const dirX = b.x - a.x, dirZ = b.z - a.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const side = Math.random() < 0.5 ? 1 : -1;
    const off = (G.city.roadHalf(edge.t) + 1.7) * side;
    const x = a.x + dirX * t + (-dirZ / len) * off;
    const z = a.z + dirZ * t + (dirX / len) * off;
    if (!G.chunks.isLoadedAt(x, z)) return;
    if (G.city.isWaterAt(x, z)) return;

    const outfit = PED_OUTFITS[(Math.random() * PED_OUTFITS.length) | 0];
    const ped = new Ped(G, new THREE.Vector3(x, 0.05, z), outfit);
    ped.edge = edge;
    ped.toNode = Math.random() < 0.5 ? edge.a : edge.b;
    ped.side = side;
    ped.brainT = Math.random() * 0.3;
    this.peds.push(ped);
  }

  sidewalkTarget(ped) {
    const { G } = this;
    const to = G.nav.nodes[ped.toNode];
    const from = G.nav.otherEnd(ped.edge, ped.toNode);
    const f = G.nav.nodes[from];
    const dx = to.x - f.x, dz = to.z - f.z;
    const len = Math.hypot(dx, dz) || 1;
    const off = (G.city.roadHalf(ped.edge.t) + 1.7) * ped.side;
    return { x: to.x + (-dz / len) * off, z: to.z + (dx / len) * off };
  }

  update(dt) {
    const { G } = this;
    const p = G.player;
    if (!p) return;

    // population control
    this.spawnT -= dt;
    const wanted = CFG.smoke ? 8 : (DENSITY[G.city.districtAt(p.position.x, p.position.z)] ?? 8);
    const ambient = this.peds.filter((x) => !x.isClerk).length;
    if (this.spawnT <= 0 && ambient < wanted) {
      this.spawnT = 0.25;
      this._spawnOne();
    }

    // vehicle-vs-ped hits
    for (const v of G.vehicles.vehicles) {
      const speed = v.speed;
      if (speed < 4.5) continue;
      const r = Math.max(v.def.size[0], v.def.size[2]) * 0.5 + 0.5;
      for (const ped of this.peds) {
        if (ped.dead) continue;
        const d = ped.position.distanceTo(v.position);
        if (d < r) {
          const vel = v.velocity;
          ped.die(new THREE.Vector3(vel.x * 9, 60 + speed * 3, vel.z * 9), v.driver === 'player', true);
          v.applyDamage(2, null, false, true);
          G.events.emit('crime', {
            type: 'pedRunOver', pos: ped.position.clone(),
            severity: v.driver === 'player' ? 26 : 0, witnessRadius: 34 });
        } else if (d < r + 3.5 && ped.state === 'walk') {
          // dive out of the way
          ped.state = 'flee';
          ped.threat = v.position.clone();
          ped.stateT = 0;
          if (v.driver === 'player' && Math.random() < 0.4) G.audio?.play('scream', { pos: ped.position, vol: 0.35 });
        }
      }
    }

    for (let i = this.peds.length - 1; i >= 0; i--) {
      const ped = this.peds[i];
      if (ped.dead) { this.peds.splice(i, 1); continue; }
      const distToPlayer = ped.position.distanceTo(p.position);
      if (!ped.isClerk && distToPlayer > 135) { this.removePed(ped); continue; }

      ped.brainT = (ped.brainT ?? 0) - dt;
      ped.stateT += dt;
      if (ped.brainT <= 0) {
        ped.brainT = 0.22;
        this.think(ped, distToPlayer);
      }
      this.act(ped, dt);
      ped.animate(dt);
    }
  }

  think(ped, distToPlayer) {
    const { G } = this;
    const p = G.player;
    switch (ped.state) {
      case 'walk':
        // react to a gun pointed at them
        if (p.aiming && distToPlayer < 12 && G.weapons.currentDef && !G.weapons.currentDef.melee) {
          ped.state = 'flee';
          ped.threat = p.position.clone();
          ped.stateT = 0;
        } else if (Math.random() < 0.015) {
          ped.state = 'idle';
          ped.stateT = 0;
          ped.idleFor = 1.5 + Math.random() * 3;
        }
        break;
      case 'idle':
        if (ped.stateT > ped.idleFor) { ped.state = 'walk'; ped.stateT = 0; }
        break;
      case 'panic':
        if (ped.stateT > 1.1) { ped.state = 'flee'; ped.stateT = 0; }
        break;
      case 'flee':
        if (ped.stateT > 6 && Math.random() < 0.18 && !ped.called) {
          ped.called = true;
          ped.state = 'call';
          ped.stateT = 0;
        }
        break;
      case 'call':
        if (ped.stateT > 2.6) {
          G.wanted?.reportCrime(ped.position);
          G.ui?.toast('911', 'Someone reported you to the police!');
          ped.state = 'flee';
          ped.stateT = 0;
        }
        break;
    }
  }

  act(ped, dt) {
    const { G } = this;
    switch (ped.state) {
      case 'walk': {
        if (!ped.edge) return;
        const t = this.sidewalkTarget(ped);
        const arrived = ped.moveToward(t.x, t.z, 1.6, dt);
        if (arrived) {
          const prev = ped.edge;
          ped.edge = G.nav.nextEdge(ped.toNode, prev);
          ped.toNode = G.nav.otherEnd(ped.edge, ped.toNode);
        }
        break;
      }
      case 'idle':
        ped.speed = 0;
        break;
      case 'panic': {
        ped.speed = 0;
        ped.handsUp = true;
        break;
      }
      case 'flee': {
        ped.handsUp = false;
        const away = ped.threat
          ? Math.atan2(ped.position.x - ped.threat.x, ped.position.z - ped.threat.z)
          : ped.yaw;
        const tx = ped.position.x + Math.sin(away) * 8 + (Math.random() - 0.5) * 2;
        const tz = ped.position.z + Math.cos(away) * 8 + (Math.random() - 0.5) * 2;
        ped.moveToward(tx, tz, 5.4, dt);
        break;
      }
      case 'call': {
        ped.speed = 0;
        ped.aimPose = false;
        ped.parts.armR.rotation.x = 2.6; // phone to ear
        break;
      }
      case 'clerk': {
        ped.speed = 0;
        break;
      }
    }
  }
}
