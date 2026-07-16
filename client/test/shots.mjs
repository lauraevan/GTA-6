// Beauty-shot harness: boots the game at high quality in three conditions
// (day / dusk / rainy night) and captures screenshots.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = 4529;
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
await new Promise((ok) => server.listen(PORT, ok));

const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
});

const SHOTS = [
  { name: 'day', q: 'medium', hour: 13, weather: 'clear', drive: 3200 },
  { name: 'dusk', q: 'medium', hour: 19.3, weather: 'clear', drive: 2600 },
  { name: 'night-rain', q: 'medium', hour: 22.5, weather: 'rain', drive: 2600 },
  // scenic on-foot shots: URL spawn params (px/pz/yaw, nocar) — keep to open road
  { name: 'bay', q: 'medium', hour: 18.9, weather: 'clear', pos: [-760, 26], yaw: -Math.PI / 2 },
  { name: 'downtown', q: 'medium', hour: 12, weather: 'clear', pos: [2, 178], yaw: Math.PI },
];

for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(`[${s.name}] pageerror:`, e.message));
  const spawnQ = s.pos ? `&px=${s.pos[0]}&pz=${s.pos[1]}&yaw=${s.yaw}&nocar=1` : '';
  await page.goto(
    `http://127.0.0.1:${PORT}/?smoke=1&quality=${s.q}&rs=1&hour=${s.hour}&weather=${s.weather}${spawnQ}`,
    { waitUntil: 'domcontentloaded' });
  try {
    if (s.pos) {
      await page.waitForFunction(() => window.__GTA && window.__GTA.state === 'playing', null, { timeout: 90000 });
      await page.waitForTimeout(6000);
    } else {
      await page.waitForFunction(() => window.__GTA?.player?.vehicle?.vp, null, { timeout: 90000 });
      // drive forward a bit for a natural road framing
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
      await page.waitForTimeout(s.drive);
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.log(`[${s.name}] setup issue:`, String(e).slice(0, 120));
  }
  await page.screenshot({ path: path.join(__dirname, `shot-${s.name}.png`) });
  console.log(`[shots] captured ${s.name}`);
  await page.close();
}
await browser.close();
server.close();
