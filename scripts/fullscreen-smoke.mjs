import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Uses the same installed Playwright/Chromium configuration as browser-smoke.mjs.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = process.env.PIC_EXTENSION_ROOT || root;
const output = resolve(root, 'output/playwright/fullscreen');
const { chromium } = await import(process.env.PIC_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PIC_PLAYWRIGHT_MODULE)).href : 'playwright');
await mkdir(output, { recursive: true });
const bitmaps = new Map();
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (bitmaps.has(path)) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(bitmaps.get(path));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(path === '/fixture' ? '<!doctype html><img src="/small.png" data-original="/large.png"><img src="/large-other.png" data-original="/small-other.png">' : '<!doctype html><title>Bitmap generator</title>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
const checks = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  context = await chromium.launchPersistentContext(await mkdtemp(resolve(output, 'profile-')), {
    headless: true, channel: 'chromium', viewport: { width: 1920, height: 1080 },
    executablePath: process.env.PIC_CHROMIUM_EXECUTABLE || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const generator = await context.newPage();
  await generator.goto(origin);
  const pngs = await generator.evaluate(() => [450, 1600].map(width => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = width === 450 ? 675 : 2399;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#357c94'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white'; ctx.font = '40px sans-serif'; ctx.fillText(`${canvas.width} x ${canvas.height}`, 20, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  for (const suffix of ['', '-other']) {
    bitmaps.set(`/small${suffix}.png`, Buffer.from(pngs[0], 'base64'));
    bitmaps.set(`/large${suffix}.png`, Buffer.from(pngs[1], 'base64'));
  }
  const source = await context.newPage(); await source.goto(`${origin}/fixture`);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, source.url());
  await worker.evaluate(id => chrome.tabs.sendMessage(id, { type: 'START_AUTO_SCAN' }), tabId);
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${new URL(worker.url()).host}/workspace/workspace.html?tabId=${tabId}`);
  await ui.waitForFunction(() => currentImages.length === 2 && cardDimensionPending.size === 0);
  const primaryIndex = await ui.evaluate(() => currentImages.findIndex(image => image.src.endsWith('/large.png')));
  assert.ok(primaryIndex >= 0);
  await ui.evaluate(index => openLightbox(currentImages[index], index), primaryIndex);
  await ui.waitForFunction(() => elements.lightboxImage.naturalWidth === 1600 && !lightboxOriginalEvalPending);
  await ui.locator('#lightbox-original').click();
  assert.equal(await ui.locator('#lightbox-image').evaluate(img => img.naturalWidth), 1600);
  passed('ordinary preview and 1:1 retain the 1600px image');
  const inspectFullscreen = () => ui.locator('#fullscreen-image').evaluate(img => ({
    width: img.naturalWidth, height: img.naturalHeight, displayedHeight: img.getBoundingClientRect().height
  }));
  await ui.locator('#lightbox-fullscreen').click();
  await ui.waitForFunction(() => !elements.fullscreenLoading.classList.contains('active') && elements.fullscreenImage.naturalWidth > 0);
  assert.equal((await inspectFullscreen()).width, 1600);
  assert.ok((await inspectFullscreen()).displayedHeight > 1000);
  passed('fullscreen from lightbox uses large image and fits the viewport');
  await ui.screenshot({ path: resolve(output, 'fullscreen.png') });
  await ui.evaluate(index => {
    closeFullscreenViewer(); closeLightbox(); cardDimensionCache.clear(); dimensionProbeQueue?.clear();
    openFullscreenViewer(index);
  }, primaryIndex);
  await ui.waitForFunction(() => !elements.fullscreenLoading.classList.contains('active') && elements.fullscreenImage.naturalWidth === 1600);
  passed('direct cold fullscreen entry compares actual image dimensions');
  await ui.locator('#fullscreen-next').click();
  await ui.waitForFunction(() => !elements.fullscreenLoading.classList.contains('active') && getLoadedPreviewUrl(elements.fullscreenImage).endsWith('/large-other.png'));
  assert.equal((await inspectFullscreen()).width, 1600);
  passed('next image preserves a larger alternative when the primary is smaller');
  await ui.locator('#fullscreen-prev').click();
  await ui.waitForFunction(() => !elements.fullscreenLoading.classList.contains('active') && getLoadedPreviewUrl(elements.fullscreenImage).endsWith('/large.png'));
  assert.equal((await inspectFullscreen()).width, 1600);
  passed('previous image restores the large primary source');
  await ui.evaluate(index => { closeFullscreenViewer(); previewCompatibility = true; cardDimensionCache.clear(); dimensionProbeQueue?.clear(); openFullscreenViewer(index); }, primaryIndex);
  await ui.waitForFunction(() => !elements.fullscreenLoading.classList.contains('active') && elements.fullscreenImage.naturalWidth === 1600);
  assert.ok(await ui.locator('#fullscreen-image').evaluate(img => img.src.startsWith('blob:')));
  passed('compatibility preview uses the large image through the actual background loader');
  await ui.locator('#fullscreen-close').click();
  assert.equal(await ui.evaluate(() => fullscreenCache.size + fullscreenPendingTasks.size), 0);
  passed('closing releases fullscreen cache and pending preloads');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ extension, checks }, null, 2));
}
