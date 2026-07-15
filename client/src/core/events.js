// Tiny event bus used for cross-system communication.
// Channels used across the game (payloads are plain objects):
//   crime            {type, pos, severity, witnessRadius}
//   gunshot          {pos, byPlayer}
//   explosion        {pos, radius, byPlayer}
//   pedKilled        {ped, byPlayer, byCar}
//   copKilled        {pos}
//   vehicleStolen    {vehicle, witnessed}
//   wantedChanged    {stars, prev}
//   moneyChanged     {value, delta}
//   missionStart / missionComplete / missionFailed  {mission}
//   playerWasted / playerBusted {}
//   enterVehicle / exitVehicle {vehicle}
//   raceFinished     {race, timeMs, place}

export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error(`[events:${type}]`, e); }
    }
  }
}
