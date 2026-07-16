import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
const DIST = '/home/user/GTA-6/client/dist';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const data = await readFile(path.join(DIST, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(4533, ok));
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://127.0.0.1:4533/?smoke=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GTA && window.__GTA.state === 'playing', null, { timeout: 90000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const G = window.__GTA;
  const near = G.vehicles.findNearestEnterable(G.player.position, 50);
  return {
    state: G.state,
    vehicle: !!G.player.vehicle,
    entering: !!G.player.entering,
    playerPos: G.player.position.toArray().map((v) => +v.toFixed(1)),
    vehicleCount: G.vehicles.vehicles.size,
    nearest: near ? { model: near.model, mode: near.mode, d: +near.position.distanceTo(G.player.position).toFixed(2), locked: near.locked, driver: near.driver } : null,
    errors: G._errors,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
