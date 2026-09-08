import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'output', 'audit-followup');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, 'profile-'));
const downloads = await mkdtemp(resolve(output, 'downloads-'));
const { chromium } = await import(process.env.PIC_PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PIC_PLAYWRIGHT_MODULE)).href : 'playwright');
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v >>> 0; });
const png = (width, height, level = 6) => {
  const chunk = (name, data) => {
    const type = Buffer.from(name); const body = Buffer.concat([type, data]); let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, sum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 4 + 1) + 1 + x * 4; pixels[i] = 42; pixels[i + 1] = 103; pixels[i + 2] = 164; pixels[i + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level })), chunk('IEND', Buffer.alloc(0))]);
};
const largePng = png(2048, 1024, 0);
const smallPng = png(320, 180);
const stalePng = png(1920, 1080);
let racePhase = 0;
let origin;
const held = new Set();
const requestLog = [];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const record = { path, referer: req.headers.referer || '', at: Date.now() }; requestLog.push(record);
  res.setHeader('Cache-Control', 'no-store');
  const sendImage = bytes => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(bytes); };
  if (path === '/large-image') sendImage(largePng);
  else if (path === '/large') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Large image</title><img src="/large-image" width="320">'); }
  else if (path === '/preview') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Preview fallback</title><img src="/working-thumb.png" data-original="/broken-original.jpg" width="320" height="180">'); }
  else if (path === '/broken-original.jpg' || path === '/all-failed.jpg') { record.status = 404; res.writeHead(404); res.end('Expected invalid candidate'); }
  else if (path === '/working-hd.png') sendImage(stalePng);
  else if (/^\/comic-[AB]\/[12]$/.test(path)) {
    const [, chapter, number] = path.match(/^\/comic-([AB])\/([12])$/);
    const pager = number === '1' ? `<nav class="pagination"><span class="current">1</span><a href="/comic-${chapter}/2">2</a><a rel="next" href="/comic-${chapter}/2">下一页</a></nav>` : '';
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>Comic ${chapter} ${number}</title><img src="/comic-${chapter}-${number}-first.png" width="320" height="180"><img src="/comic-${chapter}-${number}-second.png" width="320" height="180">${pager}`);
  }
  else if (path === '/race') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Race</title><img src="/race-320x180.png" width="320" height="180">'); }
  else if (path === '/race.png' && racePhase === 0) {
    held.add(res); record.held = true;
    res.on('close', () => { held.delete(res); record.closed = true; });
  } else if (path === '/race.png') sendImage(png(racePhase === 1 ? 640 : 800, racePhase === 1 ? 360 : 450));
  else if (/^\/capacity-\d+\.png$/.test(path)) {
    const i = Number(path.match(/\d+/)[0]);
    const expected = i % 2 ? origin + '/' : origin.replace('127.0.0.1', 'localhost') + '/';
    record.expected = expected;
    if (req.headers.referer !== expected) { record.status = 403; res.writeHead(403); res.end('Wrong source'); }
    else {
      record.status = 200;
      if (i === 200) {
        record.contentType = 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': record.contentType }); res.end(smallPng);
      } else sendImage(smallPng);
    }
  } else if (path.endsWith('.png')) sendImage(smallPng);
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Fixture</title>Fixture'); }
});
await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
origin = `http://127.0.0.1:${server.address().port}`;
const report = { startedAt: new Date().toISOString(), checks: [], requestLog };
const errors = [];
let context;
const until = async (name, task, predicate, timeout = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) { last = await task(); if (predicate(last)) return last; await new Promise(resolveTimer => setTimeout(resolveTimer, 80)); }
  throw new Error(name + ' timed out: ' + JSON.stringify(last));
};
const pass = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); console.log('PASS ' + name + ': ' + JSON.stringify(details)); };
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.PIC_CHROMIUM_EXECUTABLE || chromium.executablePath(), headless: false, acceptDownloads: true, viewport: { width: 1200, height: 850 }, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--window-position=-32000,-32000'] });
  context.setDefaultTimeout(15000);
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const worker = context.serviceWorkers().find(item => item.url().endsWith('/background/background.js')) || await context.waitForEvent('serviceworker', { predicate: item => item.url().endsWith('/background/background.js') });
  const extension = 'chrome-extension://' + new URL(worker.url()).hostname;
  report.browser = context.browser().version();
  const control = await context.newPage();
  await control.goto(extension + '/offscreen/offscreen.html');
  const workerMessage = (tabId, type, payload = {}) => control.evaluate(input => chrome.runtime.sendMessage(input), { tabId, type, payload });
  const message = (page, tabId, type, payload = {}) => page.evaluate(input => chrome.runtime.sendMessage(input), { tabId, type, payload });
  const sourcePage = async path => {
    const page = await context.newPage(); await page.goto(origin + path);
    const tab = await until('source tab', () => worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), page.url()), Boolean);
    return { page, id: tab.id };
  };
  const view = async (id, extra = '') => { const page = await context.newPage(); await page.goto(extension + '/workspace/workspace.html?tabId=' + id + extra); return page; };

  const large = await sourcePage('/large');
  assert.equal((await workerMessage(large.id, 'SCAN')).success, true);
  const largeView = await view(large.id);
  const browserSession = await context.newCDPSession(largeView);
  await browserSession.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
  const largeCollection = await message(largeView, large.id, 'GET_IMAGES');
  const largeImage = largeCollection.images.find(image => image.src.endsWith('/large-image'));
  assert.ok(largeImage);
  await message(largeView, large.id, 'SET_SELECTION', { imageIds: [largeImage.id], selected: true });
  const saved = await message(largeView, large.id, 'DOWNLOAD_BATCH', { downloadMode: 'direct', enableConvertToJpg: false });
  assert.equal(saved.succeeded, 1, JSON.stringify(saved));
  const file = (await worker.evaluate(id => chrome.downloads.search({ id }), saved.results[0].downloadId))[0];
  assert.equal(file.state, 'complete'); assert.equal(file.url.startsWith('data:image/'), true);
  assert.deepEqual(await readFile(file.filename), largePng);
  const storage = await worker.evaluate(async () => ({ bytes: await chrome.storage.local.getBytesInUse(), jobs: await chrome.storage.local.get('pic_collector_direct_download_jobs_v1') }));
  assert.ok(storage.bytes < 1024 * 1024, String(storage.bytes));
  assert.equal(JSON.stringify(storage.jobs).includes('data:image/'), false);
  pass('A: real >8 MiB PNG downloads via Data URL without using image bytes as recovery metadata', { imageBytes: largePng.length, storageBytes: storage.bytes, downloadId: file.id });
  await largeView.close();

  const capacity = await sourcePage('/capacity');
  const seeds = Array.from({ length: 201 }, (_, i) => ({ src: `${origin}/capacity-${i}.png`, width: 320, height: 180, sourceUrl: (i % 2 ? origin : origin.replace('127.0.0.1', 'localhost')) + '/source' }));
  assert.equal((await workerMessage(capacity.id, 'INCREMENTAL_SCAN', { images: seeds })).success, true);
  const capacityView = await view(capacity.id);
  const capacityCollection = await message(capacityView, capacity.id, 'GET_IMAGES');
  assert.equal(capacityCollection.success, true); assert.equal(capacityCollection.images.length, 201); assert.equal(capacityCollection.referer.degraded, true);
  const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  assert.ok(rules.filter(rule => rule.id >= 20000 && rule.id < 20200).length <= 200);
  await until('compatibility previews render', () => capacityView.evaluate(() => [...document.querySelectorAll('.gallery-card img')].filter(img => img.complete && img.naturalWidth > 0).length), count => count >= 2);
  const lastId = capacityCollection.images.at(-1).id;
  await capacityView.locator(`.gallery-card[data-id="${lastId}"]`).evaluate(card => card.scrollIntoView({ block: 'center' }));
  await until('last candidate renders', () => capacityView.locator(`.gallery-card[data-id="${lastId}"] img`).evaluate(img => ({ loaded: img.complete && img.naturalWidth > 0, src: img.src })), image => image.loaded);
  assert.ok(requestLog.filter(item => item.path.startsWith('/capacity-') && item.status === 200).every(item => item.referer === item.expected));
  assert.ok(requestLog.some(item => item.path === '/capacity-200.png' && item.contentType === 'application/octet-stream'));
  pass('B: 201 candidates remain visible and compatibility loading renders even the uncovered final card', { records: capacityCollection.images.length, rules: capacityCollection.referer.installed, requested: capacityCollection.referer.requested, genericMimePreview: true });
  await workerMessage(capacity.id, 'INCREMENTAL_SCAN', { images: [
    { src: origin + '/hd-thumb.png', hdSrc: origin + '/working-hd.png', originalSrc: origin + '/hd-thumb.png', width: 320, height: 180, sourceUrl: origin + '/capacity' },
    { src: origin + '/all-failed.jpg', width: 320, height: 180, sourceUrl: origin + '/capacity' }
  ] });
  const updatedCapacity = await message(capacityView, capacity.id, 'GET_IMAGES');
  const hdImage = updatedCapacity.images.find(image => image.src.endsWith('/hd-thumb.png'));
  const failedImage = updatedCapacity.images.find(image => image.src.endsWith('/all-failed.jpg'));
  assert.ok(hdImage); assert.ok(failedImage); assert.equal(updatedCapacity.referer.degraded, true);
  const hdCard = capacityView.locator(`.gallery-card[data-id="${hdImage.id}"] img`);
  try { await hdCard.click({ timeout: 5000 }); } catch (error) {
    console.log('CLICK_GEOMETRY', await hdCard.evaluate(img => {
      const bounds = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scroll: node.scrollTop }; };
      const r = img.getBoundingClientRect();
      return { image: bounds(img), card: bounds(img.closest('.gallery-card')), gallery: bounds(document.getElementById('gallery')),
        hit: document.elementFromPoint(r.x + r.width / 2, Math.min(innerHeight - 1, r.y + r.height / 2))?.outerHTML.slice(0, 250) };
    }));
    await capacityView.screenshot({ path: resolve(output, 'click-failure.png') });
    throw error;
  }
  await until('compatibility thumbnail loads', () => capacityView.locator('#lightbox-image').evaluate(img => img.naturalWidth), width => width === 320);
  await capacityView.locator('#lightbox-original').click();
  await until('compatibility respects original selection', () => capacityView.locator('#lightbox-image').evaluate(img => img.naturalWidth), width => width === 1920);
  await capacityView.locator('#lightbox-fullscreen').click();
  await until('compatibility fullscreen preserves HD', () => capacityView.locator('#fullscreen-image').evaluate(img => img.naturalWidth), width => width === 1920);
  await capacityView.evaluate(id => { fullscreenIndex = currentImages.findIndex(image => image.id === id); return renderFullscreenImage(); }, failedImage.id);
  await until('all failed compatibility candidates reach terminal UI state', () => capacityView.evaluate(() => ({
    failed: elements.fullscreenImage.dataset.previewFailed, source: elements.fullscreenImage.getAttribute('src'),
    loading: elements.fullscreenLoading.classList.contains('active'), alt: elements.fullscreenImage.alt
  })), state => state.failed === '1' && !state.loading && state.source === null && state.alt === '图片加载失败');
  await capacityView.screenshot({ path: resolve(output, 'compatibility-failure.png') });
  pass('C: capacity compatibility preserves chosen HD and ends in a visible failure after all candidates fail');
  await capacityView.close(); await capacity.page.close();

  const preview = await sourcePage('/preview');
  assert.equal((await workerMessage(preview.id, 'SCAN')).success, true);
  const previewView = await view(preview.id);
  const previewCollection = await message(previewView, preview.id, 'GET_IMAGES');
  const previewImage = previewCollection.images.find(image => image.src.includes('broken-original'));
  assert.ok(previewImage, JSON.stringify(previewCollection.images));
  const card = previewView.locator(`.gallery-card[data-id="${previewImage.id}"] img`);
  await until('card fallback', () => card.evaluate(img => ({ src: img.src, loaded: img.complete && img.naturalWidth === 320 })), img => img.loaded && img.src.endsWith('/working-thumb.png'));
  await card.click();
  await until('lightbox fallback', () => previewView.locator('#lightbox-image').evaluate(img => ({ src: img.src, loaded: img.complete && img.naturalWidth === 320 })), img => img.loaded && img.src.endsWith('/working-thumb.png'));
  await previewView.locator('#lightbox-fullscreen').click();
  await until('fullscreen fallback', () => previewView.locator('#fullscreen-image').evaluate(img => ({ src: img.src, loaded: img.complete && img.naturalWidth === 320 })), img => img.loaded && img.src.endsWith('/working-thumb.png'));
  await previewView.locator('#fullscreen-close').click();
  pass('C: card, lightbox, and fullscreen all reach the loaded original after the preferred URL fails');
  await previewView.close(); await preview.page.close();

  const race = await sourcePage('/race');
  assert.equal((await workerMessage(race.id, 'SCAN')).success, true);
  const viewB = await view(race.id);
  const oldCollection = await message(viewB, race.id, 'GET_IMAGES');
  const oldImage = oldCollection.images[0]; assert.ok(oldImage.hdSrc.endsWith('/race.png'), oldImage.hdSrc);
  await until('old HD request starts', async () => held.size, count => count > 0);
  const viewA = await view(race.id);
  await viewA.locator('#btn-clear').click();
  const newCollectionId = await until('other view receives collection reset', () => viewB.evaluate(() => activeCollectionId), id => id && id !== oldCollection.collectionId);
  racePhase = 1;
  for (const response of held) { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(stalePng); }
  assert.equal((await message(viewA, race.id, 'SCAN')).success, true);
  const current = await until('new collection gets fresh dimensions', () => message(viewB, race.id, 'GET_IMAGES'), result => result.images?.some(image => image.maxWidth === 640));
  assert.equal(current.collectionId, newCollectionId); assert.equal(current.images[0].id, oldImage.id);
  const rejected = await message(viewB, race.id, 'UPDATE_IMAGE_METADATA', { imageId: oldImage.id, collectionId: oldCollection.collectionId, url: origin + '/old-wrong-hd.png', width: 3840, height: 2160 });
  assert.equal(rejected.updated, false); assert.equal(rejected.stale, true);
  const after = await message(viewA, race.id, 'GET_IMAGES');
  assert.equal(after.images[0].maxWidth, 640); assert.notEqual(after.images[0].hdSrc, origin + '/old-wrong-hd.png');
  pass('D: one workspace clears/recollects while another has an old probe, and the backend refuses the old token', { stableImageId: oldImage.id, width: after.images[0].maxWidth, oldTokenRejected: rejected.stale });
  racePhase = 2;
  await race.page.goto(origin + '/race?navigation=1');
  const navigationId = await until('navigation invalidates other workspaces', () => viewB.evaluate(() => activeCollectionId), id => id && id !== newCollectionId);
  await message(viewA, race.id, 'SCAN');
  const navigated = await until('navigated collection gets dimensions', () => message(viewB, race.id, 'GET_IMAGES'), result => result.images?.some(image => image.maxWidth === 800));
  assert.equal(navigated.collectionId, navigationId);
  const navigationRejected = await message(viewB, race.id, 'UPDATE_IMAGE_METADATA', { imageId: oldImage.id, collectionId: newCollectionId, url: origin + '/previous-page.png', width: 4000, height: 3000 });
  assert.equal(navigationRejected.stale, true);
  pass('D: source navigation also invalidates probes and writes across both workspaces');

  const comicModes = [];
  for (const autoScan of [false, true]) {
    const comic = await sourcePage('/comic-A/1');
    assert.equal((await workerMessage(comic.id, 'SCAN')).success, true);
    const comicView = await view(comic.id, '&comicMode=1');
    const comicState = () => comicView.evaluate(() => ({
      collectionId: activeCollectionId, mode: comicModeEnabled, nextUrl: comicPaginationInfo?.nextUrl,
      sequence: comicSequenceCache?.map(item => item.normalized), loading: comicPaginationLoading
    }));
    const chapterA = await until('comic mode detects chapter A and caches its sequence', comicState,
      state => state.mode && state.nextUrl?.endsWith('/comic-A/2') && state.sequence?.length === 2);
    if (autoScan) {
      await comicView.locator('label:has(#toggle-auto-scan)').click();
      await until('auto scan is enabled', () => comicView.evaluate(() => currentConfig.enableAutoScan), Boolean);
    }
    const requestStart = requestLog.length;
    await comic.page.goto(origin + '/comic-B/1');
    const chapterB = await until('same workspace detects chapter B after source navigation', comicState,
      state => state.collectionId !== chapterA.collectionId && state.nextUrl?.endsWith('/comic-B/2'));
    assert.ok(!chapterB.sequence || chapterB.sequence.every(url => url.includes('/comic-B-')));
    if (!autoScan) await comicView.locator('#btn-scan').click();
    await until('chapter B sequence replaces chapter A', comicState,
      state => state.sequence?.length === 2 && state.sequence.every(url => url.includes('/comic-B-')));
    for (const type of ['GET_COMIC_SEQUENCE', 'GET_COMIC_PAGINATION', 'LOAD_COMIC_PAGINATION_PAGES']) {
      const stale = await message(comicView, comic.id, type, { collectionId: chapterA.collectionId, nextUrl: origin + '/comic-A/2' });
      assert.equal(stale.stale, true, type);
    }
    await comicView.locator('#comic-banner-pagination-wait').fill('1');
    await comicView.locator('#comic-banner-pagination-go').click();
    const collected = await until('Go loads only the next page of chapter B', () => message(comicView, comic.id, 'GET_IMAGES'),
      result => result.images?.some(image => image.comicPageUrl?.endsWith('/comic-B/2')));
    await until('comic pagination finishes', comicState, state => !state.loading);
    assert.ok(collected.images.every(image => image.src.includes('/comic-B-')), JSON.stringify(collected.images));
    assert.equal(requestLog.slice(requestStart).some(item => item.path === '/comic-A/2'), false);
    comicModes.push({ autoScan, collectionChanged: true, loadedChapter: 'B', records: collected.images.length });
    await comicView.close(); await comic.page.close();
  }
  pass('D: one comic workspace navigates A to B, refreshes order and Go target, and rejects old requests', { modes: comicModes });
  await until('finished direct job is deleted from storage', () => worker.evaluate(id => chrome.storage.local.get('pic_collector_direct_download_jobs_v1').then(value => !value.pic_collector_direct_download_jobs_v1?.[id]), large.id), Boolean, 22000);
  pass('A: completed recovery records are physically removed after their lifetime');
  assert.deepEqual(errors, []);
  report.success = true;
} catch (error) { report.success = false; report.error = error.stack || String(error); console.error(report.error); process.exitCode = 1; }
finally {
  if (context) await context.close();
  for (const response of held) response.destroy();
  server.closeAllConnections(); await new Promise(resolveClosed => server.close(resolveClosed));
  report.finishedAt = new Date().toISOString(); report.pageErrors = errors;
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + resolve(output, 'report.json'));
}
