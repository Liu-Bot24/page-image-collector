import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import vm from "node:vm";
import { createTabStateManager } from "../background/stateManager.js";

const flush = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const record = (overrides = {}) => ({
  id: "image", src: "https://cdn.example/thumb.jpg", hdSrc: "https://cdn.example/full.jpg",
  width: 320, height: 180, area: 57600, format: "jpg", ...overrides
});

const backgroundSource = await readFile(new URL('../background/background.js', import.meta.url), 'utf8');
const metadataCase = 'case MSG.UPDATE_IMAGE_METADATA:';
const metadataDispatch = new vm.Script('(async () => {' + backgroundSource.slice(
  backgroundSource.indexOf(metadataCase) + metadataCase.length,
  backgroundSource.indexOf('case MSG.SET_CONFIG:', backgroundSource.indexOf(metadataCase))) + '})()');
const dispatchMetadata = (manager, payload) => metadataDispatch.runInNewContext({
  stateManager: manager, payload, tabId: 7, tabsNavigating: new Set(), isRuntimeCacheClearActive: () => false
});

for (const succeeds of [true, false]) {
  test(`workspace transfers an in-flight original to a replacement task when the original ${succeeds ? 'succeeds' : 'fails then recovers'}`, async () => {
    const originalChrome = globalThis.chrome;
    globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
    const manager = createTabStateManager();
    try {
      await manager.ensureReady();
      manager.mergeImages(7, [record({ hdSrc: 'https://cdn.example/full.webp' })]);
      const [fixture] = manager.getAllImages(7);
      const originalHd = fixture.hdSrc;
      let finishProbe;
      let available = false;
      let hdRequests = 0;
      const ui = await loadUi('workspace', ({ type, payload }) => {
        if (type === 'PROBE_IMAGE_DIMENSIONS') {
          if (payload.url === originalHd) {
            hdRequests++;
            if (!available) return new Promise(resolve => { finishProbe = resolve; });
            return { success: true, width: 1800, height: 2400 };
          }
          return { success: true, width: payload.url === fixture.src ? 600 : 1200,
            height: payload.url === fixture.src ? 800 : 1600 };
        }
        if (type === 'UPDATE_IMAGE_METADATA') return dispatchMetadata(manager, payload);
        return { success: true };
      });
      ui.put('fixture', fixture);
      const original = ui.run('resolveCardMaxDimensions(fixture)'); await flush();
      ui.run("rememberImageDimensions(fixture, { width: 1200, height: 1600 }, { url: 'https://cdn.example/full.jpg' })");
      await flush();
      assert.equal(manager.getAllImages(7)[0].hdSrc, 'https://cdn.example/full.jpg');
      ui.put('fresh', manager.getAllImages(7)[0]);
      const replacement = ui.run('resolveCardMaxDimensions(fresh)'); await flush();
      assert.equal(hdRequests, 1, 'replacement must share the pending transport');
      finishProbe(succeeds ? { success: true, width: 1800, height: 2400 } : { success: false });
      await flush();
      for (const image of ui.images) if (image.src === originalHd) image.onerror?.();
      await Promise.all([original, replacement]); await flush();
      if (!succeeds) {
        assert.ok(ui.run('cardDimensionCache.get(fixture.id).retrySources.includes(fixture.hdSrc)'), 'replacement must retain the failed original');
        available = true; await ui.tick(31000);
        ui.put('fresh', manager.getAllImages(7)[0]);
        await ui.run('resolveCardMaxDimensions(fresh)'); await flush();
        assert.equal(hdRequests, 2);
      }
      const [stored] = manager.getAllImages(7);
      assert.equal(stored.maxWidth, 1800);
      assert.equal(stored.maxHeight, 2400);
      assert.equal(stored.hdSrc, originalHd);
    } finally {
      await manager.flushPersistence(); globalThis.chrome = originalChrome;
    }
  });
}

test('workspace does not transfer pending probes to a different source with the same image ID', async () => {
  let finishOld;
  const updates = [];
  const ui = await loadUi('workspace', ({ type, payload }) => {
    if (type === 'PROBE_IMAGE_DIMENSIONS' && payload.url.includes('/old-')) return new Promise(resolve => { finishOld = resolve; });
    if (type === 'PROBE_IMAGE_DIMENSIONS') return { success: true, width: 900, height: 700 };
    if (type === 'UPDATE_IMAGE_METADATA') updates.push(payload);
    return { success: true };
  });
  ui.put('old', record({ src: 'https://cdn.example/old-source.jpg', hdSrc: '' }));
  const oldTask = ui.run('resolveCardMaxDimensions(old)'); await flush();
  ui.put('fresh', record({ src: 'https://cdn.example/new-source.jpg', hdSrc: '' }));
  let freshDone = false;
  const freshTask = ui.run('resolveCardMaxDimensions(fresh)').then(result => { freshDone = true; return result; });
  await flush();
  assert.equal(freshDone, true, 'the new source must not wait on the unrelated old request');
  finishOld({ success: true, width: 3000, height: 2000 });
  await Promise.all([oldTask, freshTask]); await flush();
  assert.equal(ui.run('cardDimensionCache.get(fresh.id).width'), 900);
  assert.equal(updates.some(update => update.url.includes('/old-')), false);
});

for (const verified of [false, true]) {
  test(`popup ${verified ? 'does not resend' : 'persists'} an equal-sized HD result when format is already trusted`, async () => {
    const originalChrome = globalThis.chrome;
    globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
    const manager = createTabStateManager();
    try {
      await manager.ensureReady();
      manager.mergeImages(7, [record({ maxWidth: 1920, maxHeight: 1080, formatTrusted: true, hdSrcVerified: verified })]);
      const [fixture] = manager.getAllImages(7);
      let writes = 0;
      const ui = await loadUi('popup', ({ type, payload }) => {
        if (type === 'PROBE_IMAGE_DIMENSIONS') return { success: true,
          width: payload.url === fixture.hdSrc ? 1920 : 320, height: payload.url === fixture.hdSrc ? 1080 : 180,
          format: 'jpg', formatTrusted: true };
        if (type === 'UPDATE_IMAGE_METADATA') { writes++; return dispatchMetadata(manager, payload); }
        return { success: true };
      });
      ui.put('fixture', fixture);
      await ui.run('resolveCardMaxDimensions(fixture)'); await flush();
      assert.equal(writes, verified ? 0 : 1);
      assert.equal(manager.getAllImages(7)[0].hdSrcVerified, true);
    } finally {
      await manager.flushPersistence(); globalThis.chrome = originalChrome;
    }
  });
}

for (const name of ['workspace', 'popup']) {
  for (const largerFallback of name === 'workspace' ? [false, true] : [false]) {
  test(`${name} persists a recovered HD probe without borrowing fallback evidence or requiring a format change (larger fallback: ${largerFallback})`, async () => {
    const originalChrome = globalThis.chrome;
    globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
    const manager = createTabStateManager();
    try {
      await manager.ensureReady();
      manager.mergeImages(7, [record({ width: 600, height: 800, hdSrc: 'https://cdn.example/full.webp' })]);
      const [fixture] = manager.getAllImages(7);
      const originalHd = fixture.hdSrc;
      let available = false;
      let hdProbes = 0;
      const updates = [];
      const ui = await loadUi(name, ({ type, payload }) => {
        if (type === 'PROBE_IMAGE_DIMENSIONS') {
          if (payload.url === originalHd) {
            hdProbes++;
            if (!available) return { success: false };
            return { success: true, width: 1800, height: 2400, format: 'jpg', formatTrusted: true };
          }
          return { success: true, width: payload.url === fixture.src ? 600 : largerFallback ? 1200 : 400,
            height: payload.url === fixture.src ? 800 : largerFallback ? 1600 : 500, format: 'jpg', formatTrusted: true };
        }
        if (type === 'UPDATE_IMAGE_METADATA') { updates.push(payload); return dispatchMetadata(manager, payload); }
        return { success: true };
      });
      ui.put('fixture', fixture);
      const first = ui.run('resolveCardMaxDimensions(fixture)');
      await flush();
      for (const image of ui.images) if (image.src === originalHd) image.onerror?.();
      await first; await flush();
      assert.equal(manager.getAllImages(7)[0].hdSrc, largerFallback ? 'https://cdn.example/full.jpg' : originalHd,
        'a larger working fallback should be usable without pretending the failed HD was measured');
      assert.equal(updates.some(update => update.comparedHdSrc === originalHd), false);
      assert.ok(Number.isFinite(ui.run('cardDimensionCache.get(fixture.id).retryAt')), 'original HD failure must remain retryable');
      assert.equal(manager.getAllImages(7)[0].formatTrusted, true);
      ui.put('fixture', manager.getAllImages(7)[0]);
      const probesBeforeCooldown = hdProbes;
      await ui.run('resolveCardMaxDimensions(fixture)'); await flush();
      assert.equal(hdProbes, probesBeforeCooldown, 'refreshing a new record object must preserve the original cooldown');
      const priorUpdates = updates.length;
      available = true;
      await ui.tick(31000);
      ui.put('fixture', manager.getAllImages(7)[0]);
      const recovered = await ui.run('resolveCardMaxDimensions(fixture)');
      await flush();
      assert.equal(recovered.width, 1800);
      assert.ok(hdProbes >= 2, 'recovery must make a new probe');
      assert.ok(updates.length > priorUpdates, 'same-format larger dimensions must be sent to the worker');
      const [stored] = manager.getAllImages(7);
      assert.equal(stored.hdSrc, originalHd);
      assert.equal(stored.hdSrcVerified, true);
      assert.equal(stored.maxWidth, 1800);
      assert.equal(stored.maxHeight, 2400);
      assert.equal(ui.run('cardDimensionCache.get(fixture.id).retryAt'), Infinity, 'success ends the pending retry');
      const writesAfterRecovery = updates.length;
      const probesAfterRecovery = hdProbes;
      await ui.run('resolveCardMaxDimensions(fixture)');
      await flush();
      assert.equal(updates.length, writesAfterRecovery, 'reusing completed metadata must not trigger another write');
      assert.equal(hdProbes, probesAfterRecovery, 'a resolved candidate must not keep retrying');
    } finally {
      await manager.flushPersistence();
      globalThis.chrome = originalChrome;
    }
  });
  }
}

for (const name of ['popup', 'workspace']) {
  for (const baseMeasured of [false, true]) {
  for (const measuredBefore of [false, true]) {
    test(`${name} keeps the larger primary URL after comparing a smaller HD candidate (preview measured: ${measuredBefore}, base measured: ${baseMeasured})`, async () => {
      const originalChrome = globalThis.chrome;
      globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
      const manager = createTabStateManager();
      try {
        await manager.ensureReady();
        manager.mergeImages(7, [record({ width: baseMeasured ? 600 : 298, height: baseMeasured ? 800 : 398,
          area: baseMeasured ? 480000 : 118604, formatTrusted: true })]);
        let [fixture] = manager.getAllImages(7);
        if (measuredBefore) {
          manager.updateImageMetadata(7, { imageId: fixture.id, collectionId: fixture.collectionId,
            url: fixture.src, width: 600, height: 800 });
          [fixture] = manager.getAllImages(7);
        }
        const ui = await loadUi(name, ({ type, payload }) => {
          if (type === 'PROBE_IMAGE_DIMENSIONS') return { success: true,
            width: payload.url === fixture.src ? 600 : 400,
            height: payload.url === fixture.src ? 800 : 500,
            format: 'jpg', formatTrusted: true };
          if (type === 'UPDATE_IMAGE_METADATA') return { success: true, ...manager.updateImageMetadata(7, payload) };
          return { success: true };
        });
        ui.put('fixture', fixture);
        const resolved = await ui.run('resolveCardMaxDimensions(fixture)');
        await flush();
        const [stored] = manager.getAllImages(7);
        assert.equal(resolved.url, fixture.src);
        assert.equal(stored.hdSrc, fixture.src);
        assert.equal(stored.maxWidth, 600);
        assert.equal(stored.maxHeight, 800);
        if (name === 'workspace') {
          ui.run("rememberImageDimensions(fixture, { width: 400, height: 500 }, { url: fixture.hdSrc, format: 'png', formatTrusted: true })");
          await flush();
          const [afterPreview] = manager.getAllImages(7);
          assert.equal(afterPreview.hdSrc, fixture.src, 'a late smaller preview must not reverse the completed comparison');
          assert.equal(afterPreview.maxArea, 600 * 800);
        }
      } finally {
        await manager.flushPersistence();
        globalThis.chrome = originalChrome;
      }
    });
  }
  }
}

for (const name of ['popup', 'workspace']) {
  for (const format of ['jpg', 'png']) {
    test(`${name} refreshes format facets only for visible format changes (${format})`, async () => {
      const messages = [];
      const ui = await loadUi(name, message => {
        messages.push(message);
        return message.type === 'PROBE_IMAGE_DIMENSIONS'
          ? { success: true, width: 320, height: 180, format, formatTrusted: true }
          : { success: true, updated: true };
      });
      ui.put('fixture', record({ hdSrc: '' }));
      await ui.run('resolveCardMaxDimensions(fixture)');
      await flush();
      assert.equal(messages.some(message => message.type === 'UPDATE_IMAGE_METADATA'), true);
      assert.equal(ui.run('fixture.formatTrusted'), true);
      assert.equal(ui.run('metadataRefreshRequested || metadataRefreshTimer !== null'), format !== 'jpg');
    });
  }
}

async function loadUi(name, handler) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const nodes = new Map();
  const images = [];
  const messageListeners = [];
  const makeNode = () => ({
    dataset: {}, style: { removeProperty() {} }, value: "0", textContent: "", checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], appendChild() {}, append() {},
    addEventListener() {}, removeEventListener() {}, removeAttribute() {}, setAttribute() {}, scrollTo() {}, remove() {},
    getBoundingClientRect: () => ({ width: 320, height: 180 })
  });
  const document = {
    getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, makeNode()); return nodes.get(id); },
    querySelector: (selector) => selector === ".lightbox-content" ? makeNode() : null,
    querySelectorAll: () => [], addEventListener() {},
    createElement: makeNode, createDocumentFragment: makeNode, documentElement: makeNode(), body: makeNode()
  };
  const context = vm.createContext({
    document, location: { search: "?tabId=7", href: "chrome-extension://extension/ui.html" }, URLSearchParams, URL, AbortController,
    window: { removeEventListener() {}, addEventListener() {} },
    requestAnimationFrame: (fn) => { Promise.resolve().then(fn); return 1; },
    Image: class {
      constructor() { images.push(this); this.naturalWidth = 0; this.naturalHeight = 0; }
      removeAttribute() { this.src = ""; }
    },
    Date: class extends Date { static now() { return now; } }, console,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id), cancelAnimationFrame() {},
    chrome: { runtime: { onMessage: { addListener(listener) { messageListeners.push(listener); } }, sendMessage: (message, done) => {
      Promise.resolve(handler(message)).then(done);
    } } }
  });
  const shared = new URL("../shared/imageMetadataCore.js", import.meta.url);
  vm.runInContext(await readFile(new URL('../shared/imagePreviewCore.js', import.meta.url), 'utf8'), context);
  if (await access(shared).then(() => true, () => false)) vm.runInContext(await readFile(shared, "utf8"), context);
  vm.runInContext(await readFile(new URL(`../${name}/${name}.js`, import.meta.url), "utf8"), context);
  vm.runInContext("sourceTabId = 7", context);
  return {
    run: (code) => vm.runInContext(code, context),
    put: (key, value) => { context[key] = value; },
    tick: async (ms) => { now += ms; for (const [id, timer] of [...timers]) { if (timer.at <= now) { timers.delete(id); timer.fn(); } } await flush(); },
    notify: message => messageListeners.forEach(listener => listener(message)),
    nodes, images
  };
}

for (const name of ["popup", "workspace"]) {
  test(`${name} re-probes a replacement HD source with the same image id`, async () => {
    const ui = await loadUi(name, ({ type, payload }) => type === "PROBE_IMAGE_DIMENSIONS"
      ? { success: true, width: payload.url.includes("replacement") ? 3840 : payload.url.includes("full") ? 1920 : 320,
        height: payload.url.includes("replacement") ? 2160 : payload.url.includes("full") ? 1080 : 180 }
      : { success: true });
    ui.put("fixture", record());
    assert.equal((await ui.run("resolveCardMaxDimensions(fixture)")).width, 1920);
    ui.put("replacement", record({ hdSrc: "https://cdn.example/replacement.jpg" }));
    const result = await ui.run("resolveCardMaxDimensions(replacement)");
    assert.equal(result.width, 3840);
    assert.equal(result.url, "https://cdn.example/replacement.jpg");
  });

  test(`${name} renders known metadata before slow dimension probes finish`, async () => {
    const pending = [];
    const ui = await loadUi(name, ({ type }) => {
      if (type === "PROBE_IMAGE_DIMENSIONS") return new Promise((resolve) => pending.push(resolve));
      if (type === "GET_IMAGES") return { success: true, images: [record()] };
      if (type === "GET_SELECTED") return { success: true, images: [] };
      if (type === "GET_STATS") return { success: true, stats: { total: 1, selected: 0 } };
      return { success: true };
    });
    ui.run("currentConfig.enableSizeSort = true");
    let completed = false;
    const render = ui.run(name === "workspace" ? "renderGallery()" : "renderImages()").then(() => { completed = true; });
    await flush();
    assert.equal(completed, true, "initial render must not wait for network probes");
    assert.equal(ui.run("currentImages.length"), 1);
    for (const resolve of pending) resolve({ success: true, width: 100, height: 80 });
    await render;
  });

  test(`${name} selecting one image avoids rebuilding or probing the list`, async () => {
    const messages = [];
    const ui = await loadUi(name, ({ type }) => { messages.push(type); return { success: true, selectedIds: ["image"] }; });
    ui.put("fixture", record());
    ui.run("currentImages = [fixture]");
    await ui.run('toggleSelect("image")');
    assert.deepEqual(messages, ["TOGGLE_SELECT"]);
    assert.equal(ui.nodes.get("stat-selected").textContent, "1");
  });

  test(`${name} shows storage failures until a response confirms recovery`, async () => {
    let error = "QUOTA_BYTES exceeded";
    const ui = await loadUi(name, () => ({ success: true, persistence: { pending: Boolean(error), error } }));
    await ui.run('sendMessage("GET_IMAGES")');
    ui.run('setActionStatus("采集完成")');
    assert.equal(ui.nodes.get("action-status").textContent, "保存失败，当前更改尚未保存");
    error = null;
    await ui.run('sendMessage("GET_IMAGES")');
    assert.equal(ui.nodes.get("action-status").textContent, "采集完成");
  });

  test(`${name} bounds clipboard payload bytes and clears them with images`, async () => {
    const ui = await loadUi(name, ({ type }) => type === "GET_IMAGES" ? { success: false } : { success: true });
    ui.put("payload", { success: true, dataUrl: "x".repeat(3 * 1024 * 1024) });
    for (let index = 0; index < 4; index += 1) ui.run(`setClipboardCache("${index}", payload)`);
    assert.equal(ui.run("clipboardPayloadCache.size"), 2);
    await ui.run("clearImages()");
    assert.equal(ui.run("clipboardPayloadCache.size"), 0);
  });
}

test("Fullscreen uses cancellable image preloads and bounds retained decoded pixels", async () => {
  const ui = await loadUi("workspace", () => ({ success: true }));
  ui.put("fixtures", Array.from({ length: 12 }, (_, i) => record({ id: String(i), hdSrc: `https://cdn.example/${i}.jpg` })));
  ui.run("currentImages = fixtures; fullscreenActive = true");
  const obsolete = ui.run('ensureFullscreenCache("https://cdn.example/0.jpg")');
  ui.run("pruneFullscreenCache(10)");
  assert.equal((await obsolete).cached, false);
  assert.equal(ui.images[0].src, "");
  for (let i = 6; i < 9; i += 1) {
    const pending = ui.run(`ensureFullscreenCache("https://cdn.example/${i}.jpg")`);
    const image = ui.images.at(-1);
    image.naturalWidth = 3000;
    image.naturalHeight = 3000;
    image.onload();
    assert.equal((await pending).cached, true);
  }
  assert.ok(ui.run('[...fullscreenCache.values()].reduce((sum, entry) => sum + entry.size, 0)') <= 64 * 1024 * 1024);
  assert.equal(ui.run("fullscreenCache.size"), 1);
});

test('fullscreen compatibility exhaustion ends loading and shows a failure state', async () => {
  const ui = await loadUi('workspace', () => ({ success: false, error: 'unavailable' }));
  let loading = false;
  ui.nodes.get('fullscreen-loading').classList.toggle = (name, value) => { if (name === 'active') loading = value; };
  ui.put('fixture', record({ collectionId: 'current' }));
  ui.run("activeCollectionId = 'current'; currentImages = [fixture]; fullscreenIndex = 0; fullscreenActive = true; previewCompatibility = true");
  await ui.run('renderFullscreenImage()');
  await flush(); await flush();
  assert.equal(loading, false);
  assert.equal(ui.nodes.get('fullscreen-image').alt, '图片加载失败');
});

test('comic collection changes clear old order and pagination before loading the new chapter', async () => {
  const messages = [];
  const ui = await loadUi('workspace', message => {
    messages.push(message);
    const { type, payload } = message;
    if (type === 'GET_COMIC_SEQUENCE') return { success: true, collectionId: payload.collectionId, sequence: [{ normalized: 'chapter-B' }] };
    if (type === 'GET_COMIC_PAGINATION') return { success: true, collectionId: payload.collectionId, pagination: { supported: true, nextUrl: 'https://comic.example/B/2' } };
    if (type === 'LOAD_COMIC_PAGINATION_PAGES') return { success: true, collectionId: payload.collectionId, results: [], nextUrl: '' };
    return { success: false };
  });
  ui.run("activeCollectionId = 'old'; comicModeEnabled = true; comicSequenceCache = [{normalized:'chapter-A'}]; comicPaginationInfo = {supported:true,nextUrl:'https://comic.example/A/2',collectionId:'old'}");
  ui.run("acceptCollectionId('new', true)");
  await ui.run('loadComicPaginationPages()');
  assert.equal(messages.some(message => message.type === 'LOAD_COMIC_PAGINATION_PAGES'), false, 'Go must not use old chapter information');
  assert.equal(ui.run('comicSequenceCache'), null);
  assert.equal(ui.run('comicPaginationInfo'), null);
  assert.equal((await ui.run('fetchComicSequence()'))[0].normalized, 'chapter-B');
  await ui.run('refreshComicPaginationInfo()');
  await ui.run('loadComicPaginationPages()');
  const request = messages.find(message => message.type === 'LOAD_COMIC_PAGINATION_PAGES');
  assert.equal(request.payload.nextUrl, 'https://comic.example/B/2');
  assert.ok(messages.filter(message => /COMIC/.test(message.type)).every(message => message.payload.collectionId === 'new'));
});

test('late comic sequence responses cannot refill caches after collection or local sequence invalidation', async () => {
  for (const changeCollection of [false, true]) {
    const pending = [];
    const ui = await loadUi('workspace', ({ type, payload }) => type === 'GET_COMIC_SEQUENCE'
      ? new Promise(resolve => pending.push({ payload, resolve })) : { success: false });
    ui.run("activeCollectionId = 'old'; comicModeEnabled = true");
    const old = ui.run('fetchComicSequence()'); await flush();
    ui.run(changeCollection ? "acceptCollectionId('new', true)" : 'invalidateComicSequenceCache()');
    const current = ui.run('fetchComicSequence()'); await flush();
    assert.equal(pending.length, 2);
    const currentId = changeCollection ? 'new' : 'old';
    pending[1].resolve({ success: true, collectionId: currentId, sequence: [{ normalized: 'current' }] });
    await current;
    pending[0].resolve({ success: true, collectionId: 'old', sequence: [{ normalized: 'obsolete' }] });
    assert.equal((await old).length, 0);
    assert.equal(ui.run('comicSequenceCache[0].normalized'), 'current');
  }
});

test('comic pagination detection discards a previous chapter response arriving after the new response', async () => {
  const pending = [];
  const ui = await loadUi('workspace', ({ type, payload }) => type === 'GET_COMIC_PAGINATION'
    ? new Promise(resolve => pending.push({ payload, resolve })) : { success: false });
  ui.run("activeCollectionId = 'old'; comicModeEnabled = true");
  const old = ui.run('refreshComicPaginationInfo()'); await flush();
  ui.run("acceptCollectionId('new', true)");
  const current = ui.run('refreshComicPaginationInfo()'); await flush();
  pending[1].resolve({ success: true, collectionId: 'new', pagination: { supported: true, nextUrl: 'B/2' } }); await current;
  pending[0].resolve({ success: true, collectionId: 'old', pagination: { supported: true, nextUrl: 'A/2' } }); await old;
  assert.equal(ui.run('comicPaginationInfo.nextUrl'), 'B/2');
  assert.equal(ui.run('comicPaginationInfo.collectionId'), 'new');
  assert.deepEqual(pending.map(item => item.payload.collectionId), ['old', 'new']);
});

test('an old comic load cannot change the new chapter pagination or clear its active loading state', async () => {
  const pending = [];
  const ui = await loadUi('workspace', ({ type, payload }) => type === 'LOAD_COMIC_PAGINATION_PAGES'
    ? new Promise(resolve => pending.push({ payload, resolve })) : { success: false });
  ui.run("activeCollectionId = 'old'; comicModeEnabled = true; comicPaginationInfo = {supported:true,nextUrl:'A/2',collectionId:'old'}");
  const old = ui.run('loadComicPaginationPages()'); await flush();
  ui.run("acceptCollectionId('new', true); comicPaginationInfo = {supported:true,nextUrl:'B/2',collectionId:'new'}");
  const current = ui.run('loadComicPaginationPages()'); await flush();
  assert.equal(pending.length, 2, 'the new chapter must not remain blocked by the old load');
  pending[0].resolve({ success: true, collectionId: 'old', results: [], nextUrl: 'A/3' }); await old;
  assert.equal(ui.run('comicPaginationInfo.nextUrl'), 'B/2');
  assert.equal(ui.run('comicPaginationLoading'), true);
  pending[1].resolve({ success: true, collectionId: 'new', results: [], nextUrl: 'B/3' }); await current;
  assert.equal(ui.run('comicPaginationInfo.nextUrl'), 'B/3');
  assert.equal(ui.run('comicPaginationLoading'), false);
  assert.deepEqual(pending.map(item => item.payload.collectionId), ['old', 'new']);
});

test("Shared URL queue merges only matching contexts and cancels stale work without exceeding concurrency", async () => {
  const started = [];
  const ui = await loadUi("popup", () => ({ success: true }));
  ui.put("probe", (url, signal) => new Promise((resolve) => started.push({ url, signal, resolve })));
  ui.run("const queue = PageImageCollectorMetadata.createDimensionProbeQueue({ probe, concurrency: 1 })");
  const first = ui.run('queue.get("https://cdn.example/same.jpg", "tab-one")');
  assert.equal(first, ui.run('queue.get("https://cdn.example/same.jpg", "tab-one")'));
  const differentContext = ui.run('queue.get("https://cdn.example/same.jpg", "tab-two")');
  assert.notEqual(first, differentContext);
  await flush();
  assert.equal(started.length, 1);
  ui.run("queue.clear()");
  assert.equal((await first).area, 0);
  assert.equal((await differentContext).area, 0);
  assert.equal(started[0].signal.aborted, true);
  const fresh = ui.run('queue.get("https://cdn.example/same.jpg", "tab-one")');
  await flush();
  assert.equal(started.length, 1, "old non-abortable transport still occupies one slot");
  started[0].resolve({ width: 320, height: 180 });
  await flush();
  assert.equal(started.length, 2);
  started[1].resolve({ width: 1920, height: 1080 });
  assert.equal((await fresh).width, 1920);
  assert.equal(await ui.run('queue.get("https://cdn.example/same.jpg", "tab-one")'), await fresh);
});

test("Shared URL queue evicts old settled entries at its capacity", async () => {
  let probes = 0;
  const ui = await loadUi("popup", () => ({ success: true }));
  ui.put("probe", async () => { probes += 1; return { width: 2, height: 3 }; });
  ui.run("const queue = PageImageCollectorMetadata.createDimensionProbeQueue({ probe, maxEntries: 2 })");
  for (const url of ["one", "two", "three"]) await ui.run(`queue.get("${url}")`);
  await ui.run('queue.get("three")');
  assert.equal(probes, 3);
  await ui.run('queue.get("one")');
  assert.equal(probes, 4);
});

test("Workspace keeps HD width, height, area and URL together, including 1080p filtering", async () => {
  const ui = await loadUi("workspace", ({ type, payload }) => type === "PROBE_IMAGE_DIMENSIONS"
    ? { success: true, width: payload.url.includes("full") ? 1920 : 320, height: payload.url.includes("full") ? 1080 : 180 }
    : { success: true });
  ui.put("fixture", record());
  const result = await ui.run("resolveCardMaxDimensions(fixture)");
  assert.equal(result.width, 1920);
  assert.equal(result.height, 1080);
  assert.equal(result.area, result.width * result.height);
  assert.equal(ui.run("cardDimensionCache.get(fixture.id).url"), record().hdSrc);
  assert.equal(ui.run('passesMetricFilters(fixture, { preset: "1080p" })'), true);
  assert.equal(ui.run('passesMetricFilters(fixture, { preset: "4k" })'), false);
});

test("Workspace opening a thumbnail preserves its distinct HD candidate", async () => {
  const messages = [];
  const ui = await loadUi("workspace", ({ type }) => { messages.push(type); return { success: true }; });
  ui.put("fixture", record());
  ui.run('lightboxImage = fixture; currentImages = [fixture]; setLightboxSource(fixture.src, "preview")');
  const image = ui.nodes.get("lightbox-image");
  image.naturalWidth = 320;
  image.naturalHeight = 180;
  image.onload();
  assert.equal(ui.run("getEffectiveHdSrc(fixture)"), record().hdSrc);
  assert.ok(!messages.includes("COPY_TO_CLIPBOARD"));
});

test("Popup retries failed HD probes after cooldown and caches successful results", async () => {
  let requests = 0;
  let available = false;
  const ui = await loadUi("popup", ({ type, payload }) => {
    if (type !== "PROBE_IMAGE_DIMENSIONS") return { success: true };
    requests += 1;
    if (payload.url.includes("full") && !available) return { success: false };
    return { success: true, width: payload.url.includes("full") ? 1920 : 320, height: payload.url.includes("full") ? 1080 : 180 };
  });
  ui.put("fixture", record());
  assert.equal((await ui.run("resolveCardMaxDimensions(fixture)")).width, 320);
  available = true;
  await ui.tick(31000);
  assert.equal((await ui.run("resolveCardMaxDimensions(fixture)")).width, 1920);
  const afterRetry = requests;
  await ui.run("resolveCardMaxDimensions(fixture)");
  assert.equal(requests, afterRetry);
});

test("Popup clear prevents an old probe from repopulating card metadata", async () => {
  let finishProbe;
  const ui = await loadUi("popup", ({ type }) => {
    if (type === "PROBE_IMAGE_DIMENSIONS") return new Promise((resolve) => { finishProbe = resolve; });
    if (type === "GET_IMAGES") return { success: false };
    return { success: true };
  });
  ui.put("fixture", record({ hdSrc: "" }));
  const pending = ui.run("resolveCardMaxDimensions(fixture)");
  await flush();
  await ui.run("clearImages()");
  finishProbe({ success: true, width: 1920, height: 1080 });
  await pending;
  assert.equal(ui.run("cardDimensionCache.size"), 0);
});

for (const hdLoads of [false, true]) {
  test(`Popup reports the actual detected format URL when HD loading ${hdLoads ? "succeeds" : "fails"}`, async () => {
    const originalChrome = globalThis.chrome;
    globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
    const manager = createTabStateManager();
    try {
      await manager.ensureReady();
      manager.mergeImages(7, [record({ format: "webp", hdSrc: "https://cdn.example/full.webp" })]);
      const [fixture] = manager.getAllImages(7);
      const updates = [];
      const ui = await loadUi("popup", ({ type, payload }) => {
        if (type === "PROBE_IMAGE_DIMENSIONS") {
          if (payload.url === fixture.hdSrc && !hdLoads) return { success: false };
          return { success: true, width: payload.url === fixture.hdSrc ? 1920 : 320,
            height: payload.url === fixture.hdSrc ? 1080 : 180, format: "jpg", formatTrusted: true };
        }
        if (type === "UPDATE_IMAGE_METADATA") {
          updates.push(payload);
          return { success: true, ...manager.updateImageMetadata(7, payload) };
        }
        return { success: true };
      });
      ui.put("fixture", fixture);
      await ui.run("resolveCardMaxDimensions(fixture)");
      await flush();
      await manager.flushPersistence();
      assert.equal(updates.length, 1);
      assert.equal(updates[0].url, hdLoads ? fixture.hdSrc : fixture.src);
      const [stored] = manager.getAllImages(7);
      assert.equal(stored.hdSrcVerified, hdLoads);
      assert.equal(stored.format, "jpg");
      assert.equal(stored.formatTrusted, true);
    } finally {
      await manager.flushPersistence();
      globalThis.chrome = originalChrome;
    }
  });
}

for (const name of ["popup", "workspace"]) {
  for (const trusted of [false, true]) {
    test(`${name} ${trusted ? "persists" : "does not invent"} confidence when the detected format matches`, async () => {
      const originalChrome = globalThis.chrome;
      globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
      const manager = createTabStateManager();
      try {
        await manager.ensureReady();
        const src = "https://cdn.example/same-format.jpg";
        manager.mergeImages(7, [record({ src, hdSrc: src, timestamp: 1 })]);
        const [fixture] = manager.getAllImages(7);
        const updates = [];
        const ui = await loadUi(name, ({ type, payload }) => {
          if (type === "PROBE_IMAGE_DIMENSIONS") {
            return { success: true, width: 320, height: 180, format: "jpg", formatTrusted: trusted };
          }
          if (type === "UPDATE_IMAGE_METADATA") {
            updates.push(payload);
            return { success: true, ...manager.updateImageMetadata(7, payload) };
          }
          return { success: true };
        });
        ui.put("fixture", fixture);
        await ui.run("resolveCardMaxDimensions(fixture)");
        await flush();
        await manager.flushPersistence();
        assert.equal(updates.length, trusted ? 1 : 0);
        assert.equal(manager.getAllImages(7)[0].formatTrusted, trusted);
        manager.mergeImages(7, [record({ src, hdSrc: src, format: "webp", timestamp: 2 })]);
        assert.equal(manager.getAllImages(7)[0].format, trusted ? "jpg" : "webp");
      } finally {
        await manager.flushPersistence();
        globalThis.chrome = originalChrome;
      }
    });
  }
}

for (const name of ["popup", "workspace"]) {
  test(`${name} bounds URL probes even when cards start concurrently`, async () => {
    const pending = [];
    const ui = await loadUi(name, ({ type }) => {
      if (type === "PROBE_IMAGE_DIMENSIONS") return new Promise((resolve) => pending.push(resolve));
      return { success: true };
    });
    const requests = Array.from({ length: 40 }, (_, index) => ui.run(`getImageDimensions("https://cdn.example/${index}.jpg")`));
    await flush();
    assert.ok(pending.length <= ui.run("DIMENSION_PROBE_CONCURRENCY"), `started ${pending.length} probes`);
    while (pending.length) {
      for (const resolve of pending.splice(0)) resolve({ success: true, width: 100, height: 80 });
      await flush();
    }
    await Promise.all(requests);
  });
}

for (const name of ['popup', 'workspace']) {
  test(name + ' preview errors advance to the loaded original URL and then remaining candidates', async () => {
    const ui = await loadUi(name, () => ({ success: false }));
    ui.put('fixture', record({ src: 'https://cdn.example/broken.jpg', hdSrc: 'https://cdn.example/broken.jpg', originalSrc: 'https://cdn.example/working.jpg', candidateUrls: ['https://cdn.example/last.jpg'] }));
    ui.put('previewNode', { src: 'https://cdn.example/broken.jpg', dataset: {} });
    await ui.run('fallbackImageError(previewNode, fixture.src, fixture)');
    assert.equal(ui.run('previewNode.src'), 'https://cdn.example/working.jpg');
    await ui.run('fallbackImageError(previewNode, fixture.src, fixture)');
    assert.equal(ui.run('previewNode.src'), 'https://cdn.example/last.jpg');
  });
  test(name + ' discards an old probe when another view changes the collection', async () => {
    const pending = [];
    const updates = [];
    const ui = await loadUi(name, ({ type, payload }) => {
      if (type === 'PROBE_IMAGE_DIMENSIONS') return new Promise(resolve => pending.push(resolve));
      if (type === 'UPDATE_IMAGE_METADATA') updates.push(payload);
      return { success: true };
    });
    ui.run("acceptCollectionId('old');");
    ui.put('fixture', record({ collectionId: 'old' }));
    const task = ui.run('resolveCardMaxDimensions(fixture)');
    await flush();
    ui.notify({ type: 'IMAGES_UPDATED', payload: { tabId: 7, collectionId: 'new' } });
    pending.forEach(resolve => resolve({ success: true, width: 3840, height: 2160, format: 'webp', formatTrusted: true, collectionId: 'old' }));
    await task; await flush();
    assert.equal(ui.run('activeCollectionId'), 'new');
    assert.equal(ui.run('cardDimensionCache.size'), 0);
    assert.equal(updates.length, 0);
  });
  test(name + ' ignores an old gallery response that arrives after a collection-change notification', async () => {
    let complete;
    const ui = await loadUi(name, () => new Promise(resolve => { complete = resolve; }));
    ui.run("acceptCollectionId('old');");
    const query = ui.run('sendMessage(MSG.GET_IMAGES)'); await flush();
    ui.notify({ type: 'IMAGES_UPDATED', payload: { tabId: 7, collectionId: 'new' } });
    complete({ success: true, collectionId: 'old', images: [] });
    assert.equal((await query).stale, true);
    assert.equal(ui.run('activeCollectionId'), 'new');
  });
}
