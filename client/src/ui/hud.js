// HUD: minimap cluster, cash/wanted, weapon/ammo, speedo, prompts, toasts,
// banners, subtitles, crosshair, damage feedback, race panel, vault minigame
// bar, and the hold-Tab weapon wheel (with slow-mo).

import { fmtMoney, fmtTime, clamp } from '../core/mathx.js';
import { WEAPONS, WEAPON_ORDER } from '../entities/catalog.js';

export class HUD {
  constructor(G) {
    this.G = G;
    this.root = document.getElementById('hud-root');
    this.root.innerHTML = `
      <div id="toasts"></div>
      <div id="status-tr">
        <div id="cash">$0</div>
        <div id="cash-delta"></div>
        <div id="wanted">${'<span class="star">★</span>'.repeat(5)}</div>
      </div>
      <div id="minimap-wrap">
        <canvas id="minimap" width="448" height="448"></canvas>
        <div id="zone-name"></div>
      </div>
      <div id="vitals">
        <div class="bar"><div id="hp-fill" style="width:100%"></div></div>
        <div class="bar"><div id="ap-fill" style="width:0%"></div></div>
      </div>
      <div id="weapon-box">
        <div id="weapon-name">FISTS</div>
        <div id="weapon-ammo"></div>
      </div>
      <div id="vehicle-name" class="hidden"></div>
      <div id="speedo" class="hidden">
        <div class="kmh">0</div><div class="unit">KM/H</div>
        <div class="nitro-bar"><div></div></div>
      </div>
      <div id="objective"></div>
      <div id="subtitle" class="hidden"></div>
      <div id="prompt" class="hidden"></div>
      <div id="race-panel" class="hidden">
        <div class="pos"></div><div id="race-timer"></div><div class="info"></div>
      </div>
      <div id="minigame" class="hidden" style="position:absolute;left:50%;top:60%;transform:translateX(-50%);width:340px;text-align:center;">
        <div id="mg-label" style="font-size:13px;letter-spacing:.15em;color:#ffe9b0;text-shadow:0 2px 4px #000;margin-bottom:6px;"></div>
        <div style="position:relative;height:18px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.3);border-radius:9px;overflow:hidden;">
          <div id="mg-window" style="position:absolute;top:0;bottom:0;background:rgba(127,214,106,.45);border-left:1px solid #7fd66a;border-right:1px solid #7fd66a;"></div>
          <div id="mg-cursor" style="position:absolute;top:-2px;bottom:-2px;width:4px;background:#fff;box-shadow:0 0 8px #fff;"></div>
        </div>
      </div>
      <div id="crosshair" class="hidden"><div class="dot"></div></div>
      <div id="hitmarker">+</div>
      <div id="vignette-dmg"></div>
      <div id="flash-white"></div>
      <div id="banner"></div>
      <div id="radio-toast"></div>
      <div id="fps" class="hidden"></div>
      <canvas id="wheel" width="520" height="520" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;"></canvas>
    `;
    this.$ = (id) => document.getElementById(id);
    this.cash = this.$('cash');
    this.cashShown = 0;
    this.wheelOpen = false;
    this.wheelSel = null;
    this.toastQueue = [];
    this._bannerT = 0;
    this._lastHp = -1;

    G.events.on('moneyChanged', ({ value, delta, silent }) => {
      if (!silent && Math.abs(delta) >= 1) this.cashDelta(delta);
    });
    G.events.on('wantedChanged', ({ stars }) => this.renderStars(stars));
    G.events.on('playerWasted', () => this.banner('WASTED', '', 3.4, true));
    G.events.on('playerBusted', () => this.banner('BUSTED', 'The NBPD send their regards', 3.4, true));
  }

  show(on = true) { this.root.classList.toggle('hidden', !on); }

  // ---------- small widgets ----------
  toast(title, body = '') {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="t-title">${title}</div>${body}`;
    this.$('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 4600);
  }

  cashDelta(d) {
    const el = this.$('cash-delta');
    el.textContent = `${d > 0 ? '+' : ''}${fmtMoney(d)}`;
    el.classList.toggle('neg', d < 0);
    el.classList.add('show');
    clearTimeout(this._cdT);
    this._cdT = setTimeout(() => el.classList.remove('show'), 1800);
  }

  renderStars(stars) {
    const spans = this.$('wanted').querySelectorAll('.star');
    spans.forEach((s, i) => s.classList.toggle('on', i < stars));
    this.$('wanted').classList.toggle('flash', stars >= 4);
  }

  banner(text, sub = '', dur = 3, danger = false) {
    const b = this.$('banner');
    b.innerHTML = `${text}${sub ? `<span class="sub">${sub}</span>` : ''}`;
    b.classList.toggle('danger', danger);
    b.classList.add('show');
    this._bannerT = dur;
  }

  subtitle(line) {
    const el = this.$('subtitle');
    if (!line) { el.classList.add('hidden'); return; }
    const m = line.match(/^([A-ZÄÖÜ]+):\s*(.*)$/);
    el.innerHTML = m ? `<span class="speaker">${m[1]}</span> ${m[2]}` : line;
    el.classList.remove('hidden');
  }

  setObjective(html) { this.$('objective').innerHTML = html || ''; }

  setPrompt(text) {
    const el = this.$('prompt');
    if (!text) { el.classList.add('hidden'); return; }
    const m = text.match(/^(\S+)\s+—\s+(.*)$/);
    el.innerHTML = m ? `<b>${m[1]}</b>${m[2]}` : text;
    el.classList.remove('hidden');
  }

  setMinigame(mg) {
    const el = this.$('minigame');
    if (!mg) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    this.$('mg-label').textContent = mg.label;
    const w = this.$('mg-window');
    w.style.left = `${mg.lo * 100}%`;
    w.style.width = `${(mg.hi - mg.lo) * 100}%`;
    this.$('mg-cursor').style.left = `calc(${mg.cursor * 100}% - 2px)`;
  }

  setRaceInfo(info) {
    const panel = this.$('race-panel');
    if (!info) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    if (info.custom) {
      panel.querySelector('.pos').textContent = '';
      this.$('race-timer').textContent = info.custom;
      panel.querySelector('.info').textContent = '';
    } else {
      panel.querySelector('.pos').textContent = `CP ${info.cp}/${info.total}`;
      this.$('race-timer').textContent = fmtTime(info.time);
      panel.querySelector('.info').textContent = `LAP ${info.lap}/${info.laps}`;
    }
  }

  hitmarker() {
    const el = this.$('hitmarker');
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  damageFlash(a) {
    const el = this.$('vignette-dmg');
    el.style.opacity = clamp(a, 0, 1);
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => { el.style.opacity = 0; }, 350);
  }

  flashWhite(a = 0.3) {
    const el = this.$('flash-white');
    el.style.transition = 'none';
    el.style.opacity = a;
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.5s';
      el.style.opacity = 0;
    });
  }

  letterbox(on) { document.getElementById('letterbox').classList.toggle('hidden', !on); }

  radioToast(name) {
    const el = this.$('radio-toast');
    el.innerHTML = name ? `♪ <b>${name}</b>` : 'RADIO OFF';
    el.classList.add('show');
    clearTimeout(this._rtT);
    this._rtT = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // menu delegates (wired by main)
  openGarage() { this.G.menus?.openGarage(); }
  openGunShop() { this.G.menus?.openGunShop(); }

  // ---------- weapon wheel ----------
  _updateWheel(dt) {
    const G = this.G;
    const canvas = this.$('wheel');
    const open = G.input.down('Tab') && G.state === 'playing' && !G.player.vehicle;
    if (open && !this.wheelOpen) {
      this.wheelOpen = true;
      this.wvx = 0; this.wvy = 0;
      G.setTimeScale(0.3);
      canvas.style.display = 'block';
    } else if (!open && this.wheelOpen) {
      this.wheelOpen = false;
      canvas.style.display = 'none';
      G.setTimeScale(1);
      if (this.wheelSel) G.weapons.equip(this.wheelSel);
      this.wheelSel = null;
      return;
    }
    if (!this.wheelOpen) return;

    const d = G.input.consumeMouse();
    this.wvx = clamp(this.wvx + d.x, -140, 140);
    this.wvy = clamp(this.wvy + d.y, -140, 140);

    const ctx = canvas.getContext('2d');
    const S = canvas.width, C = S / 2;
    ctx.clearRect(0, 0, S, S);
    const owned = WEAPON_ORDER.filter((w) => G.weapons.inventory.has(w));
    const n = owned.length;
    const ang = Math.atan2(this.wvy, this.wvx);
    const mag = Math.hypot(this.wvx, this.wvy);
    let selIdx = -1;
    if (mag > 26) {
      selIdx = Math.round(((ang + Math.PI) / (Math.PI * 2)) * n) % n;
    }
    this.wheelSel = selIdx >= 0 ? owned[selIdx] : G.weapons.current;

    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 - Math.PI - Math.PI / n;
      const a1 = a0 + (Math.PI * 2) / n;
      const sel = owned[i] === this.wheelSel;
      ctx.beginPath();
      ctx.moveTo(C, C);
      ctx.arc(C, C, S * 0.46, a0, a1);
      ctx.closePath();
      ctx.fillStyle = sel ? 'rgba(232,180,55,0.85)' : 'rgba(10,13,20,0.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.stroke();
      const mid = (a0 + a1) / 2;
      const tx = C + Math.cos(mid) * S * 0.32;
      const ty = C + Math.sin(mid) * S * 0.32;
      ctx.fillStyle = sel ? '#15181f' : '#e8e9ec';
      ctx.font = 'bold 15px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(WEAPONS[owned[i]].name.toUpperCase(), tx, ty);
      const inv = G.weapons.inventory.get(owned[i]);
      if (inv && inv.ammo !== Infinity) {
        ctx.font = '12px Arial';
        ctx.fillText(`${inv.ammo} | ${inv.reserve}`, tx, ty + 16);
      }
    }
    ctx.beginPath();
    ctx.arc(C, C, 32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10,13,20,0.9)';
    ctx.fill();
  }

  // ---------- per-frame ----------
  update(dt) {
    const G = this.G;
    const p = G.player;
    if (!p) return;

    // banner timer
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.$('banner').classList.remove('show');
    }

    // cash roll
    if (this.cashShown !== p.money) {
      const diff = p.money - this.cashShown;
      this.cashShown += Math.abs(diff) < 2 ? diff : Math.round(diff * Math.min(1, dt * 8));
      this.cash.textContent = fmtMoney(this.cashShown);
    }

    // vitals
    if (p.health !== this._lastHp) {
      this._lastHp = p.health;
      this.$('hp-fill').style.width = `${clamp(p.health, 0, 100)}%`;
      this.$('hp-fill').style.background = p.health < 30 ? '#e84747' : '#64d05e';
    }
    this.$('ap-fill').style.width = `${clamp(p.armor, 0, 100)}%`;

    // weapon
    const wdef = G.weapons.currentDef;
    const inv = G.weapons.currentAmmo;
    this.$('weapon-name').textContent = wdef.name.toUpperCase();
    const ammoEl = this.$('weapon-ammo');
    if (wdef.melee) ammoEl.textContent = '—';
    else if (G.weapons.reloading > 0) { ammoEl.textContent = 'RELOADING'; ammoEl.classList.add('reloading'); }
    else {
      ammoEl.classList.remove('reloading');
      ammoEl.innerHTML = `${inv.ammo === Infinity ? '∞' : inv.ammo}<span class="reserve"> | ${inv.reserve === Infinity ? '∞' : inv.reserve}</span>`;
    }

    // driving widgets
    const v = p.vehicle;
    this.$('speedo').classList.toggle('hidden', !v);
    this.$('vehicle-name').classList.toggle('hidden', !v);
    if (v) {
      this.$('speedo').querySelector('.kmh').textContent = Math.round(v.speedKmh);
      this.$('vehicle-name').textContent = v.def.name.toUpperCase();
      const nb = this.$('speedo').querySelector('.nitro-bar div');
      nb.style.width = v.mods.nitro ? `${(v.vp?.nitroCharge ?? 0) * 100}%` : '0%';
    }

    // crosshair
    this.$('crosshair').classList.toggle('hidden', !(p.aiming && !wdef.melee));

    // zone name
    this.$('zone-name').textContent = G.city.districtName(p.position.x, p.position.z).toUpperCase();

    // fps
    if (G.settings.showFps) {
      this.$('fps').classList.remove('hidden');
      this._fpsAcc = (this._fpsAcc ?? 0) + dt;
      this._fpsN = (this._fpsN ?? 0) + 1;
      if (this._fpsAcc > 0.5) {
        this.$('fps').textContent = `${Math.round(this._fpsN / this._fpsAcc)} fps`;
        this._fpsAcc = 0; this._fpsN = 0;
      }
    } else this.$('fps').classList.add('hidden');

    this._updateWheel(dt);
  }
}
