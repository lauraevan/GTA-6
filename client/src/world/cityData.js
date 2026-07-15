// Loads and indexes the city layout JSON produced by server/worldgen/citygen.py.
// The client only consumes this data — generation logic lives in Python.

import { CFG } from '../core/config.js';

export const DISTRICT = {
  WATER: 0, DOWNTOWN: 1, COMMERCIAL: 2, RESIDENTIAL: 3, INDUSTRIAL: 4, RURAL: 5, PARK: 6, BEACH: 7,
};
export const DISTRICT_NAMES = {
  0: 'Neustadt Bay', 1: 'Innenstadt', 2: 'Marktviertel', 3: 'Gartenstadt',
  4: 'Hafen Docks', 5: 'Umland', 6: 'Stadtpark', 7: 'Strandpromenade',
};
export const KIND = {
  GENERIC: 0, SHOP: 1, BANK: 2, POLICE: 3, HOSPITAL: 4, SAFEHOUSE: 5,
  GARAGE: 6, GUNSHOP: 7, SPRAY: 8, WAREHOUSE: 9, HOUSE: 10, FARM: 11,
};
export const PROP = {
  STREETLIGHT: 0, TRAFFICLIGHT: 1, TREE: 2, HYDRANT: 3, BENCH: 4, CONTAINER: 5,
  CRANE: 6, HAY: 7, DUMPSTER: 8, BILLBOARD: 9, PARKMETER: 10,
};

export class CityData {
  async load() {
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed');
    let data = null;
    if (seed) {
      try {
        const res = await fetch(`${CFG.apiBase}/world?seed=${encodeURIComponent(seed)}`,
          { signal: AbortSignal.timeout(4000) });
        if (res.ok) data = await res.json();
      } catch (e) { console.warn('[city] server worldgen unavailable, using bundled city'); }
    }
    if (!data) {
      const res = await fetch('world/city.json');
      if (!res.ok) throw new Error('city.json missing — run server/worldgen/citygen.py');
      data = await res.json();
    }

    this.meta = data.meta;
    this.districts = data.districts;   // [bz][bx]
    this.roads = data.roads;           // merged runs
    this.nav = data.nav;
    this.pois = data.pois;
    this.half = this.meta.worldSize / 2;
    this.blockSize = this.meta.blockSize;
    this.chunkSize = this.meta.chunkSize;
    this.nChunks = this.meta.blocks / this.meta.chunkBlocks;

    this.chunkMap = new Map();
    for (const c of data.chunks) this.chunkMap.set(`${c.cx},${c.cz}`, c);
    return this;
  }

  chunkAt(cx, cz) { return this.chunkMap.get(`${cx},${cz}`) || null; }

  chunkCoords(x, z) {
    return [
      Math.floor((x + this.half) / this.chunkSize),
      Math.floor((z + this.half) / this.chunkSize),
    ];
  }

  districtAt(x, z) {
    const bx = Math.floor((x + this.half) / this.blockSize);
    const bz = Math.floor((z + this.half) / this.blockSize);
    if (bx < 0 || bz < 0 || bx >= this.meta.blocks || bz >= this.meta.blocks) return DISTRICT.RURAL;
    return this.districts[bz][bx];
  }

  districtName(x, z) { return DISTRICT_NAMES[this.districtAt(x, z)] ?? ''; }

  linePos(i) { return -this.half + i * this.blockSize; }

  roadHalf(type) { return this.meta.roadHalf[String(type)]; }
  roadSpeed(type) { return this.meta.roadSpeed[String(type)]; }

  /** water strip on the west edge (x below the marina line) */
  get waterEdgeX() { return this.linePos(3); }
  isWaterAt(x, z) { return this.districtAt(x, z) === DISTRICT.WATER; }
}
