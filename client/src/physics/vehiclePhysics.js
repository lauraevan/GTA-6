// Arcade-leaning raycast-vehicle physics with per-class tuning: grip vs drift,
// speed-sensitive steering, handbrake, nitro, engine damage falloff, tyre
// blowouts and flip recovery.

import * as CANNON from 'cannon-es';
import { clamp, lerp } from '../core/mathx.js';
import { GROUP } from './physics.js';

export function createVehiclePhysics(phys, def, pos, ry = 0) {
  const [w, h, l] = def.size;
  const chassisShape = new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, l / 2));
  const chassisBody = new CANNON.Body({
    mass: def.mass,
    position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    angularDamping: 0.35,
    linearDamping: 0.01,
  });
  // lower centre of mass for stability
  chassisBody.addShape(chassisShape, new CANNON.Vec3(0, def.comY ?? 0.05, 0));
  chassisBody.quaternion.setFromEuler(0, ry, 0);
  chassisBody.collisionFilterGroup = GROUP.VEHICLE;
  chassisBody.collisionFilterMask = GROUP.STATIC | GROUP.VEHICLE | GROUP.CHAR | GROUP.DEBRIS;

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
  });

  const sus = def.sus;
  const wheelOpts = {
    radius: def.wheelR,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: sus.stiff,
    suspensionRestLength: sus.rest,
    frictionSlip: def.slip,
    dampingRelaxation: 2.4,
    dampingCompression: 4.5,
    maxSuspensionForce: 250000,
    rollInfluence: def.roll ?? 0.06,
    axleLocal: new CANNON.Vec3(1, 0, 0),
    maxSuspensionTravel: sus.travel,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };
  const halfW = w / 2 - def.wheelR * 0.35;
  const axF = l / 2 - def.wheelR * 1.35;
  const axR = -(l / 2 - def.wheelR * 1.35);
  const conY = -h / 2 + sus.rest * 0.35;
  const connections = [
    new CANNON.Vec3(-halfW, conY, axF), // FL
    new CANNON.Vec3(halfW, conY, axF),  // FR
    new CANNON.Vec3(-halfW, conY, axR), // RL
    new CANNON.Vec3(halfW, conY, axR),  // RR
  ];
  for (const c of connections) {
    vehicle.addWheel({ ...wheelOpts, chassisConnectionPointLocal: c });
  }
  vehicle.addToWorld(phys.world);

  return new VehiclePhysics(phys, def, chassisBody, vehicle);
}

export class VehiclePhysics {
  constructor(phys, def, chassisBody, vehicle) {
    this.phys = phys;
    this.def = def;
    this.body = chassisBody;
    this.vehicle = vehicle;
    this.flippedTime = 0;
    this.nitroCharge = 1;
    this._fwd = new CANNON.Vec3();
  }

  get speed() { return this.body.velocity.length(); }

  /** signed forward speed m/s */
  get forwardSpeed() {
    this.body.quaternion.vmult(new CANNON.Vec3(0, 0, 1), this._fwd);
    return this.body.velocity.dot(this._fwd);
  }

  /**
   * controls: {steer -1..1, throttle 0..1, brake 0..1, handbrake, reverse, nitro}
   * traction: weather multiplier; engineFactor: damage multiplier 0.4..1
   * tires: [{burst}] x4
   */
  update(controls, dt, traction = 1, engineFactor = 1, tires = null, mods = null) {
    const { vehicle, def, body } = this;
    const speed = this.speed;
    const fwdSpeed = this.forwardSpeed;

    // --- steering: tighter at low speed
    const maxSteer = lerp(0.58, 0.16, clamp(speed / 45, 0, 1)) * (def.steer ?? 1);
    const steer = controls.steer * maxSteer;
    vehicle.setSteeringValue(steer, 0);
    vehicle.setSteeringValue(steer, 1);

    // --- engine / brakes
    let engine = 0, brake = 0;
    const tireGrip = mods?.tires ? 1.15 : 1;
    const power = def.engine * engineFactor * (1 + (mods?.engine ?? 0) * 0.09);
    const maxSpeed = def.maxSpeed * (1 + (mods?.engine ?? 0) * 0.05);

    if (controls.throttle > 0) {
      if (fwdSpeed < -1.5) brake = def.brake ?? 90; // braking out of reverse
      else {
        const falloff = clamp(1 - fwdSpeed / maxSpeed, 0, 1);
        // cannon's forwardWS = hitNormal × axle → negative engine force drives +Z
        engine = -power * controls.throttle * (0.35 + 0.65 * falloff);
        if (controls.nitro && this.nitroCharge > 0 && mods?.nitro) {
          engine *= 1.65;
          this.nitroCharge = Math.max(0, this.nitroCharge - dt / 3.2);
        }
      }
    } else if (!controls.nitro) {
      this.nitroCharge = Math.min(1, this.nitroCharge + dt / 9);
    }
    if (controls.brake > 0) {
      if (fwdSpeed > 1.5) brake = (def.brake ?? 90) * controls.brake * (mods?.brakes ? 1.35 : 1);
      else engine = power * 0.45 * controls.brake; // reverse
    }

    // rear-wheel drive force (front for none — RWD feels right for this roster)
    vehicle.applyEngineForce(engine, 2);
    vehicle.applyEngineForce(engine, 3);

    // --- friction per wheel: traction, handbrake, bursts
    const baseSlip = def.slip * traction * tireGrip;
    for (let i = 0; i < 4; i++) {
      let slip = baseSlip;
      if (controls.handbrake && i >= 2) slip *= 0.42;
      if (tires && tires[i]?.burst) slip *= 0.28;
      vehicle.wheelInfos[i].frictionSlip = slip;
    }
    for (let i = 0; i < 4; i++) {
      let b = brake;
      if (controls.handbrake && i >= 2) b = Math.max(b, 55);
      vehicle.setBrake(b, i);
    }
    // idle roll resistance
    if (engine === 0 && brake === 0) {
      vehicle.setBrake(2.2, 0); vehicle.setBrake(2.2, 1);
    }

    // --- downforce for grip classes
    if (def.downforce) {
      body.applyForce(new CANNON.Vec3(0, -def.downforce * speed, 0), body.position);
    }

    // --- speed cap via drag
    if (speed > maxSpeed) {
      body.velocity.scale(maxSpeed / speed, body.velocity);
    }

    // --- flip recovery: upside down & slow → auto-right after 2.5 s
    const up = body.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
    if (up.y < 0.1 && speed < 3) {
      this.flippedTime += dt;
      if (this.flippedTime > 2.5) {
        const yaw = Math.atan2(
          2 * (body.quaternion.w * body.quaternion.y + body.quaternion.x * body.quaternion.z),
          1 - 2 * (body.quaternion.y ** 2 + body.quaternion.x ** 2));
        body.quaternion.setFromEuler(0, yaw, 0);
        body.position.y += 1.2;
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
        this.flippedTime = 0;
      }
    } else this.flippedTime = 0;

    for (let i = 0; i < 4; i++) vehicle.updateWheelTransform(i);
  }

  /** how sideways the car is moving (0 straight, 1 fully lateral) for skids/audio */
  get slipRatio() {
    const speed = this.speed;
    if (speed < 4) return 0;
    const fwd = Math.abs(this.forwardSpeed);
    return clamp(1 - fwd / speed, 0, 1);
  }

  destroy() {
    this.vehicle.removeFromWorld(this.phys.world);
  }
}
