// Road visuals: a whole-city ground texture (base layer, also used for distant
// terrain) plus crisp per-chunk asphalt overlays with lane markings, sidewalk
// curbs (with physics) and intersection patches.

import * as THREE from 'three';
import { canvasTexture, noise2d } from '../core/assets.js';
import { DISTRICT } from './cityData.js';

const DISTRICT_GROUND = {
  [DISTRICT.WATER]: '#1d4e63',
  [DISTRICT.DOWNTOWN]: '#5b5954',
  [DISTRICT.COMMERCIAL]: '#615d55',
  [DISTRICT.RESIDENTIAL]: '#4f583f',
  [DISTRICT.INDUSTRIAL]: '#565349',
  [DISTRICT.RURAL]: '#48583a',
  [DISTRICT.PARK]: '#3f5c38',
  [DISTRICT.BEACH]: '#c4b183',
};

export class RoadFactory {
  constructor(G) {
    this.G = G;
    this.laneTex = {};
  }

  /** big canvas of the whole city: district ground + roads (used at 1 px/m). */
  buildGroundTexture() {
    const city = this.G.city;
    const size = 2048;
    const scale = size / city.meta.worldSize;
    return canvasTexture(size, size, (ctx) => {
      const toPx = (v) => (v + city.half) * scale;
      // districts with per-block tonal variation + inner lot shading
      for (let bz = 0; bz < city.meta.blocks; bz++) {
        for (let bx = 0; bx < city.meta.blocks; bx++) {
          const px = toPx(-city.half + bx * city.blockSize);
          const pz = toPx(-city.half + bz * city.blockSize);
          const bs = city.blockSize * scale;
          ctx.fillStyle = DISTRICT_GROUND[city.districts[bz][bx]] || '#5a7046';
          ctx.fillRect(px, pz, bs + 1, bs + 1);
          const jitter = ((bx * 31 + bz * 17) % 7) / 7;
          ctx.fillStyle = `rgba(${jitter > 0.5 ? '255,255,240' : '0,0,20'},${0.03 + jitter * 0.05})`;
          ctx.fillRect(px, pz, bs + 1, bs + 1);
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          ctx.fillRect(px + bs * 0.14, pz + bs * 0.14, bs * 0.72, bs * 0.72);
        }
      }
      noise2d(ctx, size, size, 0.05, 6000);
      // roads
      for (const r of this.G.city.roads) {
        const w = city.roadHalf(r.t) * 2 * scale;
        ctx.fillStyle = r.t === 2 ? '#33343a' : '#3d3e44';
        const p0 = toPx(city.linePos(r.j0)), p1 = toPx(city.linePos(r.j1));
        const c = toPx(city.linePos(r.i));
        if (r.a === 'v') ctx.fillRect(c - w / 2, p0 - w / 2, w, p1 - p0 + w);
        else ctx.fillRect(p0 - w / 2, c - w / 2, p1 - p0 + w, w);
      }
    }, { srgb: true });
  }

  laneTexture(type) {
    if (this.laneTex[type]) return this.laneTex[type];
    const tex = canvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#3b3c42'; ctx.fillRect(0, 0, w, h);
      noise2d(ctx, w, h, 0.08, 350);
      ctx.fillStyle = '#c8c8c0';
      // edge lines
      ctx.fillRect(6, 0, 3, h);
      ctx.fillRect(w - 9, 0, 3, h);
      if (type === 0) {
        // single dashed centre
        ctx.fillStyle = '#d8c04a';
        for (let y = 8; y < h; y += 48) ctx.fillRect(w / 2 - 2, y, 4, 26);
      } else if (type === 1) {
        ctx.fillStyle = '#d8c04a';
        ctx.fillRect(w / 2 - 5, 0, 3, h);
        ctx.fillRect(w / 2 + 2, 0, 3, h);
        ctx.fillStyle = '#c8c8c0';
        for (let y = 8; y < h; y += 56) { ctx.fillRect(w / 4 - 2, y, 3, 24); ctx.fillRect((3 * w) / 4 - 2, y, 3, 24); }
      } else {
        ctx.fillStyle = '#c8c8c0';
        for (let y = 8; y < h; y += 40) { ctx.fillRect(w / 4 - 2, y, 3, 22); ctx.fillRect((3 * w) / 4 - 2, y, 3, 22); }
        ctx.fillStyle = '#d8c04a';
        ctx.fillRect(w / 2 - 2, 0, 4, h);
      }
    }, { repeat: [1, 1] });
    tex.wrapT = THREE.RepeatWrapping;
    this.laneTex[type] = tex;
    return tex;
  }

  /**
   * Build road overlays + curbs for one chunk. Returns {meshes, colliders}
   * colliders: {x,y,z,sx,sy,sz,ry}
   */
  buildChunkRoads(cx, cz) {
    const city = this.G.city;
    const s = city.chunkSize;
    const x0 = -city.half + cx * s, x1 = x0 + s;
    const z0 = -city.half + cz * s, z1 = z0 + s;
    const meshes = [], colliders = [], wetMats = [];
    const curbMat = this._curbMat || (this._curbMat =
      new THREE.MeshStandardMaterial({ color: '#8f8f8a', roughness: 0.95 }));
    const mkAsphalt = (tex) => {
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, envMapIntensity: 0.35 });
      m.userData.baseRoughness = 0.92;
      wetMats.push(m);
      return m;
    };

    for (const r of city.roads) {
      const half = city.roadHalf(r.t);
      const c = city.linePos(r.i);
      let a0 = city.linePos(r.j0), a1 = city.linePos(r.j1);
      if (r.a === 'v') {
        if (c + half < x0 || c - half > x1) continue;
        const lo = Math.max(a0, z0), hi = Math.min(a1, z1);
        if (hi - lo < 2) continue;
        const len = hi - lo, mid = (lo + hi) / 2;
        const geo = new THREE.PlaneGeometry(half * 2, len);
        const tex = this.laneTexture(r.t).clone();
        tex.needsUpdate = true;
        tex.repeat.set(1, len / 24);
        const m = new THREE.Mesh(geo, mkAsphalt(tex));
        m.rotation.x = -Math.PI / 2;
        m.position.set(c, 0.03, mid);
        m.receiveShadow = true;
        meshes.push(m);
        // curbs (skip near segment ends → natural corner gaps)
        if (len > 26) {
          const cl = len - 22;
          for (const side of [-1, 1]) {
            const cxp = c + side * (half + 0.8);
            const curb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, cl), curbMat);
            curb.position.set(cxp, 0.07, mid);
            curb.receiveShadow = true;
            meshes.push(curb);
            colliders.push({ x: cxp, y: 0, z: mid, sx: 1.6, sy: 0.14, sz: cl, ry: 0 });
          }
        }
      } else {
        if (c + half < z0 || c - half > z1) continue;
        const lo = Math.max(a0, x0), hi = Math.min(a1, x1);
        if (hi - lo < 2) continue;
        const len = hi - lo, mid = (lo + hi) / 2;
        const geo = new THREE.PlaneGeometry(half * 2, len);
        const tex = this.laneTexture(r.t).clone();
        tex.needsUpdate = true;
        tex.repeat.set(1, len / 24);
        const m = new THREE.Mesh(geo, mkAsphalt(tex));
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = Math.PI / 2;
        m.position.set(mid, 0.03, c);
        m.receiveShadow = true;
        meshes.push(m);
        if (len > 26) {
          const cl = len - 22;
          for (const side of [-1, 1]) {
            const czp = c + side * (half + 0.8);
            const curb = new THREE.Mesh(new THREE.BoxGeometry(cl, 0.14, 1.6), curbMat);
            curb.position.set(mid, 0.07, czp);
            curb.receiveShadow = true;
            meshes.push(curb);
            colliders.push({ x: mid, y: 0, z: czp, sx: cl, sy: 0.14, sz: 1.6, ry: 0 });
          }
        }
      }
    }

    // intersection patches so crossing markings don't overlap
    if (!this._patchMat) {
      this._patchMat = new THREE.MeshStandardMaterial({
        color: '#3b3c42', roughness: 0.92, envMapIntensity: 0.35 });
      this._patchMat.userData.baseRoughness = 0.92;
      this.G.wetMats?.add(this._patchMat); // shared: registered once, never removed
    }
    const patchMat = this._patchMat;
    const nav = this.G.nav;
    for (const n of nav.nodes) {
      if (n.x < x0 - 10 || n.x > x1 + 10 || n.z < z0 - 10 || n.z > z1 + 10) continue;
      if (nav.adj[n.id].length < 3) continue;
      let maxHalf = 0;
      for (const e of nav.adj[n.id]) maxHalf = Math.max(maxHalf, city.roadHalf(e.t));
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(maxHalf * 2 + 1, maxHalf * 2 + 1), patchMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(n.x, 0.045, n.z);
      patch.receiveShadow = true;
      meshes.push(patch);
    }

    return { meshes, colliders, wetMats };
  }
}
