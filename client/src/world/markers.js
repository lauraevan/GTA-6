// World-space gameplay markers: glowing beacon cylinders with minimap blips
// and enter-radius triggers. Used by missions, races, shops, activities.

import * as THREE from 'three';

let nextMid = 1;

const COLORS = {
  mission: 0xe8b437, race: 0x47b5e8, activity: 0x7fd66a,
  objective: 0xffe9b0, shop: 0x7fd66a, property: 0xc583e8,
};

export class MarkerSystem {
  constructor(G) {
    this.G = G;
    this.markers = new Map();
    this.geo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
  }

  /**
   * add({pos, radius, color|type, label, blip, onEnter, requireVehicle, requireOnFoot, height})
   * returns id
   */
  add(opts) {
    const id = nextMid++;
    const color = opts.color ?? COLORS[opts.type ?? 'mission'] ?? 0xe8b437;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(this.geo, mat);
    const r = opts.radius ?? 2.2;
    mesh.scale.set(r, opts.height ?? 1.6, r);
    mesh.position.set(opts.pos.x, (opts.height ?? 1.6) / 2 + 0.05, opts.pos.z);
    this.G.scene.add(mesh);
    const m = { id, ...opts, radius: r, mesh, mat, inside: false, t: Math.random() * 6 };
    this.markers.set(id, m);
    return id;
  }

  remove(id) {
    const m = this.markers.get(id);
    if (!m) return;
    this.G.scene.remove(m.mesh);
    m.mat.dispose();
    this.markers.delete(id);
  }

  clearByTag(tag) {
    for (const m of [...this.markers.values()]) {
      if (m.tag === tag) this.remove(m.id);
    }
  }

  update(dt) {
    const p = this.G.player;
    if (!p) return;
    const pos = p.position;
    for (const m of this.markers.values()) {
      m.t += dt;
      m.mat.opacity = 0.3 + Math.sin(m.t * 3) * 0.12;
      m.mesh.rotation.y += dt * 0.6;
      if (!m.onEnter) continue;
      if (m.requireVehicle && !p.vehicle) continue;
      if (m.requireOnFoot && p.vehicle) continue;
      const dx = pos.x - m.pos.x, dz = pos.z - m.pos.z;
      const inside = dx * dx + dz * dz < m.radius * m.radius;
      if (inside && !m.inside) {
        m.inside = true;
        try { m.onEnter(m); } catch (e) { console.error('[marker]', e); }
      } else if (!inside) m.inside = false;
    }
  }
}
