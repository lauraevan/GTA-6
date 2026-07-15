// Isolated physics: pause the game loop, set engine force directly, step the
// cannon world manually, and watch velocity build per step.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = 4521;
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
await page.waitForTimeout(4200); // smoke has entered the car

const out = await page.evaluate(() => {
  const G = window.__GTA;
  const v = G.player.vehicle;
  if (!v?.vp) return { fail: 'no vp' };
  G.state = 'paused-debug'; // halt the game loop updates entirely
  const vp = v.vp;
  const world = G.physics.world;
  const log = [];
  // straighten & zero
  vp.body.velocity.set(0, 0, 0);
  vp.body.angularVelocity.set(0, 0, 0);
  for (let i = 0; i < 4; i++) { vp.vehicle.setBrake(0, i); vp.vehicle.setSteeringValue(0, i); }
  vp.vehicle.applyEngineForce(-7000, 2);
  vp.vehicle.applyEngineForce(-7000, 3);
  for (let s = 0; s <= 120; s++) {
    world.step(1 / 60);
    if (s % 20 === 0) {
      log.push({
        s,
        fwd: +vp.forwardSpeed.toFixed(3),
        y: +vp.body.position.y.toFixed(3),
        contacts: vp.vehicle.wheelInfos.map((w) => (w.isInContact ? 1 : 0)).join(''),
        suspF: vp.vehicle.wheelInfos.map((w) => Math.round(w.suspensionForce ?? 0)).join(','),
        slip: vp.vehicle.wheelInfos.map((w) => +(w.sideImpulse ?? 0).toFixed(1)).join(','),
      });
    }
  }
  return { log, mass: vp.body.mass, slipCfg: vp.vehicle.wheelInfos[2].frictionSlip };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
