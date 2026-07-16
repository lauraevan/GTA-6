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
await new Promise((ok) => server.listen(4535, ok));
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4535/?smoke=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GTA && window.__GTA.state === 'playing', null, { timeout: 90000 });
await page.waitForTimeout(4000);
const a = await page.evaluate(() => {
  const G = window.__GTA;
  return { t: G.player.entering?.t, ts: G.timeScale, veh: !!G.player.vehicle,
    enteringVehicleAlive: G.player.entering ? G.vehicles.vehicles.has(G.player.entering.vehicle) : null };
});
await page.waitForTimeout(1500);
const b = await page.evaluate(() => {
  const G = window.__GTA;
  return { t: G.player.entering?.t, ts: G.timeScale, veh: !!G.player.vehicle, state: G.state,
    meshVisible: G.player.mesh.visible, camMode: G.cameraRig.mode };
});
console.log(JSON.stringify({ a, b }, null, 1));
await browser.close();
server.close();
