// Pedestrian entity: procedural low-poly person with code-driven walk cycle,
// hit reactions and ragdoll death. Cops/SWAT/clerks are variants. The player
// re-uses the same rig. GLB swap name: `ped-civilian` etc. (see ASSETS.md).

import * as THREE from 'three';

function part(name, geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildPedMesh(G, outfit, opts = {}) {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: outfit.skin, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: outfit.shirt, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: outfit.pants, roughness: 0.85 });

  const head = part('head', new THREE.SphereGeometry(0.15, 10, 8), skin, 0, 1.62, 0);
  const torso = part('torso', new THREE.BoxGeometry(0.4, 0.62, 0.24), shirt, 0, 1.14, 0);
  const armL = part('armL', new THREE.BoxGeometry(0.11, 0.52, 0.11), shirt, -0.27, 1.32, 0);
  const armR = part('armR', new THREE.BoxGeometry(0.11, 0.52, 0.11), shirt, 0.27, 1.32, 0);
  armL.geometry.translate(0, -0.2, 0);
  armR.geometry.translate(0, -0.2, 0);
  const legL = part('legL', new THREE.BoxGeometry(0.15, 0.85, 0.15), pants, -0.11, 0.85, 0);
  const legR = part('legR', new THREE.BoxGeometry(0.15, 0.85, 0.15), pants, 0.11, 0.85, 0);
  legL.geometry.translate(0, -0.42, 0);
  legR.geometry.translate(0, -0.42, 0);
  root.add(head, torso, armL, armR, legL, legR);

  if (opts.cap) {
    const cap = part('cap', new THREE.CylinderGeometry(0.16, 0.17, 0.09, 10),
      new THREE.MeshStandardMaterial({ color: opts.cap, roughness: 0.7 }), 0, 1.74, 0);
    root.add(cap);
  }
  if (outfit.apron) {
    const ap = part('apron', new THREE.BoxGeometry(0.34, 0.5, 0.05),
      new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.9 }), 0, 1.05, 0.14);
    root.add(ap);
  }
  if (opts.badge) {
    const b = part('badge', new THREE.BoxGeometry(0.08, 0.1, 0.02),
      new THREE.MeshStandardMaterial({ color: '#e8b437', metalness: 0.8, roughness: 0.3 }), -0.12, 1.3, 0.14);
    root.add(b);
  }
  return { root, parts: { head, torso, armL, armR, legL, legR } };
}

let nextPid = 1;

export class Ped {
  constructor(G, pos, outfit, opts = {}) {
    this.G = G;
    this.id = nextPid++;
    this.isCop = opts.isCop ?? false;
    this.isSwat = opts.isSwat ?? false;
    this.isClerk = opts.isClerk ?? false;

    // civilians use the Higgsfield skinned+animated model when it's bundled;
    // cops/clerks need procedural poses (aim, hands-up) so they keep the part rig
    this.skinned = null;
    if (opts.allowSkinned && !this.isCop && !this.isSwat && !this.isClerk) {
      const model = G.assets?.getModel('ped-civilian-anim');
      if (model && model.userData.skinned && model.userData.animations?.length) {
        this.mesh = model;
        this.parts = null;
        // wardrobe variety: subtle per-ped tint so crowds don't look cloned
        model.traverse((o) => {
          if (o.isMesh && o.material) {
            o.material = o.material.clone();
            o.material.color.offsetHSL((Math.random() - 0.5) * 0.06,
              (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.1);
          }
        });
        const mixer = new THREE.AnimationMixer(model);
        const walkClip = model.userData.animations.find((c) => /walk/i.test(c.name))
          ?? model.userData.animations[0];
        const walk = mixer.clipAction(walkClip);
        walk.play();
        // idle + run clips ship as sibling GLBs on the same auto-rig
        const sibling = (name) => {
          const clip = G.assets?.cache?.get(name)?.userData?.animations?.[0];
          if (!clip) return null;
          const a = mixer.clipAction(clip);
          a.play();
          a.weight = 0;
          return a;
        };
        this.skinned = { mixer, walk, idle: sibling('ped-civilian-idle'), run: sibling('ped-civilian-run') };
      }
    }
    if (!this.skinned) {
      const built = buildPedMesh(G, outfit, {
        cap: (this.isCop || this.isSwat) ? (opts.capColor ?? '#101828') : null,
        badge: this.isCop,
      });
      this.mesh = built.root;
      this.parts = built.parts;
    }
    this.outfit = outfit;
    this.mesh.position.copy(pos);
    G.scene.add(this.mesh);

    this.hp = this.isSwat ? 90 : this.isCop ? 55 : 35;
    this.yaw = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.phase = Math.random() * 10;
    this.dead = false;
    this.handsUp = false;
    this.state = 'walk';
    this.stateT = 0;
    // brain fields (used by managers)
    this.edge = null; this.toNode = null; this.side = 1;
    this.threat = null;
    this.gun = null;

    if (opts.gun) this.attachGun();
  }

  attachGun() {
    if (this.gun || !this.parts) return;
    this.gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.16, 0.3),
      new THREE.MeshStandardMaterial({ color: '#1a1c22', roughness: 0.4, metalness: 0.6 }));
    this.gun.position.set(0, -0.42, 0.12);
    this.parts.armR.add(this.gun);
  }

  get position() { return this.mesh.position; }

  moveToward(x, z, speed, dt) {
    const dx = x - this.position.x, dz = z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.speed = 0; return true; }
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, 10 * dt);
    const step = Math.min(speed * dt, d);
    this.position.x += Math.sin(this.yaw) * step;
    this.position.z += Math.cos(this.yaw) * step;
    this.position.y = (this.G.terrain?.heightAt(this.position.x, this.position.z) ?? 0) + 0.05;
    this.speed = speed;
    return d < 0.4;
  }

  faceToward(x, z) {
    this.yaw = Math.atan2(x - this.position.x, z - this.position.z);
  }

  hit(dmg, fromDir, byPlayer = true) {
    if (this.dead) return;
    this.hp -= dmg;
    this.G.particles?.blood(this.position.clone().add(new THREE.Vector3(0, 1.2, 0)));
    if (this.hp <= 0) {
      this.die(fromDir ? fromDir.clone().multiplyScalar(60) : new THREE.Vector3(0, 0, 0), byPlayer);
    } else if (!this.isCop && !this.isSwat) {
      this.state = 'flee';
      this.threat = this.G.player?.position.clone() ?? null;
    }
  }

  die(impulse, byPlayer = false, byCar = false) {
    if (this.dead) return;
    this.dead = true;
    this.G.audio?.play('scream', { pos: this.position, vol: 0.5 });
    let ragdollSource = this.mesh;
    if (this.skinned) {
      // ragdolls need the part-based rig: swap the skinned mesh for one
      this.G.scene.remove(this.mesh);
      ragdollSource = buildPedMesh(this.G, this.outfit, {}).root;
      ragdollSource.position.copy(this.position);
      ragdollSource.rotation.y = this.yaw;
      this.G.scene.add(ragdollSource);
    }
    this.G.ragdolls?.spawn(ragdollSource, this.position.clone(), impulse);
    // occasional cash drop
    if (!this.isCop && Math.random() < 0.35) {
      this.G.pickups?.spawnCash(this.position.clone(), 10 + (Math.random() * 50) | 0);
    }
    if (this.isCop || this.isSwat) {
      this.G.pickups?.spawnAmmo(this.position.clone(), 'pistol', 12);
      this.G.events.emit('copKilled', { pos: this.position.clone(), byPlayer });
    } else {
      this.G.events.emit('pedKilled', { ped: this, byPlayer, byCar, pos: this.position.clone() });
    }
  }

  /** walk-cycle animation: AnimationMixer for skinned peds, procedural otherwise */
  animate(dt) {
    if (this.dead) return;
    this.mesh.rotation.y = this.yaw;
    if (this.skinned) {
      const { mixer, walk, idle, run } = this.skinned;
      const moving = this.speed > 0.12;
      const running = run && this.speed > 3.2;
      if (idle) {
        // three-way blend: idle <-> walk <-> run by movement speed
        const wWalk = moving && !running ? 1 : 0;
        const wRun = running ? 1 : 0;
        const k = Math.min(1, 8 * dt);
        walk.weight += (wWalk - walk.weight) * k;
        if (run) run.weight += (wRun - run.weight) * k;
        idle.weight = Math.max(0, 1 - walk.weight - (run?.weight ?? 0));
        walk.timeScale = Math.max(0.55, this.speed / 1.55);
        if (run) run.timeScale = Math.max(0.7, this.speed / 5.0);
      } else {
        walk.timeScale = moving ? Math.max(0.55, this.speed / 1.55) : 0;
        if (!moving) walk.time = 0.35; // neutral standing frame
      }
      mixer.update(dt);
      return;
    }
    const { armL, armR, legL, legR, torso } = this.parts;
    if (this.handsUp) {
      armL.rotation.x = Math.PI - 0.3 + Math.sin(this.phase * 2) * 0.03;
      armR.rotation.x = Math.PI - 0.25;
      legL.rotation.x = 0; legR.rotation.x = 0;
      return;
    }
    if (this.speed > 0.1) {
      this.phase += dt * (2.4 + this.speed * 1.35);
      const swing = Math.min(0.85, 0.3 + this.speed * 0.09);
      legL.rotation.x = Math.sin(this.phase) * swing;
      legR.rotation.x = -Math.sin(this.phase) * swing;
      armL.rotation.x = -Math.sin(this.phase) * swing * 0.8;
      armR.rotation.x = this.aimPose ? armR.rotation.x : Math.sin(this.phase) * swing * 0.8;
      torso.rotation.x = 0.06 + this.speed * 0.008;
    } else {
      this.phase += dt;
      legL.rotation.x = 0; legR.rotation.x = 0;
      armL.rotation.x = Math.sin(this.phase * 1.2) * 0.05;
      armR.rotation.x = this.aimPose ? armR.rotation.x : Math.cos(this.phase * 1.1) * 0.05;
      torso.rotation.x = 0;
    }
    if (this.aimPose) {
      armR.rotation.x = Math.PI / 2 - 0.1;
    }
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
  }
}
