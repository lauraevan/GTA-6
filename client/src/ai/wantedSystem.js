// Wanted/heat: crimes add heat when witnessed, stars escalate 1–5, heat decays
// out of police line-of-sight, spray shops clear it. Police report sightings
// here every frame.

const THRESHOLDS = [15, 70, 160, 320, 520];

export class WantedSystem {
  constructor(G) {
    this.G = G;
    this.heat = 0;
    this.stars = 0;
    this.copSeesPlayer = false;
    this.lastSeenT = -999;
    this.lastSeenPos = null;
    this.t = 0;
    this._unseenSince = 0;

    G.events.on('crime', (c) => this.onCrime(c));
    G.events.on('copKilled', ({ pos }) => this.addHeat(85, pos, true));
  }

  onCrime(c) {
    if (this.G.state !== 'playing') return;
    if (!c.severity) return;
    const { G } = this;
    const witnessed =
      this.copSeesPlayer ||
      (G.police?.anyCopNear(c.pos, (c.witnessRadius ?? 25) * 1.6) ?? false) ||
      (G.peds?.anyWitnessNear(c.pos, c.witnessRadius ?? 25) ?? false);
    if (!witnessed) return;
    const copBonus = this.copSeesPlayer ? 1.5 : 1;
    this.addHeat(c.severity * copBonus, c.pos);
  }

  addHeat(amount, pos = null, force = false) {
    this.heat = Math.min(700, this.heat + amount);
    if (pos) this.lastSeenPos = pos.clone ? pos.clone() : pos;
    this._recomputeStars(true);
  }

  /** a fleeing pedestrian completed a 911 call */
  reportCrime(pos) {
    this.heat = Math.max(this.heat, THRESHOLDS[0] + 5);
    this.addHeat(10, pos, true);
  }

  /** called by police every frame a unit has line of sight */
  reportSeen(pos) {
    this.copSeesPlayer = true;
    this.lastSeenT = this.t;
    this.lastSeenPos = pos.clone();
  }

  setStars(n, pos = null) {
    this.heat = n <= 0 ? 0 : THRESHOLDS[n - 1] + 12;
    this._recomputeStars(true);
    if (pos) this.lastSeenPos = pos;
  }

  clear() {
    this.heat = 0;
    this._recomputeStars(true);
  }

  get unseenFor() { return this.t - this.lastSeenT; }

  _targetStars() {
    let s = 0;
    for (let i = 0; i < THRESHOLDS.length; i++) if (this.heat >= THRESHOLDS[i]) s = i + 1;
    return s;
  }

  _recomputeStars(allowDrop = false) {
    const target = this._targetStars();
    const prev = this.stars;
    if (target > this.stars) this.stars = target;
    else if (target < this.stars && allowDrop && this.unseenFor > 8) this.stars = target;
    if (this.stars !== prev) {
      this.G.events.emit('wantedChanged', { stars: this.stars, prev });
      if (this.stars === 0) this.G.events.emit('wantedCleared', {});
    }
  }

  update(dt) {
    this.t += dt;
    // copSeesPlayer is re-asserted by police each frame
    const seenRecently = this.unseenFor < 0.5;
    if (!seenRecently) this.copSeesPlayer = false;

    if (this.heat > 0) {
      const grace = 9 + this.stars * 4;
      const rate = seenRecently ? 0.4 : (this.unseenFor > grace ? 3.5 + this.stars : 0.8);
      this.heat = Math.max(0, this.heat - rate * dt);
      this._recomputeStars(true);
    }
  }
}
