// Procedural low-poly vehicle meshes with separable damage panels, emissive
// lights, per-class silhouettes. Swappable with Higgsfield GLBs via AssetLibrary
// (asset names: `vehicle-<model>`).

import * as THREE from 'three';

const glassMatShared = new THREE.MeshStandardMaterial({
  color: '#20242c', roughness: 0.12, metalness: 0.8 });
const tireMat = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.9 });
const rimMats = [
  new THREE.MeshStandardMaterial({ color: '#b8bcc4', metalness: 0.85, roughness: 0.3 }),
  new THREE.MeshStandardMaterial({ color: '#22242a', metalness: 0.7, roughness: 0.4 }),
  new THREE.MeshStandardMaterial({ color: '#c8a428', metalness: 0.85, roughness: 0.25 }),
];
const trimMat = new THREE.MeshStandardMaterial({ color: '#191b20', roughness: 0.6, metalness: 0.4 });

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

/**
 * Build a vehicle mesh. Returns {root, parts:{...}, wheels:[4], mats:{body}}
 * Local convention: +Z forward, Y up, origin at chassis centre.
 */
let blobTexture = null;
function getBlobTexture() {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  blobTexture = new THREE.CanvasTexture(c);
  return blobTexture;
}

export function buildVehicleMesh(G, modelId, def, paint, wheelStyle = 0) {
  const glb = G.assets?.getModel(`vehicle-${modelId}`);
  const [W, H, L] = def.size;

  // clearcoat "car paint" so the environment map reads like real paint
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: paint, roughness: 0.34, metalness: 0.65,
    clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 1.25 });
  const root = new THREE.Group();
  const parts = {};
  const wheels = [];
  const stance = H / 2 + def.wheelR * 0.55;

  if (glb) {
    // GLB bodies bake their own wheels: align the model's bottom to the parked
    // stance so tyres touch the road when the chassis sits at stance height.
    const bb = new THREE.Box3().setFromObject(glb);
    glb.position.y -= bb.min.y + stance;
    glb.traverse((o) => {
      if (o.isMesh && o.material) o.material.envMapIntensity = 1.3;
    });
    root.add(glb);
  }

  // soft blob shadow grounds the car even without expensive shadow maps
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.35, L * 1.12),
    new THREE.MeshBasicMaterial({
      map: getBlobTexture(), transparent: true, opacity: 0.5, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = -stance + 0.06;
  blob.renderOrder = 1;
  root.add(blob);

  const mkWheel = () => {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(def.wheelR, def.wheelR, 0.26, 14), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(def.wheelR * 0.55, def.wheelR * 0.55, 0.28, 8),
      rimMats[wheelStyle % rimMats.length]);
    rim.rotation.z = Math.PI / 2;
    g.add(tire, rim);
    g.visible = !glb; // hidden when the GLB body has baked wheels
    root.add(g);
    wheels.push(g);
    return g;
  };
  for (let i = 0; i < 4; i++) mkWheel();

  if (!glb) {
    const bodyH = H * 0.52, bodyY = -H * 0.5 + bodyH / 2 + def.wheelR * 0.4;
    // main tub
    const tub = box(W, bodyH, L, bodyMat);
    tub.position.y = bodyY;
    tub.name = 'tub';
    root.add(tub);
    parts.tub = tub;

    const style = def.body;
    const cabH = H * 0.46;
    let cabL = L * 0.42, cabZ = -L * 0.05;
    if (style === 'wedge') { cabL = L * 0.36; cabZ = -L * 0.1; }
    if (style === 'muscle') { cabL = L * 0.34; cabZ = -L * 0.08; }
    if (style === 'hatch') { cabL = L * 0.48; cabZ = -L * 0.08; }
    if (style === 'van') { cabL = L * 0.8; cabZ = -L * 0.02; }
    if (style === 'pickup') { cabL = L * 0.32; cabZ = L * 0.08; }

    const cab = box(W * 0.86, cabH, cabL, bodyMat);
    cab.position.set(0, bodyY + bodyH / 2 + cabH / 2 - 0.02, cabZ);
    cab.name = 'cab';
    root.add(cab);
    parts.cab = cab;

    // windshield / windows
    const ws = box(W * 0.82, cabH * 0.75, 0.06, glassMatShared);
    ws.position.set(0, cab.position.y + cabH * 0.05, cabZ + cabL / 2);
    ws.rotation.x = style === 'wedge' ? -0.5 : -0.32;
    root.add(ws);
    const rw = ws.clone();
    rw.position.z = cabZ - cabL / 2;
    rw.rotation.x = style === 'hatch' || style === 'van' ? 0.12 : 0.42;
    root.add(rw);
    const sideGlassL = box(0.05, cabH * 0.6, cabL * 0.8, glassMatShared);
    sideGlassL.position.set(-W * 0.43, cab.position.y + cabH * 0.06, cabZ);
    root.add(sideGlassL);
    const sideGlassR = sideGlassL.clone();
    sideGlassR.position.x = W * 0.43;
    root.add(sideGlassR);

    // hood + trunk (damage panels)
    if (style !== 'van') {
      const hoodL = (L / 2 - (cabZ + cabL / 2)) * 0.92;
      const hood = box(W * 0.92, 0.1, hoodL, bodyMat);
      hood.position.set(0, bodyY + bodyH / 2 + 0.03, cabZ + cabL / 2 + hoodL / 2 + 0.05);
      if (style === 'wedge') { hood.rotation.x = 0.06; hood.position.y -= 0.05; }
      hood.name = 'hood';
      root.add(hood);
      parts.hood = hood;

      const trunkL = Math.abs(-L / 2 - (cabZ - cabL / 2)) * 0.85;
      const trunk = box(W * 0.92, 0.1, trunkL, bodyMat);
      trunk.position.set(0, bodyY + bodyH / 2 + 0.03, cabZ - cabL / 2 - trunkL / 2 - 0.04);
      trunk.name = 'trunk';
      root.add(trunk);
      parts.trunk = trunk;
      if (style === 'pickup') {
        // truck bed walls
        const bedL = trunkL + 0.4;
        const bedWall = box(0.08, 0.3, bedL, bodyMat);
        bedWall.position.set(-W * 0.44, bodyY + bodyH / 2 + 0.15, trunk.position.z);
        root.add(bedWall);
        const bw2 = bedWall.clone(); bw2.position.x = W * 0.44;
        root.add(bw2);
      }
    }

    // bumpers (damage panels)
    const bumperF = box(W * 0.98, 0.2, 0.18, trimMat);
    bumperF.position.set(0, bodyY - bodyH / 2 + 0.14, L / 2 + 0.06);
    bumperF.name = 'bumperF';
    root.add(bumperF);
    parts.bumperF = bumperF;
    const bumperR = bumperF.clone();
    bumperR.position.z = -L / 2 - 0.06;
    bumperR.name = 'bumperR';
    root.add(bumperR);
    parts.bumperR = bumperR;

    // lights
    const headMat = new THREE.MeshStandardMaterial({
      color: '#fff8e0', emissive: '#fff2c0', emissiveIntensity: 0 });
    const tailMat = new THREE.MeshStandardMaterial({
      color: '#7a1418', emissive: '#ff2a20', emissiveIntensity: 0 });
    for (const sx of [-1, 1]) {
      const hl = box(0.34, 0.12, 0.06, headMat);
      hl.position.set(sx * W * 0.32, bodyY + bodyH * 0.22, L / 2 + 0.02);
      root.add(hl);
      const tl = box(0.3, 0.1, 0.06, tailMat);
      tl.position.set(sx * W * 0.32, bodyY + bodyH * 0.2, -L / 2 - 0.02);
      root.add(tl);
    }
    parts.headMat = headMat;
    parts.tailMat = tailMat;

    // class extras
    if (style === 'wedge' || def.spoiler) {
      const sp = box(W * 0.8, 0.06, 0.3, trimMat);
      sp.position.set(0, bodyY + bodyH / 2 + 0.28, -L / 2 + 0.2);
      const struts = box(W * 0.5, 0.22, 0.06, trimMat);
      struts.position.set(0, bodyY + bodyH / 2 + 0.14, -L / 2 + 0.22);
      root.add(sp, struts);
    }
    if (def.police) {
      const barBase = box(W * 0.5, 0.09, 0.32, trimMat);
      barBase.position.set(0, cab.position.y + cabH / 2 + 0.06, cabZ);
      const red = box(W * 0.22, 0.12, 0.28, new THREE.MeshStandardMaterial({
        color: '#801418', emissive: '#ff2020', emissiveIntensity: 0 }));
      red.position.set(-W * 0.13, cab.position.y + cabH / 2 + 0.16, cabZ);
      const blue = box(W * 0.22, 0.12, 0.28, new THREE.MeshStandardMaterial({
        color: '#101880', emissive: '#2040ff', emissiveIntensity: 0 }));
      blue.position.set(W * 0.13, cab.position.y + cabH / 2 + 0.16, cabZ);
      root.add(barBase, red, blue);
      parts.sirenRed = red.material;
      parts.sirenBlue = blue.material;
      // livery stripe
      const stripe = box(W + 0.02, bodyH * 0.4, L * 0.98, new THREE.MeshStandardMaterial({
        color: '#e8e9ec', roughness: 0.4 }));
      stripe.position.copy(tub.position);
      stripe.scale.set(1.001, 0.35, 0.6);
      root.add(stripe);
    }
    if (def.taxi) {
      const sign = box(0.5, 0.16, 0.24, new THREE.MeshStandardMaterial({
        color: '#e8b437', emissive: '#ffd860', emissiveIntensity: 0.25 }));
      sign.position.set(0, cab.position.y + cabH / 2 + 0.14, cabZ);
      root.add(sign);
    }
  }

  return { root, parts, wheels, bodyMat };
}
