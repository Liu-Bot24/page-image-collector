import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'output', 'image-candidate-race');
await mkdir(output, { recursive: true });
const { chromium } = await import(process.env.PIC_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PIC_PLAYWRIGHT_MODULE)).href : 'playwright');
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const png = (width, height) => {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 4 + 1) + 1 + x * 4; pixels[i] = 45; pixels[i + 1] = 100; pixels[i + 2] = 145; pixels[i + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
};
const images = new Map([
  ['/landscape_600x0.webp', png(600, 450)], ['/portrait_600x0.webp', png(600, 800)],
  ['/landscape.jpg', png(2700, 2025)], ['/portrait.jpg', png(1800, 2400)],
  ['/smaller_600x0.webp', png(600, 800)], ['/smaller.webp', png(400, 500)]
]);
const recoveredSources = new Set();
const inFlightResponses = new Map();
for (const outcome of ['success', 'failure']) {
  const key = `inflight-${outcome}`;
  images.set(`/retry-${key}_600x0.webp`, png(600, 800));
  images.set(`/retry-${key}.webp`, png(1800, 2400));
  images.set(`/retry-${key}.jpg`, png(1200, 1600));
  inFlightResponses.set(`/retry-${key}.webp`, { phase: 'held', responses: [] });
}
for (const ui of ['workspace', 'popup', 'workspace-large']) {
  images.set(`/retry-${ui}_600x0.webp`, png(600, 800));
  images.set(`/retry-${ui}.webp`, png(1800, 2400));
  images.set(`/retry-${ui}.jpg`, ui === 'workspace-large' ? png(1200, 1600) : png(400, 500));
}
const heldResponses = []; const requests = [];
let releasePortrait = false;
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture').pathname;
  requests.push({ path, destination: req.headers['sec-fetch-dest'] || '' });
  if (['/recovery-workspace', '/recovery-popup', '/recovery-workspace-large', '/recovery-inflight-success', '/recovery-inflight-failure'].includes(path)) {
    const ui = path.slice('/recovery-'.length);
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>Candidate recovery ${ui}</title><div role="img" style="width:298px;height:398px;background-image:url(/retry-${ui}_600x0.webp)"></div>`);
    return;
  }
  if (path === '/comparison') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Completed candidate comparison</title><div role="img" style="width:298px;height:398px;background-image:url(/smaller_600x0.webp)"></div>');
    return;
  }
  if (path === '/gallery') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Pending original image fixture</title>' + ['landscape', 'portrait'].map(name =>
      `<a href="/viewer?id=${name}"><div role="img" style="width:300px;height:400px;background-image:url(/${name}_600x0.webp)"></div></a>`).join(''));
    return;
  }
  if (!images.has(path)) { res.writeHead(404); res.end('Not found'); return; }
  res.setHeader('Cache-Control', 'no-store');
  const inFlight = inFlightResponses.get(path);
  if (inFlight && !recoveredSources.has(path)) {
    if (inFlight.phase === 'held' && req.headers['sec-fetch-dest'] === 'empty') { inFlight.responses.push(res); return; }
    res.writeHead(503); res.end('Native preview unavailable'); return;
  }
  if (/^\/retry-(workspace|popup|workspace-large)\.webp$/.test(path) && !recoveredSources.has(path)) {
    res.writeHead(503); res.end('Temporarily unavailable'); return;
  }
  // Exercise the normal <img> fallback used when a server rejects programmatic fetches.
  if (req.headers['sec-fetch-dest'] === 'empty' && !path.startsWith('/smaller') && !path.startsWith('/retry-')) {
    res.writeHead(403); res.end('Use image requests'); return;
  }
  res.setHeader('Content-Type', 'image/png');
  if (path === '/portrait.jpg' && !releasePortrait) { heldResponses.push(res); return; }
  res.end(images.get(path));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const until = async (read, predicate, label) => {
  let value;
  for (let i = 0; i < 150; i++) { value = await read(); if (predicate(value)) return value; await new Promise(done => setTimeout(done, 80)); }
  throw new Error(label + ': ' + JSON.stringify(value));
};
const observePopupInit = view => view.addInitScript(() => {
  globalThis.popupInitFinished = false;
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (message, done) => send(message, response => {
    if (message.type === 'GET_DOWNLOAD_STATUS') globalThis.popupInitFinished = true;
    done(response);
  });
});
const bindPopupSource = async (view, tabId) => {
  // Tab-hosted popups lack the native action's source context; wait for init before assigning it.
  await until(() => view.evaluate(() => popupInitFinished), Boolean, 'popup initialization must finish');
  await view.evaluate(async source => { sourceTabId = source; await renderImages(); }, tabId);
};
let context;
const report = { requests, startedAt: new Date().toISOString() };
try {
  const profile = await mkdtemp(resolve(output, 'profile-'));
  context = await chromium.launchPersistentContext(profile, { headless: false,
    executablePath: process.env.PIC_CHROMIUM_EXECUTABLE || chromium.executablePath(), viewport: { width: 1200, height: 850 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--window-position=-32000,-32000'] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extension = `chrome-extension://${new URL(worker.url()).hostname}`;
  const control = await context.newPage(); await control.goto(extension + '/offscreen/offscreen.html');
  const page = await context.newPage(); await page.goto(origin + '/gallery');
  const tab = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), page.url());
  const message = (type, payload = {}) => control.evaluate(input => chrome.runtime.sendMessage(input), { type, tabId: tab.id, payload });
  assert.equal((await message('SCAN')).success, true);
  const view = await context.newPage(); await view.goto(extension + '/workspace/workspace.html?tabId=' + tab.id);
  await until(() => heldResponses.length, count => count > 0, 'original probe must start');
  await until(() => view.evaluate(() => ({ generation: galleryRenderToken, committed: committedGalleryRenderToken,
    ready: currentImages.some(image => getCardMeta(image).width === 2700) })), state => state.ready && state.generation >= 2 && state.committed === state.generation,
  'the neighboring original must trigger a completed gallery refresh');
  const before = (await message('GET_IMAGES')).images.find(image => image.src.endsWith('/portrait_600x0.webp'));
  report.beforeOriginal = before;
  assert.equal(before.maxWidth, 600); assert.equal(before.maxHeight, 800);
  assert.equal(before.hdSrc, origin + '/portrait.webp', 'the thumbnail must not erase the pending original');
  releasePortrait = true;
  for (const response of heldResponses) if (!response.writableEnded) response.end(images.get('/portrait.jpg'));
  const after = await until(async () => (await message('GET_IMAGES')).images.find(image => image.id === before.id),
    image => image.maxWidth === 1800 && image.maxHeight === 2400, 'late original must update the same record');
  assert.equal(after.hdSrc, origin + '/portrait.jpg'); assert.equal(after.hdSrcVerified, true);
  await until(() => view.evaluate(id => { const image = currentImages.find(image => image.id === id); return image && getCardMeta(image); }, before.id),
    meta => meta?.width === 1800 && meta.height === 2400, 'card must display the late original dimensions');
  await view.screenshot({ path: resolve(output, 'result.png') });
  report.afterOriginal = after; report.browser = context.browser().version();
  console.log('PASS pending original survives thumbnail measurement and neighboring gallery refresh: 600x800 -> 1800x2400');
  await view.close();
  report.comparisons = [];
  for (const ui of ['workspace', 'popup']) {
    await page.goto(origin + '/comparison?' + ui);
    assert.equal((await message('SCAN')).success, true);
    const comparison = await context.newPage();
    if (ui === 'popup') await observePopupInit(comparison);
    await comparison.addInitScript(() => {
      globalThis.comparisonUpdates = [];
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (...args) => {
        if (args[0]?.type === 'UPDATE_IMAGE_METADATA') globalThis.comparisonUpdates.push(args[0].payload);
        return send(...args);
      };
    });
    await comparison.goto(extension + `/${ui}/${ui}.html?tabId=` + tab.id);
    // A tab-hosted popup has no native action-popup active-tab context.
    if (ui === 'popup') await bindPopupSource(comparison, tab.id);
    const stored = await until(async () => ({ ...(await message('GET_IMAGES')).images.find(image => image.src.endsWith('/smaller_600x0.webp')),
      updates: await comparison.evaluate(() => comparisonUpdates) }),
      image => image?.hdSrc === image.src && image.maxWidth === 600 && image.maxHeight === 800,
      ui + ' must persist the larger primary URL through the real worker message dispatcher');
    report.comparisons.push({ ui, src: stored.src, hdSrc: stored.hdSrc, width: stored.maxWidth, height: stored.maxHeight });
    console.log(`PASS ${ui} completed comparison retains 600x800 primary over 400x500 HD candidate`);
    await comparison.close();
  }
  const recoveryCases = [];
  report.inFlight = [];
  for (const outcome of ['success', 'failure']) {
    const key = `inflight-${outcome}`;
    const originalPath = `/retry-${key}.webp`;
    const held = inFlightResponses.get(originalPath);
    const source = await context.newPage(); await source.goto(origin + '/recovery-' + key);
    const sourceTab = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), source.url());
    const send = (type, payload = {}) => control.evaluate(input => chrome.runtime.sendMessage(input), { type, tabId: sourceTab.id, payload });
    assert.equal((await send('SCAN')).success, true);
    const recoveryView = await context.newPage(); await recoveryView.goto(extension + '/workspace/workspace.html?tabId=' + sourceTab.id);
    await until(() => held.responses.length, count => count > 0, key + ' card probe must be in flight');
    await recoveryView.locator('.gallery-card').click();
    await recoveryView.locator('#lightbox-fullscreen').click();
    await until(() => recoveryView.locator('#fullscreen-image').evaluate(image => image.naturalWidth),
      width => width === 1200, key + ' real fullscreen onload must select the JPG while the card probe waits');
    const before = await until(async () => (await send('GET_IMAGES')).images[0],
      image => image?.hdSrc.endsWith('.jpg') && image.maxWidth === 1200, key + ' fullscreen must persist its actual JPG');
    await recoveryView.evaluate(() => renderGallery());
    await until(() => recoveryView.evaluate(() => galleryRenderToken === committedGalleryRenderToken), Boolean,
      key + ' gallery refresh must finish before releasing the original request');
    const originalRequests = requests.filter(request => request.path === originalPath && request.destination === 'empty').length;
    assert.equal(originalRequests, 1, 'refresh must share the in-flight background transport');
    held.phase = outcome;
    if (outcome === 'success') recoveredSources.add(originalPath);
    for (const response of held.responses) if (!response.writableEnded) {
      if (outcome === 'success') { response.setHeader('Content-Type', 'image/png'); response.end(images.get(originalPath)); }
      else { response.writeHead(503); response.end('Original probe failed'); }
    }
    if (outcome === 'success') {
      const after = await until(async () => (await send('GET_IMAGES')).images.find(image => image.id === before.id),
        image => image?.maxWidth === 1800 && image.hdSrc === origin + originalPath, 'late original success must update the record');
      report.inFlight.push({ outcome, before, after, originalRequests });
      console.log('PASS fullscreen-first refresh transfers the pending original and accepts its late success');
      await recoveryView.close(); await source.close();
    } else {
      const cache = await until(() => recoveryView.evaluate(id => {
        const entry = cardDimensionCache.get(id);
        return entry && { width: entry.width, retryAt: entry.retryAt };
      }, before.id), entry => entry?.width === 1200 && Number.isFinite(entry.retryAt), 'late failure must retain a finite retry');
      const requestCount = requests.filter(request => request.path === originalPath).length;
      report.inFlight.push({ outcome, before, originalRequests });
      recoveryCases.push({ ui: 'workspace', key, send, recoveryView, source, before, cache, requestCount });
    }
  }
  for (const key of ['workspace', 'popup', 'workspace-large']) {
    const ui = key === 'popup' ? 'popup' : 'workspace';
    const largerFallback = key === 'workspace-large';
    const source = await context.newPage(); await source.goto(origin + '/recovery-' + key);
    const sourceTab = await worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), source.url());
    const send = (type, payload = {}) => control.evaluate(input => chrome.runtime.sendMessage(input), { type, tabId: sourceTab.id, payload });
    assert.equal((await send('SCAN')).success, true);
    const recoveryView = await context.newPage();
    if (ui === 'popup') await observePopupInit(recoveryView);
    await recoveryView.goto(extension + `/${ui}/${ui}.html?tabId=` + sourceTab.id);
    if (ui === 'popup') await bindPopupSource(recoveryView, sourceTab.id);
    const cache = await until(() => recoveryView.evaluate(() => {
      const image = currentImages.find(image => image.src.includes('/retry-'));
      const entry = image && cardDimensionCache.get(image.id);
      return entry && { width: entry.width, height: entry.height, retryAt: entry.retryAt, now: Date.now() };
    }), entry => entry?.width === (largerFallback ? 1200 : 600) && Number.isFinite(entry.retryAt), key + ' failed original must remain retryable');
    const before = (await send('GET_IMAGES')).images.find(image => image.src.includes('/retry-'));
    assert.equal(before.hdSrc, `${origin}/retry-${key}.${largerFallback ? 'jpg' : 'webp'}`);
    assert.equal(before.formatTrusted, true);
    const requestCount = requests.filter(request => request.path === `/retry-${key}.webp`).length;
    recoveryCases.push({ ui, key, send, recoveryView, source, before, cache, requestCount });
  }
  const remaining = Math.max(...recoveryCases.map(item => item.cache.retryAt - Date.now())) + 100;
  console.log(`Waiting ${Math.max(0, remaining)} ms for real failed-original retry deadlines`);
  await new Promise(done => setTimeout(done, Math.max(0, remaining)));
  report.recoveries = [];
  for (const { ui, key, send, recoveryView, source, before, requestCount } of recoveryCases) {
    recoveredSources.add(`/retry-${key}.webp`);
    await recoveryView.evaluate(async name => { if (name === 'popup') await renderImages(); else await renderGallery(); }, ui);
    const after = await until(async () => (await send('GET_IMAGES')).images.find(image => image.id === before.id),
      image => image?.maxWidth === 1800 && image.maxHeight === 2400 && image.hdSrcVerified,
      key + ' recovered original must be persisted despite unchanged trusted format');
    assert.equal(after.hdSrc, `${origin}/retry-${key}.webp`);
    assert.ok(requests.filter(request => request.path === `/retry-${key}.webp`).length > requestCount);
    report.recoveries.push({ ui, key, before, after });
    console.log(`PASS ${key} original retries after real cooldown and persists 1800x2400 with unchanged format`);
    await recoveryView.close(); await source.close();
  }
  report.success = true;
} catch (error) { report.success = false; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  for (const held of inFlightResponses.values()) for (const response of held.responses) if (!response.writableEnded) response.end();
  for (const response of heldResponses) if (!response.writableEnded) response.end(images.get('/portrait.jpg'));
  await context?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  report.finishedAt = new Date().toISOString(); await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
}
