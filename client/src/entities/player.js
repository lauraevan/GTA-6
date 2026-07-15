// The player: on-foot movement (capsule physics), driving, carjacking/lockpick,
// health/armor/money, water, bail-outs, wasted/busted flows and world prompts.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from '../physics/physics.js';
import { buildPedMesh } from './pedestrian.js';
import { KIND } from '../world/cityData.js';
import { clamp, fmtMoney } from '../core/mathx.js';
import { CFG } from '../core/config.js';

const PLAYER_OUTFIT = { shirt: '#2b2f3a', pants: '#1c1e24', skin: '#c8987a' };

export class Player {
  constructor(G, spawn) {
    this.G = G;
    const built = buildPedMesh(G, PLAYER_OUTFIT, {});
    this.mesh = built.root;
    this.parts = built.parts;
    G.scene.add(this.mesh);

    this.body = new CANNON.Body({
      mass: 80,
      shape: new CANNON.Sphere(0.42),
      position: new CANNON.Vec3(spawn.x, 1.2, spawn.z),
      fixedRotation: true,
      linearDamping: 0.92,
    });
    this.body.collisionFilterGroup = GROUP.CHAR;
    this.body.collisionFilterMask = GROUP.STATIC | GROUP.VEHICLE | GROUP.DEBRIS;
    this.body.userData = { kind: 'player' };
    G.physics.addBody(this.body);

    this.position = this.mesh.position;
    this.position.set(spawn.x, 0, spawn.z);

    this.health = 100;
    this.armor = 0;
    this.money = 350;
    this.vehicle = null;
    this.aiming = false;
    this.grounded = true;
    this.dead = false;
    this.entering = null;   // {vehicle, t, carjack}
    this.bailT = 0;
    this.waterT = 0;
    this.prompt = null;
    this.speed = 0;
    this.phase = 0;
    this.yaw = 0;
    this.stats = { robberies: 0, racesWon: 0, stunts: 0, carsStolen: 0, missions: 0 };
    this._v = new THREE.Vector3();
    this._holdE = 0;
  }

  // ---------- money ----------
  giveMoney(d, silent = false) {
    this.money = Math.max(0, Math.round(this.money + d));
    this.G.events.emit('moneyChanged', { value: this.money, delta: d, silent });
  }
  spendMoney(d) {
    if (this.money < d) return false;
    this.giveMoney(-d);
    return true;
  }

  // ---------- damage ----------
  damage(n, src = null) {
    if (this.dead || this.G.state !== 'playing') return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, n * 0.65);
      this.armor -= absorbed;
      n -= absorbed;
    }
    this.health -= n;
    this.G.ui?.damageFlash(clamp(n / 40, 0.2, 1));
    this.G.audio?.play('hurt', { vol: 0.4 });
    if (this.health <= 0) this.wasted();
  }

  heal(n) { this.health = Math.min(100, this.health + n); }

  wasted() {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    const { G } = this;
    if (this.vehicle) this.exitVehicle(true);
    this.mesh.visible = true;
    G.ragdolls?.spawn(this.mesh, this.position.clone(), new THREE.Vector3(0, 30, 0));
    // ragdoll consumed our parts — rebuild mesh for respawn
    this._rebuildMesh();
    G.events.emit('playerWasted', {});
    G.setState('wasted');
    setTimeout(() => this._respawn(G.city.pois.hospital.door, CFG.wastedPenalty), 3800);
  }

  busted() {
    if (this.dead || this.G.state !== 'playing') return;
    this.dead = true;
    const { G } = this;
    if (this.vehicle) this.exitVehicle(true);
    G.events.emit('playerBusted', {});
    G.setState('busted');
    const station = G.city.pois.police[0];
    setTimeout(() => this._respawn(station.door, CFG.bustedPenalty), 3800);
  }

  _rebuildMesh() {
    const built = buildPedMesh(this.G, PLAYER_OUTFIT, {});
    this.mesh = built.root;
    this.parts = built.parts;
    this.position = this.mesh.position;
    this.G.scene.add(this.mesh);
  }

  _respawn(door, penalty) {
    const { G } = this;
    this.giveMoney(-Math.round(this.money * penalty), true);
    this.health = 100;
    this.dead = false;
    this.position.set(door[0], 0, door[1] + 2);
    this.body.position.set(door[0], 1.0, door[1] + 2);
    this.body.velocity.set(0, 0, 0);
    this.mesh.visible = true;
    G.wanted?.clear();
    G.chunks?.warmup(door[0], door[1]);
    G.setState('playing');
    G.cameraRig.setMode('foot');
    G.save?.save('respawn');
  }

  // ---------- vehicles ----------
  tryEnterVehicle() {
    const { G } = this;
    const v = G.vehicles.findNearestEnterable(this.position);
    if (!v) return;
    if (v.locked && v.mode === 'parked') {
      // smash window: quick but loud
      this.G.audio?.play('glass', { pos: v.position });
      v.locked = false;
      if (Math.random() < 0.65) v.startAlarm();
      G.events.emit('crime', { type: 'breakin', pos: v.position.clone(), severity: 6, witnessRadius: 26 });
      return;
    }
    const carjack = v.mode === 'traffic' && v.driver != null;
    this.entering = { vehicle: v, t: carjack ? 0.9 : 0.45, carjack };
    if (carjack) {
      G.events.emit('carjack', { vehicle: v });
      G.events.emit('crime', { type: 'carjack', pos: v.position.clone(), severity: 12, witnessRadius: 30 });
    }
  }

  _completeEnter(v) {
    const { G } = this;
    this.vehicle = v;
    v.driver = 'player';
    v.setMode('driven');
    if (!v.owned && v.mode === 'driven' && !v._stolenOnce) {
      v._stolenOnce = true;
      if (!v.def.cop) this.stats.carsStolen++;
    }
    this.mesh.visible = false;
    this.body.collisionFilterMask = 0; // ghost while seated
    G.cameraRig.setMode('car');
    G.audio?.attachEngine(v);
    G.events.emit('enterVehicle', { vehicle: v });
  }

  exitVehicle(force = false) {
    const { G } = this;
    const v = this.vehicle;
    if (!v) return;
    const speed = v.speed;
    if (speed > 8 && !force) {
      // bail out!
      this.bailT = 1.1;
      this.damage(Math.min(35, speed * 0.9));
      G.cameraRig?.shake(0.4);
    }
    const door = v.doorPos(-1);
    door.y = 0;
    this.position.copy(door);
    this.body.position.set(door.x, 1.0, door.z);
    this.body.velocity.set(v.velocity.x * 0.4, 0, v.velocity.z * 0.4);
    this.mesh.visible = true;
    this.body.collisionFilterMask = GROUP.STATIC | GROUP.VEHICLE | GROUP.DEBRIS;
    v.driver = null;
    v.controls.throttle = 0; v.controls.steer = 0; v.controls.nitro = false;
    this.vehicle = null;
    G.cameraRig.setMode('foot');
    G.cameraRig.yaw = this.yaw + Math.PI;
    G.audio?.detachEngine();
    G.events.emit('exitVehicle', { vehicle: v });
  }

  // ---------- per-frame ----------
  update(dt) {
    const { G } = this;
    if (G.state !== 'playing') { this.speed = 0; this._animate(dt); return; }

    // entering animation timer
    if (this.entering) {
      const e = this.entering;
      e.t -= dt;
      const door = e.vehicle.doorPos(-1);
      this.moveMeshToward(door, 4, dt);
      if (e.t <= 0) {
        this._completeEnter(e.vehicle);
        this.entering = null;
      }
      this._animate(dt);
      return;
    }

    if (this.vehicle) this._updateDriving(dt);
    else this._updateOnFoot(dt);

    // water: drowning
    const inWater = G.city.isWaterAt(this.position.x, this.position.z) && !this.vehicle;
    if (inWater) {
      this.waterT += dt;
      if (this.waterT > 2.5) this.damage(6 * dt);
    } else this.waterT = 0;

    // fell through / off the world
    if (this.body.position.y < -30) {
      const n = G.nav.nearestNode(this.position.x, this.position.z);
      this.body.position.set(n?.x ?? 0, 2, n?.z ?? 0);
      this.body.velocity.set(0, 0, 0);
    }

    this._animate(dt);
  }

  moveMeshToward(target, speed, dt) {
    const d = this._v.subVectors(target, this.position);
    d.y = 0;
    const dist = d.length();
    if (dist > 0.05) {
      d.normalize();
      const step = Math.min(speed * dt, dist);
      this.position.addScaledVector(d, step);
      this.yaw = Math.atan2(d.x, d.z);
      this.speed = speed;
      this.body.position.set(this.position.x, this.body.position.y, this.position.z);
    } else this.speed = 0;
  }

  _updateOnFoot(dt) {
    const { G } = this;
    const input = G.input;

    if (this.bailT > 0) {
      this.bailT -= dt;
      this.position.set(this.body.position.x, this.body.position.y - 0.42, this.body.position.z);
      return;
    }

    // aim state (RMB) — only with ranged weapon
    const wdef = G.weapons?.currentDef;
    this.aiming = input.mouseDown(2) && wdef && !wdef.melee && !wdef.thrown ? true : (input.mouseDown(2) && wdef?.thrown ? true : false);

    // movement relative to camera
    const camFwd = G.cameraRig.flatForward;
    const camRight = this._v.set(camFwd.z, 0, -camFwd.x); // right = fwd × up
    const ix = input.axis('KeyA', 'KeyD');
    const iz = input.axis('KeyS', 'KeyW');
    const wish = new THREE.Vector3()
      .addScaledVector(camFwd, iz)
      .addScaledVector(camRight, -ix);
    const moving = wish.lengthSq() > 0.001;
    if (moving) wish.normalize();

    const sprint = input.down('ShiftLeft') && !this.aiming;
    const inWater = G.city.isWaterAt(this.position.x, this.position.z);
    const speed = inWater ? 1.7 : this.aiming ? 3.0 : sprint ? 7.4 : 5.2;

    // grounded check
    const groundHit = G.physics.raycast(
      new THREE.Vector3().copy(this.body.position),
      new THREE.Vector3(this.body.position.x, this.body.position.y - 0.55, this.body.position.z));
    this.grounded = !!groundHit;

    const vel = this.body.velocity;
    const targetVx = moving ? wish.x * speed : 0;
    const targetVz = moving ? wish.z * speed : 0;
    const accel = this.grounded ? 14 : 4;
    vel.x += (targetVx - vel.x) * Math.min(1, accel * dt);
    vel.z += (targetVz - vel.z) * Math.min(1, accel * dt);

    if (input.pressed('Space') && this.grounded && !inWater) {
      vel.y = 6.4;
      this.grounded = false;
    }

    // fall damage
    if (this._lastVy !== undefined && this.grounded && this._lastVy < -11) {
      this.damage((-this._lastVy - 10) * 4);
    }
    this._lastVy = vel.y;

    // sync mesh to body
    this.position.set(this.body.position.x, Math.max(0, this.body.position.y - 0.42), this.body.position.z);
    this.speed = Math.hypot(vel.x, vel.z);

    // facing: camera dir while aiming, else movement dir
    if (this.aiming) {
      this.yaw = G.cameraRig.yaw + Math.PI;
      this.aimPoseTick();
    } else if (moving) {
      this.yaw = Math.atan2(wish.x, wish.z);
      this.parts.armR.rotation.x = 0;
    }

    // F: enter vehicle
    if (input.pressed('KeyF')) this.tryEnterVehicle();

    // E: contextual interactions
    this._updateInteractions(dt);
  }

  aimPoseTick() {
    // right arm points forward
    this.parts.armR.rotation.x = Math.PI / 2 - 0.08 - this.G.cameraRig.pitch * 0.6;
  }

  _updateDriving(dt) {
    const { G } = this;
    const input = G.input;
    const v = this.vehicle;
    const c = v.controls;

    const steerTarget = -input.axis('KeyA', 'KeyD');
    c.steer += (steerTarget - c.steer) * Math.min(1, 7 * dt);
    c.throttle = input.down('KeyW') ? 1 : 0;
    c.brake = input.down('KeyS') ? 1 : 0;
    c.handbrake = input.down('Space');
    c.nitro = input.down('ShiftLeft') && v.mods.nitro;

    if (input.pressed('KeyH')) G.audio?.play('horn', { pos: v.position, vol: 0.7 });
    if (input.pressed('KeyF')) this.exitVehicle();
    if (input.pressed('KeyN')) G.music?.nextStation();

    // keep body with car (for AI targeting etc.)
    this.position.copy(v.position);
    this.body.position.set(v.position.x, v.position.y + 0.4, v.position.z);
    this.body.velocity.set(0, 0, 0);
    this.yaw = v.yaw;

    // vehicle destroyed while inside
    if (v.dead) {
      this.damage(85);
      if (!this.dead) this.exitVehicle(true);
      return;
    }

    // drive-by with one-handed weapons
    // (weapons system reads aiming state; here we just permit fire)
    this.aiming = input.mouseDown(2);

    this._updateInteractions(dt);
  }

  _updateInteractions(dt) {
    const { G } = this;
    const input = G.input;
    let prompt = null;
    let action = null;

    if (!this.vehicle) {
      const v = G.vehicles.findNearestEnterable(this.position);
      if (v) {
        prompt = v.locked && v.mode === 'parked'
          ? 'F — Break into vehicle'
          : v.mode === 'traffic' ? 'F — Carjack driver' : `F — Enter ${v.def.name}`;
      }
      const zone = G.zones.zoneAt(this.position);
      if (zone) {
        if (zone.kind === KIND.SHOP && zone.counterFront &&
            this.position.distanceTo(zone.counterFront) < 2.2 && !G.robbery?.activeAt(zone)) {
          prompt = 'E — Buy snack ($25)';
          action = () => {
            if (this.spendMoney(25)) { this.heal(25); G.audio?.play('register'); G.ui?.toast('Snack', '+25 health'); }
          };
        } else if (zone.kind === KIND.GUNSHOP && zone.counterFront &&
            this.position.distanceTo(zone.counterFront) < 2.6) {
          prompt = 'E — Browse weapons';
          action = () => G.ui?.openGunShop();
        } else if (zone.kind === KIND.SAFEHOUSE && zone.bedPos &&
            this.position.distanceTo(zone.bedPos) < 2.4) {
          prompt = 'E — Sleep (save game, +6h)';
          action = () => {
            G.daynight.setHour(G.daynight.hour + 6);
            this.heal(100);
            G.save?.save('sleep');
            G.ui?.toast('Saved', 'You slept. Game saved.');
          };
        } else if (zone.kind === KIND.GARAGE && zone.deskPos &&
            this.position.distanceTo(zone.deskPos) < 2.8) {
          prompt = 'E — Garage & dealership';
          action = () => G.ui?.openGarage();
        }
      }
    } else {
      // spray shop bay (must be in a vehicle)
      const spray = G.zones.byKind(KIND.SPRAY).find((z) =>
        z.bayPos && this.position.distanceTo(z.bayPos) < 5);
      if (spray) {
        const stars = G.wanted.stars;
        const cost = 200 + stars * 400;
        prompt = `E — Respray (${fmtMoney(cost)})${stars ? ' + lose heat' : ''}`;
        action = () => {
          if (G.wanted.copSeesPlayer) { G.ui?.toast('Spray König', 'Not while the cops are watching!'); return; }
          if (this.spendMoney(cost)) {
            G.wanted.clear();
            this.vehicle.health = Math.max(this.vehicle.health, 70);
            this.vehicle.fireTimer = -1;
            G.ui?.toast('Spray König', 'Fresh paint. Heat\'s off.');
            G.audio?.play('spray');
          }
        };
      }
    }

    G.ui?.setPrompt(prompt);
    if (action && input.pressed('KeyE')) action();
  }

  _animate(dt) {
    if (!this.mesh.visible) return;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
    const { armL, armR, legL, legR } = this.parts;
    if (this.speed > 0.15) {
      this.phase += dt * (2.2 + this.speed * 1.35);
      const swing = Math.min(0.9, 0.28 + this.speed * 0.085);
      legL.rotation.x = Math.sin(this.phase) * swing;
      legR.rotation.x = -Math.sin(this.phase) * swing;
      armL.rotation.x = -Math.sin(this.phase) * swing * 0.75;
      if (!this.aiming) armR.rotation.x = Math.sin(this.phase) * swing * 0.75;
    } else {
      legL.rotation.x = legR.rotation.x = 0;
      armL.rotation.x = 0;
      if (!this.aiming) armR.rotation.x = 0;
    }
    if (this.aiming) this.aimPoseTick();
  }

  toSave() {
    return {
      pos: [this.position.x, this.position.z],
      money: this.money,
      health: this.health,
      armor: this.armor,
      stats: this.stats,
    };
  }

  fromSave(s) {
    if (!s) return;
    this.money = s.money ?? this.money;
    this.health = s.health ?? 100;
    this.armor = s.armor ?? 0;
    this.stats = { ...this.stats, ...(s.stats || {}) };
    if (s.pos) {
      this.position.set(s.pos[0], 0, s.pos[1]);
      this.body.position.set(s.pos[0], 1.0, s.pos[1]);
    }
  }
}
