// Floating pickups: cash, health, armor, ammo, weapons — plus fixed respawning
// spawners at the hospital / police station / park.

import * as THREE from 'three';
import { fmtMoney } from '../core/mathx.js';

const STYLES = {
  cash:   { color: 0x5fd66a, emissive: 0x2a8a35, size: [0.4, 0.24, 0.3] },
  health: { color: 0xe8e8e8, emissive: 0xd04040, size: [0.34, 0.34, 0.34] },
  armor:  { color: 0x4788e8, emissive: 0x1a3a8a, size: [0.4, 0.34, 0.24] },
  ammo:   { color: 0x8a8f98, emissive: 0x40454e, size: [0.36, 0.22, 0.26] },
  weapon: { color: 0x22252c, emissive: 0xe8b437, size: [0.55, 0.18, 0.18] },
};

export class Pickups {
  constructor(G) {
    this.G = G;
    this.items = [];
    this.spawners = [];
  }

  initFixedSpawners() {
    const { G } = this;
    const pois = G.city.pois;
    this.addSpawner('health', 25, new THREE.Vector3(pois.hospital.door[0] + 3, 0, pois.hospital.door[1] + 3), 45);
    this.addSpawner('armor', 50, new THREE.Vector3(pois.police[0].door[0] - 4, 0, pois.police[0].door[1] + 4), 120);
    // a bat stashed in the central park
    this.spawn('weapon', { weapon: 'bat' }, new THREE.Vector3(-30, 0, 30));
    // the smugglers' cove stash (hidden island chamber — no map marker)
    if (pois.cove) {
      const [cx, cz] = pois.cove.pos;
      this.spawn('cash', 400, new THREE.Vector3(cx - 1.2, 0, cz - 1.5));
      this.spawn('cash', 400, new THREE.Vector3(cx + 1.2, 0, cz - 1.8));
      this.spawn('cash', 400, new THREE.Vector3(cx, 0, cz - 3.2));
      this.spawn('weapon', { weapon: 'rifle', ammo: 60 }, new THREE.Vector3(cx, 0, cz - 2.4));
      this.spawn('armor', 100, new THREE.Vector3(cx, 0, cz - 0.5));
    }
  }

  addSpawner(type, value, pos, interval) {
    const s = { type, value, pos, interval, t: 0, item: null };
    s.item = this.spawn(type, value, pos.clone());
    this.spawners.push(s);
  }

  spawn(type, value, pos) {
    const st = STYLES[type];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...st.size),
      new THREE.MeshStandardMaterial({
        color: st.color, emissive: st.emissive, emissiveIntensity: 0.7, roughness: 0.4 }));
    const baseY = (this.G.terrain?.heightAt(pos.x, pos.z) ?? 0) + 0.7;
    mesh.position.copy(pos).setY(baseY);
    this.G.scene.add(mesh);
    const item = { type, value, mesh, baseY, t: Math.random() * 6, life: type === 'cash' ? 40 : Infinity };
    this.items.push(item);
    return item;
  }

  spawnCash(pos, amount) {
    return this.spawn('cash', amount, pos.clone().add(
      new THREE.Vector3((Math.random() - .5) * 1.2, 0, (Math.random() - .5) * 1.2)));
  }
  spawnAmmo(pos, weapon, amount) { return this.spawn('ammo', { weapon, amount }, pos); }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i < 0) return;
    this.items.splice(i, 1);
    this.G.scene.remove(item.mesh);
    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
  }

  update(dt) {
    const { G } = this;
    const p = G.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      it.life -= dt;
      it.mesh.rotation.y += dt * 2.2;
      it.mesh.position.y = (it.baseY ?? 0.7) + Math.sin(it.t * 2.4) * 0.12;
      if (it.life <= 0) { this.remove(it); continue; }
      if (!p || p.dead) continue;
      const d = it.mesh.position.distanceTo(p.position.clone().setY(it.mesh.position.y));
      if (d < 1.25) this.collect(it);
    }
    for (const s of this.spawners) {
      if (s.item && !this.items.includes(s.item)) s.item = null;
      if (!s.item) {
        s.t += dt;
        if (s.t >= s.interval) { s.t = 0; s.item = this.spawn(s.type, s.value, s.pos.clone()); }
      }
    }
  }

  collect(it) {
    const { G } = this;
    const p = G.player;
    switch (it.type) {
      case 'cash':
        p.giveMoney(it.value);
        G.audio?.play('cash', { vol: 0.5 });
        break;
      case 'health':
        if (p.health >= 100) return;
        p.heal(it.value);
        G.audio?.play('pickup', { vol: 0.5 });
        break;
      case 'armor':
        if (p.armor >= 100) return;
        p.armor = Math.min(100, p.armor + it.value);
        G.audio?.play('pickup', { vol: 0.5 });
        break;
      case 'ammo':
        G.weapons.giveAmmo(it.value.weapon, it.value.amount);
        G.audio?.play('pickup', { vol: 0.5 });
        G.ui?.toast('Ammo', `+${it.value.amount} ${it.value.weapon}`);
        break;
      case 'weapon':
        G.weapons.give(it.value.weapon, it.value.ammo ?? 0);
        G.audio?.play('pickup', { vol: 0.6 });
        break;
    }
    this.remove(it);
  }
}
