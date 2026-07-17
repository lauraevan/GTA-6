// Terrain: bilinear height sampling over the generator's grid + a cannon-es
// Heightfield body so vehicles, characters and raycasts all follow the hills.
// The urban core is flat by construction; the outskirts and islands roll.

import * as CANNON from 'cannon-es';
import { GROUP } from '../physics/physics.js';

export class Terrain {
  constructor(city) {
    const t = city.terrain;
    this.enabled = !!t;
    if (!this.enabled) {
      this.step = 1; this.n = 2; this.h = [[0, 0], [0, 0]]; this.half = city.half;
      return;
    }
    this.step = t.step;
    this.n = t.n;
    this.h = t.h;          // h[iz][ix], world x = -half + ix*step, z = -half + iz*step
    this.half = city.half;
  }

  heightAt(x, z) {
    if (!this.enabled) return 0;
    const gx = Math.min(Math.max((x + this.half) / this.step, 0), this.n - 1.001);
    const gz = Math.min(Math.max((z + this.half) / this.step, 0), this.n - 1.001);
    const x0 = gx | 0, z0 = gz | 0;
    const tx = gx - x0, tz = gz - z0;
    const g = this.h;
    const a = g[z0][x0] * (1 - tx) + g[z0][x0 + 1] * tx;
    const b = g[z0 + 1][x0] * (1 - tx) + g[z0 + 1][x0 + 1] * tx;
    return a * (1 - tz) + b * tz;
  }

  /** replaces the flat ground with a heightfield + flat apron outside the map */
  buildPhysics(phys) {
    if (!this.enabled) return;
    // remove the old flat ground box
    const old = phys.world.bodies.find((b) => b.userData?.kind === 'ground');
    if (old) phys.world.removeBody(old);

    // cannon heightfield: data[i][j] with local x = i*s, local y = j*s.
    // With quaternion (-π/2,0,0), local +x → world +x and local +y → world -z.
    // So data[i][j] = height at world (x0 + i*s, z1 - j*s), body at (x0, 0, z1).
    const s = this.step;
    const data = [];
    for (let i = 0; i < this.n; i++) {
      const col = [];
      for (let j = 0; j < this.n; j++) {
        col.push(this.h[this.n - 1 - j][i]);
      }
      data.push(col);
    }
    const shape = new CANNON.Heightfield(data, { elementSize: s });
    const body = new CANNON.Body({ type: CANNON.Body.STATIC });
    body.addShape(shape);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    body.position.set(-this.half, 0, this.half);
    body.collisionFilterGroup = GROUP.STATIC;
    body.userData = { kind: 'ground' };
    phys.world.addBody(body);

    // flat aprons beyond the heightfield so the outer plain stays solid
    const L = 4000, H = this.half;
    const aprons = [
      [0, -(H + L / 2), L * 2 + H * 2, L], [0, H + L / 2, L * 2 + H * 2, L],
      [-(H + L / 2), 0, L, H * 2], [H + L / 2, 0, L, H * 2],
    ];
    for (const [ax, az, sx, sz] of aprons) {
      const apron = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(sx / 2, 1, sz / 2)),
        position: new CANNON.Vec3(ax, -1, az),
      });
      apron.collisionFilterGroup = GROUP.STATIC;
      apron.userData = { kind: 'ground' };
      phys.world.addBody(apron);
    }
  }
}
