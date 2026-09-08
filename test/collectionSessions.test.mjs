import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabStateManager } from '../background/stateManager.js';
import { createDirectDownloadJobManager } from '../background/directDownloadJobs.js';

const h = () => {
  const stored = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async value => Object.assign(stored, structuredClone(value))
  } } };
  return { stored, manager: createTabStateManager() };
};
const img = (suffix = 'one', extra = {}) => ({ src: `https://cdn.example/${suffix}.jpg`, width: 320, height: 180, sourceUrl: 'https://a.example/page', ...extra });

test('backend rejects pre-clear metadata even when the same stable image ID is recollected', async () => {
  const { manager } = h();
  await manager.ensureReady();
  manager.mergeImages(1, [img()]);
  const old = manager.getAllImages(1)[0];
  manager.clearTabImages(1);
  manager.mergeImages(1, [img()]);
  const current = manager.getAllImages(1)[0];
  assert.equal(old.id, current.id);
  const stale = manager.updateImageMetadata(1, { imageId: old.id, collectionId: old.collectionId, url: 'https://cdn.example/stale.jpg', width: 1920, height: 1080 });
  assert.equal(stale.updated, false);
  assert.equal(stale.stale, true);
  assert.notEqual(old.collectionId, current.collectionId);
  const missing = manager.updateImageMetadata(1, { imageId: current.id, width: 1920, height: 1080 });
  assert.equal(missing.stale, true, 'missing scope is not a license to mutate a current record');
  const fresh = manager.updateImageMetadata(1, { imageId: current.id, collectionId: current.collectionId, url: 'https://cdn.example/current.jpg', width: 1920, height: 1080 });
  assert.equal(fresh.updated, true);
  assert.equal(manager.getAllImages(1)[0].hdSrc, 'https://cdn.example/current.jpg');
  await manager.flushPersistence();
});

test('collection identity survives worker restoration and rotates after empty clears and removal', async () => {
  const { manager } = h(); await manager.ensureReady();
  manager.mergeImages(1, [img()]);
  const initial = manager.getAllImages(1)[0].collectionId;
  assert.equal(typeof initial, 'string');
  await manager.flushPersistence();
  const restored = createTabStateManager(); await restored.ensureReady();
  assert.equal(restored.getAllImages(1)[0].collectionId, initial);
  restored.clearTabImages(1);
  const emptyId = restored.getCollectionId(1);
  restored.clearTabImages(1);
  assert.notEqual(restored.getCollectionId(1), emptyId);
  restored.removeTabState(1); restored.mergeImages(1, [img()]);
  assert.notEqual(restored.getCollectionId(1), initial);
  await restored.flushPersistence();
});

test('URL source indexes preserve ambiguity and update on merge, probe, clear, and restoration', async () => {
  const { manager } = h(); await manager.ensureReady();
  const shared = 'https://cdn.example/placeholder.jpg';
  manager.setPageUrl(1, 'https://a.example/page');
  manager.mergeImages(1, [img('one', { originalSrc: shared }), img('two', { originalSrc: shared, sourceUrl: 'https://b.example/page' })]);
  assert.equal(manager.getImageRequestSource(1, shared).ambiguous, true);
  assert.equal(manager.getImageRequestSource(1, img().src).sourceUrl, 'https://a.example/page');
  const item = manager.getAllImages(1)[0];
  manager.updateImageMetadata(1, { imageId: item.id, collectionId: item.collectionId, url: 'https://cdn.example/probed.jpg', width: 1920, height: 1080 });
  assert.equal(manager.getImageRequestSource(1, 'https://cdn.example/probed.jpg').sourceUrl, 'https://a.example/page');
  await manager.flushPersistence();
  const restored = createTabStateManager(); await restored.ensureReady();
  assert.equal(restored.getImageRequestSource(1, shared).ambiguous, true);
  restored.clearTabImages(1);
  assert.equal(restored.getImageRequestSource(1, shared).found, false);
  await restored.flushPersistence();
});

test('200 different source lookups do not enumerate image records again', async () => {
  const { manager } = h(); await manager.ensureReady();
  manager.mergeImages(1, Array.from({ length: 200 }, (_, i) => img(String(i))));
  const state = manager.initTabState(1);
  let srcReads = 0;
  for (const image of state.images.values()) {
    const src = image.src;
    Object.defineProperty(image, 'src', { get: () => { srcReads++; return src; }, enumerable: true });
  }
  // Finish pending persistence first; the measurement concerns request lookup.
  await manager.flushPersistence(); srcReads = 0;
  for (let i = 0; i < 200; i++) assert.equal(manager.getImageRequestSource(1, img(String(i)).src).sourceUrl, 'https://a.example/page');
  assert.equal(srcReads, 0);
});

test('late download fallback flags cannot mutate a new collection with the same image ID', async () => {
  const { manager } = h(); await manager.ensureReady(); manager.mergeImages(1, [img()]);
  const old = manager.getAllImages(1)[0]; manager.clearTabImages(1); manager.mergeImages(1, [img()]);
  const current = manager.getAllImages(1)[0];
  manager.markHdRejected(1, current.id, true, old.collectionId);
  assert.equal(manager.getAllImages(1)[0].hdRejected, false);
  manager.markHdRejected(1, current.id, true, current.collectionId);
  assert.equal(manager.getAllImages(1)[0].hdRejected, true);
  await manager.flushPersistence();
});

for (const ordering of ['explicit', 'omitted', 'empty', 'invalid']) {
  test(`selected downloads retain collection scope with ${ordering} ordering`, async () => {
    for (const clearDuringDownload of [false, true]) {
      const { manager } = h(); await manager.ensureReady();
      const fixture = img('one', { hdSrc: 'https://cdn.example/one-full.jpg' });
      manager.mergeImages(1, [fixture]);
      const image = manager.getAllImages(1)[0];
      manager.setSelectionByIds(1, [image.id], true);
      const order = ordering === 'explicit' ? [image.id] : ordering === 'empty' ? [] : ordering === 'invalid' ? null : undefined;
      const selected = manager.getSelectedImages(1, order);
      const downloads = createDirectDownloadJobManager({ storage: globalThis.chrome.storage.local,
        downloadImage: async () => {
          if (clearDuringDownload) { manager.clearTabImages(1); manager.mergeImages(1, [fixture]); }
          return { success: true, downloadId: 99, fallbackUsed: true };
        },
        onImageResult: (tabId, record, result) => {
          if (result.success && record.id && record.hdSrc && record.hdSrc !== record.src) {
            manager.markHdRejected(tabId, record.id, result.fallbackUsed === true, record.collectionId);
          }
        }
      });
      assert.equal((await downloads.start(1, selected)).succeeded, 1);
      assert.equal(manager.getAllImages(1)[0].hdRejected, !clearDuringDownload,
        'a current download must mark fallback; an old collection must not mark the recollected image');
      assert.equal(selected[0].collectionId, image.collectionId);
      await manager.flushPersistence();
    }
  });
}

test('a recovered primary URL replaces a lower-resolution fallback as the measured largest candidate', async () => {
  const { manager } = h(); await manager.ensureReady(); manager.mergeImages(1, [img()]);
  const image = manager.getAllImages(1)[0];
  manager.updateImageMetadata(1, { imageId: image.id, collectionId: image.collectionId, url: 'https://cdn.example/working-thumb.jpg', width: 320, height: 180 });
  manager.updateImageMetadata(1, { imageId: image.id, collectionId: image.collectionId, url: image.src, width: 1920, height: 1080 });
  const current = manager.getAllImages(1)[0];
  assert.equal(current.maxWidth, 1920);
  assert.equal(current.hdSrc, image.src);
  await manager.flushPersistence();
});

test('a loaded thumbnail larger than its layout must not replace an unmeasured HD candidate', async () => {
  const { manager } = h(); await manager.ensureReady();
  manager.mergeImages(1, [img('portrait', {
    src: 'https://cdn.example/portrait_600x0.webp', hdSrc: 'https://cdn.example/portrait.webp',
    width: 300, height: 400, maxWidth: 300, maxHeight: 400, area: 120000, maxArea: 120000
  })]);
  const image = manager.getAllImages(1)[0];
  manager.updateImageMetadata(1, { imageId: image.id, collectionId: image.collectionId,
    url: image.src, width: 600, height: 800 });
  const refreshed = manager.getAllImages(1)[0];
  assert.equal(refreshed.maxWidth, 600);
  assert.equal(refreshed.hdSrc, image.hdSrc, 'measuring the thumbnail says nothing about the pending HD candidate');
  assert.equal(refreshed.hdSrcVerified, false);
  manager.updateImageMetadata(1, { imageId: image.id, collectionId: image.collectionId,
    url: 'https://cdn.example/portrait.jpg', width: 1800, height: 2400 });
  const completed = manager.getAllImages(1)[0];
  assert.equal(completed.maxWidth, 1800); assert.equal(completed.maxHeight, 2400);
  assert.equal(completed.hdSrc, 'https://cdn.example/portrait.jpg');
  await manager.flushPersistence();
});

test('a completed comparison cannot replace a different candidate or a newer larger measurement', async () => {
  const { manager } = h(); await manager.ensureReady();
  const hdSrc = 'https://cdn.example/current-full.jpg';
  manager.mergeImages(1, [img('thumb', { hdSrc, width: 298, height: 398 })]);
  const image = manager.getAllImages(1)[0];
  manager.updateImageMetadata(1, { imageId: image.id, collectionId: image.collectionId,
    url: image.src, width: 600, height: 800, comparedHdSrc: 'https://cdn.example/old-full.jpg' });
  assert.equal(manager.getAllImages(1)[0].hdSrc, hdSrc);
  manager.updateImageMetadata(1, { imageId: image.id, collectionId: image.collectionId,
    url: image.src, width: 400, height: 500, comparedHdSrc: hdSrc });
  assert.equal(manager.getAllImages(1)[0].hdSrc, hdSrc);
  assert.equal(manager.getAllImages(1)[0].maxArea, 600 * 800);
  await manager.flushPersistence();
});

test('rescanning restores an unverified HD candidate previously overwritten by a thumbnail', async () => {
  const { manager } = h(); await manager.ensureReady();
  const src = 'https://cdn.example/item_600x0.webp', hdSrc = 'https://cdn.example/item.webp';
  manager.mergeImages(1, [img('old', { src, hdSrc: src, candidateUrls: [hdSrc, src], width: 300, height: 400,
    maxWidth: 600, maxHeight: 800, maxArea: 480000, hdSrcVerified: false })]);
  manager.mergeImages(1, [img('old', { src, hdSrc, width: 300, height: 400 })]);
  assert.equal(manager.getAllImages(1)[0].hdSrc, hdSrc);
  await manager.flushPersistence();
});
