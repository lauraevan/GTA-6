// Police response director. Escalation by wanted stars:
//   1★ patrol cruisers pursue · 2★ more cars + foot cops deploy
//   3★ roadblocks with spike strips · 4★ SWAT van + helicopter
//   5★ maximum pressure, helicopter door-gunner
// Cop behaviours: pursuit driving (PIT/ram), on-foot engage/advance/arrest,
// spike strips, searchlight helicopter, arrest → BUSTED.

import * as THREE from 'three';
import { Ped } from '../entities/pedestrian.js';
import { COP_OUTFIT, SWAT_OUTFIT } from '../entities/catalog.js';
import { VehicleDriver } from './vehicleDriver.js';
import { CFG } from '../core/config.js';
import { clamp } from '../core/mathx.js';

const CAR_BUDGET = [0, 2, 3, 5, 6, 7];
const AMBIENT_PATROLS = 1;

export class PoliceDirector {
  constructor(G) {
    this.G = G;
    this.carUnits = [];   // {vehicle, driver, state, deployT, abandonedT, isSwat}
    this.footCops = [];   // Ped (isCop) with brain fields
    this.roadblocks = []; // {vehicles, cops, spike, life}
    this.heli = null;
    this.spawnT = 0;
    this.blockT = 20;
    this._v = new THREE.Vector3();

    G.events.on('wantedCleared', () => this.standDown());
  }

  get stars() { return this.G.wanted.stars; }

  anyCopNear(pos, r) {
    for (const c of this.footCops) if (!c.dead && c.position.distanceTo(pos) < r) return true;
    for (const u of this.carUnits) if (u.vehicle.position.distanceTo(pos) < r) return true;
    return false;
  }

  // ---------- spawning ----------

  _spawnCarUnit(swat = false) {
    const { G } = this;
    if (this.carUnits.length >= CFG.maxCopCars) return;
    const p = G.player.position;
    const edge = G.nav.randomEdgeNear(p.x, p.z, 110, 200);
    if (!edge) return;
    const n = G.nav.nodes[edge.a];
    if (!G.chunks.isLoadedAt(n.x, n.z)) return;
    const vehicle = G.vehicles.spawn(swat ? 'sturm' : 'cruiser',
      new THREE.Vector3(n.x, 0, n.z), Math.random() * Math.PI * 2, { mode: 'parked' });
    vehicle.driver = 'cop';
    vehicle.setMode('driven');
    const driver = new VehicleDriver(G, vehicle);
    driver.chase(() => ({
      pos: G.wanted.copSeesPlayer || G.wanted.unseenFor < 6
        ? G.player.position
        : (G.wanted.lastSeenPos ?? G.player.position),
      vel: G.player.vehicle ? G.player.vehicle.velocity : this._v.set(0, 0, 0),
    }), 0.5 + this.stars * 0.1);
    this.carUnits.push({ vehicle, driver, state: 'chase', deployT: 0, abandonedT: 0, isSwat: swat, sirenOn: this.stars > 0 });
  }

  _spawnFootCop(pos, swat = false) {
    const cop = new Ped(this.G, pos, swat ? SWAT_OUTFIT : COP_OUTFIT,
      { isCop: !swat, isSwat: swat, gun: true, capColor: swat ? '#0c0e14' : '#101828' });
    cop.state = 'engage';
    cop.shootT = 1 + Math.random();
    cop.arrestT = 0;
    cop.moveT = 0;
    this.footCops.push(cop);
    return cop;
  }

  _spawnRoadblock() {
    const { G } = this;
    const p = G.player;
    if (this.roadblocks.length >= 2) return;
    // project ahead along player travel
    const vel = p.vehicle ? p.vehicle.velocity : this._v.set(0, 0, 0);
    if (vel.length() < 8) return;
    const aheadPos = p.position.clone().addScaledVector(vel.clone().normalize(), 170);
    const node = G.nav.nearestNode(aheadPos.x, aheadPos.z);
    if (!node || !G.chunks.isLoadedAt(node.x, node.z)) return;
    if (Math.hypot(node.x - p.position.x, node.z - p.position.z) < 90) return;

    const across = vel.clone().normalize();
    const perp = new THREE.Vector3(-across.z, 0, across.x);
    const yaw = Math.atan2(perp.x, perp.z);
    const vehicles = [];
    for (const s of [-1, 1]) {
      const v = G.vehicles.spawn('cruiser',
        new THREE.Vector3(node.x + perp.x * s * 2.6, 0, node.z + perp.z * s * 2.6), yaw, { mode: 'parked' });
      v._roadblock = true;
      vehicles.push(v);
    }
    const cops = [];
    for (let i = 0; i < 3; i++) {
      cops.push(this._spawnFootCop(new THREE.Vector3(
        node.x + perp.x * (i - 1) * 3 - across.x * 4, 0.05,
        node.z + perp.z * (i - 1) * 3 - across.z * 4)));
    }
    // spike strip across the lane, slightly before the cars
    const spikePos = new THREE.Vector3(node.x - across.x * 9, 0, node.z - across.z * 9);
    const spike = this._makeSpike(spikePos, yaw);
    this.roadblocks.push({ vehicles, cops, spike, life: 70 });
    G.audio?.play('radioChatter', { vol: 0.3 });
  }

  _makeSpike(pos, yaw) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(11, 0.1, 0.5),
      new THREE.MeshStandardMaterial({ color: '#772222', metalness: 0.6, roughness: 0.4 }));
    mesh.position.copy(pos).setY(0.06);
    mesh.rotation.y = yaw + Math.PI / 2;
    this.G.scene.add(mesh);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // along strip length? uses perp below
    return { mesh, pos: pos.clone(), yaw, hit: new Set() };
  }

  _spawnHeli() {
    if (this.heli) return;
    const { G } = this;
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#16181e', roughness: 0.5, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 5), bodyMat);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 3.4), bodyMat);
    tail.position.set(0, 0.4, -3.8);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.4),
      new THREE.MeshStandardMaterial({ color: '#22252c' }));
    rotor.position.y = 1.1;
    const skids = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 3.2), bodyMat);
    skids.position.y = -1.0;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12),
      new THREE.MeshStandardMaterial({ color: '#f22', emissive: '#f22', emissiveIntensity: 2 }));
    beacon.position.y = 0.9;
    group.add(body, tail, rotor, skids, beacon);
    const light = new THREE.SpotLight(0xfff8d8, 0, 90, 0.32, 0.4, 1);
    const lightTarget = new THREE.Object3D();
    group.add(light);
    this.G.scene.add(lightTarget);
    light.target = lightTarget;
    G.scene.add(group);
    this.heli = { group, rotor, light, lightTarget, angle: 0, shootT: 2 };
    G.audio?.startHeli();
  }

  _removeHeli() {
    if (!this.heli) return;
    this.G.scene.remove(this.heli.group, this.heli.lightTarget);
    this.G.audio?.stopHeli();
    this.heli = null;
  }

  standDown() {
    // cars drive off & despawn, foot cops walk away
    for (const u of this.carUnits) u.state = 'leave';
    for (const c of this.footCops) c.state = 'leave';
    this._removeHeli();
    for (const rb of this.roadblocks) rb.life = Math.min(rb.life, 6);
  }

  // ---------- per-frame ----------

  update(dt) {
    const { G } = this;
    const p = G.player;
    if (!p) return;
    const stars = this.stars;

    // budget management
    this.spawnT -= dt;
    const carTarget = stars > 0 ? CAR_BUDGET[stars] : AMBIENT_PATROLS;
    const active = this.carUnits.filter((u) => u.state !== 'leave').length;
    if (this.spawnT <= 0 && active < carTarget && G.state === 'playing') {
      this.spawnT = stars >= 4 ? 3.5 : 6;
      const wantSwat = stars >= 4 && !this.carUnits.some((u) => u.isSwat && u.state !== 'leave');
      this._spawnCarUnit(wantSwat);
    }
    if (stars >= 3) {
      this.blockT -= dt;
      if (this.blockT <= 0) {
        this.blockT = 24;
        this._spawnRoadblock();
      }
    }
    if (stars >= 4) this._spawnHeli();
    else if (stars === 0) this._removeHeli();

    // LOS / seen reporting
    const visRange = (60 * (G.weather?.visibility ?? 1)) * ((G.daynight?.sunFactor ?? 1) < 0.3 ? 0.75 : 1);
    const pPos = p.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const insideZone = G.zones.zoneAt(p.position);
    const checkSees = (from) => {
      if (from.distanceTo(p.position) > visRange) return false;
      if (insideZone) return from.distanceTo(p.position) < 14; // hiding indoors helps
      return G.physics.hasLOS(from.clone().setY(from.y + 1.4), pPos);
    };

    // --- car units
    for (let i = this.carUnits.length - 1; i >= 0; i--) {
      const u = this.carUnits[i];
      const v = u.vehicle;
      if (v.dead) {
        this.carUnits.splice(i, 1);
        G.events.emit('crime', { type: 'copCarDown', pos: v.position.clone(), severity: 0, witnessRadius: 0 });
        G.wanted.addHeat(50, v.position);
        continue;
      }
      const dist = v.position.distanceTo(p.position);

      if (u.state === 'leave') {
        u.driver.mode = 'idle';
        v.controls.throttle = 0; v.controls.brake = 0.6;
        if (dist > 90 || G.wanted.stars > 0) { G.vehicles.remove(v); this.carUnits.splice(i, 1); }
        else u.driver.update(dt);
        continue;
      }

      if (stars === 0) {
        // ambient patrol: wander via random far target
        if (!u._patrolTarget || v.position.distanceTo(u._patrolTarget) < 20) {
          const e = G.nav.randomEdgeNear(p.position.x, p.position.z, 60, 220);
          if (e) {
            const n = G.nav.nodes[e.a];
            u._patrolTarget = new THREE.Vector3(n.x, 0, n.z);
            u.driver.followPath([[n.x, n.z]], { speedMul: 0.35 });
          }
        }
        u.driver.update(dt);
        if (checkSees(v.position)) {
          // patrol spots active crime → handled via crime events; nothing extra here
        }
      } else {
        // pursuit
        if (u.state === 'chase') {
          u.driver.speedMul = 0.85 + stars * 0.06;
          u.driver.update(dt);
          // deploy foot cops when close & slow or player on foot
          const shouldDeploy = dist < 17 && (v.speed < 5 || (!p.vehicle && dist < 14));
          if (shouldDeploy && u.deployT <= 0) {
            u.deployT = 8;
            u.state = 'deployed';
            v.controls.throttle = 0; v.controls.brake = 1; v.controls.handbrake = true;
            const n = this.footCops.filter((c) => !c.dead).length;
            const maxFoot = 2 + stars * 2;
            for (const side of [-1, 1]) {
              if (n + 1 > maxFoot) break;
              const door = v.doorPos(side).setY(0.05);
              this._spawnFootCop(door, u.isSwat);
              if (u.isSwat) this._spawnFootCop(door.clone().add(new THREE.Vector3(0.6, 0, 0.6)), true);
            }
          }
        } else if (u.state === 'deployed') {
          v.controls.throttle = 0; v.controls.brake = 1;
          u.abandonedT += dt;
          // player drove off → re-engage driving
          if (dist > 40 && u.abandonedT > 3) {
            u.state = 'chase';
            u.abandonedT = 0;
          } else if (u.abandonedT > 26) {
            // becomes a world car (enterable), unit slot freed
            v.driver = null;
            this.carUnits.splice(i, 1);
            continue;
          }
        }
        if (checkSees(v.position)) G.wanted.reportSeen(v.position);
      }

      // siren visuals
      if (v.parts.sirenRed) {
        const on = stars > 0;
        const phase = Math.sin(G.wanted.t * 12 + u.vehicle.id);
        v.parts.sirenRed.emissiveIntensity = on ? (phase > 0 ? 3 : 0.2) : 0;
        v.parts.sirenBlue.emissiveIntensity = on ? (phase > 0 ? 0.2 : 3) : 0;
      }
    }

    // --- foot cops
    for (let i = this.footCops.length - 1; i >= 0; i--) {
      const cop = this.footCops[i];
      if (cop.dead) { this.footCops.splice(i, 1); continue; }
      const dist = cop.position.distanceTo(p.position);

      if (cop.state === 'leave') {
        cop.moveToward(cop.position.x + 30, cop.position.z + 30, 2.2, dt);
        if (dist > 70) { cop.dispose(); this.footCops.splice(i, 1); }
        cop.animate(dt);
        continue;
      }
      if (dist > 160) { cop.dispose(); this.footCops.splice(i, 1); continue; }

      const sees = checkSees(cop.position);
      if (sees) G.wanted.reportSeen(cop.position);

      this._footCopBrain(cop, dist, sees, dt);
      cop.animate(dt);
    }

    // --- roadblocks & spikes
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const rb = this.roadblocks[i];
      rb.life -= dt;
      this._checkSpike(rb.spike);
      if (rb.life <= 0) {
        G.scene.remove(rb.spike.mesh);
        for (const v of rb.vehicles) if (!v.dead && v.driver == null) G.vehicles.remove(v);
        this.roadblocks.splice(i, 1);
      }
    }

    // --- helicopter
    if (this.heli) this._updateHeli(dt);

    // --- vehicle bust: stopped & surrounded
    if (p.vehicle && p.vehicle.speed < 1.2 && stars > 0) {
      const near = this.footCops.filter((c) => !c.dead && c.position.distanceTo(p.position) < 4.5).length;
      if (near >= 2) {
        this._vehicleBustT = (this._vehicleBustT ?? 0) + dt;
        if (this._vehicleBustT > 2.2) p.busted();
      } else this._vehicleBustT = 0;
    } else this._vehicleBustT = 0;
  }

  _footCopBrain(cop, dist, sees, dt) {
    const { G } = this;
    const p = G.player;
    cop.shootT -= dt;

    const playerArmed = G.weapons.current !== 'fist' && !G.weapons.currentDef?.melee;
    const playerVehicleFast = p.vehicle && p.vehicle.speed > 6;

    // arrest attempt: unarmed-ish, slow, close
    if (!p.vehicle && dist < 3.0 && sees && p.speed < 2.5 && !playerArmed && G.wanted.stars > 0) {
      cop.arrestT += dt;
      cop.speed = 0;
      cop.faceToward(p.position.x, p.position.z);
      cop.aimPose = true;
      if (cop.arrestT > 1.4) p.busted();
      return;
    }
    cop.arrestT = 0;

    if (sees && dist < 46 && G.wanted.stars > 0) {
      // engage: face & shoot in bursts
      cop.faceToward(p.position.x, p.position.z);
      cop.aimPose = true;
      // keep some distance / advance slowly
      if (dist > 26 && !playerVehicleFast) {
        cop.moveToward(p.position.x, p.position.z, cop.isSwat ? 4.6 : 3.6, dt);
      } else if (dist < 7 && playerArmed) {
        // back off slightly
        const away = Math.atan2(cop.position.x - p.position.x, cop.position.z - p.position.z);
        cop.moveToward(cop.position.x + Math.sin(away) * 3, cop.position.z + Math.cos(away) * 3, 2.4, dt);
      } else cop.speed = 0;

      if (cop.shootT <= 0) {
        cop.shootT = (cop.isSwat ? 0.55 : 0.95) + Math.random() * 0.5;
        this._copShoot(cop, dist);
      }
    } else if (G.wanted.stars > 0) {
      // advance toward last seen
      cop.aimPose = false;
      const t = G.wanted.lastSeenPos ?? p.position;
      cop.moveToward(t.x, t.z, cop.isSwat ? 4.4 : 3.4, dt);
    } else {
      cop.state = 'leave';
    }
  }

  _copShoot(cop, dist) {
    const { G } = this;
    const p = G.player;
    const from = cop.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    const target = p.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    // accuracy: distance, player speed, vehicle armor
    let acc = (cop.isSwat ? 0.62 : 0.45) - dist * 0.006 - p.speed * 0.02;
    if (p.vehicle) acc -= 0.12;
    acc = clamp(acc, 0.08, 0.7);
    const err = (1 - acc) * 1.6;
    const dir = target.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * err, (Math.random() - 0.5) * err * 0.5, (Math.random() - 0.5) * err))
      .sub(from).normalize();
    G.weapons.rayShot(from, dir, {
      dmg: cop.isSwat ? 9 : 6, range: 60, byCop: true, muzzle: from });
    G.particles?.muzzle(from, dir);
    G.audio?.play(cop.isSwat ? 'rifle' : 'gunshot', { pos: cop.position, vol: 0.5 });
    G.events.emit('gunshot', { pos: cop.position.clone(), byPlayer: false });
  }

  _checkSpike(spike) {
    const { G } = this;
    const along = new THREE.Vector3(Math.sin(spike.yaw + Math.PI / 2), 0, Math.cos(spike.yaw + Math.PI / 2));
    const check = (v) => {
      if (spike.hit.has(v.id) || v.mode !== 'driven') return;
      const rel = v.position.clone().sub(spike.pos);
      const lat = Math.abs(rel.dot(along));
      const lon = rel.clone().addScaledVector(along, -rel.dot(along)).length();
      if (lat < 5.5 && lon < 1.4 && v.speed > 3) {
        spike.hit.add(v.id);
        v.burstTire(0); v.burstTire(1);
        if (Math.random() < 0.5) v.burstTire(2);
        if (v.driver === 'player') G.ui?.toast('Spike strip!', 'Tyres shredded');
      }
    };
    if (G.player.vehicle) check(G.player.vehicle);
    for (const u of this.carUnits) check(u.vehicle);
  }

  _updateHeli(dt) {
    const { G } = this;
    const h = this.heli;
    const p = G.player.position;
    h.angle += dt * 0.35;
    const r = 30;
    const groundY = Math.max(0, this.G.terrain?.heightAt(p.x, p.z) ?? 0);
    const target = new THREE.Vector3(
      p.x + Math.cos(h.angle) * r, groundY + 40 + Math.sin(h.angle * 2.3) * 3, p.z + Math.sin(h.angle) * r);
    h.group.position.lerp(target, Math.min(1, 1.2 * dt));
    h.group.lookAt(p.x, h.group.position.y - 6, p.z);
    h.rotor.rotation.y += dt * 30;

    // searchlight at night
    const night = (G.daynight?.sunFactor ?? 1) < 0.4;
    h.light.intensity = night ? 300 : 0;
    h.light.position.set(0, -0.8, 0);
    h.lightTarget.position.set(p.x + (Math.random() - .5) * 2, 0, p.z + (Math.random() - .5) * 2);

    // heli always keeps eyes on (unless indoors)
    if (!G.zones.zoneAt(p)) G.wanted.reportSeen(h.group.position);

    // 5★ door gunner
    if (this.stars >= 5) {
      h.shootT -= dt;
      if (h.shootT <= 0) {
        h.shootT = 0.9;
        const from = h.group.position.clone();
        const dir = p.clone().add(new THREE.Vector3(0, 1, 0)).sub(from).normalize()
          .add(new THREE.Vector3((Math.random() - .5) * 0.12, 0, (Math.random() - .5) * 0.12)).normalize();
        G.weapons.rayShot(from, dir, { dmg: 10, range: 90, byCop: true, muzzle: from });
        G.audio?.play('rifle', { pos: from, vol: 0.45 });
      }
    }
    G.audio?.setHeliDistance(h.group.position.distanceTo(G.camera.position));
  }
}
