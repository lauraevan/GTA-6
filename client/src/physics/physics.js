// cannon-es world wrapper: static world geometry, raycasts, collision groups.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { CFG } from '../core/config.js';

export const GROUP = { STATIC: 1, VEHICLE: 2, CHAR: 4, DEBRIS: 8 };

export class PhysicsWorld {
  constructor(G) {
    this.G = G;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, CFG.gravity, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.3;
    this.world.defaultContactMaterial.restitution = 0.05;
    this.world.solver.iterations = 10;

    // ground: a huge static box (NOT a CANNON.Plane — RaycastVehicle wheel rays
    // fail to intersect the rotated infinite plane, so cars would belly-flop)
    const ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(5000, 1, 5000)),
      position: new CANNON.Vec3(0, -1, 0),
    });
    ground.collisionFilterGroup = GROUP.STATIC;
    ground.userData = { kind: 'ground' };
    this.world.addBody(ground);

    this._rayResult = new CANNON.RaycastResult();
    this._from = new CANNON.Vec3();
    this._to = new CANNON.Vec3();
    this.accumulator = 0;
  }

  step(dt) {
    this.world.step(CFG.physicsStep, dt, 3);
  }

  addBody(body) { this.world.addBody(body); }
  removeBody(body) { this.world.removeBody(body); }

  addStaticBox(x, y, z, sx, sy, sz, ry = 0, userData = null) {
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)),
      position: new CANNON.Vec3(x, y, z),
    });
    if (ry) body.quaternion.setFromEuler(0, ry, 0);
    body.collisionFilterGroup = GROUP.STATIC;
    body.userData = userData || { kind: 'static' };
    this.world.addBody(body);
    return body;
  }

  /**
   * Raycast closest. from/to are THREE.Vector3. opts.skipDynamic → statics only.
   * Returns {point: THREE.Vector3, normal, body, distance} or null.
   */
  raycast(from, to, opts = {}) {
    this._from.set(from.x, from.y, from.z);
    this._to.set(to.x, to.y, to.z);
    this._rayResult.reset();
    const mask = opts.skipDynamic ? GROUP.STATIC
      : (opts.mask ?? (GROUP.STATIC | GROUP.VEHICLE | GROUP.DEBRIS));
    this.world.raycastClosest(this._from, this._to, {
      collisionFilterMask: mask,
      skipBackfaces: true,
    }, this._rayResult);
    if (!this._rayResult.hasHit) return null;
    const h = this._rayResult;
    return {
      point: new THREE.Vector3(h.hitPointWorld.x, h.hitPointWorld.y, h.hitPointWorld.z),
      normal: new THREE.Vector3(h.hitNormalWorld.x, h.hitNormalWorld.y, h.hitNormalWorld.z),
      body: h.body,
      distance: h.distance,
    };
  }

  /** Line of sight between two points considering static geometry only. */
  hasLOS(a, b) {
    return this.raycast(a, b, { skipDynamic: true }) === null;
  }
}
