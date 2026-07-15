// Time-of-day: sun/moon lighting, sky + fog colours, stars, emissive windows,
// street lights. Drives the "Forza-vibrant" look — high contrast, warm days,
// deep blue nights.

import * as THREE from 'three';
import { clamp, lerp } from '../core/mathx.js';

const SKY_STOPS = [
  // hour, sky, fog, sunColor, sunIntensity, hemi
  [0,  0x0a1226, 0x0a1020, 0x223a66, 0.05, 0.22],
  [5,  0x14203c, 0x141c30, 0x35558c, 0.08, 0.26],
  [6.5, 0xd8814f, 0xc07850, 0xffb066, 0.55, 0.5],
  [8,  0x7fb5e6, 0xa8c4de, 0xfff0d0, 1.05, 0.85],
  [13, 0x66aef0, 0xa5c8e8, 0xffffff, 1.25, 1.0],
  [17, 0x6fa8e0, 0xa8c0dc, 0xffe8c0, 1.0, 0.9],
  [19.2, 0xe08a4a, 0xcc8055, 0xff9a4d, 0.5, 0.5],
  [20.5, 0x1a2440, 0x1a2038, 0x486aa8, 0.1, 0.28],
  [24, 0x0a1226, 0x0a1020, 0x223a66, 0.05, 0.22],
];

export class DayNight {
  constructor(G) {
    this.G = G;
    this.hour = 10.5;

    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.castShadow = G.settings.quality === 'high';
    if (this.sun.castShadow) {
      const s = 130;
      this.sun.shadow.camera.left = -s; this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s; this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.far = 800;
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.bias = -0.0004;
    }
    this.sunTarget = new THREE.Object3D();
    G.scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(0xbdd5ff, 0x3a3a30, 0.8);
    G.scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0x8899ff, 0.0);
    G.scene.add(this.moon);
    this.moon.target = this.sunTarget;

    // stars
    const starGeo = new THREE.BufferGeometry();
    const n = 1200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.48;
      const r = 1900;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      pos[i * 3 + 1] = Math.sin(ph) * r + 60;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xcfd8ff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.G.scene.add(this.stars);

    // registries filled by world factories
    this.emissiveMats = [];   // window materials: intensity 1 at night
    this.lampMats = [];       // street lamp heads
    this.sunFactor = 1;
    this._skyColor = new THREE.Color();
    this._fogColor = new THREE.Color();
    this._c1 = new THREE.Color(); this._c2 = new THREE.Color();
  }

  registerEmissive(mat) { this.emissiveMats.push(mat); }
  registerLamp(mat) { this.lampMats.push(mat); }

  get isNight() { return this.hour < 6.2 || this.hour > 19.6; }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; }

  sample(hour) {
    let a = SKY_STOPS[0], b = SKY_STOPS[SKY_STOPS.length - 1];
    for (let i = 0; i < SKY_STOPS.length - 1; i++) {
      if (hour >= SKY_STOPS[i][0] && hour <= SKY_STOPS[i + 1][0]) {
        a = SKY_STOPS[i]; b = SKY_STOPS[i + 1]; break;
      }
    }
    const t = (hour - a[0]) / Math.max(0.0001, b[0] - a[0]);
    return { t, a, b };
  }

  update(dt) {
    const { G } = this;
    const dayLen = G.settings.dayLengthMin * 60;
    this.hour = (this.hour + (dt / dayLen) * 24) % 24;

    const { t, a, b } = this.sample(this.hour);
    this._skyColor.set(a[1]).lerp(this._c1.set(b[1]), t);
    this._fogColor.set(a[2]).lerp(this._c2.set(b[2]), t);
    const sunI = lerp(a[4], b[4], t);
    const hemiI = lerp(a[5], b[5], t);
    this.sunFactor = clamp((sunI - 0.05) / 1.2, 0, 1);

    G.scene.background = this._skyColor;
    if (G.scene.fog) G.scene.fog.color.copy(this._fogColor);

    // sun position on an arc over the player
    const anchor = G.player ? G.player.position : new THREE.Vector3();
    const ang = ((this.hour - 6) / 12) * Math.PI; // 6h -> 0, 18h -> PI
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.85, Math.sin(ang), 0.35).normalize();
    this.sun.position.copy(anchor).addScaledVector(sunDir, 420);
    this.sunTarget.position.copy(anchor);
    this.sun.intensity = sunI * 1.6;
    this.sun.color.set(a[3]).lerp(this._c1.set(b[3]), t);
    this.sun.visible = sunDir.y > -0.15;

    this.moon.position.copy(anchor).add(new THREE.Vector3(-160, 300, 120));
    this.moon.intensity = (1 - this.sunFactor) * 0.22;
    this.hemi.intensity = hemiI * (G.weather ? lerp(1, 0.75, G.weather.cloudiness) : 1);

    this.starMat.opacity = (1 - this.sunFactor) * 0.9;
    this.stars.position.copy(anchor).setY(0);

    // window + lamp emissives
    const night = 1 - this.sunFactor;
    const wIntensity = night * 1.35;
    for (const m of this.emissiveMats) m.emissiveIntensity = wIntensity;
    const lampI = night * 2.2;
    for (const m of this.lampMats) m.emissiveIntensity = lampI;
  }
}
