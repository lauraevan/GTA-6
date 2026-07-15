// Mission scripting engine: giver markers, sequential objective steps, GPS
// routing, cutscene-lite sequences (letterbox + subtitles + camera dolly),
// fail watchers (wasted/busted/vehicle destroyed), rewards + save.

import * as THREE from 'three';
import { fmtMoney } from '../core/mathx.js';

export class MissionDirector {
  constructor(G) {
    this.G = G;
    this.missions = [];        // defs registered by storyMissions
    this.completed = new Set();
    this.active = null;        // {def, stepIdx, state, tagged:{}, cine:null}
    this.giverMarkers = [];

    G.events.on('playerWasted', () => this.fail('You got wasted.'));
    G.events.on('playerBusted', () => this.fail('You got busted.'));
    G.events.on('robberyComplete', ({ zone }) => {
      if (this.active) this._flag('robbery', zone);
    });
    G.events.on('raceFinished', ({ race, place }) => {
      if (this.active) this._flag('race', { race, place });
    });
  }

  register(defs) { this.missions.push(...defs); }

  /** available = prereqs done, not completed, not active */
  refreshGivers() {
    const { G } = this;
    for (const id of this.giverMarkers) G.markers.remove(id);
    this.giverMarkers = [];
    if (this.active) return;
    for (const m of this.missions) {
      if (this.completed.has(m.id)) continue;
      if (m.prereq && !this.completed.has(m.prereq)) continue;
      if (!m.giver) continue;
      const id = G.markers.add({
        pos: { x: m.giver[0], z: m.giver[1] }, radius: 2.6, type: 'mission', height: 2.2,
        requireOnFoot: true, tag: 'giver',
        onEnter: () => this.start(m.id),
      });
      this.giverMarkers.push(id);
    }
  }

  start(id) {
    if (this.active) return;
    const def = this.missions.find((m) => m.id === id);
    if (!def) return;
    this.active = { def, stepIdx: -1, tagged: {}, flags: {}, timer: 0 };
    this.refreshGivers();
    this.G.ui.banner(def.title.toUpperCase(), def.subtitle ?? '', 2.4);
    this.G.events.emit('missionStart', { mission: def });
    this.G.music?.setMood('mission');
    this._advance();
  }

  _flag(kind, data) {
    if (!this.active) return;
    this.active.flags[kind] = data;
  }

  _advance() {
    const a = this.active;
    if (!a) return;
    a.stepIdx++;
    a.timer = 0;
    a.flags = {};
    if (a.marker) { this.G.markers.remove(a.marker); a.marker = null; }
    if (a.stepIdx >= a.def.steps.length) return this.complete();
    const step = a.def.steps[a.stepIdx];
    a.step = step;

    // one-time setup per step type
    if (step.type === 'cine') {
      this._startCine(step);
    }
    if (step.spawnVehicle) {
      const s = step.spawnVehicle;
      const v = this.G.vehicles.spawn(s.model, new THREE.Vector3(s.pos[0], 0, s.pos[1]), s.ry ?? 0, {
        mode: 'parked', locked: s.locked ?? false, paint: s.paint,
      });
      v._missionTag = s.tag;
      a.tagged[s.tag] = v;
    }
    if (step.pos) {
      a.marker = this.G.markers.add({
        pos: { x: step.pos[0], z: step.pos[1] }, radius: step.r ?? 3.5,
        type: 'objective', height: step.beam ?? 4,
      });
      this.G.gps?.setTarget(step.pos[0], step.pos[1]);
    } else {
      this.G.gps?.clear();
    }
    if (step.setStars !== undefined) this.G.wanted.setStars(step.setStars, this.G.player.position.clone());
    if (step.giveWeapon) this.G.weapons.give(step.giveWeapon.id, step.giveWeapon.ammo ?? 0);
    if (step.setHour !== undefined) this.G.daynight.setHour(step.setHour);
    if (step.type === 'collectCash') {
      a.cashItems = [];
      const total = step.amount;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const item = this.G.pickups.spawn('cash', Math.round(total / n),
          new THREE.Vector3(step.pos[0] + Math.cos(ang) * 1.6, 0, step.pos[1] + Math.sin(ang) * 1.6));
        item.life = Infinity;
        a.cashItems.push(item);
      }
    }
    if (step.type === 'vaultCrack') {
      a.crack = { round: 0, cursor: 0, dir: 1, speed: 0.9, windowLo: 0.42, windowHi: 0.58, cooldown: 0 };
    }

    this.G.ui.setObjective(step.text ?? '');
  }

  // ---------- cutscenes ----------
  _startCine(step) {
    const { G } = this;
    const a = this.active;
    const p = G.player.position.clone();
    const from = p.clone().add(new THREE.Vector3(6, 3.2, 8));
    const to = p.clone().add(new THREE.Vector3(-5, 2.2, 7));
    G.cameraRig.playCine(from, to,
      p.clone().add(new THREE.Vector3(0, 1.5, 0)), p.clone().add(new THREE.Vector3(0, 1.4, 0)),
      Math.max(3, step.lines.length * 2.6));
    a.cine = { lines: step.lines, idx: 0, t: 0 };
    G.ui.letterbox(true);
    G.ui.subtitle(step.lines[0]);
    G.input.setLockWanted(false);
  }

  _updateCine(dt) {
    const { G } = this;
    const a = this.active;
    const c = a.cine;
    c.t += dt;
    const advance = c.t > 2.6 || G.input.pressed('Enter') || G.input.pressed('Space');
    if (advance) {
      c.t = 0;
      c.idx++;
      if (c.idx >= c.lines.length) {
        a.cine = null;
        G.ui.letterbox(false);
        G.ui.subtitle(null);
        G.cameraRig.stopCine();
        G.cameraRig.setMode(G.player.vehicle ? 'car' : 'foot');
        if (G.state === 'playing') G.input.setLockWanted(true);
        this._advance();
      } else {
        G.ui.subtitle(c.lines[c.idx]);
      }
    }
  }

  // ---------- vault minigame ----------
  _updateVault(dt, step) {
    const { G } = this;
    const a = this.active;
    const cr = a.crack;
    const p = G.player.position;
    if (Math.hypot(p.x - step.pos[0], p.z - step.pos[1]) > 4) {
      G.ui.setMinigame(null);
      return; // must stand at the vault
    }
    cr.cooldown -= dt;
    cr.cursor += cr.dir * cr.speed * dt;
    if (cr.cursor > 1) { cr.cursor = 1; cr.dir = -1; }
    if (cr.cursor < 0) { cr.cursor = 0; cr.dir = 1; }
    G.ui.setMinigame({
      label: `VAULT LOCK ${cr.round + 1}/3 — press E in the zone`,
      cursor: cr.cursor, lo: cr.windowLo, hi: cr.windowHi,
    });
    if (G.input.pressed('KeyE') && cr.cooldown <= 0) {
      cr.cooldown = 0.3;
      if (cr.cursor >= cr.windowLo && cr.cursor <= cr.windowHi) {
        cr.round++;
        G.audio?.play('checkpoint', { vol: 0.6 });
        cr.speed += 0.5;
        const w = (cr.windowHi - cr.windowLo) * 0.62;
        const mid = 0.25 + Math.random() * 0.5;
        cr.windowLo = mid - w / 2; cr.windowHi = mid + w / 2;
        if (cr.round >= 3) {
          G.ui.setMinigame(null);
          G.audio?.play('vaultOpen');
          this._advance();
        }
      } else {
        G.audio?.play('click', { vol: 0.6 });
        if (!cr.failedOnce) {
          cr.failedOnce = true;
          G.ui.toast('Careful!', 'One more slip and the alarm trips.');
        } else {
          G.wanted.setStars(Math.max(G.wanted.stars, 3), p.clone());
          G.ui.toast('ALARM', 'The vault sensor tripped!');
          cr.failedOnce = false;
        }
      }
    }
  }

  // ---------- fail / complete ----------
  fail(reason) {
    if (!this.active) return;
    const def = this.active.def;
    if (this.active.marker) this.G.markers.remove(this.active.marker);
    this.G.ui.setMinigame(null);
    this.G.ui.letterbox(false);
    this.G.ui.subtitle(null);
    this.G.ui.setObjective('');
    this.G.gps?.clear();
    this.active = null;
    this.G.ui.banner('MISSION FAILED', reason, 2.6, true);
    this.G.events.emit('missionFailed', { mission: def });
    this.G.music?.setMood(null);
    setTimeout(() => this.refreshGivers(), 1200);
  }

  complete() {
    const a = this.active;
    const def = a.def;
    if (a.marker) this.G.markers.remove(a.marker);
    this.completed.add(def.id);
    this.active = null;
    this.G.player.stats.missions++;
    this.G.player.giveMoney(def.reward);
    this.G.ui.setObjective('');
    this.G.gps?.clear();
    this.G.ui.banner('MISSION PASSED', `${def.title} · ${fmtMoney(def.reward)}`);
    this.G.audio?.play('missionPassed');
    this.G.events.emit('missionComplete', { mission: def });
    this.G.music?.setMood(null);
    this.G.save?.save('mission');
    setTimeout(() => this.refreshGivers(), 1500);
  }

  // ---------- update ----------
  update(dt) {
    const a = this.active;
    if (!a || this.G.state !== 'playing') return;
    if (a.cine) return this._updateCine(dt);
    const step = a.step;
    if (!step) return;
    a.timer += dt;
    const p = this.G.player;

    // generic fail: tagged vehicle destroyed
    for (const [tag, v] of Object.entries(a.tagged)) {
      if (v.dead && step.needsVehicle !== false) {
        return this.fail('The vehicle was destroyed.');
      }
    }
    if (step.failTimer && a.timer > step.failTimer) return this.fail('Out of time.');

    switch (step.type) {
      case 'goto': {
        const inVeh = step.requireVehicleTag ? p.vehicle === a.tagged[step.requireVehicleTag] : true;
        if (inVeh && Math.hypot(p.position.x - step.pos[0], p.position.z - step.pos[1]) < (step.r ?? 3.5)) {
          this._advance();
        }
        break;
      }
      case 'enterVehicle': {
        const v = a.tagged[step.tag];
        if (v && p.vehicle === v) this._advance();
        break;
      }
      case 'robShop': {
        if (a.flags.robbery) this._advance();
        break;
      }
      case 'loseWanted': {
        if (this.G.wanted.stars === 0) this._advance();
        else this.G.ui.setObjective(step.text ?? 'Lose the police!');
        break;
      }
      case 'race': {
        // launch the race if not running yet
        if (!this.G.activities.race && !a.flags.race && !a._raceLaunched) {
          a._raceLaunched = true;
          const race = this.G.city.pois.races.find((r) => r.id === step.raceId);
          this.G.activities.startRace(race, { free: true });
        }
        if (a.flags.race) {
          if (a.flags.race.place === 1) this._advance();
          else this.fail('You needed to win that race.');
        }
        break;
      }
      case 'survive': {
        if (a.timer > step.seconds) this._advance();
        break;
      }
      case 'collectCash': {
        a.cashItems = a.cashItems.filter((it) => this.G.pickups.items.includes(it));
        this.G.ui.setObjective(`${step.text} (${a.cashItems.length} left)`);
        if (!a.cashItems.length) this._advance();
        break;
      }
      case 'vaultCrack':
        this._updateVault(dt, step);
        break;
      case 'wait':
        if (a.timer > (step.seconds ?? 1)) this._advance();
        break;
    }
  }

  toSave() { return { completed: [...this.completed] }; }
  fromSave(s) {
    if (!s) return;
    this.completed = new Set(s.completed ?? []);
  }
}
