// Higgsfield building library: bakes each generated GLB into a normalized
// unit-bounding-box geometry (origin at ground centre) so thousands of lots
// can render it through InstancedMesh with per-lot (w,h,d) scales.
// Archetype styles map onto the library; anything missing falls back to the
// procedural builder, and a share of downtown keeps procedural glass so the
// night skyline still has lit windows.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STYLE } from './buildingFactory.js';

const MODEL_FOR_STYLE = {
  [STYLE.GLASS_A]: 'building-tower', [STYLE.GLASS_B]: 'building-tower',
  [STYLE.GLASS_C]: 'building-tower', [STYLE.GLASS_D]: 'building-tower',
  [STYLE.OFFICE_A]: 'building-office', [STYLE.OFFICE_B]: 'building-office',
  [STYLE.OFFICE_C]: 'building-office', [STYLE.CONCRETE_A]: 'building-office',
  [STYLE.CONCRETE_B]: 'building-office', [STYLE.ARTDECO]: 'building-office',
  [STYLE.CIVIC]: 'building-office',
  [STYLE.BRICK_A]: 'building-apartment', [STYLE.BRICK_B]: 'building-apartment',
  [STYLE.BRICK_C]: 'building-apartment', [STYLE.ROWHOUSE]: 'building-apartment',
  [STYLE.SHOPFRONT]: 'building-shop',
  [STYLE.HOUSE_A]: 'building-house-a', [STYLE.HOUSE_C]: 'building-house-a',
  [STYLE.HOUSE_B]: 'building-house-b', [STYLE.HOUSE_D]: 'building-house-b',
  [STYLE.WAREHOUSE_A]: 'building-warehouse', [STYLE.WAREHOUSE_B]: 'building-warehouse',
};

// how often a lot keeps the procedural mesh (lit windows / variety)
const PROCEDURAL_SHARE = { tall: 40, low: 15 };

export class GLBBuildingLibrary {
  constructor(G) {
    this.G = G;
    this.baked = new Map();   // model name -> {geometry, materials[]} | null
  }

  _bake(name) {
    if (this.baked.has(name)) return this.baked.get(name);
    const tpl = this.G.assets?.cache?.get(name);
    if (!tpl) {
      this.baked.set(name, null);
      return null;
    }
    try {
      tpl.updateMatrixWorld(true);
      const geos = [];
      const mats = [];
      tpl.traverse((o) => {
        if (o.isMesh && o.geometry) {
          const g = o.geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          // strip attributes that differ across meshes so merge succeeds
          for (const key of Object.keys(g.attributes)) {
            if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
          }
          if (!g.attributes.normal) g.computeVertexNormals();
          geos.push(g);
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          m.envMapIntensity = 0.85;
          mats.push(m);
        }
      });
      if (!geos.length) throw new Error('no meshes');
      const merged = mergeGeometries(geos, true);
      merged.computeBoundingBox();
      const bb = merged.boundingBox;
      const size = new THREE.Vector3();
      bb.getSize(size);
      const center = new THREE.Vector3();
      bb.getCenter(center);
      // origin at ground centre, each axis normalized to 1
      const m4 = new THREE.Matrix4()
        .makeScale(1 / Math.max(size.x, 1e-3), 1 / Math.max(size.y, 1e-3), 1 / Math.max(size.z, 1e-3))
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bb.min.y, -center.z));
      merged.applyMatrix4(m4);
      merged.computeBoundingSphere();
      const entry = { geometry: merged, materials: mats };
      this.baked.set(name, entry);
      return entry;
    } catch (e) {
      console.warn(`[glb-buildings] bake failed for ${name}`, e);
      this.baked.set(name, null);
      return null;
    }
  }

  /**
   * Decide the GLB model for a building entry, or null → procedural.
   * Keeps a hash-stable share procedural for lit windows & variety.
   */
  modelFor(b) {
    const style = b[6];
    const name = MODEL_FOR_STYLE[style];
    if (!name || !this._bake(name)) return null;
    const share = style <= STYLE.ARTDECO ? PROCEDURAL_SHARE.tall : PROCEDURAL_SHARE.low;
    const hash = Math.abs(((b[0] * 13.7 + b[1] * 7.3) | 0)) % 100;
    return hash < share ? null : name;
  }

  /** InstancedMesh for a list of building entries sharing one model. */
  makeInstanced(name, entries) {
    const baked = this._bake(name);
    if (!baked) return null;
    const mesh = new THREE.InstancedMesh(baked.geometry, baked.materials, entries.length);
    mesh.castShadow = this.G.settings.quality === 'high';
    mesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    entries.forEach((b, i) => {
      const [x, z, w, d, h, ry] = b;
      const baseY = (this.G.terrain?.heightAt(x, z) ?? 0) - 0.15;
      q.setFromEuler(new THREE.Euler(0, ry * Math.PI / 2, 0));
      m4.compose(new THREE.Vector3(x, baseY, z), q, new THREE.Vector3(w, h, d));
      mesh.setMatrixAt(i, m4);
    });
    return mesh;
  }
}
