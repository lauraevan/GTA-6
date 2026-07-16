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
await new Promise((ok) => server.listen(4537, ok));
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4537/?smoke=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GTA && window.__GTA.state === 'playing', null, { timeout: 90000 });
await page.evaluate(() => {
  const G = window.__GTA;
  const orig = G.player.exitVehicle.bind(G.player);
  window.__exits = [];
  G.player.exitVehicle = (force) => {
    window.__exits.push({ force, stack: new Error().stack.split('\n').slice(1, 5).join(' | ') });
    return orig(force);
  };
  const origComplete = G.player._completeEnter.bind(G.player);
  window.__completes = 0;
  G.player._completeEnter = (v) => { window.__completes++; return origComplete(v); };
});
await page.waitForTimeout(6000);
const out = await page.evaluate(() => ({
  completes: window.__completes,
  exits: window.__exits,
  veh: !!window.__GTA.player.vehicle,
}));
console.log(JSON.stringify(out, null, 1));
await browser.close();
server.close();
