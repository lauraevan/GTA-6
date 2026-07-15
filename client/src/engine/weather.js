// Dynamic weather: clear / overcast / rain / fog. Affects fog density, traction
// (vehicle grip multiplier), cop line-of-sight range and ambience.

import * as THREE from 'three';
import { damp, lerp } from '../core/mathx.js';

const STATES = {
  clear:    { fog: 0.0016, rain: 0, cloud: 0.05, traction: 1.0, vis: 1.0 },
  overcast: { fog: 0.0030, rain: 0, cloud: 0.75, traction: 1.0, vis: 0.9 },
  rain:     { fog: 0.0048, rain: 1, cloud: 1.0, traction: 0.72, vis: 0.65 },
  fog:      { fog: 0.0110, rain: 0, cloud: 0.55, traction: 0.95, vis: 0.4 },
};
const CHAIN = {
  clear: ['clear', 'clear', 'overcast', 'fog'],
  overcast: ['clear', 'rain', 'overcast', 'rain'],
  rain: ['rain', 'overcast', 'clear'],
  fog: ['clear', 'overcast', 'fog'],
};

export class Weather {
  constructor(G) {
    this.G = G;
    this.state = 'clear';
    this.next = 'clear';
    this.timer = 60 + Math.random() * 90;
    this.cur = { ...STATES.clear };
    this.cloudiness = 0.05;
    this.rainAmount = 0;

    G.scene.fog = new THREE.FogExp2(0xa5c8e8, this.cur.fog);

    // rain particle cylinder around the camera
    const n = 900;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    this.rainSeeds = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.rainSeeds[i * 2] = Math.random();
      this.rainSeeds[i * 2 + 1] = 18 + Math.random() * 12;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.PointsMaterial({
      color: 0xa8c8e8, size: 0.14, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new THREE.Points(geo, this.rainMat);
    this.rain.frustumCulled = false;
    G.scene.add(this.rain);
    this.thunderTimer = 0;
  }

  get traction() { return this.cur.traction; }
  get visibility() { return this.cur.vis; }

  force(state) { this.state = state; this.next = state; this.timer = 120; }

  update(dt) {
    const { G } = this;
    this.timer -= dt;
    if (this.timer <= 0) {
      const options = CHAIN[this.state];
      this.state = options[(Math.random() * options.length) | 0];
      this.timer = 90 + Math.random() * 120;
    }
    const target = STATES[this.state];
    for (const k of Object.keys(this.cur)) {
      this.cur[k] = damp(this.cur[k], target[k], 0.35, dt);
    }
    this.cloudiness = this.cur.cloud;
    this.rainAmount = this.cur.rain;

    if (G.scene.fog) {
      const nightMul = 1 + (1 - (G.daynight?.sunFactor ?? 1)) * 0.4;
      G.scene.fog.density = this.cur.fog * nightMul;
    }

    // wet asphalt: darker, glossier, catches the environment reflections
    if (G.wetMats) {
      const wet = this.cur.rain;
      for (const m of G.wetMats) {
        const base = m.userData.baseRoughness ?? 0.92;
        m.roughness = lerp(base, 0.3, wet);
        m.envMapIntensity = lerp(0.35, 1.7, wet);
      }
    }

    // rain particles
    const show = this.cur.rain > 0.05;
    this.rainMat.opacity = this.cur.rain * 0.65;
    if (show) {
      const cam = G.camera.position;
      this.rain.position.set(cam.x, cam.y - 8, cam.z);
      const posAttr = this.rain.geometry.attributes.position;
      const arr = posAttr.array;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3 + 1] -= this.rainSeeds[i * 2 + 1] * dt;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 28 + Math.random() * 4;
          arr[i * 3] = (Math.random() - 0.5) * 60;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
        }
      }
      posAttr.needsUpdate = true;

      // occasional thunder in heavy rain
      this.thunderTimer -= dt;
      if (this.cur.rain > 0.8 && this.thunderTimer <= 0) {
        this.thunderTimer = 14 + Math.random() * 30;
        G.audio?.play('thunder');
        G.ui?.flashWhite?.(0.35);
      }
    }
  }
}
