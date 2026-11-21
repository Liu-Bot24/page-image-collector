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
  manager.markHdRejected(tabId, image.id, true, manager.getCollectionId(tabId));

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
  const firstUpdate = manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
    imageId: image.id,
    url: full,
    maxWidth: 1920,
    maxHeight: 1080,
    maxArea: 2073600,
    format: "jpg"
  });
  assert.equal(firstUpdate.updated, true);

  manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
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

  const update = manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
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
  const update = manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
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

  const update = manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
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
  const update = manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
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
  manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
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
  manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
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

test("does not persist unchanged selection/config while explicit clears advance the collection", async () => {
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
    manager.markHdRejected(tabId, image.id, false, manager.getCollectionId(tabId));
    await waitForPersistence();

    assert.equal(writeCount, baseline);

    manager.clearTabImages(tabId);
    await waitForPersistence();
    const afterClear = writeCount;
    const collectionAfterClear = manager.getCollectionId(tabId);
    manager.clearTabImages(tabId);
    await waitForPersistence();
    assert.equal(writeCount, afterClear + 1);
    assert.notEqual(manager.getCollectionId(tabId), collectionAfterClear);
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

test("limits selected images to the given ids while keeping the order rules", () => {
  const manager = createTabStateManager();
  manager.mergeImages(tabId, [
    { src: "https://cdn.example.com/large.jpg", width: 1000, height: 1000 },
    { src: "https://cdn.example.com/first.jpg", width: 100, height: 100 },
    { src: "https://cdn.example.com/second.jpg", width: 200, height: 100 },
    { src: "https://cdn.example.com/unselected.jpg", width: 50, height: 50 }
  ]);
  const images = manager.getAllImages(tabId);
  const bySuffix = (name) => images.find((image) => image.src.endsWith(`/${name}.jpg`));
  manager.setSelectionByIds(tabId, ["large", "first", "second"].map((name) => bySuffix(name).id), true);
  const srcs = (list) => list.map((image) => image.src.split("/").pop());

  const only = [bySuffix("first").id, bySuffix("large").id, bySuffix("unselected").id, "missing"];
  assert.deepEqual(srcs(manager.getSelectedImages(tabId, [], only)), ["large.jpg", "first.jpg"]);
  assert.deepEqual(srcs(manager.getSelectedImages(tabId, [bySuffix("first").id], only)), ["first.jpg", "large.jpg"]);
  assert.deepEqual(srcs(manager.getSelectedImages(tabId, [], [])), []);
  assert.deepEqual(srcs(manager.getSelectedImages(tabId, [], null)), ["large.jpg", "second.jpg", "first.jpg"]);
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

test("restores selected and hidden stable IDs after aliases replace normalized URLs", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const storageState = {};
  chrome.storage.local.get = async () => structuredClone(storageState);
  chrome.storage.local.set = async (values) => Object.assign(storageState, structuredClone(values));
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    const aliases = ["selected", "hidden"].map((name) => ({
      src: `https://cdn.example.com/${name}-thumb.jpg`,
      hdSrc: `https://cdn.example.com/${name}-full.jpg`, width: 100, height: 100
    }));
    manager.mergeImages(tabId, aliases);
    const [selected, hidden] = manager.getAllImages(tabId);
    manager.setSelectionByIds(tabId, [selected.id], true);
    manager.setHiddenByIds(tabId, [hidden.id], true);
    manager.mergeImages(tabId, aliases.map((record) => ({
      src: record.hdSrc, width: 1000, height: 1000
    })));
    await waitForPersistence();
    const restored = createTabStateManager();
    await restored.ensureReady();
    assert.deepEqual(restored.getSelectedImages(tabId).map((image) => image.id), [selected.id]);
    assert.equal(restored.getAllImages(tabId).find((image) => image.id === hidden.id)?.hidden, true);
    // A later thumbnail-only scan must still find the previously merged alias.
    restored.mergeImages(tabId, aliases.map(({ src }) => ({ src, width: 100, height: 100 })));
    assert.equal(restored.getAllImages(tabId).length, 2);
  } finally {
    await waitForPersistence();
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
  }
});

test("later scans preserve probed HD source and trusted payload format across restoration", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const storageState = {};
  chrome.storage.local.get = async () => structuredClone(storageState);
  chrome.storage.local.set = async (values) => Object.assign(storageState, structuredClone(values));
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    const src = "https://cdn.example.com/probed-thumb.jpg";
    const full = "https://cdn.example.com/probed-full.jpg";
    manager.mergeImages(tabId, [{ src, width: 320, height: 180, timestamp: 1 }]);
    const [image] = manager.getAllImages(tabId);
    manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
      imageId: image.id, url: full, width: 1920, height: 1080,
      format: "webp", formatTrusted: true
    });
    await waitForPersistence();
    const restored = createTabStateManager();
    await restored.ensureReady();
    restored.mergeImages(tabId, [{ src, width: 320, height: 180, format: "jpg", timestamp: 2 }]);
    const [stored] = restored.getAllImages(tabId);
    assert.equal(stored.hdSrc, full);
    assert.equal(stored.format, "webp");
    assert.equal(stored.maxWidth, 1920);
    assert.equal(stored.maxHeight, 1080);
    assert.equal(stored.isHD, true);
  } finally {
    await waitForPersistence();
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
  }
});

test("Telegram keeps distinct strong media identities with identical dimensions", () => {
  const manager = createTabStateManager();
  manager.mergeImages(tabId, [0, 1].map((index) => ({
    src: `blob:https://web.telegram.org/strong-${index}`,
    normalized: `tg:generic|-100123456:7:i:${index}`,
    sourceUrl: "https://web.telegram.org/k/#-100123456/7", width: 800, height: 600
  })));
  assert.equal(manager.getAllImages(tabId).length, 2);
});

test("Telegram merges matching strong identity after blob URL replacement", () => {
  const manager = createTabStateManager();
  manager.mergeImages(tabId, [0, 1].map((index) => ({
    src: `blob:https://web.telegram.org/same-${index}`,
    normalized: "tg:generic|-100123456:7:m:photo123",
    sourceUrl: "https://web.telegram.org/k/#-100123456/7", width: 800 + index * 800, height: 600 + index * 600
  })));
  assert.equal(manager.getAllImages(tabId).length, 1);
  assert.equal(manager.getAllImages(tabId)[0].width, 1600);
});

test("Telegram never uses weak dimensions alone to merge different blob URLs", () => {
  for (const normalized of ["tg:generic|peer:7:r:750", "tg:generic|peer:s:600x800", "tg:generic|75|600x800", ""]) {
    const manager = createTabStateManager();
    manager.mergeImages(tabId, [0, 1].map((index) => ({
      src: `blob:https://web.telegram.org/weak-${index}`, normalized,
      sourceUrl: "https://web.telegram.org/k/#-100123456/7", width: 800, height: 600
    })));
    assert.equal(manager.getAllImages(tabId).length, 2, normalized);
  }
});

test("state hydration failures reject callers and retry without overwriting stored tabs", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const originalConsoleError = console.error;
  let readCount = 0;
  let writeCount = 0;
  const storageState = { [storageKey]: { "909": { images: [{ src: "https://cdn.example.com/saved.jpg" }] } } };
  chrome.storage.local.get = async () => {
    readCount += 1;
    if (readCount === 1) throw new Error("Storage temporarily unavailable");
    return structuredClone(storageState);
  };
  chrome.storage.local.set = async (values) => {
    writeCount += 1;
    Object.assign(storageState, structuredClone(values));
  };
  console.error = () => {};
  try {
    const manager = createTabStateManager();
    await assert.rejects(manager.ensureReady(), /Storage temporarily unavailable/);
    assert.equal(writeCount, 0);
    await manager.ensureReady();
    assert.equal(manager.getAllImages(909).length, 1);
    manager.setConfig(tabId, { enableHD: false });
    await waitForPersistence();
    assert.equal(readCount, 2);
    assert.equal(storageState[storageKey]["909"].images.length, 1);
  } finally {
    await waitForPersistence();
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
    console.error = originalConsoleError;
  }
});

test("coalesces synchronous state mutations into one storage snapshot", async () => {
  await waitForPersistence();
  const originalSet = chrome.storage.local.set;
  let writeCount = 0;
  chrome.storage.local.set = async () => { writeCount += 1; };
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    manager.mergeImages(tabId, [{ src: "https://cdn.example.com/coalesced.jpg" }]);
    manager.setConfig(tabId, { enableHD: false });
    manager.setPageUrl(tabId, "https://example.com/gallery");
    await waitForPersistence();
    assert.equal(writeCount, 1);
  } finally {
    chrome.storage.local.set = originalSet;
  }
});

test("restores legacy stable IDs that differ from current normalized URL hashes", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const full = "https://cdn.example.com/legacy-full.jpg";
  const stableId = generateImageId("https://cdn.example.com/legacy-thumb.jpg");
  chrome.storage.local.get = async () => ({ [storageKey]: { [tabId]: {
    images: [{ id: stableId, src: full, normalized: full }],
    selectedIds: [stableId], hiddenIds: []
  } } });
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    assert.equal(manager.getAllImages(tabId)[0].id, stableId);
    assert.equal(manager.getSelectedImages(tabId)[0].id, stableId);
  } finally {
    chrome.storage.local.get = originalGet;
  }
});

test("retains collision-suffixed IDs and hidden state during storage hydration", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const storageState = {};
  chrome.storage.local.get = async () => structuredClone(storageState);
  chrome.storage.local.set = async (values) => Object.assign(storageState, structuredClone(values));
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    manager.mergeImages(tabId, ["Aa", "BB"].map((part) => ({ src: `https://x.example/${part}` })));
    const [first, second] = manager.getAllImages(tabId);
    manager.setSelectionByIds(tabId, [first.id], true);
    manager.setHiddenByIds(tabId, [second.id], true);
    await manager.flushPersistence();
    const restored = createTabStateManager();
    await restored.ensureReady();
    assert.deepEqual(restored.getAllImages(tabId).map((image) => image.id), [first.id, second.id]);
    assert.equal(restored.getAllImages(tabId)[1].hidden, true);
    assert.equal(restored.getSelectedImages(tabId)[0].id, first.id);
  } finally {
    await waitForPersistence();
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
  }
});

test("merges and persists exact signed download candidates while rejecting invalid URLs", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const originalSet = chrome.storage.local.set;
  const storageState = {};
  chrome.storage.local.get = async () => structuredClone(storageState);
  chrome.storage.local.set = async (values) => Object.assign(storageState, structuredClone(values));
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    const src = "https://cdn.example.com/candidate.jpg";
    const signed = "https://cdn.example.com/full.jpg?expires=123&ssig=a%2Bb";
    const otherSigned = "https://cdn.example.com/full.jpg?expires=456&ssig=c%2Bd";
    manager.mergeImages(tabId, [{ src, originalSrc: src, timestamp: 1,
      candidateUrls: [signed, signed, "/relative.jpg", "javascript:alert(1)", "not a URL"]
    }]);
    manager.mergeImages(tabId, [{ src, originalSrc: src, timestamp: 1, candidateUrls: [otherSigned] }]);
    await manager.flushPersistence();
    const restored = createTabStateManager();
    await restored.ensureReady();
    const [image] = restored.getAllImages(tabId);
    assert.deepEqual(image.candidateUrls, [otherSigned, signed]);
    assert.equal(image.originalSrc, src);
  } finally {
    await waitForPersistence();
    chrome.storage.local.get = originalGet;
    chrome.storage.local.set = originalSet;
  }
});

test("reports persistence failure and retries the latest dirty state on flush", async () => {
  await waitForPersistence();
  const originalSet = chrome.storage.local.set;
  const originalConsoleError = console.error;
  let shouldFail = true;
  let saved;
  chrome.storage.local.set = async (values) => {
    if (shouldFail) throw new Error("QUOTA_BYTES exceeded");
    saved = structuredClone(values);
  };
  console.error = () => {};
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    manager.mergeImages(tabId, [{ src: "https://cdn.example.com/unsaved.jpg" }]);
    await assert.rejects(manager.flushPersistence(), /QUOTA_BYTES/);
    assert.deepEqual(manager.getPersistenceStatus(), { pending: true, error: "QUOTA_BYTES exceeded" });
    manager.setConfig(tabId, { enableHD: false });
    await waitForPersistence();
    shouldFail = false;
    await manager.flushPersistence();
    assert.equal(saved[storageKey][tabId].images.length, 1);
    assert.equal(saved[storageKey][tabId].config.enableHD, false);
    assert.deepEqual(manager.getPersistenceStatus(), { pending: false, error: null });
  } finally {
    await waitForPersistence();
    chrome.storage.local.set = originalSet;
    console.error = originalConsoleError;
  }
});

test("flush includes changes that arrive while the previous snapshot is saving", async () => {
  await waitForPersistence();
  const originalSet = chrome.storage.local.set;
  const snapshots = [];
  let finishFirstWrite;
  chrome.storage.local.set = async (values) => {
    snapshots.push(structuredClone(values));
    if (snapshots.length === 1) await new Promise((resolve) => { finishFirstWrite = resolve; });
  };
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    manager.mergeImages(tabId, [{ src: "https://cdn.example.com/first-write.jpg" }]);
    await waitForPersistence();
    manager.mergeImages(tabId, [{ src: "https://cdn.example.com/second-write.jpg" }]);
    const flush = manager.flushPersistence();
    finishFirstWrite();
    await flush;
    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0][storageKey][tabId].images.length, 1);
    assert.equal(snapshots[1][storageKey][tabId].images.length, 2);
    assert.deepEqual(manager.getPersistenceStatus(), { pending: false, error: null });
  } finally {
    finishFirstWrite?.();
    await waitForPersistence();
    chrome.storage.local.set = originalSet;
  }
});

test("Telegram conflicting strong identities never merge through a shared blob URL", () => {
  const manager = createTabStateManager();
  manager.mergeImages(tabId, [0, 1].map((index) => ({
    src: "blob:https://web.telegram.org/shared-placeholder",
    normalized: `tg:generic|-100123456:7:i:${index}`, width: 800, height: 600
  })));
  assert.equal(manager.getAllImages(tabId).length, 2);
});

test("a trusted matching format remains trusted when a later scan guesses another format", () => {
  const manager = createTabStateManager();
  const src = "https://cdn.example.com/format-trust.jpg";
  manager.mergeImages(tabId, [{ src, timestamp: 1 }]);
  const [image] = manager.getAllImages(tabId);
  manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId), imageId: image.id, url: src, format: "jpg", formatTrusted: true });
  manager.mergeImages(tabId, [{ src, format: "webp", timestamp: 2 }]);
  assert.equal(manager.getAllImages(tabId)[0].format, "jpg");
});

test("repairs legacy maximum area that disagrees with its measured dimensions", async () => {
  await waitForPersistence();
  const originalGet = chrome.storage.local.get;
  const src = "https://cdn.example.com/legacy-dimensions.jpg";
  chrome.storage.local.get = async () => ({ [storageKey]: { [tabId]: { images: [{
    src, width: 320, height: 180, maxWidth: 320, maxHeight: 180, maxArea: 2073600
  }] } } });
  try {
    const manager = createTabStateManager();
    await manager.ensureReady();
    const [restored] = manager.getAllImages(tabId);
    assert.equal(restored.maxArea, restored.maxWidth * restored.maxHeight);
    const updated = manager.updateImageMetadata(tabId, { collectionId: manager.getCollectionId(tabId),
      imageId: restored.id, url: "https://cdn.example.com/repaired-full.jpg",
      maxWidth: 1920, maxHeight: 1080, maxArea: 2073600
    });
    assert.equal(updated.updated, true);
    assert.equal(updated.image.maxWidth, 1920);
    assert.equal(updated.image.maxArea, 2073600);
  } finally {
    await waitForPersistence();
    chrome.storage.local.get = originalGet;
  }
});
