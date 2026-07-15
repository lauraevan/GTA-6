// Ambient traffic: kinematic cars following the lane graph with traffic-light
// intersections, car-following, honking, swerving away from maniacs, and
// crash conversion into real physics wrecks (driver flees).

import * as THREE from 'three';
import { Ped } from '../entities/pedestrian.js';
import { PED_OUTFITS, TRAFFIC_POOL, TRAFFIC_COLORS } from '../entities/catalog.js';
import { CFG } from '../core/config.js';
import { clamp } from '../core/mathx.js';

const LIGHT_CYCLE = 14; // seconds NS+EW

export class TrafficSystem {
  constructor(G) {
    this.G = G;
    this.cars = [];      // {v, edge, toNode, speed, curSpeed, honkT, blockedT, swerve}
    this.t = 0;
    this.spawnT = 0;
    G.events.on('trafficCrashed', ({ vehicle }) => this.onCrashed(vehicle));
  }

  /** green axis at a node right now: 'ns' | 'ew' */
  lightPhase(nodeId) {
    const off = (nodeId * 3.7) % LIGHT_CYCLE;
    return ((this.t + off) % LIGHT_CYCLE) < LIGHT_CYCLE / 2 ? 'ns' : 'ew';
  }

  isRedFor(edge, toNodeId) {
    const { G } = this;
    // lights only at avenue intersections (3+ edges incl. an avenue)
    const adj = G.nav.adj[toNodeId];
    if (adj.length < 3 || !adj.some((e) => e.t === 1)) return false;
    const a = G.nav.nodes[edge.a], b = G.nav.nodes[edge.b];
    const ns = Math.abs(a.z - b.z) > Math.abs(a.x - b.x);
    return this.lightPhase(toNodeId) !== (ns ? 'ns' : 'ew');
  }

  onCrashed(v) {
    const idx = this.cars.findIndex((c) => c.v === v);
    if (idx < 0) return;
    this.cars.splice(idx, 1);
    v.driver = null;
    v.setMode('wreck');
    // driver bails and flees
    const door = v.doorPos(-1).setY(0.05);
    const outfit = PED_OUTFITS[(Math.random() * PED_OUTFITS.length) | 0];
    const ped = new Ped(this.G, door, outfit);
    ped.state = 'flee';
    ped.threat = v.position.clone();
    this.G.peds.peds.push(ped);
  }

  /** player carjacks this car: eject driver ped, hand over the vehicle */
  onCarjacked(v) {
    const idx = this.cars.findIndex((c) => c.v === v);
    if (idx < 0) return;
    this.cars.splice(idx, 1);
    const door = v.doorPos(1).setY(0.05);
    const outfit = PED_OUTFITS[(Math.random() * PED_OUTFITS.length) | 0];
    const ped = new Ped(this.G, door, outfit);
    ped.state = 'flee';
    ped.threat = v.position.clone();
    this.G.peds.peds.push(ped);
    v.driver = null;
    if (Math.random() < 0.3) v.startAlarm();
  }

  _spawnOne() {
    const { G } = this;
    const p = G.player.position;
    const edge = G.nav.randomEdgeNear(p.x, p.z, 90, 180);
    if (!edge) return;
    const a = G.nav.nodes[edge.a], b = G.nav.nodes[edge.b];
    const toNode = Math.random() < 0.5 ? edge.a : edge.b;
    const from = G.nav.nodes[G.nav.otherEnd(edge, toNode)];
    const to = G.nav.nodes[toNode];
    const t = 0.3 + Math.random() * 0.4;
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const off = G.nav.laneOffset(edge.t, 0);
    // right-hand traffic: lane offset to the right of travel dir
    const x = from.x + dx * t + (-dz / len) * -off;
    const z = from.z + dz * t + (dx / len) * -off;
    if (!G.chunks.isLoadedAt(x, z)) return;
    if (Math.hypot(x - p.x, z - p.z) < 60) return;

    const model = TRAFFIC_POOL[(Math.random() * TRAFFIC_POOL.length) | 0];
    const v = G.vehicles.spawn(model, new THREE.Vector3(x, 0, z), Math.atan2(dx, dz), {
      mode: 'traffic',
      paint: model === 'taxi' ? undefined : TRAFFIC_COLORS[(Math.random() * TRAFFIC_COLORS.length) | 0],
    });
    v.driver = 'traffic';
    this.cars.push({
      v, edge, toNode,
      speed: this.G.city.roadSpeed(edge.t) * (0.72 + Math.random() * 0.2),
      curSpeed: 4, honkT: 0, blockedT: 0, swerve: 0,
    });
  }

  laneTarget(car) {
    const { G } = this;
    const to = G.nav.nodes[car.toNode];
    const from = G.nav.nodes[G.nav.otherEnd(car.edge, car.toNode)];
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const off = G.nav.laneOffset(car.edge.t, 0) + car.swerve;
    return {
      x: to.x + (-dz / len) * -off,
      z: to.z + (dx / len) * -off,
      dirX: dx / len, dirZ: dz / len,
    };
  }

  update(dt) {
    const { G } = this;
    this.t += dt;
    const p = G.player;
    if (!p) return;

    this.spawnT -= dt;
    const target = CFG.smoke ? 5 : CFG.trafficTarget;
    if (this.spawnT <= 0 && this.cars.length < target) {
      this.spawnT = 0.4;
      this._spawnOne();
    }

    const playerV = p.vehicle;

    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      const v = car.v;
      if (v.dead || v.mode !== 'traffic') { this.cars.splice(i, 1); continue; }
      const distP = v.position.distanceTo(p.position);
      if (distP > 240) { this.cars.splice(i, 1); G.vehicles.remove(v); continue; }

      const t = this.laneTarget(car);
      const toT = new THREE.Vector3(t.x - v.position.x, 0, t.z - v.position.z);
      const dNode = toT.length();

      // arrived at node → next edge
      if (dNode < 6) {
        const prev = car.edge;
        // prefer going straight
        const options = G.nav.adj[car.toNode].filter((e) => e !== prev);
        let next = null;
        if (options.length) {
          const dir = new THREE.Vector2(t.dirX, t.dirZ);
          options.sort((e1, e2) => this._straightness(car.toNode, e2, dir) - this._straightness(car.toNode, e1, dir));
          next = Math.random() < 0.65 ? options[0] : options[(Math.random() * options.length) | 0];
        } else next = prev;
        car.edge = next;
        car.toNode = G.nav.otherEnd(next, car.toNode);
        car.speed = G.city.roadSpeed(next.t) * (0.72 + Math.random() * 0.2);
      }

      // desired speed with rules
      let desired = car.speed;

      // red light: stop short of the node
      if (dNode < 16 && dNode > 7 && this.isRedFor(car.edge, car.toNode)) desired = 0;

      // car following: anything ahead in my lane?
      const heading = toT.clone().normalize();
      const ahead = this._obstacleAhead(car, heading, playerV);
      if (ahead !== null) {
        desired = Math.min(desired, Math.max(0, (ahead - 4.5) * 1.2));
        if (desired < 1) {
          car.blockedT += dt;
          if (car.blockedT > 2.2 && car.honkT <= 0) {
            car.honkT = 2.5 + Math.random() * 2;
            G.audio?.play('horn', { pos: v.position, vol: 0.5 });
          }
        } else car.blockedT = 0;
      } else car.blockedT = 0;
      car.honkT -= dt;

      // maniac avoidance: player car coming at us fast
      if (playerV && playerV.speed > 14) {
        const rel = v.position.clone().sub(playerV.position);
        const d = rel.length();
        if (d < 16) {
          const closing = -rel.normalize().dot(playerV.velocity.clone().normalize());
          if (closing > 0.75) {
            car.swerve = clamp(car.swerve + dt * 8, 0, 2.6);
            if (car.honkT <= 0) {
              car.honkT = 3;
              G.audio?.play('horn', { pos: v.position, vol: 0.6 });
            }
          }
        } else car.swerve = Math.max(0, car.swerve - dt * 2);
      } else car.swerve = Math.max(0, car.swerve - dt * 2);

      // integrate speed
      const accel = desired > car.curSpeed ? 6 : 14;
      car.curSpeed += clamp(desired - car.curSpeed, -accel * dt, accel * dt);
      car.curSpeed = Math.max(0, car.curSpeed);

      // kinematic move via body velocity (collisions still push dynamic bodies)
      const dir = toT.normalize();
      const body = v.body;
      body.velocity.set(dir.x * car.curSpeed, 0, dir.z * car.curSpeed);
      // face travel direction
      if (car.curSpeed > 0.5) {
        const yaw = Math.atan2(dir.x, dir.z);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
        const target = new (body.quaternion.constructor)(q.x, q.y, q.z, q.w);
        // cannon-es slerp writes into the third argument
        body.quaternion.slerp(target, Math.min(1, 6 * dt), body.quaternion);
      } else {
        body.velocity.set(0, 0, 0);
      }
    }
  }

  _straightness(nodeId, edge, dir) {
    const { G } = this;
    const other = G.nav.otherEnd(edge, nodeId);
    const n = G.nav.nodes[nodeId], o = G.nav.nodes[other];
    const dx = o.x - n.x, dz = o.z - n.z;
    const len = Math.hypot(dx, dz) || 1;
    return (dx / len) * dir.x + (dz / len) * dir.y;
  }

  /** distance to nearest obstacle ahead in lane, or null */
  _obstacleAhead(car, heading, playerV) {
    const v = car.v;
    let best = null;
    const check = (pos) => {
      const rel = new THREE.Vector3().subVectors(pos, v.position);
      const fwd = rel.dot(heading);
      if (fwd < 1 || fwd > 13) return;
      const latV = rel.clone().addScaledVector(heading, -fwd);
      if (latV.length() < 2.4) best = best === null ? fwd : Math.min(best, fwd);
    };
    for (const other of this.cars) {
      if (other === car) continue;
      check(other.v.position);
    }
    if (playerV) check(playerV.position);
    else if (this.G.player) check(this.G.player.position);
    for (const cu of this.G.police?.carUnits ?? []) check(cu.vehicle.position);
    return best;
  }
}
