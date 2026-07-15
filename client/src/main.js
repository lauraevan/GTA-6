// GRAND THEFT AUDI — client bootstrap & game loop.

import * as THREE from 'three';
import { CFG } from './core/config.js';
import { EventBus } from './core/events.js';
import { Input } from './core/input.js';
import { AssetLibrary } from './core/assets.js';
import { SaveService } from './core/save.js';
import { RendererSys } from './engine/renderer.js';
import { CameraRig } from './engine/cameraRig.js';
import { DayNight } from './engine/daynight.js';
import { Weather } from './engine/weather.js';
import { Particles } from './engine/particles.js';
import { PhysicsWorld } from './physics/physics.js';
import { RagdollSystem } from './physics/ragdoll.js';
import { CityData } from './world/cityData.js';
import { NavGraph } from './world/navGraph.js';
import { ChunkManager } from './world/chunkManager.js';
import { ZoneRegistry } from './world/interiors.js';
import { MarkerSystem } from './world/markers.js';
import { VehicleManager } from './entities/vehicleManager.js';
import { Player } from './entities/player.js';
import { PedManager } from './entities/pedManager.js';
import { WeaponSystem } from './entities/weapons.js';
import { Pickups } from './entities/pickups.js';
import { TrafficSystem } from './ai/trafficSystem.js';
import { WantedSystem } from './ai/wantedSystem.js';
import { PoliceDirector } from './ai/policeDirector.js';
import { RobberySystem } from './gameplay/robbery.js';
import { Garage } from './gameplay/garage.js';
import { Activities } from './gameplay/activities.js';
import { MissionDirector } from './missions/missionDirector.js';
import { buildStoryMissions } from './missions/storyMissions.js';
import { HUD } from './ui/hud.js';
import { MiniMap, GPS } from './ui/minimap.js';
import { Menus } from './ui/menus.js';
import { GarageUI } from './ui/garageUI.js';
import { AudioManager } from './audio/audioManager.js';
import { MusicDirector } from './audio/musicDirector.js';

const loadingFill = document.getElementById('loading-fill');
const loadingStatus = document.getElementById('loading-status');
function progress(p, label) {
  loadingFill.style.width = `${Math.round(p * 100)}%`;
  if (label) loadingStatus.textContent = label;
}

class Game {
  constructor() {
    this.state = 'loading';
    this.settings = CFG.settings;
    this.timeScale = 1;
    this.tickers = new Set();
    this.events = new EventBus();
    this.clock = new THREE.Clock();
    this._errors = [];
  }

  async boot() {
    const canvas = document.getElementById('game');
    progress(0.05, 'reading the city plans…');
    this.city = await new CityData().load();
    this.nav = new NavGraph(this.city);

    progress(0.15, 'lighting the streets…');
    this.scene = new THREE.Scene();
    this.wetMats = new Set();
    this.input = new Input(canvas);
    this.cameraRig = new CameraRig(this);
    this.camera = this.cameraRig.camera;
    this.renderer = new RendererSys(this, canvas);
    this.renderer.buildEnvironment();
    this.daynight = new DayNight(this);
    this.weather = new Weather(this);
    this.particles = new Particles(this);

    progress(0.25, 'pouring the asphalt…');
    this.physics = new PhysicsWorld(this);
    this.ragdolls = new RagdollSystem(this);
    this.zones = new ZoneRegistry(this);
    this.markers = new MarkerSystem(this);

    progress(0.32, 'checking the model garage…');
    this.assets = new AssetLibrary();
    await this.assets.init((p) => progress(0.32 + p * 0.1));

    progress(0.45, 'building Neustadt Bay…');
    this.chunks = new ChunkManager(this);
    this.chunks.init();

    this.vehicles = new VehicleManager(this);
    this.weapons = new WeaponSystem(this);
    this.pickups = new Pickups(this);
    this.wanted = new WantedSystem(this);
    this.police = new PoliceDirector(this);
    this.peds = new PedManager(this);
    this.traffic = new TrafficSystem(this);
    this.robbery = new RobberySystem(this);
    this.garage = new Garage(this);
    this.activities = new Activities(this);
    this.missions = new MissionDirector(this);
    this.missions.register(buildStoryMissions(this));

    progress(0.6, 'tuning the radio…');
    this.audio = new AudioManager(this);
    this.music = new MusicDirector(this);
    this.gps = new GPS(this);
    this.ui = new HUD(this);
    this.menus = new Menus(this);
    this.garageUI = new GarageUI(this);
    this.save = new SaveService(this);
    await this.save.probe();

    // spawn player at the safehouse & warm the world around it
    const spawn = this.city.pois.spawn.pos;
    progress(0.7, 'moving you in…');
    this.player = new Player(this, new THREE.Vector3(spawn[0], 0, spawn[1] + 3));
    this.chunks.warmup(spawn[0], spawn[1]);
    this.pickups.initFixedSpawners();
    this.activities.init();

    // carjack hook: traffic hands the car over
    this.events.on('carjack', ({ vehicle }) => this.traffic.onCarjacked(vehicle));

    // global hotkeys
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'playing') this.setState('paused');
        else if (this.state === 'paused') this.setState('playing');
        else if (this.state === 'shop') { this.menus.close(); this.setState('playing'); }
        if (this.minimap?.bigOpen) this.minimap.toggleBig(false);
      }
      if (e.code === 'KeyM' && (this.state === 'playing')) this.minimap.toggleBig();
      if (e.code === 'F5') { e.preventDefault(); if (this.state === 'playing') this.quickSave(); }
    });

    this.minimap = new MiniMap(this);

    progress(1, 'done.');
    setTimeout(() => document.getElementById('loading').classList.add('hidden'), 250);

    this.setState('menu');
    this.menus.openMain(this.save.hasSave);
    this.renderer.renderer.setAnimationLoop(() => this.frame());

    if (CFG.autostart) {
      // smoke/CI: skip the menu, start immediately
      this.startGame(false);
    }
  }

  async quickSave() {
    const r = await this.save.save('quick');
    this.ui.toast('Quick save', r.server ? 'Server + local.' : 'Saved locally.');
  }

  applySettings() {
    this.renderer.resize();
    this.audio.applyVolumes();
    if (this.daynight) this.daynight.sun.castShadow = this.settings.quality === 'high';
  }

  setTimeScale(s) { this.timeScale = s; }

  setState(s) {
    const prev = this.state;
    this.state = s;
    switch (s) {
      case 'playing':
        this.menus.close();
        this.menus.fadeTo(false);
        this.ui.show(true);
        if (!CFG.smoke) this.input.setLockWanted(true);
        this.input.enabled = true;
        this.audio.resume();
        if (prev === 'menu') this.cameraRig.setMode(this.player.vehicle ? 'car' : 'foot');
        break;
      case 'paused':
        this.input.setLockWanted(false);
        this.menus.openPause();
        break;
      case 'shop':
        this.input.setLockWanted(false);
        break;
      case 'menu':
        this.ui.show(false);
        this.input.setLockWanted(false);
        this.cameraRig.setMode('menu');
        break;
      case 'wasted':
      case 'busted':
        this.input.setLockWanted(false);
        this.menus.fadeTo(true);
        setTimeout(() => this.menus.fadeTo(false), 4200);
        break;
    }
  }

  async startGame(fromSave) {
    this.audio.init();
    this.audio.resume();
    this.menus.close();
    if (fromSave) {
      const snap = await this.save.load();
      this.save.apply(snap);
      this.chunks.warmup(this.player.position.x, this.player.position.z);
      this.ui.toast('Welcome back', 'Save loaded.');
    } else {
      this.daynight.setHour(10.5);
    }
    if (CFG.urlHour !== null && CFG.urlHour !== undefined && CFG.urlHour !== '') {
      this.daynight.setHour(parseFloat(CFG.urlHour));
    }
    if (CFG.urlWeather) this.weather.force(CFG.urlWeather);
    this.setState('playing');
    this.cameraRig.setMode('foot');
    this.cameraRig.yaw = Math.PI * 0.75;
    this.missions.refreshGivers();
    if (!fromSave && !this.missions.completed.has('ankommen')) {
      setTimeout(() => this.missions.start('ankommen'), CFG.smoke ? 50000 : 900);
    }
    this.events.emit('gameStarted', { fromSave });

    if (CFG.smoke) this._smokeRun();
  }

  frame() {
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    const dt = rawDt * this.timeScale;
    try {
      if (this.state === 'playing' || this.state === 'wasted' || this.state === 'busted' || this.state === 'shop') {
        this.daynight.update(dt);
        this.weather.update(dt);
        this.chunks.update(dt);

        this.player.update(dt);
        this.traffic.update(dt);
        this.police.update(dt);
        this.vehicles.update(dt);
        this.physics.step(dt);

        this.peds.update(dt);
        this.wanted.update(dt);
        this.weapons.update(dt);
        this.robbery.update(dt);
        this.pickups.update(dt);
        this.missions.update(dt);
        this.activities.update(dt);
        this.markers.update(dt);
        this.ragdolls.update(dt);
        this.particles.update(dt);
        for (const t of [...this.tickers]) t(dt);

        this.cameraRig.update(rawDt);
        this.audio.update(dt);
        this.music.update();
        this.ui.update(rawDt);
        this.minimap.update(rawDt);
      } else if (this.state === 'menu') {
        this.daynight.update(dt * 4);
        this.weather.update(dt);
        this.cameraRig.update(rawDt);
        this.particles.update(dt);
      }
      this.renderer.render();
    } catch (err) {
      console.error('[frame]', err);
      this._errors.push(String(err?.stack || err));
    }
    this.input.endFrame();
  }

  /** automated smoke run for CI: drive, shoot, report readiness */
  _smokeRun() {
    const G = this;
    window.__GTA = G;
    setTimeout(() => {
      try {
        // deterministic: put player + a fresh car on the nearest road, get in
        const n = G.nav.nearestNode(G.player.position.x, G.player.position.z);
        G.player.position.set(n.x + 2.5, 0, n.z);
        G.player.body.position.set(n.x + 2.5, 1, n.z);
        G.vehicles.spawn('falke', new THREE.Vector3(n.x, 0, n.z), 0, { mode: 'parked' });
        G.player.tryEnterVehicle();
      } catch (e) { G._errors.push('smoke-enter: ' + e); }
    }, 2500);
    setTimeout(() => {
      try {
        // hold W through the real input path
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
        G.weapons.give('pistol', 24);
      } catch (e) { G._errors.push('smoke-drive: ' + e); }
    }, 4000);
    setTimeout(() => {
      try { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })); }
      catch (e) { /* ignore */ }
    }, 8600);
    setTimeout(() => {
      const report = {
        ready: true,
        errors: G._errors,
        chunks: G.chunks.loaded.size,
        peds: G.peds.peds.length,
        traffic: G.traffic.cars.length,
        driving: !!G.player.vehicle,
        pos: G.player.position.toArray(),
        speed: G.player.vehicle?.speed ?? 0,
      };
      window.__GTA_REPORT = report;
      window.__GTA_READY = G._errors.length === 0;
      console.log('GTA_SMOKE_REPORT', JSON.stringify(report));
    }, 9000);
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error('boot failed', err);
  loadingStatus.textContent = `boot failed: ${err.message}`;
  loadingFill.style.background = '#e84747';
  window.__GTA_READY = false;
  window.__GTA_REPORT = { ready: false, errors: [String(err?.stack || err)] };
});
