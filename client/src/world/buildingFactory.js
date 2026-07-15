// Procedural building construction: instanced tower/house styles with emissive
// night windows, plus bespoke "special" buildings (shops, bank, police, garage,
// safehouse …) that have real enterable ground-floor interiors.

import * as THREE from 'three';
import { canvasTexture, noise2d } from '../core/assets.js';
import { KIND } from './cityData.js';

export const STYLE = {
  GLASS_A: 0, GLASS_B: 1, OFFICE: 2, BRICK: 3, CONCRETE: 4, SHOPFRONT: 5,
  HOUSE_A: 6, HOUSE_B: 7, WAREHOUSE: 8, CIVIC: 9,
};

const STYLE_DEFS = {
  [STYLE.GLASS_A]:  { base: '#2e4a56', win: '#9adfe8', lit: '#ffe9b0', cols: 6, rows: 10, winP: 0.92, litP: 0.42 },
  [STYLE.GLASS_B]:  { base: '#26304a', win: '#a8c4f0', lit: '#ffd98a', cols: 5, rows: 9, winP: 0.9, litP: 0.38 },
  [STYLE.OFFICE]:   { base: '#6b6f76', win: '#3a4550', lit: '#ffedb8', cols: 5, rows: 8, winP: 0.8, litP: 0.3 },
  [STYLE.BRICK]:    { base: '#7a4a38', win: '#2c3038', lit: '#ffdf9a', cols: 4, rows: 5, winP: 0.7, litP: 0.35 },
  [STYLE.CONCRETE]: { base: '#8d8a82', win: '#333c44', lit: '#fff0c0', cols: 4, rows: 6, winP: 0.75, litP: 0.3 },
  [STYLE.SHOPFRONT]:{ base: '#a89a88', win: '#40484e', lit: '#ffe9b0', cols: 3, rows: 3, winP: 0.85, litP: 0.5 },
  [STYLE.HOUSE_A]:  { base: '#c9bfa8', win: '#3a4148', lit: '#ffe9b0', cols: 3, rows: 2, winP: 0.75, litP: 0.45 },
  [STYLE.HOUSE_B]:  { base: '#9ab0a2', win: '#3a4148', lit: '#ffe9b0', cols: 3, rows: 2, winP: 0.75, litP: 0.45 },
  [STYLE.WAREHOUSE]:{ base: '#7d8288', win: '#454a50', lit: '#cfe0ff', cols: 5, rows: 2, winP: 0.4, litP: 0.2 },
  [STYLE.CIVIC]:    { base: '#b0a790', win: '#404a55', lit: '#ffe9b0', cols: 5, rows: 3, winP: 0.85, litP: 0.4 },
};

export class BuildingFactory {
  constructor(G) {
    this.G = G;
    this.styleMats = new Map();
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.boxGeo.translate(0, 0.5, 0);
    this.roofGeo = this._makeRoofGeo();
    this.signCache = new Map();
  }

  _makeRoofGeo() {
    // triangular prism roof for houses, unit footprint, height 0.5
    const g = new THREE.BufferGeometry();
    const v = [
      // front triangle (+z)
      -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 0.5, 0.5,
      // back triangle
      0.5, 0, -0.5, -0.5, 0, -0.5, 0, 0.5, -0.5,
      // left slope
      -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 0.5, 0.5,
      -0.5, 0, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5,
      // right slope
      0.5, 0, 0.5, 0.5, 0, -0.5, 0, 0.5, -0.5,
      0.5, 0, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }

  /** shared wall/roof materials for an instanced style */
  materials(style) {
    if (this.styleMats.has(style)) return this.styleMats.get(style);
    const def = STYLE_DEFS[style];
    const draw = (litOnly) => (ctx, w, h) => {
      ctx.fillStyle = litOnly ? '#000' : def.base;
      ctx.fillRect(0, 0, w, h);
      if (!litOnly) noise2d(ctx, w, h, 0.05, 500);
      const cw = w / def.cols, ch = h / def.rows;
      let s = 12345 + style * 999;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let r = 0; r < def.rows; r++) {
        for (let c = 0; c < def.cols; c++) {
          if (rnd() > def.winP) continue;
          const lit = rnd() < def.litP;
          if (litOnly && !lit) continue;
          ctx.fillStyle = litOnly ? def.lit : (lit ? def.win : def.win);
          const pad = 0.22;
          ctx.fillRect(c * cw + cw * pad, r * ch + ch * pad, cw * (1 - 2 * pad), ch * (1 - 2 * pad));
        }
      }
    };
    const map = canvasTexture(128, 256, draw(false));
    const emissiveMap = canvasTexture(128, 256, draw(true));
    const wall = new THREE.MeshStandardMaterial({
      map, emissiveMap, emissive: new THREE.Color('#ffe9b0'),
      emissiveIntensity: 0, roughness: 0.85, metalness: style <= 1 ? 0.35 : 0.05,
    });
    const roof = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.95 });
    this.G.daynight?.registerEmissive(wall);
    const set = { wall, roof, array: [wall, wall, roof, roof, wall, wall] };
    this.styleMats.set(style, set);
    return set;
  }

  /** Instanced meshes for a list of plain buildings (same style). */
  makeInstanced(style, entries) {
    const mats = this.materials(style);
    const isHouse = style === STYLE.HOUSE_A || style === STYLE.HOUSE_B;
    const mesh = new THREE.InstancedMesh(this.boxGeo, mats.array, entries.length);
    mesh.castShadow = this.G.settings.quality === 'high';
    mesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const meshes = [mesh];
    let roofMesh = null;
    if (isHouse) {
      roofMesh = new THREE.InstancedMesh(this.roofGeo,
        new THREE.MeshStandardMaterial({ color: style === STYLE.HOUSE_A ? '#7a3b2e' : '#54555e', roughness: 0.9 }),
        entries.length);
      roofMesh.castShadow = mesh.castShadow;
      meshes.push(roofMesh);
    }
    entries.forEach((b, i) => {
      const [x, z, w, d, h, ry] = b;
      q.setFromEuler(new THREE.Euler(0, ry * Math.PI / 2, 0));
      m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(w, h, d));
      mesh.setMatrixAt(i, m4);
      if (roofMesh) {
        m4.compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(w * 1.08, Math.min(w, d) * 0.55, d * 1.08));
        roofMesh.setMatrixAt(i, m4);
      }
    });
    return meshes;
  }

  signTexture(text, fg = '#ffe9b0', bg = '#15181f') {
    const key = `${text}|${fg}`;
    if (this.signCache.has(key)) return this.signCache.get(key);
    const tex = canvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = fg; ctx.lineWidth = 6; ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = fg;
      ctx.font = 'bold 56px Arial Black, Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 2);
    });
    this.signCache.set(key, tex);
    return tex;
  }

  /**
   * Bespoke special building with ground-floor interior.
   * entry: [x,z,w,d,h,ry,style,kind]; returns {group, colliders, interior}
   * colliders: world-space {x,y,z,sx,sy,sz,ry}
   */
  buildSpecial(entry) {
    const [x, z, w, d, h, ryq, style, kind] = entry;
    const ry = ryq * Math.PI / 2;
    const G = this.G;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = ry;

    const def = STYLE_DEFS[style] ?? STYLE_DEFS[STYLE.CIVIC];
    const wallMat = new THREE.MeshStandardMaterial({ color: def.base, roughness: 0.9 });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.8 });
    const floorMat = new THREE.MeshStandardMaterial({ color: '#5a5348', roughness: 0.95 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#89b8cc', roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.45 });

    const colliders = [];
    const addBox = (bx, by, bz, sx, sy, sz, mat = wallMat, collide = true) => {
      const m = new THREE.Mesh(this.boxGeo, mat);
      m.position.set(bx, by, bz);
      m.scale.set(sx, sy, sz);
      m.receiveShadow = true;
      group.add(m);
      if (collide) {
        // convert local -> world for the physics box (group only yaw-rotates)
        const cos = Math.cos(ry), sin = Math.sin(ry);
        colliders.push({
          x: x + bx * cos + bz * sin, y: by, z: z - bx * sin + bz * cos,
          sx, sy, sz, ry,
        });
      }
      return m;
    };

    const GF = 3.4;                    // ground floor height
    const doorW = 2.6, doorH = 2.8;
    const halfW = w / 2, halfD = d / 2;

    // upper storeys as one textured block
    if (h > GF + 1) {
      const mats = this.materials(style);
      const upper = new THREE.Mesh(this.boxGeo, mats.array);
      upper.position.set(0, GF, 0);
      upper.scale.set(w, h - GF, d);
      upper.castShadow = G.settings.quality === 'high';
      group.add(upper);
      const cos = Math.cos(ry), sin = Math.sin(ry);
      colliders.push({ x, y: GF, z, sx: w, sy: h - GF, sz: d, ry, base: GF });
    }

    // ground floor shell: front wall (+z local) with door opening
    const t = 0.3; // wall thickness
    const segW = (w - doorW) / 2;
    addBox(-(doorW / 2 + segW / 2), 0, halfD - t / 2, segW, GF, t);
    addBox(doorW / 2 + segW / 2, 0, halfD - t / 2, segW, GF, t);
    addBox(0, doorH, halfD - t / 2, doorW, GF - doorH, t);                 // header
    addBox(0, 0, -(halfD - t / 2), w, GF, t);                              // back
    addBox(-(halfW - t / 2), 0, 0, t, GF, d - t * 2);                      // left
    addBox(halfW - t / 2, 0, 0, t, GF, d - t * 2);                         // right
    // interior floor & ceiling
    addBox(0, 0, 0, w - t, 0.1, d - t, floorMat, false);
    addBox(0, GF - 0.15, 0, w - t, 0.15, d - t, trimMat, false);
    // ceiling light
    const lightMat = new THREE.MeshStandardMaterial({
      color: '#ffffff', emissive: '#fff6d8', emissiveIntensity: 1.2 });
    addBox(0, GF - 0.3, 0, Math.min(w * 0.4, 4), 0.1, 0.8, lightMat, false);

    // big front windows either side of the door (visual only)
    addBox(-(doorW / 2 + segW / 2), 0.9, halfD - t - 0.02, segW * 0.8, 1.8, 0.05, glassMat, false);
    addBox(doorW / 2 + segW / 2, 0.9, halfD - t - 0.02, segW * 0.8, 1.8, 0.05, glassMat, false);

    // sign above the door
    const signInfo = {
      [KIND.SHOP]: ['24/7 MARKT', '#7fd66a'],
      [KIND.BANK]: ['MERIDIAN BANK', '#ffd700'],
      [KIND.POLICE]: ['N.B.P.D.', '#7fb5ff'],
      [KIND.HOSPITAL]: ['ST. LUKAS KLINIK', '#ff9a9a'],
      [KIND.SAFEHOUSE]: ['', ''],
      [KIND.GARAGE]: ['WERKSTATT M.', '#e8b437'],
      [KIND.GUNSHOP]: ['BOLT & BARREL', '#e8a25c'],
      [KIND.SPRAY]: ['SPRAY KÖNIG', '#c583e8'],
    }[kind] || ['', ''];
    let signMat = null;
    if (signInfo[0]) {
      signMat = new THREE.MeshStandardMaterial({
        map: this.signTexture(signInfo[0], signInfo[1]),
        emissiveMap: this.signTexture(signInfo[0], signInfo[1]),
        emissive: '#ffffff', emissiveIntensity: 0.4,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.7, 7), Math.min(w * 0.7, 7) / 4), signMat);
      sign.position.set(0, GF + 0.9, halfD + 0.06);
      group.add(sign);
      G.daynight?.registerLamp(signMat);
    }

    // interior furnishing by kind
    const counterMat = new THREE.MeshStandardMaterial({ color: '#6e4f35', roughness: 0.7 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: '#87571f'.replace('87571f', '575f6e'), roughness: 0.8 });
    let interior = null;
    const local2world = (lx, ly, lz) => {
      const cos = Math.cos(ry), sin = Math.sin(ry);
      return new THREE.Vector3(x + lx * cos + lz * sin, ly, z - lx * sin + lz * cos);
    };

    if (kind === KIND.SHOP || kind === KIND.GUNSHOP) {
      addBox(-w * 0.18, 0, -halfD * 0.45, Math.min(w * 0.5, 4.4), 1.0, 0.8, counterMat); // counter
      addBox(halfW * 0.55, 0, 0.2, 0.6, 1.8, Math.min(d * 0.5, 4), shelfMat);            // shelves
      addBox(-halfW * 0.55, 0, 0.4, 0.6, 1.8, Math.min(d * 0.4, 3), shelfMat);
      const till = addBox(-w * 0.18, 1.05, -halfD * 0.45 + 0.2, 0.5, 0.3, 0.4, trimMat, false);
      interior = {
        kind,
        door: local2world(0, 0, halfD + 1),
        clerkPos: local2world(-w * 0.18, 0, -halfD * 0.45 - 1.2),
        registerPos: local2world(-w * 0.18, 1.2, -halfD * 0.45),
        counterFront: local2world(-w * 0.18, 0, -halfD * 0.45 + 1.6),
        center: local2world(0, 0, 0),
        radius: Math.max(w, d) * 0.5,
      };
    } else if (kind === KIND.BANK) {
      addBox(0, 0, -halfD * 0.35, Math.min(w * 0.7, 9), 1.1, 0.8, counterMat); // teller counter
      // vault room at the back
      addBox(-w * 0.25, 0, -halfD + 1.6, 0.3, GF, 3);
      addBox(w * 0.25, 0, -halfD + 1.6, 0.3, GF, 3);
      const vaultDoor = addBox(0, 0, -halfD + 3.0, 2.2, GF, 0.35,
        new THREE.MeshStandardMaterial({ color: '#8a8d94', metalness: 0.8, roughness: 0.3 }));
      interior = {
        kind,
        door: local2world(0, 0, halfD + 1),
        clerkPos: local2world(1.5, 0, -halfD * 0.35 - 1.2),
        registerPos: local2world(0, 1.2, -halfD * 0.35),
        counterFront: local2world(0, 0, -halfD * 0.35 + 1.8),
        vaultPos: local2world(0, 0, -halfD + 1.2),
        vaultDoorPos: local2world(0, 0, -halfD + 3.6),
        center: local2world(0, 0, 0),
        radius: Math.max(w, d) * 0.55,
      };
    } else if (kind === KIND.SPRAY) {
      // drive-in bay: widen the door
      // (door boxes already built narrow; add bay marker instead — vehicles use bay zone in front)
      addBox(0, 0, -halfD * 0.4, 1.2, 1.6, 1.2, shelfMat);
      interior = {
        kind,
        door: local2world(0, 0, halfD + 1),
        bayPos: local2world(0, 0, halfD + 5.5),
        center: local2world(0, 0, 0),
        radius: Math.max(w, d) * 0.6,
      };
    } else if (kind === KIND.SAFEHOUSE) {
      addBox(halfW * 0.4, 0, -halfD * 0.35, 2.0, 0.55, 1.2, counterMat, false); // bed
      addBox(-halfW * 0.4, 0, -halfD * 0.3, 0.9, 0.9, 0.9, shelfMat, false);    // table
      interior = {
        kind,
        door: local2world(0, 0, halfD + 1),
        bedPos: local2world(halfW * 0.4, 0, -halfD * 0.35),
        center: local2world(0, 0, 0),
        radius: Math.max(w, d) * 0.6,
      };
    } else if (kind === KIND.GARAGE || kind === KIND.POLICE || kind === KIND.HOSPITAL) {
      addBox(0, 0, -halfD * 0.4, Math.min(w * 0.5, 6), 1.0, 0.8, counterMat);
      interior = {
        kind,
        door: local2world(0, 0, halfD + 1),
        deskPos: local2world(0, 0, -halfD * 0.4),
        padPos: local2world(0, 0, halfD + 8),   // garage vehicle spawn pad
        center: local2world(0, 0, 0),
        radius: Math.max(w, d) * 0.6,
      };
    }

    if (kind === KIND.POLICE) {
      // blue lamps flanking the door
      const lamp = new THREE.MeshStandardMaterial({ color: '#3355ff', emissive: '#3355ff', emissiveIntensity: 1.5 });
      addBox(-doorW, 2.4, halfD + 0.1, 0.22, 0.4, 0.22, lamp, false);
      addBox(doorW, 2.4, halfD + 0.1, 0.22, 0.4, 0.22, lamp, false);
      G.daynight?.registerLamp(lamp);
    }
    if (kind === KIND.BANK) {
      // columns
      for (const cxo of [-w * 0.3, w * 0.3]) {
        addBox(cxo, 0, halfD + 0.7, 0.7, GF + 1.6, 0.7,
          new THREE.MeshStandardMaterial({ color: '#c9c1ac', roughness: 0.85 }));
      }
    }

    return { group, colliders, interior };
  }
}
