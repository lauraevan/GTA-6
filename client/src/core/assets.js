// Asset library: optional GLB models (generated e.g. via Higgsfield, listed in
// public/models/manifest.json) with guaranteed procedural fallbacks.
// Factories elsewhere call `assets.getModel(name)` — if it returns null they
// build the procedural version instead. See ASSETS.md for the GLB prompt sheet.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class AssetLibrary {
  constructor() {
    this.manifest = { assets: {} };
    this.cache = new Map();     // name -> THREE.Group (template)
    this.loader = new GLTFLoader();
  }

  async init(onProgress) {
    try {
      const res = await fetch('models/manifest.json', { cache: 'no-cache' });
      if (res.ok) this.manifest = await res.json();
    } catch (e) { /* no manifest — fully procedural */ }
    const entries = Object.entries(this.manifest.assets || {});
    let done = 0;
    for (const [name, meta] of entries) {
      try {
        const gltf = await this.loader.loadAsync(`models/${meta.file}`);
        const inner = gltf.scene;
        if (meta.yaw) inner.rotation.y = meta.yaw;
        const root = new THREE.Group();
        root.add(inner);
        if (meta.fit) this._fit(root, inner, meta.fit, meta.ground ?? false);
        else if (meta.scale) inner.scale.setScalar(meta.scale);
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.cache.set(name, root);
      } catch (e) {
        console.warn(`[assets] failed to load ${name}, falling back to procedural`, e);
      }
      done++;
      onProgress?.(done / Math.max(1, entries.length));
    }
  }

  /**
   * Uniformly scale + centre `inner` so its bbox matches fit=[w,h,l] as closely
   * as possible (scale set by length, the dominant gameplay dimension).
   * ground=true puts the origin at the bbox bottom instead of the centre.
   */
  _fit(root, inner, fit, ground) {
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const [, , targetL] = fit;
    const srcL = Math.max(size.x, size.z) || 1;
    const s = targetL / srcL;
    inner.scale.setScalar(s);
    inner.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(inner);
    const c = box2.getCenter(new THREE.Vector3());
    inner.position.x -= c.x;
    inner.position.z -= c.z;
    inner.position.y -= ground ? box2.min.y : c.y;
  }

  /** Returns a fresh clone of a GLB asset, or null → caller builds procedural mesh. */
  getModel(name) {
    const tpl = this.cache.get(name);
    if (!tpl) return null;
    const clone = tpl.clone(true);
    clone.traverse((o) => {
      if (o.isMesh && o.material) o.material = o.material.clone();
    });
    return clone;
  }

  has(name) { return this.cache.has(name); }
}

// ---- shared canvas-texture helpers used by procedural factories ----

export function canvasTexture(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 4;
  return tex;
}

export function noise2d(ctx, w, h, alpha = 0.06, n = 800) {
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#fff' : '#000';
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}
