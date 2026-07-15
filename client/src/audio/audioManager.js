// Audio manager: bus routing, positional one-shots, engine/siren/heli/screech
// loops, ambient beds (wind, rain, city hum, birds). All synthesized.

import { SFX, makeNoiseBuffer, makeSiren, makeHeli, makeScreech, makeEngine } from './synths.js';

export class AudioManager {
  constructor(G) {
    this.G = G;
    this.ctx = null;
    this.engine = null;
    this.sirens = [];
    this.heli = null;
    this.screechVoice = null;
    this._pending = [];
  }

  /** must be called from a user gesture */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const s = this.G.settings;
    this.master = this.ctx.createGain();
    this.master.gain.value = s.volMaster;
    this.master.connect(this.ctx.destination);
    this.busSfx = this.ctx.createGain();
    this.busSfx.gain.value = s.volSfx;
    this.busSfx.connect(this.master);
    this.busMusic = this.ctx.createGain();
    this.busMusic.gain.value = s.volMusic;
    this.busMusic.connect(this.master);
    this.busAmbient = this.ctx.createGain();
    this.busAmbient.gain.value = 0.5;
    this.busAmbient.connect(this.master);
    this.noise = makeNoiseBuffer(this.ctx, 1.2);
    this._initAmbient();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.G.settings;
    this.master.gain.value = s.volMaster;
    this.busSfx.gain.value = s.volSfx;
    this.busMusic.gain.value = s.volMusic;
  }

  resume() { this.ctx?.resume?.(); }

  /** one-shot by name; opts {pos, vol} — pos gives distance attenuation + pan */
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const fn = SFX[name];
    if (!fn) return;
    let dest = this.busSfx;
    if (opts.pos && this.G.camera) {
      const cam = this.G.camera.position;
      const d = Math.hypot(opts.pos.x - cam.x, opts.pos.y - cam.y, opts.pos.z - cam.z);
      if (d > 160) return;
      const g = this.ctx.createGain();
      g.gain.value = (opts.vol ?? 1) * Math.max(0.05, 1 - d / 160);
      const pan = this.ctx.createStereoPanner();
      // pan by camera-relative x
      const fwd = this.G.cameraRig.flatForward;
      const relX = (opts.pos.x - cam.x) * fwd.z - (opts.pos.z - cam.z) * fwd.x;
      pan.pan.value = Math.max(-1, Math.min(1, relX / 40));
      g.connect(pan).connect(this.busSfx);
      dest = g;
    } else if (opts.vol !== undefined) {
      const g = this.ctx.createGain();
      g.gain.value = opts.vol;
      g.connect(this.busSfx);
      dest = g;
    }
    try { fn(this.ctx, dest, this.noise); } catch (e) { /* audio glitch — ignore */ }
  }

  // ---------- engine ----------
  attachEngine(vehicle) {
    if (!this.ctx) return;
    this.detachEngine();
    this.engine = { voice: makeEngine(this.ctx, this.busSfx), vehicle };
  }
  detachEngine() {
    this.engine?.voice.stop();
    this.engine = null;
  }

  screech(level) {
    if (!this.ctx) return;
    if (!this.screechVoice) this.screechVoice = makeScreech(this.ctx, this.busSfx, this.noise);
    this.screechVoice.set(level);
  }

  // ---------- heli ----------
  startHeli() {
    if (!this.ctx || this.heli) return;
    this.heli = makeHeli(this.ctx, this.busSfx, this.noise);
  }
  stopHeli() { this.heli?.stop(); this.heli = null; }
  setHeliDistance(d) { this.heli?.setDistance(d); }

  // ---------- ambient ----------
  _initAmbient() {
    const ctx = this.ctx;
    // wind / city hum
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass'; windLp.frequency.value = 260;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.05;
    wind.connect(windLp).connect(this.windGain).connect(this.busAmbient);
    wind.start();
    // rain layer
    const rain = ctx.createBufferSource();
    rain.buffer = this.noise;
    rain.loop = true;
    const rainBp = ctx.createBiquadFilter();
    rainBp.type = 'bandpass'; rainBp.frequency.value = 3400; rainBp.Q.value = 0.4;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainBp).connect(this.rainGain).connect(this.busAmbient);
    rain.start();
    this._birdT = 4;
  }

  update(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const { G } = this;

    // engine voice
    if (this.engine && this.engine.vehicle && !this.engine.vehicle.dead) {
      const v = this.engine.vehicle;
      this.engine.voice.update(
        Math.min(1, v.speed / v.def.maxSpeed),
        v.controls.throttle * (v.controls.nitro ? 1.3 : 1));
    }

    // ambient by weather / time
    const rain = G.weather?.rainAmount ?? 0;
    this.rainGain.gain.setTargetAtTime(rain * 0.16, this.ctx.currentTime, 0.5);
    this.windGain.gain.setTargetAtTime(0.04 + rain * 0.03, this.ctx.currentTime, 0.5);

    // birds in daytime greenery
    this._birdT -= dt;
    if (this._birdT <= 0) {
      this._birdT = 3 + Math.random() * 7;
      const dn = G.daynight;
      if (dn && dn.sunFactor > 0.5 && rain < 0.3 && G.player) {
        const d = G.city.districtAt(G.player.position.x, G.player.position.z);
        if (d === 5 || d === 6 || d === 3) { // rural, park, residential
          const f = 2200 + Math.random() * 1800;
          const o = this.ctx.createOscillator();
          o.type = 'sine';
          o.frequency.setValueAtTime(f, this.ctx.currentTime);
          o.frequency.exponentialRampToValueAtTime(f * (1.1 + Math.random() * 0.3), this.ctx.currentTime + 0.08);
          o.frequency.exponentialRampToValueAtTime(f * 0.9, this.ctx.currentTime + 0.16);
          const g = this.ctx.createGain();
          g.gain.value = 0;
          g.gain.setTargetAtTime(0.02, this.ctx.currentTime, 0.01);
          g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.15, 0.05);
          o.connect(g).connect(this.busAmbient);
          o.start();
          o.stop(this.ctx.currentTime + 0.4);
        }
      }
    }

    // police sirens: attach to the two nearest pursuing cars
    const units = (G.police?.carUnits ?? []).filter((u) => G.wanted.stars > 0 && !u.vehicle.dead);
    units.sort((a, b) =>
      a.vehicle.position.distanceTo(G.camera.position) - b.vehicle.position.distanceTo(G.camera.position));
    const want = units.slice(0, 2);
    // recycle voices
    while (this.sirens.length < want.length) {
      this.sirens.push(makeSiren(this.ctx, this.busSfx));
    }
    while (this.sirens.length > want.length) {
      this.sirens.pop().stop();
    }
    this.sirens.forEach((s, i) => {
      const d = want[i].vehicle.position.distanceTo(G.camera.position);
      s.update(dt, d);
    });
  }
}
