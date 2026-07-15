// Pure Web-Audio synthesized SFX — no audio files, fully license-free.
// Each maker returns a function(ctx, destination) that plays one shot,
// or for loops an object {node, stop} / {update}.

export function makeNoiseBuffer(ctx, seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function env(ctx, node, t0, a, peak, d, sustain = 0.0001) {
  node.gain.setValueAtTime(0.0001, t0);
  node.gain.linearRampToValueAtTime(peak, t0 + a);
  node.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + a + d);
}

function noiseShot(ctx, dest, noiseBuf, { dur = 0.3, peak = 0.8, lp = 4000, hp = 0, decay = 0.25 }) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const g = ctx.createGain();
  env(ctx, g, t, 0.004, peak, decay);
  let node = src;
  if (lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lp;
    node.connect(f); node = f;
  }
  if (hp) {
    const f2 = ctx.createBiquadFilter();
    f2.type = 'highpass'; f2.frequency.value = hp;
    node.connect(f2); node = f2;
  }
  node.connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur);
}

function tone(ctx, dest, { type = 'sine', f0 = 440, f1 = null, dur = 0.3, peak = 0.4, decay = 0.25, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const g = ctx.createGain();
  env(ctx, g, t, 0.005, peak, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const SFX = {
  gunshot: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 0.9, lp: 3600, decay: 0.09, dur: 0.14 });
    tone(ctx, dest, { type: 'square', f0: 160, f1: 60, dur: 0.07, peak: 0.5, decay: 0.06 });
  },
  rifle: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 0.95, lp: 5200, decay: 0.11, dur: 0.16 });
    tone(ctx, dest, { type: 'sawtooth', f0: 220, f1: 70, dur: 0.09, peak: 0.4, decay: 0.08 });
  },
  shotgun: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 1.0, lp: 2100, decay: 0.24, dur: 0.34 });
    tone(ctx, dest, { type: 'sine', f0: 110, f1: 45, dur: 0.18, peak: 0.7, decay: 0.16 });
  },
  explosion: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 1.0, lp: 900, decay: 0.9, dur: 1.4 });
    tone(ctx, dest, { type: 'sine', f0: 90, f1: 28, dur: 1.0, peak: 0.9, decay: 0.8 });
    noiseShot(ctx, dest, nb, { peak: 0.5, lp: 5000, hp: 1200, decay: 0.4, dur: 0.5 });
  },
  reload: (ctx, dest) => {
    tone(ctx, dest, { type: 'square', f0: 900, f1: 700, dur: 0.04, peak: 0.2, decay: 0.05 });
    tone(ctx, dest, { type: 'square', f0: 620, f1: 500, dur: 0.05, peak: 0.24, decay: 0.06, delay: 0.13 });
  },
  click: (ctx, dest) => tone(ctx, dest, { type: 'square', f0: 1200, f1: 900, dur: 0.03, peak: 0.16, decay: 0.04 }),
  punch: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 0.5, lp: 700, decay: 0.1, dur: 0.14 });
    tone(ctx, dest, { type: 'sine', f0: 140, f1: 70, dur: 0.1, peak: 0.5, decay: 0.09 });
  },
  swing: (ctx, dest, nb) => noiseShot(ctx, dest, nb, { peak: 0.18, lp: 1800, hp: 500, decay: 0.13, dur: 0.18 }),
  horn: (ctx, dest) => {
    tone(ctx, dest, { type: 'square', f0: 392, dur: 0.32, peak: 0.22, decay: 0.3 });
    tone(ctx, dest, { type: 'square', f0: 494, dur: 0.32, peak: 0.22, decay: 0.3 });
  },
  crash: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 0.9, lp: 2400, decay: 0.35, dur: 0.5 });
    tone(ctx, dest, { type: 'sawtooth', f0: 320, f1: 60, dur: 0.28, peak: 0.35, decay: 0.26 });
    tone(ctx, dest, { type: 'triangle', f0: 1200, f1: 300, dur: 0.4, peak: 0.12, decay: 0.36 });
  },
  glass: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 0.5, lp: 8000, hp: 2600, decay: 0.3, dur: 0.4 });
    tone(ctx, dest, { type: 'triangle', f0: 2400, f1: 1400, dur: 0.2, peak: 0.15, decay: 0.18 });
  },
  scream: (ctx, dest) => {
    tone(ctx, dest, { type: 'sawtooth', f0: 800 + Math.random() * 300, f1: 300, dur: 0.5, peak: 0.16, decay: 0.45 });
  },
  hurt: (ctx, dest) => tone(ctx, dest, { type: 'sawtooth', f0: 260, f1: 120, dur: 0.14, peak: 0.24, decay: 0.13 }),
  register: (ctx, dest) => {
    tone(ctx, dest, { type: 'square', f0: 1568, dur: 0.07, peak: 0.16, decay: 0.07 });
    tone(ctx, dest, { type: 'square', f0: 2093, dur: 0.1, peak: 0.16, decay: 0.1, delay: 0.09 });
  },
  cash: (ctx, dest) => {
    tone(ctx, dest, { type: 'triangle', f0: 1318, dur: 0.08, peak: 0.2, decay: 0.08 });
    tone(ctx, dest, { type: 'triangle', f0: 1760, dur: 0.12, peak: 0.2, decay: 0.12, delay: 0.07 });
  },
  pickup: (ctx, dest) => {
    tone(ctx, dest, { type: 'triangle', f0: 880, f1: 1320, dur: 0.12, peak: 0.2, decay: 0.12 });
  },
  checkpoint: (ctx, dest) => {
    tone(ctx, dest, { type: 'sine', f0: 1046, dur: 0.1, peak: 0.25, decay: 0.1 });
    tone(ctx, dest, { type: 'sine', f0: 1568, dur: 0.16, peak: 0.25, decay: 0.16, delay: 0.09 });
  },
  missionPassed: (ctx, dest) => {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => tone(ctx, dest, {
      type: 'triangle', f0: f, dur: 0.3, peak: 0.22, decay: 0.28, delay: i * 0.13 }));
  },
  vaultOpen: (ctx, dest, nb) => {
    tone(ctx, dest, { type: 'square', f0: 180, f1: 90, dur: 0.5, peak: 0.3, decay: 0.45 });
    noiseShot(ctx, dest, nb, { peak: 0.3, lp: 900, decay: 0.5, dur: 0.7 });
    tone(ctx, dest, { type: 'sine', f0: 700, dur: 0.2, peak: 0.2, decay: 0.18, delay: 0.5 });
  },
  tireBurst: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 0.7, lp: 1600, decay: 0.2, dur: 0.28 });
    tone(ctx, dest, { type: 'sine', f0: 220, f1: 60, dur: 0.2, peak: 0.4, decay: 0.18 });
  },
  spray: (ctx, dest, nb) => noiseShot(ctx, dest, nb, { peak: 0.3, lp: 6000, hp: 1800, decay: 0.7, dur: 0.9 }),
  thunder: (ctx, dest, nb) => {
    noiseShot(ctx, dest, nb, { peak: 0.8, lp: 500, decay: 1.8, dur: 2.4 });
    tone(ctx, dest, { type: 'sine', f0: 60, f1: 25, dur: 1.6, peak: 0.5, decay: 1.4 });
  },
  radioChatter: (ctx, dest, nb) => {
    for (let i = 0; i < 4; i++) {
      noiseShot(ctx, dest, nb, { peak: 0.06, lp: 2400, hp: 700, decay: 0.07, dur: 0.09 });
    }
  },
};

/** looping siren voice: {setMode, setGainTarget, stop} */
export function makeSiren(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const g = ctx.createGain();
  g.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2200;
  osc.connect(lp).connect(g).connect(dest);
  osc.start();
  let phase = 0;
  return {
    gainNode: g,
    update(dt, dist) {
      phase += dt * 0.9;
      const f = 620 + Math.sin(phase * Math.PI * 2) * 180; // wail
      osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
      const vol = Math.max(0, 0.24 * (1 - dist / 220));
      g.gain.setTargetAtTime(vol, ctx.currentTime, 0.1);
    },
    stop() {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => { try { osc.stop(); } catch (e) { /* done */ } }, 600);
    },
  };
}

/** helicopter rotor loop */
export function makeHeli(ctx, dest, noiseBuf) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 380;
  const g = ctx.createGain();
  g.gain.value = 0;
  // amplitude chop
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 13;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.5;
  const base = ctx.createGain();
  base.gain.value = 0.5;
  lfo.connect(lfoG).connect(base.gain);
  src.connect(lp).connect(base).connect(g).connect(dest);
  src.start(); lfo.start();
  return {
    setDistance(d) {
      g.gain.setTargetAtTime(Math.max(0, 0.5 * (1 - d / 260)), ctx.currentTime, 0.2);
    },
    stop() {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeout(() => { try { src.stop(); lfo.stop(); } catch (e) { /* done */ } }, 1200);
    },
  };
}

/** tyre screech loop, level 0..1 */
export function makeScreech(ctx, dest, noiseBuf) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 6;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(bp).connect(g).connect(dest);
  src.start();
  return {
    set(level) {
      bp.frequency.setTargetAtTime(1100 + level * 700, ctx.currentTime, 0.05);
      g.gain.setTargetAtTime(level * 0.22, ctx.currentTime, 0.05);
    },
    stop() { try { src.stop(); } catch (e) { /* done */ } },
  };
}

/** vehicle engine voice */
export function makeEngine(ctx, dest) {
  const oscA = ctx.createOscillator();
  oscA.type = 'sawtooth';
  const oscB = ctx.createOscillator();
  oscB.type = 'sawtooth';
  oscB.detune.value = 18;
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  const g = ctx.createGain();
  g.gain.value = 0;
  oscA.connect(lp); oscB.connect(lp); sub.connect(g);
  lp.connect(g).connect(dest);
  oscA.start(); oscB.start(); sub.start();
  return {
    /** speed01: speed/maxSpeed, load: throttle 0..1 */
    update(speed01, load) {
      // fake gears: rpm saw rises & drops across speed bands
      const gearPos = (speed01 * 4.2) % 1;
      const rpm = 0.25 + gearPos * 0.75;
      const f = 55 + rpm * 260 + speed01 * 90;
      oscA.frequency.setTargetAtTime(f, ctx.currentTime, 0.04);
      oscB.frequency.setTargetAtTime(f * 1.005, ctx.currentTime, 0.04);
      sub.frequency.setTargetAtTime(f * 0.5, ctx.currentTime, 0.04);
      lp.frequency.setTargetAtTime(300 + load * 1400 + rpm * 900, ctx.currentTime, 0.06);
      const vol = 0.075 + load * 0.11 + speed01 * 0.05;
      g.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
    },
    stop() {
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => { try { oscA.stop(); oscB.stop(); sub.stop(); } catch (e) { /* done */ } }, 500);
    },
  };
}
