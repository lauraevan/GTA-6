// Pooled particle + tracer + skid-mark effects.

import * as THREE from 'three';

const MAX = 600;

export class Particles {
  constructor(G) {
    this.G = G;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.sizes = new Float32Array(MAX);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.parts = []; // {i, vel, life, maxLife, grav, drag, startSize, endSize, fadeColor?}
    this.free = [];
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);

    this.mat = new THREE.PointsMaterial({
      size: 0.5, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    G.scene.add(this.points);

    // tracers (bullet lines)
    this.tracerPool = [];
    this.tracers = [];
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 24; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(g, tracerMat.clone());
      line.visible = false; line.frustumCulled = false;
      G.scene.add(line);
      this.tracerPool.push(line);
    }

    // explosion flash lights
    this.flashPool = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 40, 2);
      G.scene.add(l);
      this.flashPool.push({ light: l, life: 0 });
    }

    // skid marks
    this.skids = [];
    this.skidMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false });
  }

  emit(o) {
    if (!this.free.length) return;
    const i = this.free.pop();
    this.pos[i * 3] = o.pos.x; this.pos[i * 3 + 1] = o.pos.y; this.pos[i * 3 + 2] = o.pos.z;
    const c = o.color;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.parts.push({
      i, vel: o.vel.clone(), life: o.life, maxLife: o.life,
      grav: o.grav ?? -6, drag: o.drag ?? 1.5, fade: o.fade ?? true,
    });
  }

  burst(pos, { count = 10, speed = 4, color = 0xffffff, life = 0.7, spread = 1, up = 2, grav = -6 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2 * spread,
        Math.random() * up,
        (Math.random() - 0.5) * 2 * spread).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.emit({ pos, vel: v, color: c, life: life * (0.6 + Math.random() * 0.7), grav });
    }
  }

  // convenience effects -----------------------------------------------------
  sparks(pos) { this.burst(pos, { count: 10, speed: 7, color: 0xffd080, life: 0.4, grav: -12 }); }
  smoke(pos, dark = false) {
    this.burst(pos, { count: 2, speed: 0.8, color: dark ? 0x222222 : 0x888888, life: 1.6, up: 2.2, grav: 1.2 });
  }
  blood(pos) { this.burst(pos, { count: 8, speed: 3.2, color: 0x7a1010, life: 0.5 }); }
  dust(pos) { this.burst(pos, { count: 3, speed: 1.4, color: 0xb09a70, life: 0.9, grav: -1 }); }
  muzzle(pos, dir) {
    const c = new THREE.Color(0xffe090);
    for (let k = 0; k < 4; k++) {
      const v = dir.clone().multiplyScalar(8 + Math.random() * 6)
        .add(new THREE.Vector3((Math.random() - .5) * 3, (Math.random() - .5) * 3, (Math.random() - .5) * 3));
      this.emit({ pos, vel: v, color: c, life: 0.08, grav: 0 });
    }
  }
  explosion(pos) {
    this.burst(pos, { count: 40, speed: 12, color: 0xff9030, life: 0.8, up: 3, grav: -3 });
    this.burst(pos, { count: 26, speed: 6, color: 0x222222, life: 2.2, up: 3, grav: 2 });
    this.burst(pos, { count: 16, speed: 16, color: 0xffe9a0, life: 0.35, grav: -14 });
    const f = this.flashPool.find((f) => f.life <= 0);
    if (f) { f.life = 0.35; f.light.position.copy(pos).add(new THREE.Vector3(0, 2, 0)); f.light.intensity = 260; }
    this.G.camera && this.G.cameraRig?.shake(Math.max(0.1, 1.6 - pos.distanceTo(this.G.camera.position) * 0.02));
  }

  tracer(from, to) {
    const line = this.tracerPool.find((l) => !l.visible);
    if (!line) return;
    line.geometry.setFromPoints([from, to]);
    line.material.opacity = 0.85;
    line.visible = true;
    this.tracers.push({ line, life: 0.07 });
  }

  skidMark(pos, dir, width = 0.28) {
    if (this.skids.length > 240) {
      const old = this.skids.shift();
      old.mesh.geometry.dispose();
      this.G.scene.remove(old.mesh);
    }
    const g = new THREE.PlaneGeometry(width, 1.1);
    const m = new THREE.Mesh(g, this.skidMat);
    m.position.copy(pos).setY(0.06);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(dir.x, dir.z);
    this.G.scene.add(m);
    this.skids.push({ mesh: m, life: 14 });
  }

  update(dt) {
    const posAttr = this.geo.attributes.position;
    const colAttr = this.geo.attributes.color;
    for (let k = this.parts.length - 1; k >= 0; k--) {
      const p = this.parts[k];
      p.life -= dt;
      const i = p.i;
      if (p.life <= 0) {
        this.pos[i * 3 + 1] = -9999;
        this.parts.splice(k, 1);
        this.free.push(i);
        continue;
      }
      p.vel.y += p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      this.pos[i * 3] += p.vel.x * dt;
      this.pos[i * 3 + 1] += p.vel.y * dt;
      this.pos[i * 3 + 2] += p.vel.z * dt;
      if (p.fade) {
        const f = p.life / p.maxLife;
        this.col[i * 3] *= (0.2 + 0.8 * f) ** dt;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    for (let k = this.tracers.length - 1; k >= 0; k--) {
      const t = this.tracers[k];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) { t.line.visible = false; this.tracers.splice(k, 1); }
    }
    for (const f of this.flashPool) {
      if (f.life > 0) {
        f.life -= dt;
        f.light.intensity = Math.max(0, f.life / 0.35) * 260;
        if (f.life <= 0) f.light.intensity = 0;
      }
    }
    for (let k = this.skids.length - 1; k >= 0; k--) {
      const s = this.skids[k];
      s.life -= dt;
      if (s.life < 3) s.mesh.material = this.skidMat; // shared fade handled by opacity below
      if (s.life <= 0) {
        s.mesh.geometry.dispose();
        this.G.scene.remove(s.mesh);
        this.skids.splice(k, 1);
      }
    }
  }
}
