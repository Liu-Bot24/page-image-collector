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
let failUpgrade = false;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (failUpgrade && path === '/upgrade.webp') { res.writeHead(503); res.end(); return; }
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
  const pngs = await generator.evaluate(() => [450, 1600, 2400].map(width => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = width === 450 ? 675 : width === 1600 ? 2399 : 3200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#357c94'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white'; ctx.font = '40px sans-serif'; ctx.fillText(`${canvas.width} x ${canvas.height}`, 20, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  for (const suffix of ['', '-other']) {
    bitmaps.set(`/small${suffix}.png`, Buffer.from(pngs[0], 'base64'));
    bitmaps.set(`/large${suffix}.png`, Buffer.from(pngs[1], 'base64'));
  }
  bitmaps.set('/upgrade.webp', Buffer.from(pngs[2], 'base64'));
  bitmaps.set('/upgrade.jpg', Buffer.from(pngs[0], 'base64'));
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

  // Keep the full extension, network and image decoder real. Only delay delivery
  // of selected runtime replies to reproduce the two independent Pro findings.
  await ui.evaluate(() => {
    closeLightbox();
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    globalThis.replyGate = { mode: '', held: [], started: [], cardsDone: 0 };
    chrome.runtime.sendMessage = (message, callback) => {
      const gate = globalThis.replyGate;
      const url = message.payload?.url || '';
      if (message.type === 'PROBE_IMAGE_DIMENSIONS') gate.started.push(url);
      const kind = gate.mode === 'race' && message.type === 'GET_IMAGE_PREVIEW' && url.endsWith('/large-other.png') ? 'old'
        : gate.mode === 'race' && message.type === 'PROBE_IMAGE_DIMENSIONS' ? 'comparison'
        : gate.mode === 'queue' && message.type === 'PROBE_IMAGE_DIMENSIONS' && url.includes('?card=') ? 'card'
        : gate.mode === 'mapping' && message.type === 'PROBE_IMAGE_DIMENSIONS' && url.endsWith('/large.png') ? 'primary'
        : gate.mode === 'upgrade' && message.type === 'PROBE_IMAGE_DIMENSIONS' && url.endsWith('/upgrade.webp') ? 'upgrade' : '';
      if (!kind) return send(message, callback);
      return send(message, response => gate.held.push({ kind, release: () => callback(response) }));
    };
  });
  if (process.env.PIC_FULLSCREEN_REGRESSION !== 'queue') {
    await ui.evaluate(index => {
      closeFullscreenViewer(); dimensionProbeQueue?.clear(); cardDimensionCache.clear();
      previewCompatibility = true; replyGate.mode = 'race';
      const b = currentImages[index];
      const other = currentImages.find(image => image.id !== b.id);
      const a = { ...other, src: other.originalSrc, hdSrc: other.originalSrc, originalSrc: other.originalSrc };
      globalThis.regressionRecords = currentImages;
      currentImages = [a, b]; openFullscreenViewer(0);
    }, primaryIndex);
    await ui.waitForFunction(() => replyGate.held.some(reply => reply.kind === 'old'));
    await ui.evaluate(() => { fullscreenIndex = 1; void renderFullscreenImage(); });
    await ui.waitForFunction(() => replyGate.held.filter(reply => reply.kind === 'comparison').length === 2);
    await ui.evaluate(() => {
      const index = replyGate.held.findIndex(reply => reply.kind === 'old');
      replyGate.held.splice(index, 1)[0].release();
    });
    // Give an erroneous old blob assignment enough time to decode and fire load.
    await ui.waitForTimeout(200);
    assert.equal(await ui.locator('#fullscreen-image').getAttribute('src'), null);
    assert.equal(await ui.locator('#fullscreen-loading').evaluate(node => node.classList.contains('active')), true);
    await ui.evaluate(() => { replyGate.mode = ''; for (const reply of replyGate.held.splice(0)) reply.release(); });
    await ui.waitForFunction(() => !elements.fullscreenLoading.classList.contains('active') && elements.fullscreenImage.naturalWidth === 1600);
    assert.equal(await ui.evaluate(() => getLoadedPreviewUrl(elements.fullscreenImage).endsWith('/large.png')), true);
    passed('late A compatibility response cannot display A or stop B loading during B comparison');
    await ui.evaluate(() => { closeFullscreenViewer(); currentImages = regressionRecords; });
  }
  await ui.evaluate(async index => {
    closeFullscreenViewer(); closeLightbox(); dimensionProbeQueue?.clear(); cardDimensionCache.clear();
    previewCompatibility = false; replyGate.mode = 'queue'; replyGate.started = [];
    const image = currentImages[index];
    await getImageDimensions(image.src);
    const decoded = new Image(); decoded.src = image.src; await decoded.decode();
    globalThis.cardProbes = Array.from({ length: 24 }, (_, i) => getImageDimensions(`${image.src}?card=${i}`).then(() => { replyGate.cardsDone += 1; }));
    openFullscreenViewer(index);
  }, primaryIndex);
  await ui.waitForFunction(() => replyGate.held.filter(reply => reply.kind === 'card').length === 8);
  await ui.waitForFunction(() => elements.fullscreenImage.naturalWidth === 1600 && !elements.fullscreenLoading.classList.contains('active'), null, { timeout: 3000 });
  assert.equal(await ui.evaluate(() => replyGate.cardsDone), 0);
  await ui.evaluate(() => replyGate.held.shift().release());
  await ui.waitForFunction(() => replyGate.started.some(url => url.endsWith('/small.png')));
  await ui.evaluate(async () => {
    replyGate.mode = '';
    for (const reply of replyGate.held.splice(0)) reply.release();
    await Promise.all(cardProbes);
  });
  assert.equal((await inspectFullscreen()).width, 1600);
  passed('decoded 1600px image displays while 24 card probes wait; comparison gets a free slot without waiting for them all');

  if (process.env.PIC_FULLSCREEN_REGRESSION !== 'fallback') {
    await ui.evaluate(async index => {
      closeFullscreenViewer(); closeLightbox(); dimensionProbeQueue?.clear(); cardDimensionCache.clear(); resolvedHdUrlMap.clear();
      replyGate.mode = 'mapping';
      const image = { ...currentImages[index], width: 298, height: 398, area: 298 * 398, maxWidth: 0, maxHeight: 0, maxArea: 0 };
      image.hdSrc = image.src; image.displaySrc = image.src;
      globalThis.mappingImageId = image.id;
      await getImageDimensions(image.originalSrc, image.collectionId);
      currentImages = [image]; fullscreenActive = true; fullscreenIndex = 0;
      globalThis.renderDone = renderFullscreenImage();
    }, primaryIndex);
    await ui.waitForFunction(() => replyGate.held.some(reply => reply.kind === 'primary') && elements.fullscreenImage.naturalWidth === 450 && !elements.fullscreenLoading.classList.contains('active'));
    await ui.evaluate(async () => { replyGate.mode = ''; for (const reply of replyGate.held.splice(0)) reply.release(); await renderDone; });
    await ui.waitForFunction(() => elements.fullscreenImage.naturalWidth === 1600 && !elements.fullscreenLoading.classList.contains('active'));
    await ui.evaluate(async () => {
      const response = await sendMessage(MSG.GET_IMAGES);
      const fresh = response.images.find(image => image.id === mappingImageId);
      if (fresh.hdSrc !== fresh.src || fresh.maxWidth !== 1600) throw new Error('background must retain measured primary');
      if (getEffectiveHdSrc(fresh) !== fresh.src) throw new Error('stale local small override survived the primary upgrade');
      currentImages = [fresh]; await renderFullscreenImage();
      await resolveCardMaxDimensions(fresh);
      const next = await sendMessage(MSG.GET_IMAGES);
      currentImages = next.images.filter(image => image.id === mappingImageId);
      closeFullscreenViewer(); openFullscreenViewer(0);
    });
    await ui.waitForFunction(() => elements.fullscreenImage.naturalWidth === 1600 && !elements.fullscreenLoading.classList.contains('active'));
    passed('temporary small display upgrades to primary and remains large after background refresh, card completion and reopen');
  }

  await ui.evaluate(async origin => {
    closeFullscreenViewer(); closeLightbox(); dimensionProbeQueue?.clear(); cardDimensionCache.clear(); resolvedHdUrlMap.clear();
    replyGate.mode = 'upgrade';
    const stored = (await sendMessage(MSG.GET_IMAGES)).images.find(image => image.src.endsWith('/large.png'));
    const image = { ...stored, originalSrc: `${origin}/upgrade.webp`, hdSrc: stored.src, displaySrc: stored.src };
    await getImageDimensions(image.src, image.collectionId);
    currentImages = [image]; fullscreenActive = true; fullscreenIndex = 0;
    globalThis.renderDone = renderFullscreenImage();
  }, origin);
  await ui.waitForFunction(() => replyGate.held.some(reply => reply.kind === 'upgrade') && elements.fullscreenImage.naturalWidth === 1600 && !elements.fullscreenLoading.classList.contains('active'));
  failUpgrade = true;
  await ui.evaluate(async () => { replyGate.mode = ''; for (const reply of replyGate.held.splice(0)) reply.release(); await renderDone; });
  assert.equal(await ui.evaluate(() => getLoadedPreviewUrl(elements.fullscreenImage).endsWith('/large.png')), true);
  assert.equal((await inspectFullscreen()).width, 1600);
  assert.equal(await ui.evaluate(() => getEffectiveHdSrc(currentImages[0]).endsWith('/upgrade.jpg')), false);
  passed('failed 2400px upgrade with a decoded 450px JPG fallback preserves the working 1600px image and source mapping');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ extension, checks }, null, 2));
}
