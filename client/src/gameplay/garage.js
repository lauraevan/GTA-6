// Garage & dealership logic: owned vehicles, purchases, paint/wheels/perf mods.
// UI lives in ui/garageUI.js.

import * as THREE from 'three';
import { VEHICLES } from '../entities/catalog.js';

export const UPGRADES = {
  engine: { name: 'Engine tune', levels: [2500, 5500, 9000] },
  tires: { name: 'Sport tyres', price: 1800 },
  brakes: { name: 'Race brakes', price: 1200 },
  nitro: { name: 'Nitro kit', price: 3000 },
};
export const PAINT_PRICE = 150;
export const WHEEL_PRICE = 500;

export class Garage {
  constructor(G) {
    this.G = G;
    this.owned = [];       // [{model, paint, mods}]
    this.selected = -1;
  }

  get dealerCatalog() {
    return Object.entries(VEHICLES)
      .filter(([, d]) => !d.noSale)
      .map(([id, d]) => ({ id, ...d }));
  }

  padPosition() {
    const { G } = this;
    const zone = G.zones.byKind ? G.zones.byKind(6)[0] : null; // KIND.GARAGE = 6
    if (zone?.padPos) return { x: zone.padPos.x, z: zone.padPos.z, ry: 0 };
    const poi = G.city.pois.garage;
    return { x: poi.door[0], z: poi.door[1] + 7, ry: 0 };
  }

  buy(modelId) {
    const def = VEHICLES[modelId];
    if (!def || !this.G.player.spendMoney(def.price)) return false;
    this.owned.push({ model: modelId, paint: def.paint, mods: { engine: 0, tires: false, brakes: false, nitro: false, wheelStyle: 0 } });
    this.selected = this.owned.length - 1;
    this.deliverSelected();
    this.G.audio?.play('cash');
    this.G.ui?.toast('Purchased', def.name);
    this.G.save?.save('vehicle-bought');
    return true;
  }

  sell(idx) {
    const rec = this.owned[idx];
    if (!rec) return;
    const price = Math.round(VEHICLES[rec.model].price * 0.5);
    this.G.player.giveMoney(price);
    this.owned.splice(idx, 1);
    if (this.selected >= this.owned.length) this.selected = this.owned.length - 1;
    this.G.ui?.toast('Sold', `+$${price}`);
  }

  deliverSelected() {
    const rec = this.owned[this.selected];
    if (!rec) return;
    const pad = this.padPosition();
    const v = this.G.vehicles.spawnOwned(rec, pad);
    v._garageRecord = rec;
    return v;
  }

  /** live vehicle carrying this record (if spawned) */
  liveVehicle(rec) {
    for (const v of this.G.vehicles.vehicles) {
      if (v._garageRecord === rec) return v;
    }
    return null;
  }

  applyPaint(rec, color) {
    if (!this.G.player.spendMoney(PAINT_PRICE)) return false;
    rec.paint = color;
    const v = this.liveVehicle(rec);
    if (v) v.bodyMat.color.set(color);
    return true;
  }

  applyWheels(rec, style) {
    if (!this.G.player.spendMoney(WHEEL_PRICE)) return false;
    rec.mods.wheelStyle = style;
    const v = this.liveVehicle(rec);
    if (v) { this.G.vehicles.remove(v); this.deliverSelected(); }
    return true;
  }

  upgradeEngine(rec) {
    const lvl = rec.mods.engine;
    if (lvl >= 3) return false;
    const price = UPGRADES.engine.levels[lvl];
    if (!this.G.player.spendMoney(price)) return false;
    rec.mods.engine = lvl + 1;
    const v = this.liveVehicle(rec);
    if (v) v.mods.engine = rec.mods.engine;
    return true;
  }

  upgradeFlag(rec, key) {
    if (rec.mods[key]) return false;
    if (!this.G.player.spendMoney(UPGRADES[key].price)) return false;
    rec.mods[key] = true;
    const v = this.liveVehicle(rec);
    if (v) v.mods[key] = true;
    return true;
  }

  toSave() { return { owned: this.owned, selected: this.selected }; }
  fromSave(s) {
    if (!s) return;
    this.owned = s.owned ?? [];
    this.selected = s.selected ?? (this.owned.length ? 0 : -1);
  }
}
