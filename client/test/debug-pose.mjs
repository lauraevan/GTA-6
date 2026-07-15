// Deep probe: body orientation, wheel ray endpoints, manual ray tests, and a
// clean high-drop settle test far from any obstacles.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = 4523;
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
await page.waitForFunction(() => window.__GTA && window.__GTA.state === 'playing', null, { timeout: 60000 });
await page.waitForFunction(() => window.__GTA?.player?.vehicle?.vp, null, { timeout: 30000 });
await page.waitForTimeout(500);

const out = await page.evaluate(() => {
  const G = window.__GTA;
  const v = G.player.vehicle;
  if (!v?.vp) return { fail: 'no vp' };
  G.state = 'paused-debug';
  const vp = v.vp;
  const world = G.physics.world;

  const euler = { x: 0, y: 0, z: 0 };
  vp.body.quaternion.toEuler(euler);

  const wheelData = vp.vehicle.wheelInfos.map((w, i) => {
    const conn = w.chassisConnectionPointWorld ?? w.chassisConnectionPointLocal;
    return {
      i,
      connWorld: conn ? [+conn.x.toFixed(2), +conn.y.toFixed(2), +conn.z.toFixed(2)] : null,
      suspLen: +w.suspensionLength.toFixed(3),
      contact: w.isInContact,
      hitY: w.raycastResult?.hasHit ? +w.raycastResult.hitPointWorld.y.toFixed(3) : null,
      hitBody: w.raycastResult?.body?.userData?.kind ?? null,
    };
  });

  // clean drop test: teleport high above a rural field far from everything
  vp.body.position.set(-300, 3, 700);
  vp.body.quaternion.set(0, 0, 0, 1);
  vp.body.velocity.set(0, 0, 0);
  vp.body.angularVelocity.set(0, 0, 0);
  for (let i = 0; i < 4; i++) { vp.vehicle.setBrake(0, i); vp.vehicle.applyEngineForce(0, i); }
  const settle = [];
  for (let s = 0; s <= 180; s++) {
    world.step(1 / 60);
    if (s % 30 === 0) {
      settle.push({
        s, y: +vp.body.position.y.toFixed(3),
        contacts: vp.vehicle.wheelInfos.map((w) => (w.isInContact ? 1 : 0)).join(''),
      });
    }
  }
  // now drive on the settled flat spot
  vp.vehicle.applyEngineForce(-7000, 2);
  vp.vehicle.applyEngineForce(-7000, 3);
  const drive = [];
  for (let s = 0; s <= 120; s++) {
    world.step(1 / 60);
    if (s % 30 === 0) drive.push({ s, fwd: +vp.forwardSpeed.toFixed(2), y: +vp.body.position.y.toFixed(2) });
  }
  return { euler: { x: +euler.x.toFixed(3), y: +euler.y.toFixed(3), z: +euler.z.toFixed(3) }, wheelData, settle, drive };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
