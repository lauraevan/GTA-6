// Road network graph used by traffic, police and GPS routing.
// Nodes at intersections; edges are straight road segments with type/speed.

const LANE_OFFSETS = { 0: [2.6], 1: [2.4, 5.2], 2: [2.9, 6.1] }; // per road type

export class NavGraph {
  constructor(city) {
    this.city = city;
    this.nodes = city.nav.nodes.map(([x, z], id) => ({ id, x, z }));
    this.adj = this.nodes.map(() => []);
    this.edges = [];
    for (const [a, b, t] of city.nav.edges) {
      const e = {
        id: this.edges.length, a, b, t,
        speed: city.roadSpeed(t),
        len: Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z),
      };
      this.edges.push(e);
      this.adj[a].push(e);
      this.adj[b].push(e);
    }
    // spatial hash for nearestNode
    this.cell = 60;
    this.hash = new Map();
    for (const n of this.nodes) {
      const key = this._key(n.x, n.z);
      if (!this.hash.has(key)) this.hash.set(key, []);
      this.hash.get(key).push(n);
    }
  }

  _key(x, z) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }

  nearestNode(x, z) {
    let best = null, bd = Infinity;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let r = 0; r < 6; r++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        for (let iz = cz - r; iz <= cz + r; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== r) continue;
          const bucket = this.hash.get(`${ix},${iz}`);
          if (!bucket) continue;
          for (const n of bucket) {
            const d = (n.x - x) ** 2 + (n.z - z) ** 2;
            if (d < bd) { bd = d; best = n; }
          }
        }
      }
      if (best && r >= 1) break;
    }
    return best;
  }

  otherEnd(edge, nodeId) { return edge.a === nodeId ? edge.b : edge.a; }

  /** A* shortest path (time-weighted). Returns array of node ids or null. */
  path(fromId, toId) {
    if (fromId === toId) return [fromId];
    const open = new Map([[fromId, 0]]);
    const g = new Map([[fromId, 0]]);
    const came = new Map();
    const h = (id) => {
      const n = this.nodes[id], t = this.nodes[toId];
      return Math.hypot(n.x - t.x, n.z - t.z) / 30;
    };
    const f = new Map([[fromId, h(fromId)]]);
    let guard = 0;
    while (open.size && guard++ < 4000) {
      let cur = null, best = Infinity;
      for (const [id] of open) {
        const fv = f.get(id) ?? Infinity;
        if (fv < best) { best = fv; cur = id; }
      }
      if (cur === toId) {
        const path = [cur];
        while (came.has(cur)) { cur = came.get(cur); path.push(cur); }
        return path.reverse();
      }
      open.delete(cur);
      for (const e of this.adj[cur]) {
        const nb = this.otherEnd(e, cur);
        const ng = g.get(cur) + e.len / e.speed;
        if (ng < (g.get(nb) ?? Infinity)) {
          came.set(nb, cur);
          g.set(nb, ng);
          f.set(nb, ng + h(nb));
          open.set(nb, ng);
        }
      }
    }
    return null;
  }

  /** route as world points [[x,z],...] */
  routePoints(fromX, fromZ, toX, toZ) {
    const a = this.nearestNode(fromX, fromZ);
    const b = this.nearestNode(toX, toZ);
    if (!a || !b) return null;
    const ids = this.path(a.id, b.id);
    if (!ids) return null;
    const pts = ids.map((id) => [this.nodes[id].x, this.nodes[id].z]);
    pts.push([toX, toZ]);
    return pts;
  }

  /** pick a next edge continuing a walk, avoiding U-turns when possible */
  nextEdge(nodeId, fromEdge, rand = Math.random) {
    const options = this.adj[nodeId].filter((e) => e !== fromEdge);
    if (!options.length) return fromEdge;
    // prefer continuing straight-ish
    return options[(rand() * options.length) | 0];
  }

  laneOffset(type, lane = 0) {
    const o = LANE_OFFSETS[type] || LANE_OFFSETS[0];
    return o[Math.min(lane, o.length - 1)];
  }

  /** random edge whose midpoint is within [rMin,rMax] of (x,z) */
  randomEdgeNear(x, z, rMin, rMax, rand = Math.random) {
    for (let tries = 0; tries < 40; tries++) {
      const e = this.edges[(rand() * this.edges.length) | 0];
      const na = this.nodes[e.a], nb = this.nodes[e.b];
      const mx = (na.x + nb.x) / 2, mz = (na.z + nb.z) / 2;
      const d = Math.hypot(mx - x, mz - z);
      if (d >= rMin && d <= rMax) return e;
    }
    return null;
  }
}
