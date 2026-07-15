// Save/progression: REST-first (FastAPI backend) with localStorage fallback.
// Endpoints: GET/POST /api/save/{profile}, /api/leaderboard/{race}, /api/health

import { CFG } from './config.js';

const LOCAL_KEY = 'gta.save.default';

export class SaveService {
  constructor(G) {
    this.G = G;
    this.serverUp = false;
    this.hasSave = false;
  }

  async probe() {
    try {
      const res = await fetch(`${CFG.apiBase}/health`, { signal: AbortSignal.timeout(1800) });
      this.serverUp = res.ok;
    } catch (e) { this.serverUp = false; }
    // detect any existing save (either source)
    const local = this._loadLocal();
    let server = null;
    if (this.serverUp) server = await this._loadServer();
    this.hasSave = !!(local || server);
    return this.serverUp;
  }

  collect() {
    const { G } = this;
    return {
      version: 1,
      ts: Date.now(),
      player: G.player.toSave(),
      weapons: G.weapons.toSave(),
      garage: G.garage.toSave(),
      missions: G.missions.toSave(),
      activities: G.activities.toSave(),
      world: { hour: G.daynight.hour, weather: G.weather.state },
    };
  }

  apply(s) {
    if (!s) return;
    const { G } = this;
    G.player.fromSave(s.player);
    G.weapons.fromSave(s.weapons);
    G.garage.fromSave(s.garage);
    G.missions.fromSave(s.missions);
    G.activities.fromSave(s.activities);
    if (s.world) {
      G.daynight.setHour(s.world.hour ?? 10);
      if (s.world.weather) G.weather.force(s.world.weather);
    }
  }

  _loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  async _loadServer() {
    try {
      const res = await fetch(`${CFG.apiBase}/save/${CFG.profile}`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return null;
      const body = await res.json();
      return body.data ?? null;
    } catch (e) { return null; }
  }

  /** returns freshest snapshot from server/local */
  async load() {
    const local = this._loadLocal();
    const server = this.serverUp ? await this._loadServer() : null;
    if (local && server) return (server.ts ?? 0) >= (local.ts ?? 0) ? server : local;
    return server ?? local;
  }

  async save(reason = 'auto') {
    const { G } = this;
    if (!G.player) return { local: false, server: false };
    const snap = this.collect();
    let localOk = false;
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(snap));
      localOk = true;
    } catch (e) { /* storage full/blocked */ }
    let serverOk = false;
    if (this.serverUp) {
      try {
        const res = await fetch(`${CFG.apiBase}/save/${CFG.profile}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: snap, reason }),
          signal: AbortSignal.timeout(3000),
        });
        serverOk = res.ok;
      } catch (e) { serverOk = false; }
    }
    this.hasSave = true;
    return { local: localOk, server: serverOk };
  }

  async postLeaderboard(raceId, ms) {
    if (!this.serverUp) return false;
    try {
      const res = await fetch(`${CFG.apiBase}/leaderboard/${encodeURIComponent(raceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: CFG.profile, ms }),
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (e) { return false; }
  }

  async getLeaderboard(raceId, limit = 10) {
    if (!this.serverUp) return [];
    try {
      const res = await fetch(`${CFG.apiBase}/leaderboard/${encodeURIComponent(raceId)}?limit=${limit}`,
        { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return [];
      return (await res.json()).entries ?? [];
    } catch (e) { return []; }
  }
}
