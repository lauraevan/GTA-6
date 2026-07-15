// POI zone registry: tracks enterable interiors (shops, bank, safehouse, spray
// bays …) registered by loaded chunks, answers "where is the player" queries
// and provides lookups for gameplay systems (robbery, economy, missions).

import { KIND } from './cityData.js';

let nextId = 1;

export class ZoneRegistry {
  constructor(G) {
    this.G = G;
    this.zones = new Map(); // id -> interior {kind, center, radius, ...}
  }

  register(interior, chunkKey) {
    const id = nextId++;
    const zone = { id, chunkKey, ...interior };
    this.zones.set(id, zone);
    this.G.events.emit('zoneRegistered', zone);
    return id;
  }

  unregister(id) {
    const z = this.zones.get(id);
    if (!z) return;
    this.zones.delete(id);
    this.G.events.emit('zoneUnregistered', z);
  }

  /** zone whose interior contains pos (rough radius check on centre) */
  zoneAt(pos) {
    for (const z of this.zones.values()) {
      const dx = pos.x - z.center.x, dz = pos.z - z.center.z;
      if (dx * dx + dz * dz < z.radius * z.radius && pos.y < 4) return z;
    }
    return null;
  }

  nearest(kind, pos, maxDist = 60) {
    let best = null, bd = maxDist * maxDist;
    for (const z of this.zones.values()) {
      if (z.kind !== kind) continue;
      const dx = pos.x - z.center.x, dz = pos.z - z.center.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  byKind(kind) {
    return [...this.zones.values()].filter((z) => z.kind === kind);
  }
}

export { KIND };
