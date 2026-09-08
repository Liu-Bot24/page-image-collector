import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createTabStateManager } from "../background/stateManager.js";

const contentSource = readFileSync(new URL("../content/content.js", import.meta.url), "utf8");
const placeholder = "https://shop.example/assets/product-placeholder.jpg";
const productUrl = (name) => `https://cdn.example/products/${name}.jpg`;

function createContentHarness() {
  class Element {
    constructor(tagName = "div", attributes = {}) {
      this.tagName = tagName.toUpperCase();
      this.attributes = attributes;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.naturalWidth = 320;
      this.naturalHeight = 180;
    }
    get src() { return this.attributes.src || ""; }
    get currentSrc() { return this.src; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    getAttributeNames() { return Object.keys(this.attributes); }
    hasAttribute(key) { return key in this.attributes; }
    getBoundingClientRect() { return { width: 320, height: 180, top: 0, left: 0, bottom: 180, right: 320 }; }
    closest() { return null; }
    querySelectorAll() { return []; }
    addEventListener() {}
    removeEventListener() {}
  }
  const document = new Element("document");
  document.documentElement = new Element("html");
  document.body = new Element("body");
  const context = vm.createContext({
    Element, URL, document, location: new URL("https://shop.example/list"),
    chrome: { runtime: { onMessage: { addListener() {} } } },
    window: { addEventListener() {}, removeEventListener() {} }
  });
  vm.runInContext(contentSource.replace(/\}\)\(\);\s*$/, `globalThis.audit = { extractFromImg, normalizeImageRecord }; })();`), context);
  return {
    extract(name) {
      const element = new Element("img", { src: placeholder, "data-original": productUrl(name) });
      return context.audit.normalizeImageRecord(context.audit.extractFromImg(element));
    }
  };
}

async function managerWithMemoryStorage() {
  const state = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(state),
    set: async (payload) => Object.assign(state, structuredClone(payload))
  } } };
  const manager = createTabStateManager();
  await manager.ensureReady();
  return manager;
}

test("real content records retain two lazy-loaded products sharing a loaded placeholder", async () => {
  const content = createContentHarness();
  const records = [content.extract("one"), content.extract("two")];
  assert.notEqual(records[0].normalized, records[1].normalized);
  assert.deepEqual(records.map((record) => record.originalSrc), [placeholder, placeholder]);
  const manager = await managerWithMemoryStorage();
  assert.equal(manager.mergeImages(7, records).total, 2);
  const [first, second] = manager.getAllImages(7);
  assert.ok(first.candidateUrls.includes(placeholder));
  assert.ok(second.candidateUrls.includes(placeholder));
  assert.ok(!first.candidateUrls.includes(productUrl("two")));
  manager.setSelectionByIds(7, [first.id], true);
  manager.setHiddenByIds(7, [second.id], true);
  await manager.flushPersistence();

  const restored = createTabStateManager();
  await restored.ensureReady();
  assert.equal(restored.getAllImages(7).length, 2);
  assert.deepEqual(restored.getSelectedImages(7).map((image) => image.id), [first.id]);
  assert.equal(restored.getAllImages(7).find((image) => image.id === second.id).hidden, true);
  assert.equal(restored.mergeImages(7, records).total, 2);
  await restored.flushPersistence();
});

test("a fallback shared with another image's primary source cannot merge their identities", async () => {
  const manager = await managerWithMemoryStorage();
  manager.mergeImages(7, [{ src: placeholder, width: 100, height: 100 }]);
  manager.mergeImages(7, [{ src: productUrl("one"), originalSrc: placeholder,
    candidateUrls: [placeholder, productUrl("one")], width: 320, height: 180 }]);
  assert.equal(manager.getAllImages(7).length, 2);
  await manager.flushPersistence();
});

test("real source-to-HD aliases still merge and retain stable selection after restoration", async () => {
  const manager = await managerWithMemoryStorage();
  manager.mergeImages(7, [{ src: productUrl("thumb"), hdSrc: productUrl("full"),
    originalSrc: placeholder, width: 320, height: 180 }]);
  const [first] = manager.getAllImages(7);
  manager.setSelectionByIds(7, [first.id], true);
  manager.mergeImages(7, [{ src: productUrl("full"), width: 1920, height: 1080 }]);
  assert.equal(manager.getAllImages(7).length, 1);
  await manager.flushPersistence();
  const restored = createTabStateManager();
  await restored.ensureReady();
  restored.mergeImages(7, [{ src: productUrl("thumb"), width: 320, height: 180 }]);
  assert.equal(restored.getAllImages(7).length, 1);
  assert.equal(restored.getSelectedImages(7)[0].id, first.id);
  await restored.flushPersistence();
});
