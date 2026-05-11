import test from "node:test";
import assert from "node:assert/strict";

globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {}
    }
  }
};

const { createTabStateManager } = await import("../background/stateManager.js");

const tabId = 101;

test("merges full-size-first and thumbnail-later records through HD indexes", () => {
  const manager = createTabStateManager();
  const full = "https://cdn.example.com/images/full/photo.jpg";
  const thumb = "https://cdn.example.com/images/thumb/photo.jpg";

  manager.mergeImages(tabId, [{
    src: full,
    originalSrc: full,
    hdSrc: full,
    normalized: full,
    width: 2000,
    height: 1000,
    area: 2000000,
    sourceUrl: "https://source.example/page"
  }]);

  const result = manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 200,
    height: 100,
    area: 20000,
    sourceUrl: "https://source.example/page"
  }]);

  const images = manager.getAllImages(tabId);
  assert.equal(result.total, 1);
  assert.equal(images.length, 1);
  assert.equal(images[0].src, full);
});

test("preserves HD rejected state when later scans replace image metadata", () => {
  const manager = createTabStateManager();
  const thumb = "https://cdn.example.com/images/thumb/item.jpg";
  const full = "https://cdn.example.com/images/full/item.jpg";

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 200,
    height: 100,
    area: 20000,
    sourceUrl: "https://source.example/page"
  }]);
  const [image] = manager.getAllImages(tabId);
  manager.markHdRejected(tabId, image.id, true);

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 400,
    height: 200,
    area: 80000,
    timestamp: Date.now() + 1000,
    sourceUrl: "https://source.example/page"
  }]);

  const [updated] = manager.getAllImages(tabId);
  assert.equal(updated.hdRejected, true);
  assert.equal(updated.isHD, false);
});

test("preserves comic pagination order metadata during image merge", () => {
  const manager = createTabStateManager();

  manager.mergeImages(tabId, [{
    src: "https://img.example.com/page-2-01.jpg",
    width: 900,
    height: 1400,
    comicPageIndex: 2,
    comicPageOrder: 1,
    comicPageUrl: "https://comic.example.com/2"
  }]);

  let [stored] = manager.getAllImages(tabId);
  assert.equal(stored.comicPageIndex, 2);
  assert.equal(stored.comicPageOrder, 1);
  assert.equal(stored.comicPageUrl, "https://comic.example.com/2");

  manager.mergeImages(tabId, [{
    src: "https://img.example.com/page-2-01.jpg",
    width: 900,
    height: 1400
  }]);

  [stored] = manager.getAllImages(tabId);
  assert.equal(stored.comicPageIndex, 2);
  assert.equal(stored.comicPageOrder, 1);
  assert.equal(stored.comicPageUrl, "https://comic.example.com/2");
});

test("stores hidden image state with image records and stats", () => {
  const manager = createTabStateManager();

  manager.mergeImages(tabId, [
    { src: "https://cdn.example.com/a.jpg", width: 100, height: 100 },
    { src: "https://cdn.example.com/b.jpg", width: 100, height: 100 }
  ]);

  const [first, second] = manager.getAllImages(tabId);
  manager.setSelectionByIds(tabId, [first.id], true);
  const hiddenIds = manager.setHiddenByIds(tabId, [first.id], true);

  assert.deepEqual(hiddenIds, [first.id]);
  assert.equal(manager.getSelectedImages(tabId).length, 0);

  const images = manager.getAllImages(tabId);
  const hidden = images.find((image) => image.id === first.id);
  const visible = images.find((image) => image.id === second.id);
  assert.equal(hidden.hidden, true);
  assert.equal(visible.hidden, false);

  const stats = manager.getStats(tabId);
  assert.equal(stats.hidden, 1);

  manager.setHiddenByIds(tabId, [first.id], false);
  assert.equal(manager.getAllImages(tabId).find((image) => image.id === first.id).hidden, false);
  assert.equal(manager.getStats(tabId).hidden, 0);
});
