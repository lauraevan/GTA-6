// Garage & dealership screen: buy/sell cars, paint, wheels, performance mods.

import { COLORS } from '../core/config.js';
import { fmtMoney } from '../core/mathx.js';
import { VEHICLES } from '../entities/catalog.js';
import { UPGRADES, PAINT_PRICE, WHEEL_PRICE } from '../gameplay/garage.js';

export class GarageUI {
  constructor(G) {
    this.G = G;
  }

  open() {
    const { G } = this;
    if (G.state !== 'playing') return;
    G.setState('shop');
    this.render();
  }

  close() {
    this.G.menus.close();
    this.G.setState('playing');
  }

  statBar(label, v) {
    return `<div class="stat-row"><div class="lbl">${label}</div>
      <div class="bar"><div style="width:${Math.round(v * 100)}%"></div></div></div>`;
  }

  render() {
    const { G } = this;
    const g = G.garage;
    const sel = g.owned[g.selected];

    const dealerHtml = g.dealerCatalog.map((d) => `
      <button class="menu-btn" data-buy="${d.id}">${d.name}
        <span class="price">${fmtMoney(d.price)}</span>
        <div style="clear:both">${this.statBar('SPEED', d.maxSpeed / 90)}${this.statBar('POWER', d.engine / 9500)}${this.statBar('GRIP', d.slip / 5.5)}</div>
      </button>`).join('');

    const ownedHtml = g.owned.length
      ? g.owned.map((rec, i) => `
        <button class="menu-btn ${i === g.selected ? 'sel' : ''}" data-sel="${i}">
          ${VEHICLES[rec.model].name}
          <span class="note">${'⭐'.repeat(rec.mods.engine)}${rec.mods.nitro ? ' N₂O' : ''}</span>
        </button>`).join('')
      : '<div style="color:var(--text-dim);padding:10px 12px;font-size:14px">No cars yet — buy one from the dealership.</div>';

    let customizeHtml = '<div style="color:var(--text-dim);padding:10px;font-size:14px">Select an owned car.</div>';
    if (sel) {
      const def = VEHICLES[sel.model];
      customizeHtml = `
        <h3>${def.name.toUpperCase()}</h3>
        <div class="swatches">
          ${COLORS.paints.map((c) => `<div class="swatch ${sel.paint === c ? 'sel' : ''}"
            data-paint="${c}" style="background:${c}"></div>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--text-dim);padding:0 10px 6px">Respray ${fmtMoney(PAINT_PRICE)}</div>
        <button class="menu-btn" data-mod="wheels">Wheel style ${sel.mods.wheelStyle + 1}/3
          <span class="price">${fmtMoney(WHEEL_PRICE)}</span></button>
        <button class="menu-btn" data-mod="engine" ${sel.mods.engine >= 3 ? 'disabled' : ''}>
          Engine tune ${sel.mods.engine}/3
          <span class="price">${sel.mods.engine >= 3 ? 'MAX' : fmtMoney(UPGRADES.engine.levels[sel.mods.engine])}</span></button>
        <button class="menu-btn" data-mod="tires" ${sel.mods.tires ? 'disabled' : ''}>
          Sport tyres <span class="price">${sel.mods.tires ? 'OWNED' : fmtMoney(UPGRADES.tires.price)}</span></button>
        <button class="menu-btn" data-mod="brakes" ${sel.mods.brakes ? 'disabled' : ''}>
          Race brakes <span class="price">${sel.mods.brakes ? 'OWNED' : fmtMoney(UPGRADES.brakes.price)}</span></button>
        <button class="menu-btn" data-mod="nitro" ${sel.mods.nitro ? 'disabled' : ''}>
          Nitro kit <span class="price">${sel.mods.nitro ? 'OWNED' : fmtMoney(UPGRADES.nitro.price)}</span></button>
        <button class="menu-btn" data-mod="deliver">Deliver to pad</button>
        <button class="menu-btn" data-mod="sell">Sell
          <span class="price">${fmtMoney(Math.round(def.price * 0.5))}</span></button>`;
    }

    const s = this.G.menus._screen(`
      <div class="menu-panel" style="min-width:min(920px,94vw)">
        <h2>WERKSTATT M. — GARAGE &amp; DEALER</h2>
        <div style="color:var(--text-dim);font-size:13px;margin-bottom:8px">
          Cash: <b style="color:#7fd66a">${fmtMoney(G.player.money)}</b></div>
        <div class="garage-layout">
          <div class="col"><h3>YOUR CARS</h3>${ownedHtml}</div>
          <div class="col"><h3>CUSTOMISE</h3>${customizeHtml}</div>
          <div class="col wide"><h3>DEALERSHIP</h3>${dealerHtml}</div>
        </div>
        <button class="menu-btn" data-a="close" style="margin-top:10px">← Leave garage</button>
      </div>`);

    s.addEventListener('click', (e) => {
      const t = e.target.closest('[data-a],[data-buy],[data-sel],[data-mod],[data-paint]');
      if (!t) return;
      if (t.dataset.a === 'close') return this.close();
      if (t.dataset.buy) {
        if (!G.garage.buy(t.dataset.buy)) G.ui.toast('Dealer', 'Not enough cash.');
        return this.render();
      }
      if (t.dataset.sel !== undefined) {
        G.garage.selected = parseInt(t.dataset.sel, 10);
        return this.render();
      }
      if (t.dataset.paint) {
        if (!G.garage.applyPaint(sel, t.dataset.paint)) G.ui.toast('Garage', 'Not enough cash.');
        return this.render();
      }
      switch (t.dataset.mod) {
        case 'wheels':
          if (!G.garage.applyWheels(sel, (sel.mods.wheelStyle + 1) % 3)) G.ui.toast('Garage', 'Not enough cash.');
          break;
        case 'engine':
          if (!G.garage.upgradeEngine(sel)) G.ui.toast('Garage', 'Not enough cash.');
          break;
        case 'tires': case 'brakes': case 'nitro':
          if (!G.garage.upgradeFlag(sel, t.dataset.mod)) G.ui.toast('Garage', 'Not enough cash.');
          break;
        case 'deliver':
          G.garage.deliverSelected();
          G.ui.toast('Garage', 'Your car is on the pad outside.');
          return this.close();
        case 'sell':
          G.garage.sell(G.garage.selected);
          break;
      }
      this.render();
    });
  }
}
