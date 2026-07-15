// Bisect: (a) manual raycast against the Plane ground the way RaycastVehicle
// casts it; (b) swap in a big box ground and re-run the drop; (c) drive.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = 4525;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const data = await readFile(path.join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(PORT, ok));

const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/?smoke=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GTA?.player?.vehicle?.vp, null, { timeout: 90000 });

const out = await page.evaluate(async () => {
  const G = window.__GTA;
  G.state = 'paused-debug';
  const vp = G.player.vehicle.vp;
  const world = G.physics.world;
  const CANNONRay = Object.getPrototypeOf(world).constructor; // not needed

  // (a) manual ray straight down from above the ground plane
  const res1 = G.physics.raycast(
    new (G.player.position.constructor)(-300, 2, 700),
    new (G.player.position.constructor)(-300, -2, 700));
  // (b) the raycastClosest call pattern RaycastVehicle uses (world.rayTest)
  const RR = vp.vehicle.wheelInfos[0].raycastResult.constructor;
  const r2 = new RR();
  const V3 = world.gravity.constructor;
  world.rayTest(new V3(-300, 2, 700), new V3(-300, -2, 700), r2);

  // (c) add a big box ground and re-drop the car on it
  const BodyCls = world.bodies[0].constructor;
  const BoxCls = world.bodies.find((b) => b.shapes[0]?.halfExtents)?.shapes[0].constructor;
  const box = new BodyCls({ type: 2, position: new V3(-300, -1, 700) });
  box.addShape(new BoxCls(new V3(50, 1, 50)));
  box.userData = { kind: 'ground-box' };
  world.addBody(box);

  vp.body.position.set(-300, 2.5, 700);
  vp.body.quaternion.set(0, 0, 0, 1);
  vp.body.velocity.set(0, 0, 0);
  vp.body.angularVelocity.set(0, 0, 0);
  vp.body.wakeUp();
  for (let i = 0; i < 4; i++) { vp.vehicle.setBrake(0, i); vp.vehicle.applyEngineForce(0, i); }
  const settle = [];
  for (let s = 0; s <= 150; s++) {
    world.step(1 / 60);
    if (s % 30 === 0) {
      settle.push({ s, y: +vp.body.position.y.toFixed(3),
        contacts: vp.vehicle.wheelInfos.map((w) => (w.isInContact ? 1 : 0)).join('') });
    }
  }
  vp.vehicle.applyEngineForce(-7000, 2);
  vp.vehicle.applyEngineForce(-7000, 3);
  const drive = [];
  for (let s = 0; s <= 150; s++) {
    world.step(1 / 60);
    vp.vehicle.applyEngineForce(-7000, 2);
    vp.vehicle.applyEngineForce(-7000, 3);
    if (s % 30 === 0) drive.push({ s, fwd: +vp.forwardSpeed.toFixed(2) });
  }
  return {
    manualRayHelper: res1 ? { y: +res1.point.y.toFixed(3), kind: res1.body.userData?.kind } : null,
    worldRayTestPlane: r2.hasHit ? { y: +r2.hitPointWorld.y.toFixed(3) } : { hasHit: false },
    settleOnBox: settle,
    driveOnBox: drive,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
