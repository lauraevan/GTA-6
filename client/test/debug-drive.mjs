// Diagnose why the driven vehicle isn't accelerating: inspect raycast-vehicle
// state live in the page.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = 4519;
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/?smoke=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GTA && window.__GTA.state === 'playing', null, { timeout: 60000 });
await page.waitForTimeout(4500); // let smoke enter the car

const snap1 = await page.evaluate(() => {
  const G = window.__GTA;
  const v = G.player.vehicle;
  if (!v) return { noVehicle: true };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  return { mode: v.mode, hasVp: !!v.vp, pos: v.position.toArray() };
});
console.log('snap1', JSON.stringify(snap1));

await page.waitForTimeout(2000);
const snap2 = await page.evaluate(() => {
  const G = window.__GTA;
  const v = G.player.vehicle;
  if (!v || !v.vp) return { noVp: true };
  const vp = v.vp;
  return {
    keysW: G.input.down('KeyW'),
    controls: { ...v.controls },
    speed: vp.speed,
    fwdSpeed: vp.forwardSpeed,
    bodyPos: [vp.body.position.x, vp.body.position.y, vp.body.position.z],
    bodyVel: [vp.body.velocity.x, vp.body.velocity.y, vp.body.velocity.z],
    sleepState: vp.body.sleepState,
    wheels: vp.vehicle.wheelInfos.map((w) => ({
      contact: w.isInContact,
      engine: w.engineForce,
      brake: w.brake,
      suspLen: +w.suspensionLength?.toFixed(3),
    })),
    health: v.health,
    engineFactorInputs: { health: v.health },
  };
});
console.log('snap2', JSON.stringify(snap2, null, 1));

await browser.close();
server.close();
