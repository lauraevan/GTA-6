// Third-person camera rig: on-foot orbit, over-shoulder aim, vehicle chase cam
// with speed FOV, cinematic mode for cutscenes/stunts, menu orbit.

import * as THREE from 'three';
import { clamp, damp, angleDamp, lerp } from '../core/mathx.js';

const UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(G) {
    this.G = G;
    this.camera = new THREE.PerspectiveCamera(
      G.settings.fov, window.innerWidth / window.innerHeight, 0.1, 2600);
    this.mode = 'menu';
    this.yaw = 0;
    this.pitch = -0.18;
    this.pos = new THREE.Vector3(0, 60, 120);
    this.look = new THREE.Vector3();
    this.shakeAmp = 0;
    this.fovBoost = 0;
    this.cine = null;          // {from,to,lookFrom,lookTo,dur,t}
    this.menuAngle = 0;
    this._tmp = new THREE.Vector3();
    this._desired = new THREE.Vector3();
  }

  setMode(m) { this.mode = m; }

  shake(a) { if (this.G.settings.cameraShake) this.shakeAmp = Math.max(this.shakeAmp, a); }

  /** cinematic dolly: arrays of Vector3 */
  playCine(from, to, lookFrom, lookTo, dur = 3) {
    this.cine = { from, to, lookFrom, lookTo, dur, t: 0 };
    this.mode = 'cine';
  }
  stopCine() { this.cine = null; }

  applyMouseLook(dt) {
    const { G } = this;
    const d = G.input.consumeMouse();
    const sens = 0.0022;
    const inv = G.settings.invertY ? -1 : 1;
    this.yaw -= d.x * sens;
    this.pitch -= d.y * sens * inv;
    this.pitch = clamp(this.pitch, -1.15, 0.7);
  }

  update(dt) {
    const { G, camera } = this;
    const p = G.player;

    switch (this.mode) {
      case 'menu': {
        this.menuAngle += dt * 0.05;
        const r = 260;
        const cx = 0, cz = 0;
        this.pos.set(cx + Math.cos(this.menuAngle) * r, 120 + Math.sin(this.menuAngle * 0.7) * 30,
          cz + Math.sin(this.menuAngle) * r);
        this.look.set(cx, 40, cz);
        break;
      }
      case 'cine': {
        const c = this.cine;
        if (c) {
          c.t = Math.min(1, c.t + dt / c.dur);
          const e = c.t * c.t * (3 - 2 * c.t); // smoothstep
          this.pos.lerpVectors(c.from, c.to, e);
          this.look.lerpVectors(c.lookFrom, c.lookTo, e);
        }
        break;
      }
      case 'foot': {
        this.applyMouseLook(dt);
        const head = p.position.clone().add(new THREE.Vector3(0, 1.55, 0));
        const aiming = p.aiming;
        const dist = aiming ? 2.1 : 4.2;
        const side = aiming ? 0.55 : 0.0;
        const dir = new THREE.Vector3(
          Math.sin(this.yaw) * Math.cos(this.pitch),
          Math.sin(this.pitch),
          Math.cos(this.yaw) * Math.cos(this.pitch));
        const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
        this._desired.copy(head).addScaledVector(dir, -dist).addScaledVector(right, side)
          .add(new THREE.Vector3(0, aiming ? 0.15 : 0.35, 0));
        this.collideCamera(head, this._desired);
        this.pos.lerp(this._desired, 1 - Math.exp(-(aiming ? 22 : 12) * dt));
        this.look.copy(head).addScaledVector(dir, 14).addScaledVector(right, aiming ? side * 2.2 : 0);
        break;
      }
      case 'car': {
        const v = p.vehicle;
        if (!v) break;
        const vm = v.mesh;
        const vel = v.velocity;
        const speed = vel.length();
        // follow behind velocity dir (falls back to car heading when slow)
        const heading = new THREE.Vector3(0, 0, 1).applyQuaternion(vm.quaternion);
        const followDir = speed > 4
          ? this._tmp.copy(vel).setY(0).normalize().lerp(heading.setY(0).normalize(), 0.35).normalize()
          : heading.setY(0).normalize();
        const dist = 6.2 + Math.min(speed * 0.06, 2.6);
        const height = 2.4 + Math.min(speed * 0.02, 1.0);
        this._desired.copy(vm.position).addScaledVector(followDir, -dist).add(new THREE.Vector3(0, height, 0));
        const head = vm.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        this.collideCamera(head, this._desired);
        const lam = 5.5 + speed * 0.05;
        this.pos.lerp(this._desired, 1 - Math.exp(-lam * dt));
        this.look.copy(vm.position).addScaledVector(followDir, 9).add(new THREE.Vector3(0, 1.0, 0));
        // speed fov
        this.fovBoost = damp(this.fovBoost, Math.min(speed * 0.28, 16) + (v.controls.nitro ? 6 : 0), 4, dt);
        break;
      }
    }

    if (this.mode !== 'car') this.fovBoost = damp(this.fovBoost, 0, 6, dt);

    // shake decay
    if (this.shakeAmp > 0.001) {
      this.pos.x += (Math.random() - 0.5) * this.shakeAmp;
      this.pos.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
      this.pos.z += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-6 * dt);
    }

    camera.position.copy(this.pos);
    camera.lookAt(this.look);
    const targetFov = this.G.settings.fov + this.fovBoost;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = damp(camera.fov, targetFov, 8, dt);
      camera.updateProjectionMatrix();
    }
  }

  /** pull camera in front of world geometry between head and desired position */
  collideCamera(head, desired) {
    const phys = this.G.physics;
    if (!phys) return;
    const hit = phys.raycast(head, desired, { skipDynamic: true });
    if (hit) {
      // step back from the wall toward the head so the near plane stays clear
      const toHead = this._tmp.subVectors(head, desired).normalize();
      desired.copy(hit.point).addScaledVector(toHead, 0.35);
    }
  }

  /** direction the camera looks on the ground plane */
  get flatForward() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    d.y = 0;
    return d.lengthSq() > 0 ? d.normalize() : new THREE.Vector3(0, 0, 1);
  }
}
