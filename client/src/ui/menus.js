// Menu screens: main menu, pause, settings, controls, credits, gun shop.
// The garage screen lives in garageUI.js.

import { CFG, saveSettings } from '../core/config.js';
import { fmtMoney } from '../core/mathx.js';
import { WEAPONS } from '../entities/catalog.js';

const CONTROLS = [
  ['W A S D', 'Move / steer'], ['Shift', 'Sprint / nitro'], ['Space', 'Jump / handbrake'],
  ['Mouse', 'Camera / aim'], ['RMB', 'Aim weapon'], ['LMB', 'Fire / melee'],
  ['R', 'Reload'], ['Tab (hold)', 'Weapon wheel'], ['Scroll', 'Cycle weapons'],
  ['F', 'Enter / exit / carjack'], ['E', 'Interact / rob / accept'],
  ['H', 'Horn'], ['N', 'Radio station'], ['M', 'City map'], ['F5', 'Quick save'],
  ['Esc / P', 'Pause'],
];

export class Menus {
  constructor(G) {
    this.G = G;
    this.root = document.getElementById('menu-root');
    this.fade = document.createElement('div');
    this.fade.id = 'fade';
    document.body.appendChild(this.fade);
    this.current = null;
  }

  fadeTo(on) { this.fade.classList.toggle('on', on); }

  close() {
    this.root.innerHTML = '';
    this.current = null;
  }

  _screen(inner, { transparent = false } = {}) {
    this.root.innerHTML = `<div class="screen${transparent ? ' transparent' : ''}">${inner}</div>`;
    return this.root.firstElementChild;
  }

  // ---------- main menu ----------
  openMain(hasSave) {
    this.current = 'main';
    const s = this._screen(`
      <div class="menu-panel" style="min-width:380px">
        <h1>GRAND<span>THEFT</span>AUDI</h1>
        <h2>NEUSTADT BAY</h2>
        ${hasSave ? '<button class="menu-btn" data-a="continue">Continue</button>' : ''}
        <button class="menu-btn" data-a="new">New Game</button>
        <button class="menu-btn" data-a="settings">Settings</button>
        <button class="menu-btn" data-a="controls">How to Play</button>
        <button class="menu-btn" data-a="credits">Credits</button>
        <div class="menu-footer">v${CFG.version} · an original open-world driving sandbox ·
        all vehicles & brands are fictional</div>
      </div>`);
    s.addEventListener('click', (e) => {
      const a = e.target.dataset?.a;
      if (!a) return;
      if (a === 'continue') this.G.startGame(true);
      if (a === 'new') this.G.startGame(false);
      if (a === 'settings') this.openSettings('main');
      if (a === 'controls') this.openControls('main');
      if (a === 'credits') this.openCredits();
    });
  }

  // ---------- pause ----------
  openPause() {
    this.current = 'pause';
    const s = this._screen(`
      <div class="pause-title">PAUSED</div>
      <div class="menu-panel">
        <button class="menu-btn" data-a="resume">Resume</button>
        <button class="menu-btn" data-a="save">Save Game</button>
        <button class="menu-btn" data-a="settings">Settings</button>
        <button class="menu-btn" data-a="controls">Controls</button>
        <button class="menu-btn" data-a="menu">Quit to Main Menu</button>
      </div>`);
    s.addEventListener('click', async (e) => {
      const a = e.target.dataset?.a;
      if (!a) return;
      if (a === 'resume') this.G.setState('playing');
      if (a === 'save') {
        const ok = await this.G.save.save('manual');
        this.G.ui.toast('Save', ok.server ? 'Saved to server + local.' : 'Saved locally.');
      }
      if (a === 'settings') this.openSettings('pause');
      if (a === 'controls') this.openControls('pause');
      if (a === 'menu') location.reload();
    });
  }

  // ---------- settings ----------
  openSettings(back) {
    const st = CFG.settings;
    const s = this._screen(`
      <div class="menu-panel" style="min-width:460px">
        <h2>SETTINGS</h2>
        <div class="menu-row"><label>Quality (restart applies fully)</label>
          <select id="set-q">
            ${['low', 'medium', 'high'].map((q) => `<option ${st.quality === q ? 'selected' : ''}>${q}</option>`).join('')}
          </select></div>
        <div class="menu-row"><label>Draw distance</label>
          <input type="range" id="set-dd" min="1" max="3" step="1" value="${st.drawDistance}"></div>
        <div class="menu-row"><label>Resolution scale</label>
          <input type="range" id="set-rs" min="0.5" max="1" step="0.05" value="${st.resolutionScale}"></div>
        <div class="menu-row"><label>Field of view</label>
          <input type="range" id="set-fov" min="55" max="90" step="1" value="${st.fov}"></div>
        <div class="menu-row"><label>Master volume</label>
          <input type="range" id="set-vm" min="0" max="1" step="0.05" value="${st.volMaster}"></div>
        <div class="menu-row"><label>Music volume</label>
          <input type="range" id="set-vmu" min="0" max="1" step="0.05" value="${st.volMusic}"></div>
        <div class="menu-row"><label>SFX volume</label>
          <input type="range" id="set-vs" min="0" max="1" step="0.05" value="${st.volSfx}"></div>
        <div class="menu-row"><label>Aim assist</label>
          <span class="toggle" id="set-aa">${st.aimAssist ? 'ON' : 'OFF'}</span></div>
        <div class="menu-row"><label>Camera shake</label>
          <span class="toggle" id="set-cs">${st.cameraShake ? 'ON' : 'OFF'}</span></div>
        <div class="menu-row"><label>FPS counter</label>
          <span class="toggle" id="set-fps">${st.showFps ? 'ON' : 'OFF'}</span></div>
        <button class="menu-btn" data-a="back">← Back</button>
      </div>`);
    const bind = (id, key, parse = parseFloat) => {
      s.querySelector(id).addEventListener('input', (e) => {
        st[key] = parse(e.target.value);
        saveSettings();
        this.G.applySettings();
      });
    };
    bind('#set-dd', 'drawDistance', (v) => parseInt(v, 10));
    bind('#set-rs', 'resolutionScale');
    bind('#set-fov', 'fov', (v) => parseInt(v, 10));
    bind('#set-vm', 'volMaster');
    bind('#set-vmu', 'volMusic');
    bind('#set-vs', 'volSfx');
    s.querySelector('#set-q').addEventListener('change', (e) => {
      st.quality = e.target.value; saveSettings();
      this.G.ui.toast('Settings', 'Quality fully applies after restart.');
    });
    const toggle = (id, key) => {
      const el = s.querySelector(id);
      el.addEventListener('click', () => {
        st[key] = !st[key];
        el.textContent = st[key] ? 'ON' : 'OFF';
        saveSettings();
        this.G.applySettings();
      });
    };
    toggle('#set-aa', 'aimAssist');
    toggle('#set-cs', 'cameraShake');
    toggle('#set-fps', 'showFps');
    s.addEventListener('click', (e) => {
      if (e.target.dataset?.a === 'back') back === 'pause' ? this.openPause() : this.openMain(this.G.save.hasSave);
    });
  }

  openControls(back) {
    const s = this._screen(`
      <div class="menu-panel" style="min-width:480px">
        <h2>CONTROLS</h2>
        <div class="controls-grid">
          ${CONTROLS.map(([k, v]) => `<div class="key">${k}</div><div>${v}</div>`).join('')}
        </div>
        <button class="menu-btn" data-a="back">← Back</button>
      </div>`);
    s.addEventListener('click', (e) => {
      if (e.target.dataset?.a === 'back') back === 'pause' ? this.openPause() : this.openMain(this.G.save.hasSave);
    });
  }

  openCredits() {
    const s = this._screen(`
      <div class="menu-panel" style="min-width:420px;text-align:center">
        <h2>CREDITS</h2>
        <p style="line-height:1.9;font-size:15px">
          <b>GRAND THEFT AUDI</b> — an original fan-scale open-world sandbox.<br/>
          Design, code, city, physics, audio: this repository.<br/>
          Hero 3D concepts generated via Higgsfield AI (see ASSETS.md).<br/>
          Built with Three.js, cannon-es, Vite, FastAPI.<br/><br/>
          All brands, vehicles, characters, stations and music are fictional.<br/>
          No real-world trademarks. Adler Motors isn't real. Sadly.
        </p>
        <button class="menu-btn" data-a="back">← Back</button>
      </div>`);
    s.addEventListener('click', (e) => {
      if (e.target.dataset?.a === 'back') this.openMain(this.G.save.hasSave);
    });
  }

  // ---------- gun shop ----------
  openGunShop() {
    const { G } = this;
    if (G.state !== 'playing') return;
    G.setState('shop');
    const items = Object.entries(WEAPONS).filter(([, d]) => d.price);
    const render = () => {
      const s = this._screen(`
        <div class="menu-panel" style="min-width:460px">
          <h2>BOLT &amp; BARREL</h2>
          <div style="color:var(--text-dim);font-size:13px;margin-bottom:10px">
            Cash: <b style="color:#7fd66a">${fmtMoney(G.player.money)}</b></div>
          ${items.map(([id, d]) => {
            const owned = G.weapons.inventory.has(id);
            return `<button class="menu-btn" data-buy="${id}">
              ${d.name} <span class="price">${owned ? `ammo ${fmtMoney(d.ammoPrice ?? 0)}` : fmtMoney(d.price)}</span></button>`;
          }).join('')}
          <button class="menu-btn" data-buy="__armor">Body armor <span class="price">${fmtMoney(400)}</span></button>
          <button class="menu-btn" data-a="close">← Leave</button>
        </div>`);
      s.addEventListener('click', (e) => {
        const id = e.target.closest('[data-buy]')?.dataset.buy;
        if (e.target.dataset?.a === 'close') { this.close(); G.setState('playing'); return; }
        if (!id) return;
        if (id === '__armor') {
          if (G.player.armor >= 100) return G.ui.toast('Bolt & Barrel', 'Armor already maxed.');
          if (G.player.spendMoney(400)) { G.player.armor = 100; G.audio.play('register'); render(); }
          else G.ui.toast('Bolt & Barrel', 'Not enough cash.');
          return;
        }
        const d = WEAPONS[id];
        const owned = G.weapons.inventory.has(id);
        if (owned) {
          if (G.player.spendMoney(d.ammoPrice ?? 0)) {
            G.weapons.giveAmmo(id, d.ammoPack ?? 0);
            G.audio.play('register');
          } else G.ui.toast('Bolt & Barrel', 'Not enough cash.');
        } else if (G.player.spendMoney(d.price)) {
          G.weapons.give(id, d.ammoPack ?? 0);
          G.audio.play('register');
        } else G.ui.toast('Bolt & Barrel', 'Not enough cash.');
        render();
      });
    };
    render();
  }

  openGarage() { this.G.garageUI.open(); }
}
