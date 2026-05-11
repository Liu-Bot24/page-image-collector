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

test("reports the maximum loaded comic pagination page index", () => {
  const manager = createTabStateManager();

  assert.equal(manager.getMaxComicPageIndex(tabId), 0);

  manager.mergeImages(tabId, [
    {
      src: "https://img.example.com/page-1-01.jpg",
      width: 900,
      height: 1400,
      comicPageIndex: 1,
      comicPageOrder: 0,
      comicPageUrl: "https://comic.example.com/1"
    },
    {
      src: "https://img.example.com/page-6-01.jpg",
      width: 900,
      height: 1400,
      comicPageIndex: 6,
      comicPageOrder: 0,
      comicPageUrl: "https://comic.example.com/6"
    },
    {
      src: "https://img.example.com/current-page.jpg",
      width: 900,
      height: 1400
    }
  ]);

  assert.equal(manager.getMaxComicPageIndex(tabId), 6);
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

test("keeps maximum known dimensions when a thumbnail and HD source describe the same image", () => {
  const manager = createTabStateManager();
  const thumb = "https://cdn.example.com/photo_320.jpg";
  const full = "https://cdn.example.com/photo_1920.jpg";

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 320,
    height: 180,
    area: 57600,
    maxWidth: 1920,
    maxHeight: 1080,
    maxArea: 2073600
  }]);

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 320,
    height: 180,
    area: 57600
  }]);

  const [stored] = manager.getAllImages(tabId);
  assert.equal(stored.width, 320);
  assert.equal(stored.height, 180);
  assert.equal(stored.maxWidth, 1920);
  assert.equal(stored.maxHeight, 1080);
  assert.equal(stored.maxArea, 2073600);
});

test("upgrades hdSrc on same-area records when the later record has a better HD candidate", () => {
  const manager = createTabStateManager();
  const thumb = "https://cdn.example.com/photo-thumb.jpg";
  const full = "https://cdn.example.com/photo-full.jpg";

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: thumb,
    normalized: thumb,
    width: 640,
    height: 360,
    area: 230400
  }]);

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 640,
    height: 360,
    area: 230400,
    maxWidth: 1920,
    maxHeight: 1080,
    maxArea: 2073600
  }]);

  const [stored] = manager.getAllImages(tabId);
  assert.equal(stored.hdSrc, full);
  assert.equal(stored.maxWidth, 1920);
  assert.equal(stored.maxHeight, 1080);
});

test("updates image metadata with larger loaded dimensions without downgrading later", () => {
  const manager = createTabStateManager();
  const thumb = "https://cdn.example.com/photo-thumb.jpg";
  const full = "https://cdn.example.com/photo-full.jpg";

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 320,
    height: 180,
    area: 57600
  }]);

  const [image] = manager.getAllImages(tabId);
  const firstUpdate = manager.updateImageMetadata(tabId, {
    imageId: image.id,
    url: full,
    maxWidth: 1920,
    maxHeight: 1080,
    maxArea: 2073600,
    format: "jpg"
  });
  assert.equal(firstUpdate.updated, true);

  manager.updateImageMetadata(tabId, {
    imageId: image.id,
    url: thumb,
    maxWidth: 320,
    maxHeight: 180,
    maxArea: 57600
  });

  const [stored] = manager.getAllImages(tabId);
  assert.equal(stored.maxWidth, 1920);
  assert.equal(stored.maxHeight, 1080);
  assert.equal(stored.maxArea, 2073600);
  assert.equal(stored.hdSrc, full);
  assert.equal(stored.format, "jpg");
});

test("updates image metadata by loaded URL when image id is absent", () => {
  const manager = createTabStateManager();
  const thumb = "https://cdn.example.com/photo-small.jpg";
  const full = "https://cdn.example.com/photo-large.jpg";

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: full,
    normalized: thumb,
    width: 500,
    height: 300,
    area: 150000
  }]);

  const update = manager.updateImageMetadata(tabId, {
    url: full,
    maxWidth: 2500,
    maxHeight: 1500,
    maxArea: 3750000
  });

  const [stored] = manager.getAllImages(tabId);
  assert.equal(update.updated, true);
  assert.equal(stored.maxWidth, 2500);
  assert.equal(stored.maxHeight, 1500);
});

test("updates missing HD source even when maximum dimensions were already known", () => {
  const manager = createTabStateManager();
  const thumb = "https://cdn.example.com/photo-small.jpg";
  const full = "https://cdn.example.com/photo-large.jpg";

  manager.mergeImages(tabId, [{
    src: thumb,
    originalSrc: thumb,
    hdSrc: thumb,
    normalized: thumb,
    width: 600,
    height: 450,
    area: 270000,
    maxWidth: 2700,
    maxHeight: 2025,
    maxArea: 5467500
  }]);

  const [image] = manager.getAllImages(tabId);
  const update = manager.updateImageMetadata(tabId, {
    imageId: image.id,
    url: full,
    maxWidth: 2700,
    maxHeight: 2025,
    maxArea: 5467500
  });

  const [stored] = manager.getAllImages(tabId);
  assert.equal(update.updated, true);
  assert.equal(stored.hdSrc, full);
  assert.equal(stored.maxWidth, 2700);
  assert.equal(stored.maxHeight, 2025);
});

test("keeps maximum dimensions as an observed width-height-area tuple", () => {
  const manager = createTabStateManager();
  const src = "https://cdn.example.com/cropped-thumb.jpg";

  manager.mergeImages(tabId, [{
    src,
    width: 800,
    height: 1200,
    area: 960000
  }]);

  const [image] = manager.getAllImages(tabId);
  manager.updateImageMetadata(tabId, {
    imageId: image.id,
    url: "https://cdn.example.com/full.jpg",
    maxWidth: 2000,
    maxHeight: 1000,
    maxArea: 2000000
  });

  const [stored] = manager.getAllImages(tabId);
  assert.equal(stored.maxWidth, 2000);
  assert.equal(stored.maxHeight, 1000);
  assert.equal(stored.maxArea, 2000000);
});

test("does not persist temporary blob URLs as HD sources when updating dimensions", () => {
  const manager = createTabStateManager();
  const src = "https://cdn.example.com/photo-thumb.jpg";

  manager.mergeImages(tabId, [{
    src,
    originalSrc: src,
    hdSrc: src,
    normalized: src,
    width: 320,
    height: 180,
    area: 57600
  }]);

  const [image] = manager.getAllImages(tabId);
  manager.updateImageMetadata(tabId, {
    imageId: image.id,
    url: "blob:https://example.com/temporary-viewer-url",
    maxWidth: 1920,
    maxHeight: 1080,
    maxArea: 2073600
  });

  const [stored] = manager.getAllImages(tabId);
  assert.equal(stored.hdSrc, src);
  assert.equal(stored.maxWidth, 1920);
  assert.equal(stored.maxHeight, 1080);
});
