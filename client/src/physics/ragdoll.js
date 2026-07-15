// Lightweight ragdolls for NPC/player deaths: 6 linked bodies re-using the
// pedestrian's visual parts. Capped pool; settle → freeze → fade.

import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { CFG } from '../core/config.js';
import { GROUP } from './physics.js';

export class RagdollSystem {
  constructor(G) {
    this.G = G;
    this.ragdolls = [];
  }

  /**
   * pedMesh: THREE.Group with children named head/torso/armL/armR/legL/legR
   * impulse: THREE.Vector3 initial hit impulse
   */
  spawn(pedMesh, position, impulse) {
    if (this.ragdolls.length >= CFG.maxRagdolls) {
      this.remove(this.ragdolls[0]);
    }
    const G = this.G;
    const mkBody = (mass, shape, off) => {
      const b = new CANNON.Body({
        mass,
        shape,
        position: new CANNON.Vec3(position.x + off.x, position.y + off.y, position.z + off.z),
        angularDamping: 0.6,
        linearDamping: 0.25,
      });
      b.collisionFilterGroup = GROUP.DEBRIS;
      b.collisionFilterMask = GROUP.STATIC | GROUP.VEHICLE | GROUP.DEBRIS;
      G.physics.addBody(b);
      return b;
    };

    const torso = mkBody(30, new CANNON.Box(new CANNON.Vec3(0.19, 0.3, 0.12)), { x: 0, y: 1.1, z: 0 });
    const head = mkBody(6, new CANNON.Sphere(0.14), { x: 0, y: 1.62, z: 0 });
    const armL = mkBody(4, new CANNON.Box(new CANNON.Vec3(0.06, 0.26, 0.06)), { x: -0.3, y: 1.15, z: 0 });
    const armR = mkBody(4, new CANNON.Box(new CANNON.Vec3(0.06, 0.26, 0.06)), { x: 0.3, y: 1.15, z: 0 });
    const legL = mkBody(8, new CANNON.Box(new CANNON.Vec3(0.08, 0.4, 0.08)), { x: -0.11, y: 0.42, z: 0 });
    const legR = mkBody(8, new CANNON.Box(new CANNON.Vec3(0.08, 0.4, 0.08)), { x: 0.11, y: 0.42, z: 0 });

    const cs = [];
    const link = (a, b, pivA, pivB) => {
      const c = new CANNON.ConeTwistConstraint(a, b, {
        pivotA: new CANNON.Vec3(pivA.x, pivA.y, pivA.z),
        pivotB: new CANNON.Vec3(pivB.x, pivB.y, pivB.z),
        axisA: CANNON.Vec3.UNIT_Y,
        axisB: CANNON.Vec3.UNIT_Y,
        angle: Math.PI / 5,
        twistAngle: Math.PI / 6,
      });
      this.G.physics.world.addConstraint(c);
      cs.push(c);
    };
    link(torso, head, { x: 0, y: 0.36, z: 0 }, { x: 0, y: -0.16, z: 0 });
    link(torso, armL, { x: -0.25, y: 0.22, z: 0 }, { x: 0, y: 0.28, z: 0 });
    link(torso, armR, { x: 0.25, y: 0.22, z: 0 }, { x: 0, y: 0.28, z: 0 });
    link(torso, legL, { x: -0.11, y: -0.34, z: 0 }, { x: 0, y: 0.42, z: 0 });
    link(torso, legR, { x: 0.11, y: -0.34, z: 0 }, { x: 0, y: 0.42, z: 0 });

    const imp = new CANNON.Vec3(impulse.x, impulse.y + 40, impulse.z);
    torso.applyImpulse(imp);
    head.applyImpulse(imp.scale(0.2));

    // re-parent visual parts to world & map to bodies
    pedMesh.updateMatrixWorld(true);
    const parts = {};
    for (const name of ['head', 'torso', 'armL', 'armR', 'legL', 'legR']) {
      const m = pedMesh.getObjectByName(name);
      if (m) {
        const world = new THREE.Vector3();
        m.getWorldPosition(world);
        this.G.scene.attach(m);
        parts[name] = m;
      }
    }
    if (pedMesh.parent) pedMesh.parent.remove(pedMesh);

    const r = {
      bodies: { torso, head, armL, armR, legL, legR },
      constraints: cs,
      parts,
      life: 14,
      frozen: false,
    };
    this.ragdolls.push(r);
    return r;
  }

  remove(r) {
    const idx = this.ragdolls.indexOf(r);
    if (idx < 0) return;
    this.ragdolls.splice(idx, 1);
    for (const c of r.constraints) this.G.physics.world.removeConstraint(c);
    for (const b of Object.values(r.bodies)) this.G.physics.removeBody(b);
    for (const m of Object.values(r.parts)) {
      m.parent?.remove(m);
      m.geometry?.dispose?.();
    }
  }

  update(dt) {
    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      const r = this.ragdolls[i];
      r.life -= dt;

      if (!r.frozen) {
        for (const [name, m] of Object.entries(r.parts)) {
          const b = r.bodies[name];
          m.position.copy(b.position);
          m.quaternion.copy(b.quaternion);
        }
        if (r.bodies.torso.velocity.lengthSquared() < 0.05 && r.life < 11) {
          r.frozen = true;
          for (const c of r.constraints) this.G.physics.world.removeConstraint(c);
          for (const b of Object.values(r.bodies)) this.G.physics.removeBody(b);
          r.constraints = [];
        }
      }

      if (r.life < 2) {
        for (const m of Object.values(r.parts)) {
          if (m.material) {
            m.material.transparent = true;
            m.material.opacity = Math.max(0, r.life / 2);
          }
        }
      }
      if (r.life <= 0) this.remove(r);
    }
  }
}
