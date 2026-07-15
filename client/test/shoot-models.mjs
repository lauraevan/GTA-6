// Screenshot every GLB from a fixed angle (with +Z arrow) to determine yaw.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 4527;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/test/viewer.html';
    const data = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(PORT, ok));

const browser = await chromium.launch({
  headless: true,
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });

const models = process.argv.slice(2).length ? process.argv.slice(2) : [
  'vehicle-falke', 'vehicle-cruiser', 'vehicle-thunder', 'vehicle-kurier', 'ped-civilian-rigged',
];
for (const m of models) {
  await page.goto(`http://127.0.0.1:${PORT}/test/viewer.html?m=${m}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__READY, null, { timeout: 60000 });
  const info = await page.evaluate(() => ({ dims: window.__DIMS, err: window.__ERR }));
  console.log(m, JSON.stringify(info));
  await page.screenshot({ path: path.join(__dirname, `model-${m}.png`) });
}
await browser.close();
server.close();
