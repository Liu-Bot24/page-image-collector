import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Runs the shipped rewrite code itself: the source slices between the named
// declarations are evaluated as-is, without the rest of the script.
const slice = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `cannot locate ${start}`);
  return source.slice(from, to);
};
const contentSource = readFileSync(new URL("../content/content.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../background/background.js", import.meta.url), "utf8");

const contentContext = vm.createContext({ location: { href: "https://example.com/page" }, URL });
vm.runInContext(slice(contentSource, "const HD_RULES = [", "const normalizeUrl =") +
  slice(contentSource, "const getHDUrl =", "const IMAGE_FORMAT_EXTENSIONS =") + "globalThis.getHDUrl = getHDUrl;", contentContext);
const getHDUrl = contentContext.getHDUrl;

const backgroundContext = vm.createContext({ URL });
vm.runInContext(slice(backgroundSource, "const resolveOriginalImageUrl =", "const pickContextImageUrl =") +
  "globalThis.resolveOriginalImageUrl = resolveOriginalImageUrl;", backgroundContext);
const resolveOriginalImageUrl = backgroundContext.resolveOriginalImageUrl;

test("size suffix after a full image file name restores that file name", () => {
  assert.equal(getHDUrl("https://img.alicdn.com/bao/x.jpg_300x300.jpg"), "https://img.alicdn.com/bao/x.jpg");
  assert.equal(getHDUrl("https://img.alicdn.com/bao/x.png_640x640.webp?a=1"), "https://img.alicdn.com/bao/x.png?a=1");
  assert.equal(resolveOriginalImageUrl("https://img.alicdn.com/bao/x.jpg_300x300.jpg"), "https://img.alicdn.com/bao/x.jpg");
});

test("plain size suffixes are still removed", () => {
  assert.equal(getHDUrl("https://example.com/a_300x300.jpg"), "https://example.com/a.jpg");
  assert.equal(getHDUrl("https://example.com/a-1024x768.png?v=2"), "https://example.com/a.png?v=2");
  assert.equal(resolveOriginalImageUrl("https://example.com/a_300x300.jpg"), "https://example.com/a.jpg");
});

test("Discord size is dropped without breaking the remaining query", () => {
  assert.equal(getHDUrl("https://cdn.discordapp.com/attachments/1/2/a.webp?size=48&quality=lossless"),
    "https://cdn.discordapp.com/attachments/1/2/a.webp?quality=lossless");
  assert.equal(getHDUrl("https://cdn.discordapp.com/attachments/1/2/a.png?size=48"),
    "https://cdn.discordapp.com/attachments/1/2/a.png");
});

const contextMenuHarness = ({ reachable }) => {
  const requested = [];
  const fail = (url) => { throw Object.assign(new Error("HTTP 404 " + url), { retryable: true }); };
  const context = vm.createContext({
    URL, requested, MSG: { COPY_IMAGE_DATA_URL: "COPY" },
    filenameFromImageUrl: (url) => url.split("/").pop(),
    resolveImageRequestSource: async () => "https://example.com/page",
    downloadByUrl: async (url) => { requested.push(["download", url]); return reachable.includes(url) ? { success: true, url } : fail(url); },
    fetchBlob: async (url) => { requested.push(["fetch", url]); return reachable.includes(url) ? { type: "image/jpeg", url } : fail(url); },
    downloadByBlob: async (blob) => ({ success: true, url: blob.url }),
    mimeFromFormat: () => "image/jpeg", formatFromUrl: () => "jpg",
    convertBlobToPng: async (blob) => blob, blobToDataUrl: async (blob) => "data:image/png;base64," + blob.url,
    sendMessageToTab: async (_tabId, message) => { context.sent = message; return { success: true, mode: message.payload.dataUrl ? "image" : "url" }; }
  });
  vm.runInContext(slice(backgroundSource, "const resolveOriginalImageUrl =", "const pickContextImageUrl =") +
    slice(backgroundSource, "const getDownloadCandidates =", "const isNoReceiverError =") +
    slice(backgroundSource, "const prepareClipboardPayload =", "const getTabIdFromMessage =") +
    slice(backgroundSource, "const downloadContextImageUrl =", "const openWorkspaceAndScan =") +
    "globalThis.download = downloadOriginalImageByUrl; globalThis.copy = copyOriginalImageByUrl;", context);
  return context;
};

test("right-click download falls back to the page address when the rewritten one fails", async () => {
  const page = "https://example.com/wallpaper-1920x1080.jpg";
  const harness = contextMenuHarness({ reachable: [page] });
  const result = await harness.download(7, page);
  assert.equal(result.success, true);
  assert.equal(result.url, page);
  assert.equal(harness.requested[0][1], "https://example.com/wallpaper.jpg");
});

test("right-click download keeps the rewritten address when it works", async () => {
  const harness = contextMenuHarness({ reachable: ["https://example.com/wallpaper.jpg"] });
  const result = await harness.download(7, "https://example.com/wallpaper-1920x1080.jpg");
  assert.equal(result.url, "https://example.com/wallpaper.jpg");
  assert.deepEqual(harness.requested.map(([, url]) => url), ["https://example.com/wallpaper.jpg"]);
});

test("right-click copy falls back to the page image and never copies a guessed link", async () => {
  const page = "https://example.com/wallpaper-1920x1080.jpg";
  const works = contextMenuHarness({ reachable: [page] });
  assert.equal((await works.copy(7, page)).url, page);
  assert.equal(works.sent.payload.dataUrl, "data:image/png;base64," + page);
  const broken = contextMenuHarness({ reachable: [] });
  const result = await broken.copy(7, page);
  assert.equal(result.mode, "url");
  assert.equal(broken.sent.payload.fallbackUrl, page);
});

test("site rules keep their existing results", () => {
  assert.equal(getHDUrl("https://pbs.twimg.com/media/abc?format=jpg&name=small"), "https://pbs.twimg.com/media/abc?format=jpg&name=orig");
  assert.equal(getHDUrl("https://wx1.sinaimg.cn/mw690/abc.jpg"), "https://wx1.sinaimg.cn/large/abc.jpg");
  assert.equal(getHDUrl("https://example.com/a.gif"), "https://example.com/a.gif");
  assert.equal(getHDUrl("https://example.com/plain.jpg"), "https://example.com/plain.jpg");
});
