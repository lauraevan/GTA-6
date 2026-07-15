// Weapon system: player inventory/firing/reload/recoil, shared hitscan used by
// cops too, melee arcs, thrown explosives, and the global explosion responder.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { WEAPONS, WEAPON_ORDER } from './catalog.js';
import { GROUP } from '../physics/physics.js';
import { clamp } from '../core/mathx.js';

export class WeaponSystem {
  constructor(G) {
    this.G = G;
    this.inventory = new Map([['fist', { ammo: Infinity, reserve: Infinity }]]);
    this.current = 'fist';
    this.cooldown = 0;
    this.reloading = 0;
    this.bloom = 0;
    this.grenades = [];
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();

    G.events.on('explosion', (e) => this.onExplosion(e));
  }

  get currentDef() { return WEAPONS[this.current]; }
  get currentAmmo() { return this.inventory.get(this.current); }

  give(id, ammo = 0) {
    const def = WEAPONS[id];
    if (!def) return;
    if (!this.inventory.has(id)) {
      this.inventory.set(id, { ammo: def.mag ?? Infinity, reserve: ammo });
      this.equip(id);
      this.G.ui?.toast('Weapon acquired', def.name);
    } else {
      const inv = this.inventory.get(id);
      inv.reserve = Math.min(999, inv.reserve + ammo);
    }
  }

  giveAmmo(id, n) {
    const inv = this.inventory.get(id);
    if (inv) inv.reserve = Math.min(999, inv.reserve + n);
  }

  equip(id) {
    if (!this.inventory.has(id)) return;
    this.current = id;
    this.reloading = 0;
    this.G.audio?.play('click', { vol: 0.3 });
  }

  cycle(dir) {
    const owned = WEAPON_ORDER.filter((w) => this.inventory.has(w));
    const i = owned.indexOf(this.current);
    this.equip(owned[(i + dir + owned.length) % owned.length]);
  }

  startReload() {
    const def = this.currentDef;
    const inv = this.currentAmmo;
    if (!def.mag || this.reloading > 0 || inv.ammo >= def.mag || inv.reserve <= 0) return;
    this.reloading = def.reload;
    this.G.audio?.play('reload', { vol: 0.5 });
  }

  /** shared bullet: from THREE.Vector3, dir normalized. opts {dmg, range, byPlayer, byCop, muzzle} */
  rayShot(from, dir, opts) {
    const G = this.G;
    const range = opts.range ?? 80;
    const end = this._v1.copy(from).addScaledVector(dir, range).clone();

    // static & vehicles
    const hit = G.physics.raycast(from, end);
    let bestT = hit ? hit.distance / range : 1;
    let target = hit ? { kind: hit.body.userData?.kind ?? 'static', hit } : null;

    // capsule tests: peds & cops (+ player when cop is shooting)
    const testPed = (ped, kindName) => {
      const c = this._v2.set(ped.position.x, ped.position.y + 1.0, ped.position.z);
      const toC = c.sub(from);
      const t = clamp(toC.dot(dir) / range, 0, 1);
      const closest = this._v1.copy(from).addScaledVector(dir, t * range);
      const d = closest.distanceTo(new THREE.Vector3(ped.position.x, ped.position.y + 1.0, ped.position.z));
      if (d < 0.55 && t < bestT) { bestT = t; target = { kind: kindName, ped }; }
    };
    if (!opts.byCop) {
      for (const ped of G.peds?.peds ?? []) testPed(ped, 'ped');
      for (const cop of G.police?.footCops ?? []) testPed(cop, 'cop');
    } else if (G.player && !G.player.dead) {
      const p = G.player;
      const c = this._v2.set(p.position.x, p.position.y + 1.0, p.position.z);
      const toC = c.sub(from);
      const t = clamp(toC.dot(dir) / range, 0, 1);
      const closest = this._v1.copy(from).addScaledVector(dir, t * range);
      if (closest.distanceTo(new THREE.Vector3(p.position.x, p.position.y + 1.0, p.position.z)) < 0.6 && t < bestT) {
        bestT = t; target = { kind: 'player' };
      }
    }

    const hitPoint = new THREE.Vector3().copy(from).addScaledVector(dir, bestT * range);
    G.particles?.tracer(opts.muzzle ?? from, hitPoint);

    if (target) {
      const dmg = opts.dmg;
      if (target.kind === 'ped' || target.kind === 'cop') {
        target.ped.hit(dmg, dir, !!opts.byPlayer);
        if (opts.byPlayer) G.ui?.hitmarker();
      } else if (target.kind === 'player') {
        G.player.damage(dmg);
      } else if (target.kind === 'vehicle') {
        const v = target.hit.body.userData.entity;
        v.applyDamage(dmg * 0.7, hitPoint, !!opts.byPlayer);
        // tyre hits
        for (let i = 0; i < 4; i++) {
          const wp = v.wheels[i]?.getWorldPosition(this._v2);
          if (wp && wp.distanceTo(hitPoint) < 0.5) v.burstTire(i);
        }
        if (opts.byPlayer) G.ui?.hitmarker();
        G.particles?.sparks(hitPoint);
        if (v.driver === 'player' && opts.byCop) { /* already hurt via player capsule */ }
      } else {
        G.particles?.sparks(hitPoint);
      }
    }
    return { point: hitPoint, target };
  }

  /** aim-assist: bend dir toward closest target in a small cone */
  assist(from, dir) {
    if (!this.G.settings.aimAssist) return dir;
    let best = null, bestScore = 0.994; // ~6.3°
    const consider = (pos) => {
      const to = this._v2.set(pos.x, pos.y + 1.0, pos.z).sub(from);
      const d = to.length();
      if (d > 55 || d < 2) return;
      to.normalize();
      const score = to.dot(dir);
      if (score > bestScore) { bestScore = score; best = to.clone(); }
    };
    for (const cop of this.G.police?.footCops ?? []) consider(cop.position);
    for (const ped of this.G.peds?.peds ?? []) if (ped.state === 'clerk') consider(ped.position);
    return best ?? dir;
  }

  playerFireOrigin() {
    const G = this.G;
    if (G.player.aiming || G.player.vehicle) {
      // from camera through the crosshair
      const dir = new THREE.Vector3();
      G.camera.getWorldDirection(dir);
      const from = G.camera.position.clone().addScaledVector(dir, 1.2);
      return { from, dir: this.assist(from, dir) };
    }
    // hip fire: from chest along facing
    const from = G.player.position.clone().add(new THREE.Vector3(0, 1.25, 0));
    const dir = new THREE.Vector3(Math.sin(G.player.yaw), 0, Math.cos(G.player.yaw));
    return { from, dir };
  }

  update(dt) {
    const G = this.G;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const def = this.currentDef;
        const inv = this.currentAmmo;
        const need = def.mag - inv.ammo;
        const take = Math.min(need, inv.reserve);
        inv.ammo += take;
        inv.reserve -= take;
      }
    }

    // grenades in flight
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.mesh.position.copy(g.body.position);
      if (g.fuse <= 0) {
        const pos = new THREE.Vector3().copy(g.body.position);
        G.physics.removeBody(g.body);
        G.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        G.particles?.explosion(pos);
        G.audio?.play('explosion', { pos });
        G.events.emit('explosion', { pos, radius: WEAPONS.grenade.radius, dmg: WEAPONS.grenade.dmg, byPlayer: g.byPlayer });
      }
    }

    if (G.state !== 'playing' || !G.player || G.player.dead) return;

    const input = G.input;
    if (input.pressed('KeyR')) this.startReload();
    const wheel = input.consumeWheel();
    if (wheel && !G.ui?.wheelOpen) this.cycle(wheel > 0 ? 1 : -1);

    // firing
    const def = this.currentDef;
    const inVehicle = !!G.player.vehicle;
    if (inVehicle && !(this.current === 'pistol' || this.current === 'smg')) return; // drive-by only 1-handed
    if (inVehicle && !G.player.aiming) return;

    const wantFire = def.auto ? input.mouseDown(0) : input.mousePressed(0);
    if (!wantFire || this.cooldown > 0 || this.reloading > 0) return;

    if (def.melee) return this.meleeSwing(def);
    if (def.thrown) return this.throwGrenade(def);

    const inv = this.currentAmmo;
    if (inv.ammo <= 0) {
      if (inv.reserve > 0) this.startReload();
      else G.audio?.play('click', { vol: 0.4 });
      this.cooldown = 0.25;
      return;
    }
    inv.ammo--;
    this.cooldown = 1 / def.rate;

    const { from, dir } = this.playerFireOrigin();
    const shots = def.pellets ?? 1;
    for (let s = 0; s < shots; s++) {
      const spread = (def.spread + this.bloom * 0.02) * (G.player.aiming ? 0.65 : 1.4);
      const d2 = dir.clone().add(new THREE.Vector3(
        (Math.random() - 0.5) * spread * 2,
        (Math.random() - 0.5) * spread * 2,
        (Math.random() - 0.5) * spread * 2)).normalize();
      const muzzle = G.player.position.clone().add(new THREE.Vector3(0, 1.3, 0))
        .addScaledVector(d2, 0.6);
      this.rayShot(muzzle, d2, { dmg: def.dmg, range: def.range, byPlayer: true, muzzle });
      G.particles?.muzzle(muzzle, d2);
    }
    this.bloom = Math.min(0.6, this.bloom + 0.09);
    G.cameraRig.pitch += def.kick ?? 0.01;
    G.cameraRig.shake(0.03);
    G.audio?.play(this.current === 'shotgun' ? 'shotgun' : this.current === 'rifle' ? 'rifle' : 'gunshot',
      { pos: G.player.position, vol: 0.8 });
    G.events.emit('gunshot', { pos: G.player.position.clone(), byPlayer: true });
    G.events.emit('crime', { type: 'gunshot', pos: G.player.position.clone(), severity: 8, witnessRadius: 42 });
  }

  meleeSwing(def) {
    const G = this.G;
    this.cooldown = 1 / def.rate;
    G.audio?.play('swing', { vol: 0.4 });
    const p = G.player;
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    let hitSomething = false;

    const inRange = (pos) => {
      const to = this._v1.set(pos.x - p.position.x, 0, pos.z - p.position.z);
      const d = to.length();
      if (d > def.range) return false;
      to.normalize();
      return to.dot(fwd) > 0.35;
    };
    for (const ped of [...(G.peds?.peds ?? [])]) {
      if (inRange(ped.position)) {
        ped.hit(def.dmg, fwd, true);
        hitSomething = true;
        G.events.emit('crime', { type: 'assault', pos: p.position.clone(), severity: 6, witnessRadius: 22 });
      }
    }
    for (const cop of [...(G.police?.footCops ?? [])]) {
      if (inRange(cop.position)) { cop.hit(def.dmg, fwd, true); hitSomething = true; }
    }
    for (const v of G.vehicles?.vehicles ?? []) {
      if (v.position.distanceTo(p.position) < def.range + 1.2 && inRange(v.position)) {
        v.applyDamage(def.dmg * 0.4, null, true);
        G.particles?.sparks(p.position.clone().addScaledVector(fwd, 1).add(new THREE.Vector3(0, 1, 0)));
        hitSomething = true;
      }
    }
    if (hitSomething) { G.audio?.play('punch', { vol: 0.6 }); G.ui?.hitmarker(); }
  }

  throwGrenade(def) {
    const G = this.G;
    const inv = this.currentAmmo;
    if (inv.reserve <= 0 && inv.ammo <= 0) return;
    if (inv.ammo > 0) inv.ammo--; else inv.reserve--;
    this.cooldown = 1 / def.rate;

    const { from, dir } = this.playerFireOrigin();
    const body = new CANNON.Body({
      mass: 0.6,
      shape: new CANNON.Sphere(0.12),
      position: new CANNON.Vec3(from.x, from.y, from.z),
    });
    body.velocity.set(dir.x * 15, dir.y * 15 + 4.5, dir.z * 15);
    body.collisionFilterGroup = GROUP.DEBRIS;
    body.collisionFilterMask = GROUP.STATIC | GROUP.VEHICLE | GROUP.DEBRIS;
    G.physics.addBody(body);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({ color: '#3a3f2a', roughness: 0.5 }));
    G.scene.add(mesh);
    this.grenades.push({ body, mesh, fuse: def.fuse, byPlayer: true });
    G.audio?.play('swing', { vol: 0.3 });
  }

  onExplosion({ pos, radius, dmg, byPlayer }) {
    const G = this.G;
    // peds & cops
    for (const ped of [...(G.peds?.peds ?? [])]) {
      const d = ped.position.distanceTo(pos);
      if (d < radius) {
        const away = ped.position.clone().sub(pos).setY(0.6).normalize().multiplyScalar(120 * (1 - d / radius));
        ped.die(away, byPlayer);
      } else if (d < radius * 2.4) {
        ped.state = 'flee';
        ped.threat = pos.clone();
      }
    }
    for (const cop of [...(G.police?.footCops ?? [])]) {
      const d = cop.position.distanceTo(pos);
      if (d < radius) cop.die(cop.position.clone().sub(pos).setY(0.5).normalize().multiplyScalar(120), byPlayer);
    }
    // player
    if (G.player && !G.player.dead) {
      const d = G.player.position.distanceTo(pos);
      if (d < radius * 1.15) G.player.damage(dmg * (1 - d / (radius * 1.15)));
    }
    // vehicles (chain reactions come naturally)
    for (const v of [...(G.vehicles?.vehicles ?? [])]) {
      const d = v.position.distanceTo(pos);
      if (d < radius + 2 && !v.dead) {
        setTimeout(() => v.applyDamage(dmg * 0.75 * (1 - d / (radius + 2)), pos, byPlayer), 120 + Math.random() * 380);
      }
    }
    if (byPlayer) {
      G.events.emit('crime', { type: 'explosion', pos: pos.clone(), severity: 30, witnessRadius: 80 });
    }
  }

  toSave() {
    const out = {};
    for (const [id, inv] of this.inventory) {
      if (id === 'fist') continue;
      out[id] = { ammo: inv.ammo === Infinity ? -1 : inv.ammo, reserve: inv.reserve === Infinity ? -1 : inv.reserve };
    }
    return { current: this.current, inv: out };
  }

  fromSave(s) {
    if (!s) return;
    for (const [id, inv] of Object.entries(s.inv || {})) {
      this.inventory.set(id, {
        ammo: inv.ammo < 0 ? Infinity : inv.ammo,
        reserve: inv.reserve < 0 ? Infinity : inv.reserve,
      });
    }
    if (s.current && this.inventory.has(s.current)) this.current = s.current;
  }
}
