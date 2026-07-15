// Minimap (rotating, blips, GPS route) + fullscreen big map (M) with
// click-to-set waypoint. Also owns the GPS route state (A* over nav graph).

import { DISTRICT } from '../world/cityData.js';

const MAP_COLORS = {
  [DISTRICT.WATER]: '#1d4560', [DISTRICT.DOWNTOWN]: '#3c4148', [DISTRICT.COMMERCIAL]: '#40444a',
  [DISTRICT.RESIDENTIAL]: '#3b4438', [DISTRICT.INDUSTRIAL]: '#42403a', [DISTRICT.RURAL]: '#33402c',
  [DISTRICT.PARK]: '#2e4f2e',
};

export class GPS {
  constructor(G) {
    this.G = G;
    this.target = null;   // {x,z}
    this.route = null;    // [[x,z]...]
    this._recalcT = 0;
  }
  setTarget(x, z) { this.target = { x, z }; this.route = null; this._recalcT = 0; }
  clear() { this.target = null; this.route = null; }
  update(dt) {
    if (!this.target) return;
    this._recalcT -= dt;
    if (this._recalcT <= 0) {
      this._recalcT = 2;
      const p = this.G.player.position;
      this.route = this.G.nav.routePoints(p.x, p.z, this.target.x, this.target.z);
      const d = Math.hypot(p.x - this.target.x, p.z - this.target.z);
      if (d < 8) this.clear();
    }
  }
}

export class MiniMap {
  constructor(G) {
    this.G = G;
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.big = null;
    this.bigOpen = false;
    this._buildBase();
    this._buildBigMap();
  }

  _buildBase() {
    const city = this.G.city;
    const S = 1024;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = S;
    const ctx = this.base.getContext('2d');
    const scale = S / city.meta.worldSize;
    const toPx = (v) => (v + city.half) * scale;
    ctx.fillStyle = MAP_COLORS[DISTRICT.RURAL];
    ctx.fillRect(0, 0, S, S);
    for (let bz = 0; bz < city.meta.blocks; bz++) {
      for (let bx = 0; bx < city.meta.blocks; bx++) {
        ctx.fillStyle = MAP_COLORS[city.districts[bz][bx]] || '#333';
        ctx.fillRect(toPx(-city.half + bx * city.blockSize), toPx(-city.half + bz * city.blockSize),
          city.blockSize * scale + 0.5, city.blockSize * scale + 0.5);
      }
    }
    for (const r of city.roads) {
      const w = Math.max(2, city.roadHalf(r.t) * 2 * scale);
      ctx.fillStyle = r.t === 2 ? '#8a8f98' : r.t === 1 ? '#767b84' : '#5d626b';
      const p0 = toPx(city.linePos(r.j0)), p1 = toPx(city.linePos(r.j1));
      const c = toPx(city.linePos(r.i));
      if (r.a === 'v') ctx.fillRect(c - w / 2, p0, w, p1 - p0);
      else ctx.fillRect(p0, c - w / 2, p1 - p0, w);
    }
    this.mapScale = scale;
  }

  worldToBase(x, z) {
    const city = this.G.city;
    return [(x + city.half) * this.mapScale, (z + city.half) * this.mapScale];
  }

  _poiList() {
    const pois = this.G.city.pois;
    const out = [
      { p: pois.safehouse.door, icon: 'S', color: '#7fd66a' },
      { p: pois.garage.door, icon: 'G', color: '#e8b437' },
      { p: pois.bank.door, icon: '$', color: '#ffd700' },
      { p: pois.hospital.door, icon: 'H', color: '#ff8a8a' },
      { p: pois.gunshop.door, icon: 'A', color: '#e8a25c' },
    ];
    for (const pol of pois.police) out.push({ p: pol.door, icon: 'P', color: '#7fb5ff' });
    for (const s of pois.spray) out.push({ p: s.door, icon: '◔', color: '#c583e8' });
    return out;
  }

  // ---------- minimap ----------
  render() {
    const { G, ctx, canvas } = this;
    const p = G.player;
    if (!p) return;
    const S = canvas.width;
    const C = S / 2;
    const v = p.vehicle;
    const heading = v ? v.yaw : (G.cameraRig.yaw + Math.PI);
    const zoom = v ? 1.5 - Math.min(v.speed / 60, 0.55) : 1.7; // px per m-ish

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, C - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, S, S);

    // rotate map under fixed player arrow
    ctx.translate(C, C);
    ctx.rotate(heading);            // world rotated so heading points up
    const sc = zoom * (2);          // canvas is 2x CSS size
    ctx.scale(sc / this.mapScale, sc / this.mapScale);
    const [bx, bz] = this.worldToBase(p.position.x, p.position.z);
    ctx.translate(-bx, -bz);
    ctx.drawImage(this.base, 0, 0);

    // GPS route
    const route = G.gps.route;
    if (route) {
      ctx.strokeStyle = '#b44ee8';
      ctx.lineWidth = 5 / (sc / this.mapScale) * this.mapScale;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      route.forEach(([x, z], i) => {
        const [px, pz] = this.worldToBase(x, z);
        i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz);
      });
      ctx.stroke();
    }

    // blips (in base coords)
    const blip = (x, z, color, r = 3) => {
      const [px, pz] = this.worldToBase(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, pz, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const poi of this._poiList()) blip(poi.p[0], poi.p[1], poi.color, 2.6);
    for (const m of G.markers.markers.values()) {
      const col = m.type === 'race' ? '#47b5e8' : m.type === 'activity' ? '#7fd66a'
        : m.type === 'property' ? '#c583e8' : '#e8b437';
      blip(m.pos.x, m.pos.z, col, 3.2);
    }
    for (const u of G.police.carUnits) blip(u.vehicle.position.x, u.vehicle.position.z, '#ff4040', 2.8);
    for (const c of G.police.footCops) blip(c.position.x, c.position.z, '#ff7070', 2);
    if (G.police.heli) blip(G.police.heli.group.position.x, G.police.heli.group.position.z, '#ff40b0', 3.4);

    ctx.restore();

    // player arrow (fixed center, pointing up)
    ctx.save();
    ctx.translate(C, C);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // north tick
    ctx.save();
    ctx.translate(C, C);
    ctx.rotate(heading);
    ctx.fillStyle = '#e8b437';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -C + 26);
    ctx.restore();
  }

  // ---------- big map ----------
  _buildBigMap() {
    const wrap = document.createElement('div');
    wrap.id = 'bigmap';
    wrap.className = 'hidden';
    wrap.style.cssText = `position:fixed;inset:0;z-index:30;background:rgba(5,7,10,0.88);
      display:flex;align-items:center;justify-content:center;pointer-events:auto;`;
    wrap.innerHTML = `
      <canvas id="bigmap-canvas" width="820" height="820" style="border:1px solid rgba(232,180,55,.4);border-radius:8px;cursor:crosshair;max-width:92vmin;max-height:92vmin;"></canvas>
      <div style="position:absolute;bottom:4vh;left:50%;transform:translateX(-50%);color:#9aa0ab;font-size:13px;letter-spacing:.1em;">
        CLICK — set waypoint · M / ESC — close</div>`;
    document.getElementById('hud-root').appendChild(wrap);
    this.big = wrap;
    const canvas = wrap.querySelector('#bigmap-canvas');
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width;
      const vv = (e.clientY - rect.top) / rect.height;
      const city = this.G.city;
      const x = u * city.meta.worldSize - city.half;
      const z = vv * city.meta.worldSize - city.half;
      this.G.gps.setTarget(x, z);
      this.G.ui.toast('GPS', 'Waypoint set');
      this.renderBig();
    });
  }

  toggleBig(force) {
    this.bigOpen = force ?? !this.bigOpen;
    this.big.classList.toggle('hidden', !this.bigOpen);
    if (this.bigOpen) {
      this.G.input.setLockWanted(false);
      this.renderBig();
    } else if (this.G.state === 'playing') {
      this.G.input.setLockWanted(true);
    }
  }

  renderBig() {
    const canvas = this.big.querySelector('#bigmap-canvas');
    const ctx = canvas.getContext('2d');
    const S = canvas.width;
    ctx.drawImage(this.base, 0, 0, S, S);
    const k = S / 1024;
    const dot = (x, z, color, r = 5, icon = null) => {
      const [px, pz] = this.worldToBase(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px * k, pz * k, r, 0, Math.PI * 2);
      ctx.fill();
      if (icon) {
        ctx.fillStyle = '#0c0f14';
        ctx.font = `bold ${r * 1.4}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, px * k, pz * k + 0.5);
      }
    };
    // route
    const route = this.G.gps.route;
    if (route) {
      ctx.strokeStyle = '#b44ee8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      route.forEach(([x, z], i) => {
        const [px, pz] = this.worldToBase(x, z);
        i ? ctx.lineTo(px * k, pz * k) : ctx.moveTo(px * k, pz * k);
      });
      ctx.stroke();
    }
    for (const poi of this._poiList()) dot(poi.p[0], poi.p[1], poi.color, 7, poi.icon);
    for (const m of this.G.markers.markers.values()) {
      const col = m.type === 'race' ? '#47b5e8' : m.type === 'activity' ? '#7fd66a'
        : m.type === 'property' ? '#c583e8' : '#e8b437';
      dot(m.pos.x, m.pos.z, col, 6);
    }
    if (this.G.gps.target) dot(this.G.gps.target.x, this.G.gps.target.z, '#b44ee8', 6, '✕');
    const p = this.G.player.position;
    dot(p.x, p.z, '#ffffff', 6);
  }

  update(dt) {
    this.G.gps.update(dt);
    this.render();
    if (this.bigOpen && (this._bigT = (this._bigT ?? 0) + dt) > 0.5) {
      this._bigT = 0;
      this.renderBig();
    }
  }
}
