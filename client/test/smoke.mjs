// Headless smoke test: serves the production build, boots the game with
// ?smoke=1 (auto new-game, low quality), lets the automated run drive/shoot,
// then asserts zero errors and sanity-checks the world state.
//
//   npm run build && npm run smoke

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = 4517;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary',
};

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const file = path.join(DIST, p);
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404); res.end('nope');
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

const chromePath = process.env.CHROMIUM_PATH
  || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const server = await serve();
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: [
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  if (res.status() >= 400) consoleErrors.push(`http ${res.status()}: ${res.url()}`);
});

console.log('[smoke] loading game…');
await page.goto(`http://127.0.0.1:${PORT}/?smoke=1`, { waitUntil: 'domcontentloaded' });

let report = null;
try {
  await page.waitForFunction(() => window.__GTA_READY !== undefined, null, { timeout: 90000 });
  report = await page.evaluate(() => window.__GTA_REPORT);
} catch (e) {
  console.error('[smoke] timed out waiting for readiness');
}

await page.screenshot({ path: path.join(__dirname, 'smoke-shot.png') });
await browser.close();
server.close();

console.log('[smoke] report:', JSON.stringify(report, null, 2));
const webglErrors = consoleErrors.filter((e) =>
  !/swiftshader|GPU|fallback|WebGL.*performance/i.test(e) &&
  !/api\/health|Failed to load resource/.test(e)); // backend probe is optional
if (webglErrors.length) console.log('[smoke] console errors:', webglErrors.slice(0, 12));

const ok = report && report.ready && (report.errors?.length ?? 1) === 0 &&
  report.chunks > 0 && webglErrors.length === 0;
console.log(ok ? '[smoke] PASS ✅' : '[smoke] FAIL ❌');
process.exit(ok ? 0 : 1);
