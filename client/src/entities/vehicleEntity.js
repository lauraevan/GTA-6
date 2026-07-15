// A vehicle instance in any lifecycle mode:
//   parked  — static physics box (carjackable)
//   traffic — kinematic box steered by TrafficSystem
//   driven  — full raycast-vehicle physics (player, cops, racers)
//   wreck   — dynamic tumbling box (crashed traffic / destroyed cars)
// Includes damage model: panel deformation, engine falloff, tyre bursts, fire → explosion.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from '../physics/physics.js';
import { createVehiclePhysics } from '../physics/vehiclePhysics.js';
import { VEHICLES } from './catalog.js';
import { buildVehicleMesh } from './vehicleFactory.js';

let nextVid = 1;

export class VehicleEntity {
  constructor(G, modelId, pos, ry = 0, opts = {}) {
    this.G = G;
    this.id = nextVid++;
    this.model = modelId;
    this.def = VEHICLES[modelId];
    this.paint = opts.paint || this.def.paint;
    this.mods = opts.mods || { engine: 0, tires: false, nitro: false, brakes: false, wheelStyle: 0 };
    this.locked = opts.locked ?? false;
    this.owned = opts.owned ?? false;

    const built = buildVehicleMesh(G, modelId, this.def, this.paint, this.mods.wheelStyle);
    this.mesh = built.root;
    this.parts = built.parts;
    this.wheels = built.wheels;
    this.bodyMat = built.bodyMat;
    G.scene.add(this.mesh);

    const [W, H] = [this.def.size[0], this.def.size[1]];
    this.stanceY = H / 2 + this.def.wheelR * 0.55;
    this.wheelLocalY = this.def.wheelR - this.stanceY;
    this._setStaticWheelPose();

    this.mode = null;
    this.body = null;      // cannon body for parked/traffic/wreck
    this.vp = null;        // VehiclePhysics for driven
    this.health = this.def.health ?? 100;
    this.maxHealth = this.health;
    this.tires = [{}, {}, {}, {}];
    this.controls = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false, reverse: false };
    this.driver = null;    // 'player' | cop unit | traffic brain tag
    this.fireTimer = -1;
    this.dead = false;
    this.alarmT = 0;
    this.honkT = 0;
    this.zoneDamage = { front: 0, rear: 0, left: 0, right: 0 };
    this.chunkKey = opts.chunkKey || null;
    this._v3 = new THREE.Vector3();
    this._smokeT = 0;
    this._lastImpact = 0;

    this.mesh.position.set(pos.x, pos.y ?? this.stanceY, pos.z);
    this.mesh.rotation.y = ry;
    this.setMode(opts.mode || 'parked');
  }

  get position() { return this.mesh.position; }

  get velocity() {
    if (this.vp) {
      const v = this.vp.body.velocity;
      return this._v3.set(v.x, v.y, v.z);
    }
    if (this.body) {
      const v = this.body.velocity;
      return this._v3.set(v.x, v.y, v.z);
    }
    return this._v3.set(0, 0, 0);
  }

  get speed() { return this.velocity.length(); }
  get speedKmh() { return this.speed * 3.6; }

  get yaw() {
    const q = this.mesh.quaternion;
    return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
  }

  _setStaticWheelPose() {
    const [W, , L] = this.def.size;
    const halfW = W / 2 - this.def.wheelR * 0.35;
    const axF = L / 2 - this.def.wheelR * 1.35;
    const pos = [
      [-halfW, this.wheelLocalY, axF], [halfW, this.wheelLocalY, axF],
      [-halfW, this.wheelLocalY, -axF], [halfW, this.wheelLocalY, -axF],
    ];
    this.wheels.forEach((w, i) => w.position.set(...pos[i]));
  }

  _removePhysics() {
    if (this.vp) { this.vp.destroy(); this.G.physics.removeBody(this.vp.body); this.vp = null; }
    if (this.body) { this.G.physics.removeBody(this.body); this.body = null; }
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const { G } = this;
    const pos = this.mesh.position.clone();
    const quat = this.mesh.quaternion.clone();
    const vel = this.velocity.clone();
    this._removePhysics();
    this.mode = mode;
    const [W, H, L] = this.def.size;

    if (mode === 'driven') {
      this.vp = createVehiclePhysics(G.physics, this.def, pos.clone().setY(Math.max(pos.y, this.stanceY + 0.1)), this.yaw);
      this.vp.body.velocity.set(vel.x, vel.y, vel.z);
      this.vp.body.userData = { kind: 'vehicle', entity: this };
      this._bindCollide(this.vp.body);
    } else {
      const type = mode === 'wreck' ? CANNON.Body.DYNAMIC
        : mode === 'traffic' ? CANNON.Body.KINEMATIC : CANNON.Body.STATIC;
      this.body = new CANNON.Body({
        type,
        mass: mode === 'wreck' ? this.def.mass : 0,
        shape: new CANNON.Box(new CANNON.Vec3(W / 2, H / 2, L / 2)),
        position: new CANNON.Vec3(pos.x, Math.max(pos.y, this.stanceY), pos.z),
        angularDamping: 0.5,
        linearDamping: 0.15,
      });
      this.body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
      this.body.collisionFilterGroup = GROUP.VEHICLE;
      this.body.collisionFilterMask = GROUP.STATIC | GROUP.VEHICLE | GROUP.CHAR | GROUP.DEBRIS;
      this.body.userData = { kind: 'vehicle', entity: this };
      if (mode === 'wreck') this.body.velocity.set(vel.x, vel.y, vel.z);
      G.physics.addBody(this.body);
      this._bindCollide(this.body);
      this._setStaticWheelPose();
    }
  }

  _bindCollide(body) {
    body.addEventListener('collide', (e) => {
      const impact = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (impact < 2.2) return;
      const now = performance.now();
      if (now - this._lastImpact < 120) return;
      this._lastImpact = now;

      const otherKind = e.body.userData?.kind;
      const dmg = impact * (otherKind === 'vehicle' ? 1.6 : 1.2);
      // resolve damage zone from the local-space contact point
      const cp = e.contact.bi === body ? e.contact.ri : e.contact.rj;
      const local = new THREE.Vector3(cp.x, cp.y, cp.z).applyQuaternion(
        this.mesh.quaternion.clone().invert());
      this._applyZoneDamage(local, dmg);
      this.applyDamage(dmg, null, false, true);

      if (impact > 4) {
        this.G.audio?.play('crash', { pos: this.position, vol: Math.min(1, impact / 18) });
        this.G.particles?.sparks(this.position.clone().add(new THREE.Vector3(0, 0.4, 0)));
        if (this.driver === 'player') this.G.cameraRig?.shake(Math.min(impact * 0.05, 0.5));
      }
      // traffic car hit hard → becomes a real physics wreck
      if (this.mode === 'traffic' && impact > 3.2) {
        this.G.events.emit('trafficCrashed', { vehicle: this, impact });
      }
      if (this.mode === 'parked' && impact > 3 && !this.locked && Math.random() < 0.4) {
        this.startAlarm();
      }
    });
  }

  _applyZoneDamage(local, dmg) {
    const [W, , L] = this.def.size;
    let zone;
    if (Math.abs(local.z) > Math.abs(local.x) * (L / W)) zone = local.z > 0 ? 'front' : 'rear';
    else zone = local.x > 0 ? 'right' : 'left';
    this.zoneDamage[zone] += dmg;
    this._updatePanels();
  }

  _updatePanels() {
    const zd = this.zoneDamage;
    const p = this.parts;
    if (p.hood) {
      const d = Math.min(zd.front / 40, 1);
      p.hood.rotation.x = 0.06 + d * 0.5;
      p.hood.position.y += 0;
      if (zd.front > 70 && p.hood.parent) this._detachPanel(p.hood);
    }
    if (p.bumperF && zd.front > 45 && p.bumperF.parent) this._detachPanel(p.bumperF);
    if (p.bumperR && zd.rear > 45 && p.bumperR.parent) this._detachPanel(p.bumperR);
    if (p.trunk) p.trunk.rotation.x = -Math.min(zd.rear / 50, 1) * 0.6;
    if (p.cab) {
      p.cab.position.x = (Math.min(zd.right / 80, 1) - Math.min(zd.left / 80, 1)) * -0.06;
    }
  }

  _detachPanel(panel) {
    const world = new THREE.Vector3();
    panel.getWorldPosition(world);
    this.G.scene.attach(panel);
    const vel = this.velocity.clone().multiplyScalar(0.5)
      .add(new THREE.Vector3((Math.random() - .5) * 3, 3, (Math.random() - .5) * 3));
    const spin = new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4);
    const G = this.G;
    const life = { t: 2.5 };
    const tick = (dt) => {
      vel.y -= 12 * dt;
      panel.position.addScaledVector(vel, dt);
      panel.rotation.x += spin.x * dt; panel.rotation.y += spin.y * dt;
      if (panel.position.y < 0.06) { panel.position.y = 0.06; vel.set(0, 0, 0); spin.set(0, 0, 0); }
      life.t -= dt;
      if (life.t <= 0) {
        G.scene.remove(panel);
        G.tickers.delete(tick);
      }
    };
    G.tickers.add(tick);
  }

  applyDamage(amount, atPos = null, byPlayer = false, fromCollision = false) {
    if (this.dead) return;
    const armored = this.def.health ? 0.6 : 1;
    this.health -= amount * armored * (fromCollision ? 0.55 : 1);
    if (this.health <= 16 && this.fireTimer < 0) {
      this.fireTimer = 4.2;
    }
    if (this.health <= 0 && this.fireTimer < 0.5) {
      this.explode(byPlayer);
    }
  }

  burstTire(i) {
    if (this.tires[i].burst) return;
    this.tires[i].burst = true;
    this.wheels[i]?.scale.set(1, 0.55, 1);
    this.G.audio?.play('tireBurst', { pos: this.position });
  }

  startAlarm() {
    if (this.alarmT > 0) return;
    this.alarmT = 6;
    this.G.events.emit('crime', { type: 'carAlarm', pos: this.position.clone(), severity: 4, witnessRadius: 30 });
  }

  explode(byPlayer = false) {
    if (this.dead) return;
    this.dead = true;
    this.fireTimer = -1;
    this.health = 0;
    const pos = this.position.clone();
    this.G.particles?.explosion(pos);
    this.G.audio?.play('explosion', { pos });
    this.G.events.emit('explosion', { pos, radius: 7.5, dmg: 90, byPlayer, sourceVehicle: this });
    // blacken
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material && o.material.color) {
        o.material = o.material.clone();
        o.material.color.multiplyScalar(0.18);
        if (o.material.emissive) o.material.emissiveIntensity = 0;
      }
    });
    if (this.mode !== 'wreck') this.setMode('wreck');
    this.body?.applyImpulse(new CANNON.Vec3((Math.random() - .5) * 3000, this.def.mass * 4.5, (Math.random() - .5) * 3000));
    this.wreckT = 24;
  }

  /** door world position for enter/exit */
  doorPos(side = -1) {
    const [W] = this.def.size;
    return this.position.clone().add(
      new THREE.Vector3(side * (W / 2 + 0.7), 0, 0).applyQuaternion(this.mesh.quaternion));
  }

  update(dt) {
    const { G } = this;

    if (this.mode === 'driven' && this.vp) {
      const engineFactor = Math.max(0.35, Math.min(1, this.health / 70));
      const inWater = G.city.isWaterAt(this.position.x, this.position.z);
      this.vp.update(this.controls, dt,
        (G.weather?.traction ?? 1) * (inWater ? 0.3 : 1),
        inWater ? 0.1 : engineFactor, this.tires, this.mods);
      if (inWater) this.applyDamage(6 * dt, null, false, true);
      // sync mesh
      this.mesh.position.copy(this.vp.body.position);
      this.mesh.quaternion.copy(this.vp.body.quaternion);
      // wheels from suspension
      const invQ = this.vp.body.quaternion.inverse();
      for (let i = 0; i < 4; i++) {
        const wi = this.vp.vehicle.wheelInfos[i];
        const wp = wi.worldTransform.position;
        const rel = new CANNON.Vec3(wp.x - this.vp.body.position.x, wp.y - this.vp.body.position.y, wp.z - this.vp.body.position.z);
        const local = invQ.vmult(rel);
        this.wheels[i].position.set(local.x, local.y, local.z);
        this.wheels[i].rotation.y = i < 2 ? this.vp.vehicle.wheelInfos[i].steering : 0;
        if (!this.tires[i].burst) this.wheels[i].children[0].rotation.x += wi.deltaRotation ?? 0;
      }
      // skids + screech
      const slip = this.vp.slipRatio;
      if ((slip > 0.32 || (this.controls.handbrake && this.speed > 6)) && this.speed > 6) {
        for (const i of [2, 3]) {
          const w = this.wheels[i];
          const wp = w.getWorldPosition(new THREE.Vector3());
          if (Math.random() < 0.6) G.particles?.skidMark(wp, this.velocity);
        }
        if (this.driver === 'player') G.audio?.screech(Math.min(1, slip + 0.2));
      } else if (this.driver === 'player') G.audio?.screech(0);
    } else if (this.body && (this.mode === 'wreck' || this.mode === 'traffic')) {
      this.mesh.position.copy(this.body.position);
      this.mesh.quaternion.copy(this.body.quaternion);
      if (this.mode === 'traffic') {
        // roll wheels
        const fwd = this.speed;
        for (const w of this.wheels) w.children[0].rotation.x += (fwd / this.def.wheelR) * dt;
      }
    }

    // fire → smoke → boom
    if (this.fireTimer > 0) {
      this.fireTimer -= dt;
      if (Math.random() < 0.6) {
        G.particles?.burst(this.position.clone().add(new THREE.Vector3(0, 0.8, this.def.size[2] * 0.3)),
          { count: 3, speed: 1.4, color: 0xff7020, life: 0.5, up: 3, grav: 3 });
      }
      if (this.fireTimer <= 0) this.explode();
    } else if (this.health < 45 && !this.dead) {
      this._smokeT -= dt;
      if (this._smokeT <= 0) {
        this._smokeT = 0.12;
        G.particles?.smoke(this.position.clone().add(
          this.forward().multiplyScalar(this.def.size[2] * 0.35).add(new THREE.Vector3(0, 0.7, 0))), this.health < 28);
      }
    }

    // alarm
    if (this.alarmT > 0) {
      this.alarmT -= dt;
      this.honkT -= dt;
      if (this.honkT <= 0) {
        this.honkT = 0.5;
        G.audio?.play('horn', { pos: this.position, vol: 0.5 });
      }
    }

    // headlights (driven at night)
    const night = (G.daynight?.sunFactor ?? 1) < 0.35;
    if (this.parts.headMat) {
      const on = night && this.mode === 'driven' && !this.dead;
      this.parts.headMat.emissiveIntensity = on ? 2.2 : 0;
      this.parts.tailMat.emissiveIntensity = on ? 1.4 : (this.mode === 'driven' && this.controls.brake > 0 ? 1.8 : 0);
    }

    if (this.wreckT !== undefined) this.wreckT -= dt;
  }

  dispose() {
    this._removePhysics();
    this.G.scene.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
  }
}
