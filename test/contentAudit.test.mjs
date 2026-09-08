import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { MessageChannel } from "node:worker_threads";

const contentSource = readFileSync(new URL("../content/content.js", import.meta.url), "utf8");

// Run the complete shipped content script; only expose its closure for inspection.
// The DOM and clock are deterministic so a paused animation frame is reproducible.
function createHarness({ reply = async () => ({ success: true }), url = "https://example.com/gallery", scanClock } = {}) {
  class Element {
    constructor(tagName = "div", attributes = {}) {
      this.tagName = tagName.toUpperCase();
      this.attributes = { ...attributes };
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.naturalWidth = 320;
      this.naturalHeight = 180;
      this.isConnected = true;
      this.scrollTop = 0;
      this.scrollHeight = 5000;
      this.clientHeight = 800;
      this.listeners = new Map();
    }
    get src() { return this.attributes.src || ""; }
    get srcset() { return this.attributes.srcset || ""; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    hasAttribute(key) { return key in this.attributes; }
    getAttributeNames() { return Object.keys(this.attributes); }
    getBoundingClientRect() { return { width: 320, height: 180, top: 0, left: 0, bottom: 180, right: 320 }; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
    getRootNode() { return this.parentElement?.getRootNode() || this; }
    matches(selector) {
      return selector.split(",").some((part) => {
        const trimmed = part.trim();
        if (trimmed === "*") return true;
        if (["img", "picture", "source", "a"].includes(trimmed)) return this.tagName === trimmed.toUpperCase();
        if (trimmed === "a[href]") return this.tagName === "A" && this.hasAttribute("href");
        return false;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name) { this.listeners.delete(name); }
  }
  class Document extends Element {}
  class ShadowRoot extends Element {}
  const document = new Document("document");
  document.documentElement = document.appendChild(new Element("html"));
  document.body = document.documentElement.appendChild(new Element("body"));
  document.scrollingElement = document.documentElement;
  Object.defineProperty(document, "images", { get: () => document.querySelectorAll("img") });
  let now = 10000;
  let handle = 0;
  const timers = new Map();
  const frames = new Map();
  const messages = [];
  const observers = [];
  const events = new Map();
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.targets = []; }
  }
  const context = vm.createContext({
    URL, Element, Document, ShadowRoot, MutationObserver, AbortController, MessageChannel,
    performance: { now: () => scanClock ? scanClock() : now },
    location: new URL(url), document,
    Date: class extends Date { static now() { return now; } },
    setTimeout(callback, delay) { const id = ++handle; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { const id = ++handle; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    chrome: { runtime: {
      sendMessage: async (message) => { messages.push(message); return reply(message); },
      onMessage: { addListener(callback) { events.set("message", callback); } }
    } },
    window: {
      innerWidth: 1200, innerHeight: 800, scrollY: 0,
      scrollTo({ top }) { document.scrollingElement.scrollTop = top; this.scrollY = top; },
      getComputedStyle: (element) => ({ backgroundImage: element.style.backgroundImage || "none", overflowY: "visible" }),
      addEventListener() {}, removeEventListener() {}
    }
  });
  vm.runInContext(contentSource.replace(/\}\)\(\);\s*$/, `globalThis.audit = {
    extractFromImg, extractFromPicture, normalizeImageRecord, parseSrcsetUrls,
    startAutoScan, stopAutoScan, pushIncrementalImages, recordKnownImages,
    addAutoScanMutationRoot, consumeAutoScanMutationRoots, sendIncrementalToBackground,
    startAutoScroll, stopAutoScroll, resetRuntimeCaches, scanImagesFromRoots,
    get known() { return [...knownNormalizedUrls]; },
    get scrolling() { return autoScrollEnabled; }
  }; })();`), context);
  const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    now = end;
    await flush();
  }
  return { api: context.audit, context, document, Element, ShadowRoot, messages, observers, timers, frames, advance, flush };
}

function appendImage(harness, attributes = {}) {
  const image = new harness.Element("img", { src: "https://cdn.example.com/image.jpg", ...attributes });
  image.currentSrc = image.src;
  harness.document.body.appendChild(image);
  return image;
}

test("image extraction keeps loaded signed currentSrc and every fallback candidate", () => {
  const h = createHarness();
  const image = appendImage(h, { "data-original": "https://cdn.example.com/original.jpg", srcset: "small.jpg 400w, middle.jpg 800w, large.jpg 1600w" });
  image.currentSrc = "https://cdn.example.com/small.jpg?Expires=12&ssig=keep";
  const result = h.api.normalizeImageRecord(h.api.extractFromImg(image));
  assert.equal(result.originalSrc, image.currentSrc);
  for (const url of [image.currentSrc, image.src, "https://example.com/middle.jpg", "https://example.com/small.jpg", result.src, result.hdSrc]) {
    assert.ok(result.candidateUrls.includes(url), `missing candidate ${url}`);
  }
});

test("picture extraction retains media alternatives and loaded image fallback", () => {
  const h = createHarness();
  const picture = h.document.body.appendChild(new h.Element("picture"));
  picture.appendChild(new h.Element("source", { srcset: "a.avif 1x, a@2x.avif 2x" }));
  const image = picture.appendChild(new h.Element("img", { src: "https://cdn.example.com/a.jpg" }));
  image.currentSrc = image.src;
  const record = h.api.normalizeImageRecord(h.api.extractFromPicture(picture));
  assert.equal(record.originalSrc, image.src);
  assert.ok(record.candidateUrls.includes("https://example.com/a.avif"));
  assert.ok(record.candidateUrls.includes("https://example.com/a@2x.avif"));
});

test("starting auto scan uploads existing images before remembering them", async () => {
  let acknowledge;
  const h = createHarness({ reply: () => new Promise((resolve) => { acknowledge = resolve; }) });
  appendImage(h);
  h.api.startAutoScan();
  await h.flush();
  assert.equal(h.messages.length, 1);
  assert.equal(h.api.known.length, 0);
  acknowledge({ success: true });
  await h.flush();
  assert.equal(h.api.known.length, 1);
  h.api.stopAutoScan();
});

test("negative or missing acknowledgement leaves initial images retryable", async () => {
  for (const firstReply of [{ success: false }, undefined]) {
    let attempt = 0;
    const h = createHarness({ reply: async () => ++attempt === 1 ? firstReply : { success: true } });
    appendImage(h);
    h.api.startAutoScan();
    await h.flush();
    assert.equal(h.api.known.length, 0);
    await h.advance(1600);
    assert.equal(attempt, 2);
    assert.equal(h.api.known.length, 1);
    h.api.stopAutoScan();
  }
});

test("same URL reports improved dimensions while identical scans stay quiet", async () => {
  const h = createHarness();
  const image = appendImage(h);
  h.api.startAutoScan();
  await h.flush();
  h.messages.length = 0;
  await h.advance(1);
  await h.api.pushIncrementalImages();
  assert.equal(h.messages.length, 0);
  image.naturalWidth = 1920;
  image.naturalHeight = 1080;
  await h.api.pushIncrementalImages();
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].payload.images[0].width, 1920);
  await h.api.pushIncrementalImages();
  assert.equal(h.messages.length, 1);
  h.api.stopAutoScan();
});

test("image load reports dimensions even when its URL attributes do not change", async () => {
  const h = createHarness();
  const image = appendImage(h);
  image.naturalWidth = 0;
  image.naturalHeight = 0;
  h.api.startAutoScan();
  await h.flush();
  image.naturalWidth = 1600;
  image.naturalHeight = 900;
  assert.equal(typeof h.document.listeners.get("load"), "function");
  h.document.listeners.get("load")({ target: image });
  await h.advance(250);
  assert.equal(h.messages.at(-1).payload.images[0].width, 1600);
  h.api.stopAutoScan();
  assert.equal(h.document.listeners.has("load"), false);
});

test("duplicate selected URLs retain alternate candidates from all DOM records", async () => {
  const h = createHarness();
  appendImage(h, { "data-original": "https://cdn.example.com/original.jpg", src: "https://cdn.example.com/first.jpg" });
  appendImage(h, { "data-original": "https://cdn.example.com/original.jpg", src: "https://cdn.example.com/second.jpg" });
  const images = await h.api.scanImagesFromRoots([h.document]);
  assert.equal(images.length, 1);
  assert.ok(images[0].candidateUrls.includes("https://cdn.example.com/first.jpg"));
  assert.ok(images[0].candidateUrls.includes("https://cdn.example.com/second.jpg"));
});

test("pending baseline serializes mutations and ignores acknowledgements after reset", async () => {
  const acknowledgements = [];
  const h = createHarness({ reply: () => new Promise((resolve) => acknowledgements.push(resolve)) });
  const image = appendImage(h);
  h.api.startAutoScan();
  image.naturalWidth = 1920;
  image.naturalHeight = 1080;
  const observer = h.observers[0];
  observer.callback([{ type: "attributes", target: image }]);
  await h.advance(300);
  assert.equal(h.messages.length, 1);
  acknowledgements[0]({ success: true });
  await h.flush();
  await h.advance(300);
  assert.equal(h.messages.length, 2);
  assert.equal(h.messages[1].payload.images[0].width, 1920);
  h.api.resetRuntimeCaches();
  acknowledgements[1]({ success: true });
  await h.flush();
  assert.equal(h.api.known.length, 0);
  h.api.stopAutoScan();
});

test("stopping auto scan cancels retries and ignores a late success", async () => {
  let acknowledge;
  const h = createHarness({ reply: () => new Promise((resolve) => { acknowledge = resolve; }) });
  appendImage(h);
  h.api.startAutoScan();
  await h.flush();
  h.api.stopAutoScan();
  acknowledge({ success: true });
  await h.flush();
  await h.advance(3000);
  assert.equal(h.api.known.length, 0);
  assert.equal(h.messages.length, 1);
  assert.equal(h.timers.size, 0);
});

test("dirty subtree roots coalesce descendants without dropping siblings", () => {
  const h = createHarness();
  const left = h.document.body.appendChild(new h.Element());
  const leaf = left.appendChild(new h.Element());
  const right = h.document.body.appendChild(new h.Element());
  h.api.addAutoScanMutationRoot(leaf);
  h.api.addAutoScanMutationRoot(left);
  h.api.addAutoScanMutationRoot(leaf);
  h.api.addAutoScanMutationRoot(right);
  assert.deepEqual([...h.api.consumeAutoScanMutationRoots()], [left, right]);
});

test("auto scan observes class changes and existing open shadow roots", async () => {
  const h = createHarness();
  const host = h.document.body.appendChild(new h.Element());
  host.shadowRoot = new h.ShadowRoot();
  host.shadowRoot.host = host;
  h.api.startAutoScan();
  await h.flush();
  const targets = h.observers.flatMap((observer) => observer.targets);
  assert.ok(targets.some(({ target }) => target === host.shadowRoot));
  assert.ok(targets.every(({ options }) => options.attributeFilter.includes("class")));
  h.api.stopAutoScan();
  assert.equal(h.observers.flatMap((observer) => observer.targets).length, 0);
});

test("scrolling advances when animation frames are suspended and stops cleanly", async () => {
  const h = createHarness();
  h.api.startAutoScroll();
  await h.advance(2500);
  assert.ok(h.document.scrollingElement.scrollTop > 620, "scroller got stuck after its first step");
  h.api.stopAutoScroll();
  const stoppedAt = h.document.scrollingElement.scrollTop;
  await h.advance(3000);
  assert.equal(h.document.scrollingElement.scrollTop, stoppedAt);
  assert.equal(h.timers.size, 0);
  assert.equal(h.frames.size, 0);
});

test("scroll duration is bounded even on endlessly growing pages", async () => {
  const h = createHarness();
  h.context.window.scrollTo = ({ top }) => {
    h.document.scrollingElement.scrollTop = top;
    h.document.scrollingElement.scrollHeight += 2000;
  };
  h.api.startAutoScroll("normal", { maxDurationMs: 1800 });
  await h.advance(3000);
  assert.equal(h.api.scrolling, false);
  assert.equal(h.messages.at(-1)?.payload.reason, "timeout");
});

test("a cancelled scroll frame cannot interfere with a restarted run", async () => {
  const h = createHarness();
  h.api.startAutoScroll();
  await h.advance(180);
  const staleFrame = [...h.frames.values()][0];
  h.api.stopAutoScroll();
  h.api.startAutoScroll();
  await h.advance(180);
  const pendingTimers = h.timers.size;
  staleFrame();
  assert.equal(h.timers.size, pendingTimers);
  assert.equal(h.frames.size, 1);
  const liveFrame = [...h.frames.values()][0];
  liveFrame();
  liveFrame();
  assert.equal(h.frames.size, 0);
  assert.equal(h.timers.size, 2, "only the next tick and deadline remain");
  h.api.stopAutoScroll();
});

test("Telegram weak size keys keep distinct blobs while strong media identity stays stable", () => {
  const h = createHarness({ url: "https://web.telegram.org/a/" });
  const record = (src, telegramKey) => h.api.normalizeImageRecord({ src, telegramKey, width: 640, height: 480 });
  for (const key of ["", "peer:s:480x640", "peer:123:r:750", "peer:i:0", "peer:123:f"]) {
    assert.notEqual(record("blob:https://web.telegram.org/one", key).normalized, record("blob:https://web.telegram.org/two", key).normalized);
  }
  for (const key of ["peer:123:i:0", "peer:123:m:media123", "peer:x:media123"]) {
    assert.equal(record("blob:https://web.telegram.org/one", key).normalized, record("blob:https://web.telegram.org/two", key).normalized);
  }
});

for (const cancel of [false, true]) {
  test(`long scans yield between batches and discard cancelled work (${cancel})`, async () => {
    let time = 0;
    const h = createHarness({ scanClock: () => ++time });
    for (let i = 0; i < 400; i++) appendImage(h, { src: `https://cdn.example/${i}.jpg` });
    let completed = false;
    const scan = h.api.scanImagesFromRoots([h.document], { includeBackground: false }).then(images => { completed = true; return images; });
    await h.flush();
    assert.equal(completed, false, 'a long scan must release the task before finishing');
    if (cancel) h.api.resetRuntimeCaches();
    const images = await scan;
    assert.equal(images.length, cancel ? 0 : 400);
  });
}
