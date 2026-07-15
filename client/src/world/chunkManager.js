// Streams the city in 240 m chunks around the player: instanced buildings,
// bespoke POI buildings with interiors, road overlays, props, physics bodies,
// parked cars. Also owns the global ground, water, distant skyline and ramps.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from '../physics/physics.js';
import { BuildingFactory, STYLE } from './buildingFactory.js';
import { RoadFactory } from './roadFactory.js';
import { PropFactory } from './propFactory.js';
import { KIND } from './cityData.js';

const SPECIAL_KINDS = new Set([
  KIND.SHOP, KIND.BANK, KIND.POLICE, KIND.HOSPITAL, KIND.SAFEHOUSE,
  KIND.GARAGE, KIND.GUNSHOP, KIND.SPRAY,
]);

export class ChunkManager {
  constructor(G) {
    this.G = G;
    this.buildings = new BuildingFactory(G);
    this.roads = new RoadFactory(G);
    this.props = new PropFactory(G);
    this.loaded = new Map();   // key -> {group, bodies, disposables, interiors, trafficLights}
    this.queue = [];
    this.trafficLights = [];
  }

  init() {
    const { G } = this;
    const city = G.city;

    // outer terrain
    const outer = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshStandardMaterial({ color: '#55693f', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.05;
    G.scene.add(outer);

    // city ground with baked district/road texture
    const groundTex = this.roads.buildGroundTexture();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(city.meta.worldSize, city.meta.worldSize),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.0;
    ground.receiveShadow = true;
    G.scene.add(ground);

    // water strip (west marina)
    const waterW = city.linePos(3) - (-city.half);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: '#2a7a9a', transparent: true, opacity: 0.82, roughness: 0.2, metalness: 0.4 });
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(waterW, city.meta.worldSize), this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(-city.half + waterW / 2, 0.14, 0);
    G.scene.add(water);
    this.waterT = 0;

    // distant skyline: all tall buildings as one dark instanced mesh
    const talls = [];
    for (const c of city.chunkMap.values()) {
      for (const b of c.b) if (b[4] >= 28) talls.push(b);
    }
    const skyMat = new THREE.MeshBasicMaterial({ color: '#4a5262' });
    const skyline = new THREE.InstancedMesh(this.buildings.boxGeo, skyMat, talls.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    talls.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(0, b[5] * Math.PI / 2, 0));
      m4.compose(new THREE.Vector3(b[0], 0, b[1]), q, new THREE.Vector3(b[2] * 0.96, b[4] * 0.985, b[3] * 0.96));
      skyline.setMatrixAt(i, m4);
    });
    G.scene.add(skyline);

    // stunt ramps (always loaded, they're few)
    for (const s of city.pois.stunts) {
      const r = this.props.buildRamp(s[0], s[1], s[2]);
      G.scene.add(r.group);
      const c = r.collider;
      const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(c.sx / 2, c.sy / 2, c.sz / 2)),
        position: new CANNON.Vec3(c.x, c.y, c.z),
      });
      body.quaternion.setFromEuler(c.rx, c.ry, 0);
      body.collisionFilterGroup = GROUP.STATIC;
      body.userData = { kind: 'ramp' };
      G.physics.addBody(body);
    }
  }

  key(cx, cz) { return `${cx},${cz}`; }

  /** synchronously build the ring around a position (boot/teleport) */
  warmup(x, z) {
    const [cx, cz] = this.G.city.chunkCoords(x, z);
    const r = this.G.settings.drawDistance;
    for (let iz = cz - r; iz <= cz + r; iz++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        this.ensureChunk(ix, iz, true);
      }
    }
  }

  ensureChunk(cx, cz, now = false) {
    const city = this.G.city;
    if (cx < 0 || cz < 0 || cx >= city.nChunks || cz >= city.nChunks) return;
    const k = this.key(cx, cz);
    if (this.loaded.has(k) || this.queue.find((q) => q.k === k)) return;
    if (now) this.buildChunk(cx, cz);
    else this.queue.push({ k, cx, cz });
  }

  update(dt) {
    const { G } = this;
    this.waterT += dt;
    this.waterMat.opacity = 0.78 + Math.sin(this.waterT * 0.8) * 0.05;

    const p = G.player?.position;
    if (!p) return;
    const [cx, cz] = G.city.chunkCoords(p.x, p.z);
    const r = G.settings.drawDistance;

    for (let iz = cz - r; iz <= cz + r; iz++) {
      for (let ix = cx - r; ix <= cx + r; ix++) {
        this.ensureChunk(ix, iz);
      }
    }
    // build one queued chunk per frame, nearest first
    if (this.queue.length) {
      this.queue.sort((a, b) =>
        (Math.abs(a.cx - cx) + Math.abs(a.cz - cz)) - (Math.abs(b.cx - cx) + Math.abs(b.cz - cz)));
      const job = this.queue.shift();
      if (!this.loaded.has(job.k)) this.buildChunk(job.cx, job.cz);
    }
    // unload far chunks (hysteresis +1)
    for (const [k, chunk] of this.loaded) {
      const [ix, iz] = k.split(',').map(Number);
      if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) > r + 1) {
        this.unloadChunk(k, chunk);
      }
    }
  }

  isLoadedAt(x, z) {
    const [cx, cz] = this.G.city.chunkCoords(x, z);
    return this.loaded.has(this.key(cx, cz));
  }

  buildChunk(cx, cz) {
    const { G } = this;
    const data = G.city.chunkAt(cx, cz);
    const k = this.key(cx, cz);
    const group = new THREE.Group();
    const bodies = [], disposables = [], interiors = [], lights = [];

    const addCollider = (c, userData) => {
      const body = G.physics.addStaticBox(
        c.x, c.y + c.sy / 2, c.z, c.sx, c.sy, c.sz, c.ry || 0, userData);
      bodies.push(body);
    };

    // --- roads + curbs
    const roadRes = this.roads.buildChunkRoads(cx, cz);
    for (const m of roadRes.meshes) { group.add(m); disposables.push(m.geometry); }
    for (const c of roadRes.colliders) addCollider(c, { kind: 'curb' });

    if (data) {
      // --- buildings
      const byStyle = new Map();
      for (const b of data.b) {
        const kind = b[7];
        if (SPECIAL_KINDS.has(kind)) {
          const built = this.buildings.buildSpecial(b);
          group.add(built.group);
          for (const c of built.colliders) addCollider(c, { kind: 'building' });
          if (built.interior) {
            const handle = G.zones?.register(built.interior, k);
            if (handle) interiors.push(handle);
          }
        } else {
          const style = b[6];
          if (!byStyle.has(style)) byStyle.set(style, []);
          byStyle.get(style).push(b);
          addCollider({ x: b[0], y: 0, z: b[1], sx: b[2], sy: b[4], sz: b[3], ry: b[5] * Math.PI / 2 },
            { kind: 'building' });
        }
      }
      for (const [style, list] of byStyle) {
        for (const m of this.buildings.makeInstanced(style, list)) {
          group.add(m);
          disposables.push(m); // InstancedMesh.dispose frees instance buffers
        }
      }

      // --- props
      const propRes = this.props.buildChunkProps(data.p);
      for (const m of propRes.meshes) {
        group.add(m.isObject3D ? m : m.group);
        if (m.isInstancedMesh) disposables.push(m);
      }
      for (const c of propRes.colliders) addCollider(c, { kind: 'prop' });
      for (const tl of propRes.trafficLights) { lights.push(tl); this.trafficLights.push(tl); }
    }

    G.scene.add(group);
    this.loaded.set(k, { group, bodies, disposables, interiors, lights });

    // parked cars
    G.vehicles?.onChunkLoad(cx, cz, data);
  }

  unloadChunk(k, chunk) {
    const { G } = this;
    G.scene.remove(chunk.group);
    for (const b of chunk.bodies) G.physics.removeBody(b);
    for (const d of chunk.disposables) d.dispose?.();
    for (const h of chunk.interiors) G.zones?.unregister(h);
    for (const tl of chunk.lights) {
      const i = this.trafficLights.indexOf(tl);
      if (i >= 0) this.trafficLights.splice(i, 1);
    }
    this.loaded.delete(k);
    const [cx, cz] = k.split(',').map(Number);
    G.vehicles?.onChunkUnload(cx, cz);
  }
}
