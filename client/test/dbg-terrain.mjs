// Verify the cannon Heightfield matches Terrain.heightAt: raycast down at
// sample points and compare. Misalignment = cars floating/sinking on hills.
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
await new Promise((ok) => server.listen(4541, ok));
const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://127.0.0.1:4541/?smoke=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__GTA && window.__GTA.state === 'playing', null, { timeout: 90000 });
const out = await page.evaluate(() => {
  const G = window.__GTA;
  const pts = [
    [0.7, 0.7, 'core'], [1120.7, -900.7, 'big hill'], [-1140.7, 270.7, 'island peak'],
    [900.7, -700.7, 'hill slope'], [-420.7, 1230.7, 'south hill'], [600.7, 600.7, 'suburb'],
  ];
  const V = G.player.position.constructor;
  return pts.map(([x, z, name]) => {
    const want = G.terrain.heightAt(x, z);
    const hit = G.physics.raycast(new V(x, want + 5, z), new V(x, want - 5, z), { skipDynamic: true });
    return { name, want: +want.toFixed(2), got: hit ? +hit.point.y.toFixed(2) : null,
      kind: hit?.body?.userData?.kind ?? null, ok: hit ? Math.abs(hit.point.y - want) < 0.6 : false };
  });
});
console.log(JSON.stringify(out, null, 1));
const allOk = out.every((o) => o.ok);
console.log(allOk ? 'TERRAIN ALIGNED ✅' : 'TERRAIN MISMATCH ❌');
await browser.close();
server.close();
process.exit(allOk ? 0 : 1);
