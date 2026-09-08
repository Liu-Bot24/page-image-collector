import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createTabStateManager } from '../background/stateManager.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] || 'sample';
if (!/^[a-z0-9_-]+$/i.test(label)) throw new Error('Use a short alphanumeric sample name');
const output = resolve(root, 'output', 'performance');
await mkdir(output, { recursive: true });
const report = { label, startedAt: new Date().toISOString(), storageCpu: [], scans: [], rows: [] };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const key = 'pic_collector_tab_states_v2';
for (const count of [250, 1000, 3000]) {
  let savedBytes = 0;
  globalThis.chrome = { storage: { local: { get: async () => ({}), set: async payload => { savedBytes = Buffer.byteLength(JSON.stringify(payload)); } } } };
  const manager = createTabStateManager(); await manager.ensureReady();
  for (const tabId of [1, 2]) manager.mergeImages(tabId, Array.from({ length: count }, (_, i) => ({
    src: `https://cdn.example/tab-${tabId}/image-${i}.png`, width: 320, height: 180, sourceUrl: `https://source.example/${tabId}`
  })));
  await manager.flushPersistence();
  const id = manager.getAllImages(1)[0].id;
  const timings = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now(); manager.setSelectionByIds(1, [id], i % 2 === 0); await manager.flushPersistence(); timings.push(performance.now() - start);
  }
  report.storageCpu.push({ records: count * 2, bytesPerSelectionWrite: savedBytes, cpuMedianMs: median(timings) });
}
delete globalThis.chrome;

const { chromium } = await import(process.env.PIC_PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PIC_PLAYWRIGHT_MODULE)).href : 'playwright');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=', 'base64');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.endsWith('.png')) { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }); res.end(pixel); return; }
  const nodes = Number(url.searchParams.get('nodes')) || 0;
  const body = Array.from({ length: nodes }, (_, i) => i % 5 === 0
    ? `<img loading="lazy" src="/image-${nodes}-${i}.png" width="128" height="128">` : `<div class="tile">${i}</div>`).join('');
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!doctype html><title>Performance fixture ${nodes}</title><style>.tile{height:1px}img{width:128px;height:128px}</style>${body}`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(output, 'profile-'));
let context;
const until = async (read, predicate, timeout = 25000) => {
  const start = performance.now(); let value;
  while (performance.now() - start < timeout) { value = await read(); if (predicate(value)) return value; await new Promise(done => setTimeout(done, 80)); }
  throw new Error('Benchmark did not settle: ' + JSON.stringify(value));
};
try {
  context = await chromium.launchPersistentContext(profile, { headless: false, executablePath: process.env.PIC_CHROMIUM_EXECUTABLE || chromium.executablePath(), viewport: { width: 1200, height: 850 }, args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--window-position=-32000,-32000'] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extension = `chrome-extension://${new URL(worker.url()).hostname}`;
  const control = await context.newPage(); await control.goto(extension + '/offscreen/offscreen.html');
  const message = (tabId, type, payload = {}) => control.evaluate(input => chrome.runtime.sendMessage(input), { tabId, type, payload });
  let largestId;
  for (const nodes of [1000, 6000, 12000]) {
    const page = await context.newPage(); await page.goto(`${origin}/fixture?nodes=${nodes}`);
    const sourceTab = await until(() => worker.evaluate(url => chrome.tabs.query({}).then(tabs => tabs.find(tab => tab.url === url)), page.url()), Boolean);
    largestId = sourceTab.id;
    assert.equal((await message(largestId, 'SCAN')).success, true);
    await page.evaluate(() => {
      window.performanceLongTasks = [];
      new PerformanceObserver(list => window.performanceLongTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: false });
    });
    const timings = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now(); const response = await message(largestId, 'SCAN');
      assert.equal(response.success, true); timings.push(performance.now() - start);
    }
    await page.evaluate(() => new Promise(done => setTimeout(done, 100)));
    const longTasks = await page.evaluate(() => window.performanceLongTasks);
    const images = await message(largestId, 'GET_IMAGES');
    report.scans.push({ nodes, images: images.images.length, endToEndMedianMs: median(timings), longTasks });
    console.log('SCAN', JSON.stringify(report.scans.at(-1)));
  }
  const collection = await message(largestId, 'GET_IMAGES');
  const selectionTimings = [];
  for (let i = 0; i < 7; i++) { const start = performance.now(); await message(largestId, 'TOGGLE_SELECT', { imageId: collection.images[0].id }); selectionTimings.push(performance.now() - start); }
  report.storageBrowser = { totalStateBytes: await worker.evaluate(key => chrome.storage.local.getBytesInUse(key), key), selectionMedianMs: median(selectionTimings) };
  await message(largestId, 'SET_CONFIG', { enableHD: false, enableSizeSort: false });
  const view = await context.newPage(); await view.goto(extension + '/workspace/workspace.html?tabId=' + largestId);
  await until(() => view.evaluate(() => ({ enabled: virtualGridState.enabled, cards: document.querySelectorAll('.gallery-card').length, committed: galleryRenderToken === committedGalleryRenderToken, pending: cardDimensionTasks.size })), value => value.enabled && value.cards > 0 && value.committed && value.pending === 0);
  report.virtualViewport = await view.evaluate(() => ({
    height: elements.gallery.clientHeight, windowHeight: innerHeight,
    totalRows: virtualGridState.rows.length, renderedRows: virtualGridState.spacer.childElementCount
  }));
  const bounded = report.virtualViewport.renderedRows < report.virtualViewport.totalRows / 2;
  if (process.argv[3] === 'verify') assert.equal(bounded, true, 'the virtualizer must use the viewport rather than the full document height');
  for (let i = 0; bounded && i < 12; i++) {
    const before = await view.evaluate(() => {
      window.performanceRows = new Map([...virtualGridState.spacer.children].map(row => [row.firstElementChild?.dataset.id, row]));
      const key = virtualGridState.renderedKey; elements.gallery.scrollTop += virtualGridState.metrics.rowHeight;
      return { key, token: galleryRenderToken, mountToken: virtualGridState.renderToken, committed: committedGalleryRenderToken };
    });
    await until(() => view.evaluate(() => virtualGridState.renderedKey), key => key !== before.key);
    report.rows.push(await view.evaluate(before => {
      const rows = [...virtualGridState.spacer.children];
      return { renderStable: galleryRenderToken === before.token && virtualGridState.renderToken === before.mountToken && committedGalleryRenderToken === before.committed, rows: rows.length,
        overlap: rows.filter(row => window.performanceRows.has(row.firstElementChild?.dataset.id)).length,
        reused: rows.filter(row => window.performanceRows.get(row.firstElementChild?.dataset.id) === row).length };
    }, before));
  }
  if (process.argv[3] === 'verify') {
    const stableRows = report.rows.filter(row => row.renderStable);
    assert.ok(stableRows.length >= 8, 'at least eight scroll samples must be stable');
    assert.ok(stableRows.every(row => row.reused === row.overlap), 'overlapping virtual rows must retain their DOM nodes');
  }
  report.responsive = [];
  report.marquee = [];
  for (const { reverse, shrink = false, replace, expected } of [
    { reverse: false, replace: true, expected: 128 }, { reverse: true, replace: true, expected: 128 },
    { reverse: false, shrink: true, replace: true, expected: 8 }, { reverse: false, replace: false, expected: 120 }
  ]) {
    await view.evaluate(() => setActionStatus('框选测试准备中'));
    const geometry = await view.evaluate(reverse => {
      const r = elements.gallery.getBoundingClientRect();
      const m = virtualGridState.metrics;
      elements.gallery.scrollTop = reverse ? 30 * m.rowHeight : 0;
      return { left: r.left + 4, top: r.top + 4, right: r.left + elements.gallery.clientWidth - 12,
        bottom: r.top + m.rowHeight + m.cardHeight / 2, distance: 30 * m.rowHeight };
    }, reverse);
    await view.mouse.move(reverse ? geometry.right : geometry.left, reverse ? geometry.bottom : geometry.top);
    if (replace) await view.keyboard.down('Control');
    await view.mouse.down();
    assert.equal(await view.evaluate(() => Boolean(dragSelectState)), true, 'pointerdown must start a gallery marquee rather than drag the scrollbar');
    if (replace) await view.keyboard.up('Control');
    await view.mouse.move(reverse ? geometry.left : geometry.right, reverse ? geometry.top : geometry.bottom, { steps: 5 });
    await view.mouse.wheel(0, reverse ? -geometry.distance * 2 : geometry.distance);
    await until(() => view.evaluate(() => elements.gallery.scrollTop), scroll => Math.abs(scroll - (reverse ? 0 : geometry.distance)) < 2);
    if (shrink) {
      await view.mouse.wheel(0, -geometry.distance * 2);
      await until(() => view.evaluate(() => elements.gallery.scrollTop), scroll => scroll === 0);
    }
    const preview = await until(() => view.evaluate(() => ({ hits: dragPreviewIds.size, mounted: virtualGridState.rowNodes.size })),
      state => state.hits === (shrink ? 8 : 128));
    await view.mouse.up(); await view.keyboard.up('Control');
    const selected = await until(() => view.evaluate(() => ({ count: selectedIds.size, active: Boolean(dragSelectState),
      status: elements.actionStatus.textContent, committed: galleryRenderToken === committedGalleryRenderToken })),
    state => !state.active && state.committed && state.status.startsWith(replace ? '框选覆盖' : '框选切换'));
    report.marquee.push({ reverse, shrink, replace, selected: selected.count, ...preview });
    if (process.argv[3] === 'verify') {
      assert.equal(selected.count, expected, 'cross-screen selection must track the current rectangle');
      assert.ok(preview.mounted < 25, 'marquee selection must not mount all rows');
    }
  }
  for (const viewport of [{ width: 1200, height: 850 }, { width: 390, height: 844 }, { width: 1200, height: 360 }]) {
    await view.setViewportSize(viewport);
    await until(() => view.evaluate(() => ({ committed: galleryRenderToken === committedGalleryRenderToken,
      width: elements.gallery.clientWidth, rowWidth: virtualGridState.spacer?.clientWidth || 0 })),
    state => state.committed && state.rowWidth > 0 && state.rowWidth <= state.width);
    const geometry = await view.evaluate(() => ({ gallery: elements.gallery.clientHeight,
      card: document.querySelector('.gallery-card')?.getBoundingClientRect().height,
      width: document.documentElement.scrollWidth, viewport: innerWidth }));
    if (process.argv[3] === 'verify') { assert.ok(geometry.gallery >= 160); assert.ok(geometry.card > 100); assert.ok(geometry.width <= geometry.viewport); }
    report.responsive.push({ windowSize: viewport, ...geometry });
    await view.screenshot({ path: resolve(output, `${label}-${viewport.width}x${viewport.height}.png`) });
  }
  report.browserVersion = context.browser().version(); report.success = true;
  console.log('STORAGE', JSON.stringify(report.storageCpu), JSON.stringify(report.storageBrowser));
  console.log('ROWS', JSON.stringify(report.rows));
  console.log('VIEWPORT', JSON.stringify(report.virtualViewport));
} catch (error) { report.success = false; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  if (context) await context.close();
  server.closeAllConnections(); await new Promise(done => server.close(done));
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, label + '.json'), JSON.stringify(report, null, 2));
}
