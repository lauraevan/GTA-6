// Generative music: a tiny pattern sequencer with synth voices. Moods follow
// gameplay (calm / chase / combat / mission); in a car you get three original
// "radio stations" instead. Everything is synthesized — zero licensed audio.

const STATIONS = [
  { id: 'off', name: null },
  { id: 'nachtwelle', name: 'Nachtwelle 103.7', tempo: 100, root: 45, mode: [0, 2, 3, 5, 7, 8, 10], style: 'synthwave' },
  { id: 'kraftraum', name: 'KRAFTRAUM', tempo: 128, root: 43, mode: [0, 2, 3, 5, 7, 8, 10], style: 'techno' },
  { id: 'hafenfunk', name: 'Hafenfunk 88.1', tempo: 76, root: 48, mode: [0, 2, 4, 5, 7, 9, 11], style: 'lofi' },
];

const MOODS = {
  calm:    { tempo: 84, root: 45, layers: { pad: 0.5, bass: 0.4, drums: 0, arp: 0, lead: 0 } },
  mission: { tempo: 100, root: 43, layers: { pad: 0.45, bass: 0.5, drums: 0.3, arp: 0.25, lead: 0 } },
  chase:   { tempo: 128, root: 41, layers: { pad: 0.35, bass: 0.6, drums: 0.7, arp: 0.5, lead: 0 } },
  combat:  { tempo: 140, root: 38, layers: { pad: 0.3, bass: 0.7, drums: 0.85, arp: 0.4, lead: 0.4 } },
};

const midi2f = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class MusicDirector {
  constructor(G) {
    this.G = G;
    this.station = 0;         // index into STATIONS
    this.mood = 'calm';
    this.moodOverride = null;
    this.step = 0;
    this.nextStepTime = 0;
    this.chord = 0;
    this.enabled = true;
    this.progression = [0, 5, 3, 4]; // scale degrees
  }

  get ctx() { return this.G.audio.ctx; }
  get bus() { return this.G.audio.busMusic; }

  setMood(m) { this.moodOverride = m; }

  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    const st = STATIONS[this.station];
    this.G.ui.radioToast(st.name);
  }

  _autoMood() {
    const { G } = this;
    if (this.moodOverride) return this.moodOverride;
    const stars = G.wanted?.stars ?? 0;
    if (stars >= 3) return 'combat';
    if (stars >= 1) return 'chase';
    return 'calm';
  }

  /** voices */
  _kick(t, v) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 0.3);
  }
  _snare(t, v) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.G.audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t); s.stop(t + 0.2);
  }
  _hat(t, v) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.G.audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v * 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f).connect(g).connect(this.bus);
    s.start(t); s.stop(t + 0.08);
  }
  _note(t, midi, dur, v, type = 'sawtooth', lp = 1800) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = midi2f(midi);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + 0.02);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.8, dur * 0.2);
    o.connect(f).connect(g).connect(this.bus);
    o.start(t); o.stop(t + dur + 0.3);
  }
  _pad(t, midis, dur, v) {
    for (const m of midis) {
      this._note(t, m, dur, v * 0.5, 'sawtooth', 900);
      this._note(t, m + 0.06, dur, v * 0.35, 'sawtooth', 700);
    }
  }

  _scheduleStep(cfg, t) {
    const step = this.step % 16;
    const bar = Math.floor(this.step / 16);
    if (step === 0) this.chord = this.progression[bar % this.progression.length];
    const scale = cfg.mode ?? [0, 2, 3, 5, 7, 8, 10];
    const root = cfg.root + scale[this.chord % scale.length];
    const deg = (i) => root + scale[i % scale.length] + 12 * Math.floor(i / scale.length);
    const L = cfg.layers;
    const style = cfg.style;

    // drums
    if (L.drums > 0 || style) {
      const dv = L.drums ?? 0.7;
      if (style === 'techno' || !style) {
        if (step % 4 === 0) this._kick(t, 0.5 * (dv || 0.8));
        if (step % 8 === 4) this._snare(t, 0.4 * (dv || 0.8));
        if (step % 2 === 1) this._hat(t, 0.5 * (dv || 0.6));
      } else if (style === 'synthwave') {
        if (step % 8 === 0 || step % 8 === 5) this._kick(t, 0.42);
        if (step % 8 === 4) this._snare(t, 0.35);
        if (step % 2 === 0) this._hat(t, 0.3);
      } else if (style === 'lofi') {
        if (step % 8 === 0 || step === 10) this._kick(t, 0.35);
        if (step % 8 === 4) this._snare(t, 0.22);
        if (step % 4 === 2) this._hat(t, 0.2);
      }
    }
    // bass
    const bassV = L?.bass ?? 0.5;
    if (bassV > 0 && step % 4 === 0) {
      this._note(t, root - 24, 0.5, 0.28 * bassV, 'sawtooth', 500);
    }
    if ((style === 'techno') && step % 4 === 2) {
      this._note(t, root - 24, 0.2, 0.2, 'sawtooth', 600);
    }
    // pad every bar
    const padV = L?.pad ?? 0.4;
    if (padV > 0 && step === 0) {
      this._pad(t, [deg(0), deg(2), deg(4)], (60 / cfg.tempo) * 4, 0.12 * padV * 2);
    }
    // arp
    const arpV = L?.arp ?? (style ? 0.4 : 0);
    if (arpV > 0 && step % 2 === 0) {
      const seq = [0, 4, 2, 4, 7, 4, 2, 4];
      this._note(t, deg(seq[(step / 2) % 8]) + 12, 0.16, 0.1 * arpV * 2, 'square', 2600);
    }
    // lead stabs (combat)
    const leadV = L?.lead ?? 0;
    if (leadV > 0 && (step === 6 || step === 14)) {
      this._note(t, deg(7) + 12, 0.3, 0.16 * leadV * 2, 'sawtooth', 3000);
    }
    // lofi ep chords
    if (style === 'lofi' && step % 8 === 0) {
      this._pad(t, [deg(0) + 12, deg(2) + 12, deg(4) + 12], 1.4, 0.16);
    }
  }

  update() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.enabled) return;
    const { G } = this;

    // choose active config: radio in car > mood music
    let cfg = null;
    const st = STATIONS[this.station];
    if (G.player?.vehicle && st.name && (G.wanted?.stars ?? 0) < 2) {
      cfg = { ...st, layers: null };
    } else {
      const mood = this._autoMood();
      cfg = { ...MOODS[mood], mode: undefined, style: null };
    }

    const stepDur = 60 / cfg.tempo / 4;
    if (this.nextStepTime < ctx.currentTime - 0.4) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + 0.25) {
      this._scheduleStep(cfg, this.nextStepTime);
      this.nextStepTime += stepDur;
      this.step++;
    }
  }
}
