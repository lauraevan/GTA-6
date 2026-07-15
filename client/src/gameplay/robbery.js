// Shop hold-ups: aim a gun at a clerk → the till spits cash over ~8 seconds.
// Clerk may trip the silent alarm or pull a pistol. Robbing the bank teller
// is possible too — at a price.

import * as THREE from 'three';
import { KIND } from '../world/cityData.js';

const TICKS = 8;

export class RobberySystem {
  constructor(G) {
    this.G = G;
    this.active = null;   // {zone, clerk, ticks, tickT, alarm, resist, total}
    this.cooldowns = new Map(); // zoneKeyPos -> until
  }

  zoneKey(zone) { return `${zone.center.x | 0},${zone.center.z | 0}`; }

  activeAt(zone) { return this.active && this.active.zone.id === zone.id; }

  _canHoldUp() {
    const { G } = this;
    const p = G.player;
    if (p.vehicle || p.dead) return null;
    const wdef = G.weapons.currentDef;
    if (!wdef || wdef.melee || wdef.thrown) return null;
    if (!p.aiming) return null;

    const zone = G.zones.zoneAt(p.position);
    if (!zone || (zone.kind !== KIND.SHOP && zone.kind !== KIND.GUNSHOP && zone.kind !== KIND.BANK)) return null;
    const clerk = G.peds.clerkFor(zone);
    if (!clerk) return null;
    if ((this.cooldowns.get(this.zoneKey(zone)) ?? 0) > G.wanted.t) return null;

    const d = p.position.distanceTo(clerk.position);
    if (d > 8) return null;
    // roughly facing the clerk
    const to = new THREE.Vector3().subVectors(clerk.position, p.position).setY(0).normalize();
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (to.dot(fwd) < 0.4) return null;
    return { zone, clerk };
  }

  update(dt) {
    const { G } = this;
    const ctx = this._canHoldUp();

    if (!this.active) {
      if (ctx) {
        const isBank = ctx.zone.kind === KIND.BANK;
        this.active = {
          zone: ctx.zone,
          clerk: ctx.clerk,
          ticks: 0,
          tickT: 1.0,
          alarm: false,
          resist: false,
          perTick: isBank ? 60 + Math.random() * 40 : ctx.zone.kind === KIND.GUNSHOP ? 45 : 25 + Math.random() * 25,
          isBank,
        };
        ctx.clerk.handsUp = true;
        G.audio?.play('scream', { pos: ctx.clerk.position, vol: 0.3 });
        G.ui?.toast('HOLD-UP', 'Keep your gun on the clerk!');
        G.events.emit('crime', {
          type: 'robbery', pos: ctx.clerk.position.clone(), severity: 10, witnessRadius: 16 });
      }
      return;
    }

    const a = this.active;

    // clerk died → it's over
    if (a.clerk.dead) {
      this._finish(false);
      return;
    }
    // player broke the hold-up (moved away / stopped aiming)
    if (!ctx || ctx.zone.id !== a.zone.id) {
      a.graceT = (a.graceT ?? 0) + dt;
      if (a.graceT > 1.6) this._finish(false);
      return;
    }
    a.graceT = 0;

    a.tickT -= dt;
    G.ui?.setPrompt(`ROBBERY — ${a.ticks}/${TICKS} · hold your aim`);
    if (a.tickT <= 0 && a.ticks < TICKS) {
      a.tickT = 0.95;
      a.ticks++;
      const amount = Math.round(a.perTick * (0.7 + Math.random() * 0.6));
      G.pickups.spawnCash(a.zone.registerPos ? a.zone.registerPos.clone().setY(0)
        : a.clerk.position.clone(), amount);
      G.audio?.play('register', { pos: a.clerk.position, vol: 0.6 });

      if (!a.alarm && Math.random() < 0.13) {
        a.alarm = true;
        setTimeout(() => {
          if (this.G.state !== 'playing') return;
          G.wanted.reportCrime(a.clerk.position);
          G.ui?.toast('Silent alarm', 'The clerk tipped off the police…');
        }, 2500);
      }
      if (!a.resist && !a.isBank && Math.random() < 0.06) {
        a.resist = true;
        a.clerk.handsUp = false;
        a.clerk.attachGun();
        a.clerk.aimPose = true;
        a.clerk.faceToward(G.player.position.x, G.player.position.z);
        G.ui?.toast('Look out!', 'The clerk pulled a gun!');
        a.resistT = 0.8;
      }
      if (a.ticks >= TICKS) this._finish(true);
    }

    // resisting clerk shoots back
    if (a.resist && a.clerk && !a.clerk.dead) {
      a.resistT -= dt;
      if (a.resistT <= 0) {
        a.resistT = 1.1;
        const from = a.clerk.position.clone().add(new THREE.Vector3(0, 1.3, 0));
        const dir = G.player.position.clone().add(new THREE.Vector3(
          (Math.random() - .5) * 1.2, 1.0, (Math.random() - .5) * 1.2)).sub(from).normalize();
        G.weapons.rayShot(from, dir, { dmg: 8, range: 25, byCop: true, muzzle: from });
        G.audio?.play('gunshot', { pos: from, vol: 0.5 });
      }
    }
  }

  _finish(completed) {
    const { G } = this;
    const a = this.active;
    this.active = null;
    if (!a) return;
    if (a.clerk && !a.clerk.dead && !a.resist) {
      a.clerk.handsUp = false;
    }
    this.cooldowns.set(this.zoneKey(a.zone), G.wanted.t + 300);
    if (completed) {
      G.player.stats.robberies++;
      G.ui?.toast('Robbery complete', 'Grab the cash and GO!');
      const sev = a.isBank ? 0 : 16;
      if (a.isBank) G.wanted.setStars(Math.max(G.wanted.stars, 3), a.clerk.position.clone());
      else G.events.emit('crime', { type: 'robberyDone', pos: a.clerk.position.clone(), severity: sev, witnessRadius: 30 });
      G.events.emit('robberyComplete', { zone: a.zone });
    }
  }
}
