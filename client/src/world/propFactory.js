// Street furniture: instanced per-chunk props + bespoke traffic lights,
// billboards, cranes and stunt ramps.

import * as THREE from 'three';
import { PROP } from './cityData.js';
import { canvasTexture } from '../core/assets.js';

const ADS = [
  ['ADLER MOTORS', 'DRIVE THE STORM', '#e8b437', '#15181f'],
  ['NACHTWELLE 103.7', 'NEUSTADT NIGHTS', '#c583e8', '#131022'],
  ['BOLT & BARREL', 'SPORTING GOODS', '#e8a25c', '#1a150f'],
  ['KESTREL', 'PURE MUSCLE', '#e84747', '#16090b'],
  ['MERIDIAN BANK', 'YOUR MONEY. SAFE.*', '#ffd700', '#101418'],
];

export class PropFactory {
  constructor(G) {
    this.G = G;
    this.mats = {
      pole: new THREE.MeshStandardMaterial({ color: '#4a4e55', metalness: 0.6, roughness: 0.5 }),
      lampHead: new THREE.MeshStandardMaterial({ color: '#dedbc8', emissive: '#ffedb0', emissiveIntensity: 0 }),
      trunk: new THREE.MeshStandardMaterial({ color: '#5e4630', roughness: 0.95 }),
      canopy: new THREE.MeshStandardMaterial({ color: '#3f7a38', roughness: 0.95 }),
      canopy2: new THREE.MeshStandardMaterial({ color: '#57883f', roughness: 0.95 }),
      hydrant: new THREE.MeshStandardMaterial({ color: '#b03030', roughness: 0.6 }),
      bench: new THREE.MeshStandardMaterial({ color: '#6e5638', roughness: 0.85 }),
      hay: new THREE.MeshStandardMaterial({ color: '#c2a44a', roughness: 1 }),
      dumpster: new THREE.MeshStandardMaterial({ color: '#3e5e3e', roughness: 0.8, metalness: 0.3 }),
      meter: new THREE.MeshStandardMaterial({ color: '#5a5e66', metalness: 0.5, roughness: 0.5 }),
      containerCols: ['#b34d33', '#33688a', '#7a8a33', '#8a5f33', '#557'].map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, metalness: 0.25 })),
    };
    this.G.daynight?.registerLamp(this.mats.lampHead);

    this.geo = {
      pole: new THREE.CylinderGeometry(0.07, 0.1, 5.4, 6).translate(0, 2.7, 0),
      lampArm: new THREE.BoxGeometry(0.08, 0.08, 1.4).translate(0, 5.25, 0.6),
      lampHead: new THREE.BoxGeometry(0.34, 0.14, 0.6).translate(0, 5.2, 1.15),
      trunk: new THREE.CylinderGeometry(0.14, 0.2, 2.2, 6).translate(0, 1.1, 0),
      canopy: new THREE.IcosahedronGeometry(1.6, 0).translate(0, 3.1, 0),
      hydrant: new THREE.CylinderGeometry(0.16, 0.2, 0.75, 8).translate(0, 0.37, 0),
      bench: new THREE.BoxGeometry(1.8, 0.1, 0.5).translate(0, 0.45, 0),
      benchLegs: new THREE.BoxGeometry(1.6, 0.45, 0.4).translate(0, 0.22, 0),
      hay: new THREE.CylinderGeometry(0.7, 0.7, 1.3, 8).rotateZ(Math.PI / 2).translate(0, 0.7, 0),
      container: new THREE.BoxGeometry(2.4, 2.5, 6).translate(0, 1.25, 0),
      dumpster: new THREE.BoxGeometry(1.7, 1.2, 1.0).translate(0, 0.6, 0),
      meter: new THREE.CylinderGeometry(0.04, 0.04, 1.1, 5).translate(0, 0.55, 0),
    };
  }

  /**
   * Build instanced props for a chunk. Returns {meshes, colliders, trafficLights}
   */
  buildChunkProps(props) {
    const buckets = new Map();
    const bespoke = [];
    for (const p of props) {
      if (p[2] === PROP.TRAFFICLIGHT || p[2] === PROP.CRANE || p[2] === PROP.BILLBOARD) {
        bespoke.push(p);
      } else {
        if (!buckets.has(p[2])) buckets.set(p[2], []);
        buckets.get(p[2]).push(p);
      }
    }

    const meshes = [], colliders = [], trafficLights = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const inst = (geo, mat, list, each) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = this.G.settings.quality === 'high';
      list.forEach((p, i) => {
        q.setFromEuler(new THREE.Euler(0, (p[3] || 0) * Math.PI / 2, 0));
        m4.compose(new THREE.Vector3(p[0], 0, p[1]), q, new THREE.Vector3(1, 1, 1));
        im.setMatrixAt(i, m4);
        each?.(p);
      });
      meshes.push(im);
    };

    for (const [type, list] of buckets) {
      switch (type) {
        case PROP.STREETLIGHT:
          inst(this.geo.pole, this.mats.pole, list,
            (p) => colliders.push({ x: p[0], y: 0, z: p[1], sx: 0.24, sy: 5.2, sz: 0.24, ry: 0 }));
          inst(this.geo.lampArm, this.mats.pole, list);
          inst(this.geo.lampHead, this.mats.lampHead, list);
          break;
        case PROP.TREE: {
          inst(this.geo.trunk, this.mats.trunk, list,
            (p) => colliders.push({ x: p[0], y: 0, z: p[1], sx: 0.4, sy: 2.4, sz: 0.4, ry: 0 }));
          // vary canopy material by position hash
          const a = list.filter((p) => ((p[0] * 7 + p[1] * 13) | 0) % 2 === 0);
          const b = list.filter((p) => ((p[0] * 7 + p[1] * 13) | 0) % 2 !== 0);
          if (a.length) inst(this.geo.canopy, this.mats.canopy, a);
          if (b.length) inst(this.geo.canopy, this.mats.canopy2, b);
          break;
        }
        case PROP.HYDRANT: inst(this.geo.hydrant, this.mats.hydrant, list); break;
        case PROP.BENCH:
          inst(this.geo.bench, this.mats.bench, list);
          inst(this.geo.benchLegs, this.mats.pole, list);
          break;
        case PROP.HAY: inst(this.geo.hay, this.mats.hay, list); break;
        case PROP.CONTAINER: {
          // split by colour via hash
          const groups = new Map();
          for (const p of list) {
            const gi = Math.abs((p[0] * 31 + p[1] * 17) | 0) % this.mats.containerCols.length;
            if (!groups.has(gi)) groups.set(gi, []);
            groups.get(gi).push(p);
          }
          for (const [gi, g] of groups) {
            inst(this.geo.container, this.mats.containerCols[gi], g, (p) =>
              colliders.push({ x: p[0], y: 0, z: p[1], sx: 2.4, sy: 2.5, sz: 6, ry: (p[3] || 0) * Math.PI / 2 }));
          }
          break;
        }
        case PROP.DUMPSTER:
          inst(this.geo.dumpster, this.mats.dumpster, list, (p) =>
            colliders.push({ x: p[0], y: 0, z: p[1], sx: 1.7, sy: 1.2, sz: 1.0, ry: (p[3] || 0) * Math.PI / 2 }));
          break;
        case PROP.PARKMETER: inst(this.geo.meter, this.mats.meter, list); break;
      }
    }

    for (const p of bespoke) {
      if (p[2] === PROP.TRAFFICLIGHT) {
        const g = this.buildTrafficLight(p);
        meshes.push(g.group);
        colliders.push({ x: p[0], y: 0, z: p[1], sx: 0.24, sy: 5.6, sz: 0.24, ry: 0 });
        trafficLights.push(g);
      } else if (p[2] === PROP.CRANE) {
        const g = this.buildCrane(p);
        meshes.push(g);
        colliders.push({ x: p[0], y: 0, z: p[1], sx: 2.2, sy: 20, sz: 2.2, ry: 0 });
      } else if (p[2] === PROP.BILLBOARD) {
        const g = this.buildBillboard(p);
        meshes.push(g);
        colliders.push({ x: p[0], y: 0, z: p[1], sx: 0.6, sy: 8, sz: 0.6, ry: 0 });
      }
    }

    return { meshes, colliders, trafficLights };
  }

  buildTrafficLight(p) {
    const group = new THREE.Group();
    group.position.set(p[0], 0, p[1]);
    group.rotation.y = (p[3] || 0) * Math.PI / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.6, 6), this.mats.pole);
    pole.position.y = 2.8;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.05, 0.3),
      new THREE.MeshStandardMaterial({ color: '#22252a' }));
    head.position.set(0, 5.0, 0.25);
    const mkLamp = (y, c) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8),
        new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15 }));
      m.position.set(0, y, 0.42);
      return m;
    };
    const red = mkLamp(5.32, '#c22'), amber = mkLamp(5.0, '#ca2'), green = mkLamp(4.68, '#2a3');
    group.add(pole, head, red, amber, green);
    return { group, pos: new THREE.Vector2(p[0], p[1]), red: red.material, amber: amber.material, green: green.material };
  }

  buildCrane(p) {
    const group = new THREE.Group();
    group.position.set(p[0], 0, p[1]);
    group.rotation.y = (p[3] || 0) * Math.PI / 2 + 0.4;
    const mat = new THREE.MeshStandardMaterial({ color: '#c8a428', roughness: 0.6, metalness: 0.4 });
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 20, 1.6), mat);
    tower.position.y = 10;
    const jib = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 16), mat);
    jib.position.set(0, 19.5, 6);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 3), mat);
    counter.position.set(0, 19.3, -4);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8), this.mats.pole);
    cable.position.set(0, 15, 11);
    group.add(tower, jib, counter, cable);
    return group;
  }

  buildBillboard(p) {
    const ad = ADS[Math.abs((p[0] * 13 + p[1] * 7) | 0) % ADS.length];
    const tex = canvasTexture(512, 256, (ctx, w, h) => {
      ctx.fillStyle = ad[3]; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = ad[2]; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = ad[2]; ctx.textAlign = 'center';
      ctx.font = 'bold 54px Arial Black, Arial';
      ctx.fillText(ad[0], w / 2, h / 2 - 12);
      ctx.font = '26px Arial';
      ctx.fillStyle = '#d8d8d8';
      ctx.fillText(ad[1], w / 2, h / 2 + 36);
    });
    const group = new THREE.Group();
    group.position.set(p[0], 0, p[1]);
    group.rotation.y = (p[3] || 0) * Math.PI / 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 8, 8), this.mats.pole);
    pole.position.y = 4;
    const boardMat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0 });
    this.G.daynight?.registerLamp(boardMat);
    const board = new THREE.Mesh(new THREE.BoxGeometry(9, 4.5, 0.3), boardMat);
    board.position.y = 9.5;
    group.add(pole, board);
    return group;
  }

  /** stunt ramp: mesh + collider boxes (angled) */
  buildRamp(x, z, ryQuarter) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const ry = ryQuarter * Math.PI / 2;
    group.rotation.y = ry;
    const mat = new THREE.MeshStandardMaterial({ color: '#c8b028', roughness: 0.6, metalness: 0.3 });
    const stripes = new THREE.MeshStandardMaterial({ color: '#22252a', roughness: 0.7 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.3, 7), mat);
    const tilt = 0.38;
    deck.rotation.x = tilt;
    deck.position.set(0, 1.15, 0);
    const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 7), stripes);
    side1.rotation.x = tilt; side1.position.set(-2.2, 1.3, 0);
    const side2 = side1.clone(); side2.position.x = 2.2;
    group.add(deck, side1, side2);
    // collider: same angled box
    return {
      group,
      collider: { x, y: 1.15, z, sx: 4.4, sy: 0.3, sz: 7, ry, rx: tilt },
    };
  }
}
