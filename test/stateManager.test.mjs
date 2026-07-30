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

const { createTabStateManager, generateImageId } = await import("../background/stateManager.js");

const tabId = 101;
const storageKey = "pic_collector_tab_states_v2";

const waitForPersistence = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

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

test("updates image format from trusted payload inspection even when URL guess was different", () => {
  const manager = createTabStateManager();
  const url = "https://cdn.example.com/photo.jpg";

  manager.mergeImages(tabId, [{
    src: url,
    originalSrc: url,
    hdSrc: url,
    normalized: url,
    width: 640,
    height: 360,
    area: 230400
  }]);

  let [stored] = manager.getAllImages(tabId);
  assert.equal(stored.format, "jpg");

  const update = manager.updateImageMetadata(tabId, {
    imageId: stored.id,
    url,
    maxWidth: 640,
    maxHeight: 360,
    maxArea: 230400,
    format: "webp",
    formatTrusted: true
  });

  [stored] = manager.getAllImages(tabId);
  assert.equal(update.updated, true);
  assert.equal(stored.format, "webp");
});

test("does not replace a known format from an untrusted metadata update", () => {
  const manager = createTabStateManager();
  const url = "https://cdn.example.com/photo.jpg";

  manager.mergeImages(tabId, [{
    src: url,
    originalSrc: url,
    hdSrc: url,
    normalized: url,
    width: 640,
    height: 360,
    area: 230400
  }]);

  const [image] = manager.getAllImages(tabId);
  const update = manager.updateImageMetadata(tabId, {
    imageId: image.id,
    url,
    maxWidth: 640,
    maxHeight: 360,
    maxArea: 230400,
    format: "webp"
  });

  const [stored] = manager.getAllImages(tabId);
  assert.equal(update.updated, false);
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

test("persists the last source page URL for navigation comparisons", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const storageState = {};

  chrome.storage.local.get = async () => structuredClone(storageState);
  chrome.storage.local.set = async (values) => {
    Object.assign(storageState, structuredClone(values));
  };

  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    assert.equal(manager.hasTabState(601), false);
    assert.equal(manager.setPageUrl(601, "https://example.com/gallery?page=1#top"), true);
    assert.equal(manager.hasTabState(601), true);
    assert.equal(manager.setPageUrl(601, "https://example.com/gallery?page=1#top"), false);
    await waitForPersistence();

    assert.equal(
      storageState[storageKey]["601"].pageUrl,
      "https://example.com/gallery?page=1#top"
    );

    const restored = createTabStateManager();
    await restored.ensureReady();
    assert.equal(
      restored.getPageUrl(601),
      "https://example.com/gallery?page=1#top"
    );
  } finally {
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
  }
});

test("hydrates all persisted tabs before removing a closed tab", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const storageState = {
    [storageKey]: {
      "501": {
        images: [{ src: "https://cdn.example.com/closed.jpg", width: 100, height: 100 }],
        selectedIds: [],
        hiddenIds: [],
        config: { enableHD: true },
        lastScanTime: 1
      },
      "502": {
        images: [{ src: "https://cdn.example.com/kept.jpg", width: 200, height: 100 }],
        selectedIds: [],
        hiddenIds: [],
        config: { enableHD: true },
        lastScanTime: 2
      }
    }
  };

  chrome.storage.local.get = async () => structuredClone(storageState);
  chrome.storage.local.set = async (values) => {
    Object.assign(storageState, structuredClone(values));
  };

  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    manager.removeTabState(501);
    await waitForPersistence();

    assert.equal(storageState[storageKey]["501"], undefined);
    assert.equal(storageState[storageKey]["502"].images.length, 1);
    assert.equal(storageState[storageKey]["502"].images[0].src, "https://cdn.example.com/kept.jpg");
  } finally {
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
  }
});

test("falls back to the original URL format when the HD URL has no extension", () => {
  const manager = createTabStateManager();
  manager.mergeImages(tabId, [{
    src: "https://cdn.example.com/photo.jpg",
    hdSrc: "https://cdn.example.com/photo-original",
    width: 1200,
    height: 800
  }]);

  const [stored] = manager.getAllImages(tabId);
  assert.equal(stored.format, "jpg");
});

test("does not replace a known format with unknown metadata from a larger record", () => {
  const manager = createTabStateManager();
  const src = "https://cdn.example.com/photo";

  manager.mergeImages(tabId, [{
    src,
    normalized: src,
    format: "jpg",
    width: 400,
    height: 300,
    timestamp: 1
  }]);
  manager.mergeImages(tabId, [{
    src,
    normalized: src,
    format: "unknown",
    width: 1600,
    height: 1200,
    timestamp: 2
  }]);

  const [stored] = manager.getAllImages(tabId);
  assert.equal(stored.format, "jpg");
  assert.equal(stored.width, 1600);
});

test("keeps both images when different normalized URLs produce the same base hash", () => {
  const manager = createTabStateManager();
  const first = "https://x.example/Aa";
  const second = "https://x.example/BB";

  assert.equal(generateImageId(first), generateImageId(second));

  manager.mergeImages(tabId, [
    { src: first, normalized: first, width: 100, height: 100 },
    { src: second, normalized: second, width: 200, height: 100 }
  ]);

  const images = manager.getAllImages(tabId);
  assert.equal(images.length, 2);
  assert.equal(new Set(images.map((image) => image.id)).size, 2);
  assert.deepEqual(new Set(images.map((image) => image.normalized)), new Set([first, second]));
});

test("does not persist state operations that change nothing", async () => {
  await waitForPersistence();
  const originalSet = chrome.storage.local.set;
  let writeCount = 0;
  chrome.storage.local.set = async () => {
    writeCount += 1;
  };

  try {
    const manager = createTabStateManager();
    manager.mergeImages(tabId, [{
      src: "https://cdn.example.com/no-op.jpg",
      width: 100,
      height: 100
    }]);
    await waitForPersistence();
    const [image] = manager.getAllImages(tabId);
    const baseline = writeCount;

    manager.setSelectionByIds(tabId, [], true);
    manager.setSelectionByIds(tabId, ["missing"], true);
    manager.setHiddenByIds(tabId, [image.id], false);
    manager.setConfig(tabId, { enableHD: true });
    manager.markHdRejected(tabId, image.id, false);
    await waitForPersistence();

    assert.equal(writeCount, baseline);

    manager.clearTabImages(tabId);
    await waitForPersistence();
    const afterClear = writeCount;
    manager.clearTabImages(tabId);
    await waitForPersistence();
    assert.equal(writeCount, afterClear);
  } finally {
    chrome.storage.local.set = originalSet;
  }
});

test("uses caller order for selected images without dropping selected items", () => {
  const manager = createTabStateManager();
  manager.mergeImages(tabId, [
    { src: "https://cdn.example.com/large.jpg", width: 1000, height: 1000 },
    { src: "https://cdn.example.com/first.jpg", width: 100, height: 100 },
    { src: "https://cdn.example.com/second.jpg", width: 200, height: 100 }
  ]);
  const images = manager.getAllImages(tabId);
  manager.setSelectionByIds(tabId, images.map((image) => image.id), true);

  const first = images.find((image) => image.src.endsWith("/first.jpg"));
  const second = images.find((image) => image.src.endsWith("/second.jpg"));
  const ordered = manager.getSelectedImages(tabId, [first.id, second.id, first.id, "missing"]);

  assert.deepEqual(
    ordered.map((image) => image.src),
    [
      "https://cdn.example.com/first.jpg",
      "https://cdn.example.com/second.jpg",
      "https://cdn.example.com/large.jpg"
    ]
  );
});

test("finishing a scan after tab removal does not recreate the removed tab state", async () => {
  await waitForPersistence();
  const originalSet = chrome.storage.local.set;
  let latestPayload = {};
  chrome.storage.local.set = async (values) => {
    latestPayload = structuredClone(values);
  };

  try {
    const manager = createTabStateManager();
    manager.setScanning(701, true);
    manager.removeTabState(701);
    manager.setScanning(701, false);
    manager.mergeImages(702, [{
      src: "https://cdn.example.com/kept-after-removal.jpg",
      width: 100,
      height: 100
    }]);
    await waitForPersistence();

    assert.equal(latestPayload[storageKey]["701"], undefined);
    assert.equal(latestPayload[storageKey]["702"].images.length, 1);
  } finally {
    chrome.storage.local.set = originalSet;
  }
});
