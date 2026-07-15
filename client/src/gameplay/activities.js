// Side activities: street races (AI opponents + leaderboard), stunt jumps
// (slow-mo air), delivery gigs, and the docks vehicle theft list.

import * as THREE from 'three';
import { VehicleDriver } from '../ai/vehicleDriver.js';
import { fmtMoney, fmtTime } from '../core/mathx.js';

const RACER_MODELS = ['falke', 'thunder', 'kurier'];
const THEFT_LIST = [
  { model: 'stadt', pay: 350 }, { model: 'taxi', pay: 450 },
  { model: 'steinbock', pay: 750 }, { model: 'thunder', pay: 950 },
];

export class Activities {
  constructor(G) {
    this.G = G;
    this.race = null;          // active race state
    this.delivery = null;
    this.stuntsDone = new Set();
    this.theftDone = new Set();
    this.bestTimes = {};
    this._stuntAir = null;
  }

  init() {
    const { G } = this;
    const pois = G.city.pois;

    // race start markers
    for (const race of pois.races) {
      const [x, z] = race.checkpoints[0];
      G.markers.add({
        pos: { x, z }, radius: 5, type: 'race', tag: 'race', height: 2.4,
        requireVehicle: true,
        onEnter: () => this.offerRace(race),
      });
    }
    // delivery depot
    G.markers.add({
      pos: { x: pois.deliveryDepot.pos[0], z: pois.deliveryDepot.pos[1] },
      radius: 4, type: 'activity', tag: 'delivery', requireVehicle: true,
      onEnter: () => this.offerDelivery(),
    });
    // theft drop pad
    G.markers.add({
      pos: { x: pois.theftDrop.pos[0], z: pois.theftDrop.pos[1] },
      radius: 5.5, type: 'property', tag: 'theft',
      onEnter: () => this.checkTheftDrop(),
    });
  }

  // =================== RACES ===================

  offerRace(race) {
    const { G } = this;
    if (this.race || G.missions?.active) return;
    if ((this.bestTimes[race.id] ?? null) !== null) {
      G.ui.toast(race.name, `Best: ${fmtTime(this.bestTimes[race.id])} — E to race again (${fmtMoney(race.entry)})`);
    } else {
      G.ui.toast(race.name, `${race.laps} lap(s) · entry ${fmtMoney(race.entry)} · prize ${fmtMoney(race.prize)} — press E`);
    }
    this._offeredRace = { race, until: G.wanted.t + 6 };
  }

  startRace(race, { free = false } = {}) {
    const { G } = this;
    if (!free && !G.player.spendMoney(race.entry)) {
      G.ui.toast('Race', 'Not enough cash for the entry fee.');
      return false;
    }
    const pts = race.checkpoints;
    const loopPts = [];
    for (let l = 0; l < race.laps; l++) loopPts.push(...pts);
    loopPts.push(pts[0]); // finish line back at start

    // spawn AI racers around the start
    const [sx, sz] = pts[0];
    const racers = [];
    for (let i = 0; i < 3; i++) {
      const v = G.vehicles.spawn(RACER_MODELS[i % RACER_MODELS.length],
        new THREE.Vector3(sx + (i - 1) * 3.2, 0, sz - 6 - i * 2), 0, { mode: 'parked' });
      v.driver = 'racer';
      v.setMode('driven');
      const driver = new VehicleDriver(G, v);
      driver.followPath(loopPts.map((p) => [p[0], p[1]]), { speedMul: 0.8 + i * 0.04 });
      racers.push({ v, driver });
    }

    this.race = {
      def: race, cp: 1, lap: 0, startT: performance.now(), racers,
      countdown: 3, started: false, marker: null,
    };
    this._placeCpMarker();
    G.ui.banner('3…', '', 0.8);
    G.audio?.play('click');
    G.events.emit('raceStarted', { race });
    return true;
  }

  _placeCpMarker() {
    const { G } = this;
    const r = this.race;
    if (r.marker) G.markers.remove(r.marker);
    const idx = r.cp % r.def.checkpoints.length;
    const [x, z] = r.def.checkpoints[idx];
    r.marker = G.markers.add({ pos: { x, z }, radius: 7, type: 'objective', height: 10, tag: 'raceCp' });
    G.gps?.setTarget(x, z);
  }

  _endRace(place) {
    const { G } = this;
    const r = this.race;
    if (r.marker) G.markers.remove(r.marker);
    for (const rc of r.racers) {
      rc.driver.stop();
      rc.v.driver = null;
    }
    const ms = performance.now() - r.startT;
    this.race = null;
    G.gps?.clear();

    if (place > 0) {
      const prize = place === 1 ? r.def.prize : place === 2 ? Math.round(r.def.prize * 0.3) : Math.round(r.def.prize * 0.1);
      if (place === 1) G.player.stats.racesWon++;
      G.player.giveMoney(prize);
      G.ui.banner(place === 1 ? 'WINNER' : `${place}${place === 2 ? 'ND' : 'RD'} PLACE`,
        `${fmtTime(ms)} · ${fmtMoney(prize)}`);
      if (!this.bestTimes[r.def.id] || ms < this.bestTimes[r.def.id]) this.bestTimes[r.def.id] = ms;
      G.save?.postLeaderboard(r.def.id, Math.round(ms));
      G.events.emit('raceFinished', { race: r.def, timeMs: ms, place });
    } else {
      G.ui.banner('RACE ABANDONED', '', 2);
    }
    G.save?.save('race');
  }

  _updateRace(dt) {
    const { G } = this;
    const r = this.race;
    const p = G.player;

    if (r.countdown > 0) {
      const prev = Math.ceil(r.countdown);
      r.countdown -= dt;
      const now = Math.ceil(r.countdown);
      if (now !== prev && now > 0) G.ui.banner(`${now}…`, '', 0.8);
      if (r.countdown <= 0) {
        G.ui.banner('GO!', '', 0.9);
        r.startT = performance.now();
        G.audio?.play('checkpoint');
      }
      return;
    }

    if (!p.vehicle) {
      r.abandonT = (r.abandonT ?? 0) + dt;
      if (r.abandonT > 12) return this._endRace(0);
    } else r.abandonT = 0;

    // racer rubber-banding
    for (const rc of r.racers) {
      rc.driver.update(dt);
      const d = rc.v.position.distanceTo(p.position);
      const behind = rc.driver.pathIdx * 60 < (r.lap * r.def.checkpoints.length + r.cp) * 60 - 40;
      rc.driver.speedMul = behind || d > 120 ? 0.95 : 0.72;
    }

    // checkpoint pass
    const total = r.def.checkpoints.length;
    const idx = r.cp % total;
    const [cx, cz] = r.def.checkpoints[idx];
    if (Math.hypot(p.position.x - cx, p.position.z - cz) < 8) {
      r.cp++;
      G.audio?.play('checkpoint');
      if (r.cp >= total * r.def.laps + 1) {
        // compute place from racers' progress
        let place = 1;
        for (const rc of r.racers) {
          if (rc.driver.pathIdx >= r.cp) place++;
        }
        return this._endRace(place);
      }
      this._placeCpMarker();
    }

    G.ui.setRaceInfo({
      cp: r.cp, total: total * r.def.laps,
      time: performance.now() - r.startT,
      lap: Math.floor((r.cp - 1) / total) + 1, laps: r.def.laps,
    });
  }

  // =================== STUNTS ===================

  _updateStunts(dt) {
    const { G } = this;
    const p = G.player;
    const v = p.vehicle;

    if (this._stuntAir) {
      const s = this._stuntAir;
      s.t += dt;
      const grounded = !v || v.mode !== 'driven' || v.vp?.vehicle.wheelInfos.some((w) => w.isInContact);
      if (!v || v.dead) { this._stuntAir = null; G.setTimeScale(1); return; }
      if (grounded && s.t > 0.25) {
        G.setTimeScale(1);
        const dist = v.position.distanceTo(s.from);
        const upright = new THREE.Vector3(0, 1, 0).applyQuaternion(v.mesh.quaternion).y > 0.55;
        if (s.t > 0.75 && dist > 10 && upright && !this.stuntsDone.has(s.id)) {
          this.stuntsDone.add(s.id);
          p.stats.stunts++;
          p.giveMoney(s.reward);
          G.ui.banner('INSANE STUNT', `${dist.toFixed(0)} m · ${fmtMoney(s.reward)}`);
          G.audio?.play('checkpoint');
          G.save?.save('stunt');
        }
        this._stuntAir = null;
      }
      return;
    }

    if (!v || v.speed < 16) return;
    for (let i = 0; i < G.city.pois.stunts.length; i++) {
      const [x, z, , reward] = G.city.pois.stunts[i];
      if (Math.hypot(v.position.x - x, v.position.z - z) < 7) {
        this._stuntAir = { id: i, t: 0, from: v.position.clone(), reward };
        G.setTimeScale(0.45);
        G.cameraRig.shake(0.1);
        break;
      }
    }
  }

  // =================== DELIVERY ===================

  offerDelivery() {
    const { G } = this;
    if (this.delivery || this.race || G.missions?.active) return;
    G.ui.toast('Hafen Depot', 'Press E to start a delivery run (4 drops, 110 s)');
    this._offeredDelivery = G.wanted.t + 6;
  }

  startDelivery() {
    const { G } = this;
    const shops = G.city.pois.shops.slice();
    // pick 4 spread-out drops
    const drops = [];
    while (drops.length < 4 && shops.length) {
      const i = (Math.random() * shops.length) | 0;
      drops.push(shops.splice(i, 1)[0]);
    }
    this.delivery = { drops, idx: 0, timer: 110, marker: null };
    this._placeDeliveryMarker();
    G.ui.banner('DELIVERY RUN', '4 packages — beat the clock');
  }

  _placeDeliveryMarker() {
    const { G } = this;
    const d = this.delivery;
    if (d.marker) G.markers.remove(d.marker);
    const drop = d.drops[d.idx];
    d.marker = G.markers.add({
      pos: { x: drop.door[0], z: drop.door[1] }, radius: 4.5, type: 'activity', height: 6, tag: 'drop' });
    G.gps?.setTarget(drop.door[0], drop.door[1]);
  }

  _updateDelivery(dt) {
    const { G } = this;
    const d = this.delivery;
    d.timer -= dt;
    G.ui.setRaceInfo({ custom: `DROP ${d.idx + 1}/4 · ${Math.max(0, d.timer).toFixed(0)}s` });
    if (d.timer <= 0) {
      G.markers.remove(d.marker);
      G.gps?.clear();
      this.delivery = null;
      G.ui.banner('DELIVERY FAILED', 'Too slow', 2.2);
      return;
    }
    const drop = d.drops[d.idx];
    if (Math.hypot(G.player.position.x - drop.door[0], G.player.position.z - drop.door[1]) < 5) {
      G.player.giveMoney(120);
      G.audio?.play('cash');
      d.idx++;
      if (d.idx >= d.drops.length) {
        G.markers.remove(d.marker);
        G.gps?.clear();
        const bonus = Math.round(d.timer * 6);
        G.player.giveMoney(bonus);
        G.ui.banner('ALL DELIVERED', `time bonus ${fmtMoney(bonus)}`);
        this.delivery = null;
        G.save?.save('delivery');
      } else this._placeDeliveryMarker();
    }
  }

  // =================== THEFT LIST ===================

  checkTheftDrop() {
    const { G } = this;
    const v = G.player.vehicle;
    if (!v) {
      const remaining = THEFT_LIST.filter((t) => !this.theftDone.has(t.model));
      if (!remaining.length) return G.ui.toast('Docks fence', 'List complete. Check back another time.');
      G.ui.toast('Docks fence — wanted list',
        remaining.map((t) => `${t.model.toUpperCase()} (${fmtMoney(t.pay)})`).join(' · '));
      return;
    }
    const entry = THEFT_LIST.find((t) => t.model === v.model && !this.theftDone.has(t.model));
    if (!entry) {
      G.ui.toast('Docks fence', 'Not on the list. Bring something from the board.');
      return;
    }
    if (v.owned) {
      G.ui.toast('Docks fence', "That one's yours — bring a *hot* one.");
      return;
    }
    this.theftDone.add(entry.model);
    G.player.exitVehicle(true);
    G.vehicles.remove(v);
    G.player.giveMoney(entry.pay);
    G.audio?.play('cash');
    if (this.theftDone.size >= THEFT_LIST.length) {
      G.player.giveMoney(1500);
      G.ui.banner('LIST CLEARED', `bonus ${fmtMoney(1500)}`);
    } else {
      G.ui.toast('Docks fence', `Nice wheels. ${fmtMoney(entry.pay)}.`);
    }
    G.save?.save('theft');
  }

  // =================== update ===================

  update(dt) {
    const { G } = this;
    if (G.state !== 'playing') return;

    // offered prompts (E to accept)
    if (this._offeredRace && G.wanted.t < this._offeredRace.until) {
      if (G.input.pressed('KeyE')) {
        const { race } = this._offeredRace;
        this._offeredRace = null;
        this.startRace(race);
      }
    }
    if (this._offeredDelivery && G.wanted.t < this._offeredDelivery) {
      if (G.input.pressed('KeyE')) {
        this._offeredDelivery = null;
        this.startDelivery();
      }
    }

    if (this.race) this._updateRace(dt);
    else if (this.delivery) this._updateDelivery(dt);
    else G.ui.setRaceInfo(null);

    this._updateStunts(dt);
  }

  toSave() {
    return {
      stunts: [...this.stuntsDone],
      theft: [...this.theftDone],
      best: this.bestTimes,
    };
  }
  fromSave(s) {
    if (!s) return;
    this.stuntsDone = new Set(s.stunts ?? []);
    this.theftDone = new Set(s.theft ?? []);
    this.bestTimes = s.best ?? {};
  }
}
