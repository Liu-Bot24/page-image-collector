import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Run explicitly; this is intentionally outside node --test. Use an installed
// Playwright/Chromium runtime, or point PIC_PLAYWRIGHT_MODULE at its index.mjs.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "output", "playwright");
const playwrightSpecifier = process.env.PIC_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PIC_PLAYWRIGHT_MODULE)).href
  : "playwright";
const { chromium } = await import(playwrightSpecifier);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(resolve(output, "profile-"));
const downloads = await mkdtemp(resolve(output, "downloads-"));
const fixturePng = await readFile(resolve(root, "icons", "icon128.png"));
const generatedPng = new Map();
let retryAvailable = false;
const requestLog = [];
const svg = (label, width = 320, height = 180) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#3769b8"/><text x="20" y="45" fill="white" font-size="24">${label}</text></svg>`;
const html = `<!doctype html><meta charset="utf-8"><title>Collector smoke fixture</title>
<style>body{font:18px sans-serif;margin:32px}img,.background{display:block;width:320px;height:180px;margin:16px 0}.background.active{background-image:url('/class-bg.svg')}.spacer{height:12000px}</style>
<h1>Collector smoke fixture</h1>
<img id="loaded" src="/thumb.svg?Expires=123&ssig=keep" data-original="/original.svg" srcset="/fallback.svg 1x, /thumb.svg?Expires=123&ssig=keep 2x">
<div id="background" class="background"></div><div id="shadow-host"></div><div class="spacer"></div>
<script>const shadow = document.querySelector('#shadow-host').attachShadow({mode:'open'});shadow.innerHTML='<img id="shadow-initial" width="320" height="180" src="/shadow-initial.svg">';</script>`;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const loggedRequest = { path: request.url, host: request.headers.host, referer: request.headers.referer || "", destination: request.headers["sec-fetch-dest"] || "", at: Date.now() };
  requestLog.push(loggedRequest);
  response.once("finish", () => { loggedRequest.status = response.statusCode; });
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/retry.png" && !retryAvailable) {
    response.writeHead(503, { "Content-Type": "text/plain" });
    response.end("Temporary fixture image outage");
  } else if (generatedPng.has(url.pathname)) {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(generatedPng.get(url.pathname));
  } else if (url.pathname === "/source-ui") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end('<!doctype html><title>Workspace metadata fixture</title><style>img{width:320px;height:180px}</style><img width="320" height="180" src="/retina-320x180.png"><img width="128" height="128" src="/cdn.png"><img width="320" height="180" src="/retry.png">');
  } else if (url.pathname === "/cdn.png") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(fixturePng);
  } else if (url.pathname === "/source-a" || url.pathname === "/source-b") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>${url.pathname}</title><h1>${url.pathname}</h1><img width="128" height="128" src="http://127.0.0.1:${server.address().port}/cdn.png">`);
  } else if (url.pathname.endsWith(".svg")) {
    if (["/original.svg", "/direct-full.svg", "/zip-full.svg"].includes(url.pathname)) {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Original URL intentionally unavailable");
    } else {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(svg(url.pathname));
    }
  } else if (url.pathname === "/fixture") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  } else {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Foreground control tab</title><h1>Foreground control tab</h1>");
  }
});
await new Promise((resolveListening, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolveListening);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { startedAt: new Date().toISOString(), origin, profile, checks: [], requestLog };
let context;

async function until(label, operation, predicate, timeoutMs = 12000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await operation();
    if (predicate(last)) return last;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
  }
  throw new Error(`${label} timed out; last result: ${JSON.stringify(last)}`);
}

function passed(name, details) {
  report.checks.push({ name, passed: true, ...details });
  console.log(`PASS ${name}: ${JSON.stringify(details)}`);
}

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: process.env.PIC_SMOKE_HEADLESS === "1",
    executablePath: process.env.PIC_CHROMIUM_EXECUTABLE || chromium.executablePath(),
    channel: "chromium",
    acceptDownloads: true,
    downloadsPath: downloads,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, "--window-position=-32000,-32000"],
    ignoreDefaultArgs: ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"]
  });
  report.browser = context.browser()?.version() || "Chromium";
  report.browserErrors = [];
  context.on("weberror", (event) => report.browserErrors.push(event.error().stack || String(event.error())));
  context.on("console", (message) => { if (message.type() === "error") report.browserErrors.push(message.text()); });
  const worker = context.serviceWorkers().find((item) => item.url().endsWith("/background/background.js")) ||
    await context.waitForEvent("serviceworker", { predicate: (item) => item.url().endsWith("/background/background.js"), timeout: 15000 });
  report.extensionId = new URL(worker.url()).host;
  report.extension = await worker.evaluate(async () => ({ name: chrome.runtime.getManifest().name, permissions: await chrome.permissions.getAll(), workerUrl: location.href }));
  console.log(`Extension: ${JSON.stringify(report.extension)}`);
  const fixture = await context.newPage();
  await fixture.goto(`${origin}/fixture`);
  await fixture.waitForFunction(() => [...document.images].every((image) => image.complete));
  const fixtureTabs = await until("fixture Chrome tab registration", () => worker.evaluate(async () =>
    (await chrome.tabs.query({})).map(({ id, url, pendingUrl }) => ({ id, url, pendingUrl }))),
    (tabs) => tabs.some((tab) => tab.url === `${origin}/fixture`));
  const fixtureTab = fixtureTabs.find((tab) => tab.url === `${origin}/fixture`);
  assert.ok(Number.isInteger(fixtureTab?.id), "fixture Chrome tab ID was not found");
  const tabId = fixtureTab.id;
  const sendContent = (message) => worker.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, message), { id: tabId, message });
  const storedImages = () => worker.evaluate(async (id) => {
    const stored = await chrome.storage.local.get("pic_collector_tab_states_v2");
    return stored.pic_collector_tab_states_v2?.[String(id)]?.images || [];
  }, tabId);
  await until("content listener", () => sendContent({ type: "GET_COMIC_PAGINATION" }).catch(() => null), (reply) => reply?.success === true);
  const loadedSrc = await fixture.evaluate(() => document.querySelector("#loaded").currentSrc);
  assert.equal((await sendContent({ type: "START_AUTO_SCAN" })).success, true);
  let images = await until("auto-scan baseline persistence", storedImages, (items) => items.some((image) => image.src === `${origin}/original.svg`));
  const original = images.find((image) => image.src === `${origin}/original.svg`);
  assert.equal(original.originalSrc, loadedSrc);
  assert.ok(original.candidateUrls.includes(`${origin}/fallback.svg`));
  assert.ok(original.candidateUrls.includes(`${origin}/thumb.svg?Expires=123&ssig=keep`));
  assert.ok(original.candidateUrls.includes(`${origin}/original.svg`));
  passed("baseline/currentSrc/candidates persisted by actual service worker", { count: images.length, currentSrc: loadedSrc, candidates: original.candidateUrls });

  await fixture.evaluate(() => {
    document.querySelector("#background").classList.add("active");
    const image = document.createElement("img");
    image.src = "/shadow-added.svg";
    document.querySelector("#shadow-host").shadowRoot.append(image);
  });
  images = await until("class and open shadow mutations", storedImages, (items) =>
    items.some((image) => image.src.endsWith("/class-bg.svg")) &&
    items.some((image) => image.src.endsWith("/shadow-added.svg")));
  passed("class background and open shadow mutation collection", { sources: images.map((image) => image.src) });

  const foreground = await context.newPage();
  await foreground.goto(`${origin}/foreground`);
  await foreground.bringToFront();
  report.visibilityTabs = await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((item) => item.url === url);
    await chrome.tabs.update(tab.id, { active: true });
    return (await chrome.tabs.query({})).map(({ id, windowId, active, url }) => ({ id, windowId, active, url }));
  }, `${origin}/foreground`);
  console.log(`Visibility tabs: ${JSON.stringify(report.visibilityTabs)}`);
  const fixtureActivity = () => worker.evaluate(async (id) => (await chrome.scripting.executeScript({
    target: { tabId: id }, func: () => ({ hidden: document.hidden, scrollY })
  }))[0].result, tabId);
  const inactiveTab = await worker.evaluate((id) => chrome.tabs.get(id), tabId);
  assert.equal(inactiveTab.active, false);
  const hidden = (await fixtureActivity()).hidden;
  if (!hidden) {
    report.validationLimitations = ["Chrome reports the source tab inactive, but document.hidden remains false in this Windows environment. This run does not establish requestAnimationFrame suspension; deterministic contentAudit tests cover that case."];
    console.log(`LIMITATION ${report.validationLimitations[0]}`);
  }
  await worker.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
    globalThis.__PIC_SMOKE_FRAME_FIRED__ = false;
    requestAnimationFrame(() => { globalThis.__PIC_SMOKE_FRAME_FIRED__ = true; });
  } }), tabId);
  await sendContent({ type: "START_AUTO_SCROLL", payload: { maxDurationMs: 15000 } });
  const positions = [];
  await until("inactive-page multi-step scrolling", async () => {
    const position = (await fixtureActivity()).scrollY;
    if (positions.at(-1) !== position) positions.push(position);
    return position;
  }, (position) => position > 1400, 12000);
  assert.ok(positions.length >= 3);
  assert.equal((await worker.evaluate((id) => chrome.tabs.get(id), tabId)).active, false);
  const animationFrameFired = await worker.evaluate(async (id) => (await chrome.scripting.executeScript({
    target: { tabId: id }, func: () => globalThis.__PIC_SMOKE_FRAME_FIRED__
  }))[0].result, tabId);
  passed("non-active Chrome tab multi-step scrolling", { hidden, animationFrameFired, positions });

  await sendContent({ type: "STOP_AUTO_SCROLL" });
  const stoppedAt = (await fixtureActivity()).scrollY;
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 2200));
  assert.equal((await fixtureActivity()).scrollY, stoppedAt);
  await sendContent({ type: "STOP_AUTO_SCAN" });
  passed("explicit cancellation keeps inactive page stationary", { stoppedAt });

  const extensionOrigin = `chrome-extension://${report.extensionId}`;
  const appMessage = (page, sourceId, type, payload = {}) => page.evaluate(
    ({ tabId, type, payload }) => chrome.runtime.sendMessage({ tabId, type, payload }),
    { tabId: sourceId, type, payload });
  const findChromeTab = async (url) => until("source Chrome tab registration", () => worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url), url), Boolean);
  const sourceA = await context.newPage();
  const sourceB = await context.newPage();
  const sourceAUrl = `http://localhost:${server.address().port}/source-a`;
  const sourceBUrl = `${origin}/source-b`;
  await Promise.all([sourceA.goto(sourceAUrl), sourceB.goto(sourceBUrl)]);
  const [tabA, tabB] = await Promise.all([findChromeTab(sourceAUrl), findChromeTab(sourceBUrl)]);
  await Promise.all([tabA, tabB].map((tab) => until("source content ready", () => worker.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: "START_AUTO_SCAN" }), tab.id).catch(() => null), (reply) => reply?.success === true)));
  let workspaceA = await context.newPage();
  const workspaceB = await context.newPage();
  await Promise.all([
    workspaceA.goto(`${extensionOrigin}/workspace/workspace.html?tabId=${tabA.id}`),
    workspaceB.goto(`${extensionOrigin}/workspace/workspace.html?tabId=${tabB.id}`)
  ]);
  const [collectionA, collectionB] = await Promise.all([
    until("source A collection", () => appMessage(workspaceA, tabA.id, "GET_IMAGES"), (result) => result?.success && result.images.length > 0),
    until("source B collection", () => appMessage(workspaceB, tabB.id, "GET_IMAGES"), (result) => result?.success && result.images.length > 0)
  ]);
  const loadImage = (page, url) => page.evaluate((url) => new Promise((resolveLoaded, reject) => {
    const image = new Image();
    image.onload = () => resolveLoaded({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error(`Image failed: ${url}`));
    image.src = url;
    document.body.append(image);
  }), url);
  await Promise.all([
    loadImage(workspaceA, `${origin}/cdn.png?ui=A`),
    loadImage(workspaceB, `${origin}/cdn.png?ui=B`),
    loadImage(foreground, `${origin}/cdn.png?ordinary=1`)
  ]);
  const requestA = requestLog.find((request) => request.path === "/cdn.png?ui=A");
  const requestB = requestLog.find((request) => request.path === "/cdn.png?ui=B");
  const ordinary = requestLog.find((request) => request.path === "/cdn.png?ordinary=1");
  assert.equal(requestA?.referer, `${new URL(sourceAUrl).origin}/`);
  assert.equal(requestB?.referer, `${new URL(sourceBUrl).origin}/`);
  assert.equal(ordinary?.referer, `${origin}/foreground`);
  passed("DNR isolates two workspaces and leaves ordinary page headers unchanged", { requestA, requestB, ordinary });

  // Give the actual popup an image that no remaining workspace can request.
  // Its source-page load finishes before the observation window starts.
  await workspaceA.close();
  const popupImageUrl = `${origin}/cdn.png?popup=source-a`;
  await sourceA.evaluate((url) => new Promise((resolveLoaded, reject) => {
    const image = document.querySelector("img");
    image.addEventListener("load", () => resolveLoaded(), { once: true });
    image.addEventListener("error", () => reject(new Error("Popup fixture image failed")), { once: true });
    image.src = url;
  }), popupImageUrl);
  await until("popup-specific image collection", () => worker.evaluate(async ({ id, url }) => {
    const stored = await chrome.storage.local.get("pic_collector_tab_states_v2");
    return stored.pic_collector_tab_states_v2?.[String(id)]?.images?.some((image) => image.src === url);
  }, { id: tabA.id, url: popupImageUrl }), Boolean);

  await worker.evaluate(() => {
    globalThis.__PIC_SMOKE_SENDERS__ = [];
    chrome.runtime.onMessage.addListener((message, sender) => {
      globalThis.__PIC_SMOKE_SENDERS__.push({ type: message.type, requestedTabId: message.tabId, url: sender.url || "", hasTab: Boolean(sender.tab), tabId: sender.tab?.id });
    });
  });
  const popupStartedAt = Date.now();
  let popupOpened = false;
  try {
    await worker.evaluate(async (id) => {
      const tab = await chrome.tabs.update(id, { active: true });
      await chrome.action.openPopup({ windowId: tab.windowId });
    }, tabA.id);
    popupOpened = true;
  } catch (error) {
    report.validationLimitations ||= [];
    report.validationLimitations.push(`Native action popup could not be opened: ${error.message}`);
    console.log(`LIMITATION ${report.validationLimitations.at(-1)}`);
  }
  if (popupOpened) {
    const popupSender = await until("actual popup GET_IMAGES sender", () => worker.evaluate(() =>
      globalThis.__PIC_SMOKE_SENDERS__.find((sender) => sender.type === "GET_IMAGES" && sender.url.endsWith("/popup/popup.html") && !sender.hasTab)), Boolean);
    assert.equal(popupSender.requestedTabId, tabA.id);
    const popupImageRequest = await until("native popup image Referer", () => requestLog.find((request) =>
      request.at >= popupStartedAt && request.path === "/cdn.png?popup=source-a" && request.destination === "image"), Boolean);
    assert.equal(popupImageRequest.referer, `${new URL(sourceAUrl).origin}/`);
    const popupRules = await worker.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    const popupRule = popupRules.find((rule) => rule.condition.tabIds?.includes(-1) && rule.action.requestHeaders?.some((header) => header.value === `${new URL(sourceAUrl).origin}/`));
    assert.ok(popupRule, JSON.stringify(popupRules));
    assert.deepEqual(popupRule.condition.resourceTypes, ["image"]);
    const popupConcurrentProbeUrl = `${origin}/cdn.png?probe=while-popup`;
    const popupConcurrentProbe = await appMessage(workspaceB, tabB.id, "PROBE_IMAGE_DIMENSIONS", { url: popupConcurrentProbeUrl });
    assert.equal(popupConcurrentProbe.success, true, JSON.stringify(popupConcurrentProbe));
    const backgroundRequest = requestLog.find((request) => request.path === "/cdn.png?probe=while-popup");
    assert.equal(backgroundRequest?.referer, `${new URL(sourceBUrl).origin}/`);
    passed("native action popup without sender tab isolates image rules from background probes", { popupSender, popupImageRequest, resourceTypes: popupRule.condition.resourceTypes, backgroundRequest });
  }
  workspaceA = await context.newPage();
  await workspaceA.goto(`${extensionOrigin}/workspace/workspace.html?tabId=${tabA.id}`);

  const probeUrl = `${origin}/cdn.png?probe=parallel`;
  const probes = await Promise.all([
    appMessage(workspaceA, tabA.id, "PROBE_IMAGE_DIMENSIONS", { url: probeUrl }),
    appMessage(workspaceB, tabB.id, "PROBE_IMAGE_DIMENSIONS", { url: probeUrl })
  ]);
  assert.ok(probes.every((probe) => probe.success && probe.width === 128 && probe.height === 128), JSON.stringify(probes));
  const probeRequests = requestLog.filter((request) => request.path === "/cdn.png?probe=parallel");
  assert.deepEqual(probeRequests.map((request) => request.referer).sort(), [`${new URL(sourceAUrl).origin}/`, `${new URL(sourceBUrl).origin}/`].sort());
  passed("concurrent background probes preserve each source Referer", { probes, probeRequests });

  const downloadSession = await context.newCDPSession(workspaceB);
  await downloadSession.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
  await appMessage(workspaceB, tabB.id, "SET_SELECTION", { imageIds: collectionB.images.map((image) => image.id), selected: true });
  const zipStart = await appMessage(workspaceB, tabB.id, "DOWNLOAD_BATCH", { downloadMode: "zip", enableConvertToJpg: false });
  assert.equal(zipStart.success, true, JSON.stringify(zipStart));
  const zipStatus = await until("offscreen ZIP completes", () => appMessage(workspaceB, tabB.id, "GET_DOWNLOAD_STATUS"), (result) => result?.status?.active === false, 25000);
  assert.equal(zipStatus.status.phase, "completed", JSON.stringify(zipStatus));
  const zipDownloads = await worker.evaluate(() => chrome.downloads.search({ state: "complete" }));
  const zipFile = zipDownloads.find((download) => download.filename.toLowerCase().endsWith(".zip"));
  assert.ok(zipFile, JSON.stringify(zipDownloads));
  assert.ok(resolve(zipFile.filename).toLowerCase().startsWith(`${resolve(downloads).toLowerCase()}\\`));
  const zipBytes = await readFile(zipFile.filename);
  assert.equal(zipBytes.readUInt32LE(0), 0x04034b50);
  assert.ok(zipBytes.includes(fixturePng), "ZIP does not contain the expected source PNG bytes");
  await appMessage(workspaceB, tabB.id, "SET_SELECTION", { imageIds: collectionB.images.map(image => image.id), selected: false });
  await appMessage(workspaceB, tabB.id, "INCREMENTAL_SCAN", { images: [{
    src: `${origin}/zip-thumb.svg`, hdSrc: `${origin}/zip-full.svg`,
    width: 320, height: 180, sourceUrl: sourceBUrl
  }] });
  const zipFallbackImage = (await appMessage(workspaceB, tabB.id, "GET_IMAGES")).images.find(image => image.src.endsWith('/zip-thumb.svg'));
  assert.ok(zipFallbackImage); assert.notEqual(zipFallbackImage.hdSrc, zipFallbackImage.src);
  await appMessage(workspaceB, tabB.id, "SET_SELECTION", { imageIds: [zipFallbackImage.id], selected: true });
  const zipFallbackStart = await appMessage(workspaceB, tabB.id, "DOWNLOAD_BATCH", { downloadMode: "zip", enableConvertToJpg: false });
  assert.equal(zipFallbackStart.success, true, JSON.stringify(zipFallbackStart));
  const zipFallbackStatus = await until("offscreen ZIP fallback completes", () => appMessage(workspaceB, tabB.id, "GET_DOWNLOAD_STATUS"),
    result => result?.status?.taskId === zipFallbackStart.taskId && result.status.active === false, 25000);
  assert.equal(zipFallbackStatus.status.phase, 'completed', JSON.stringify(zipFallbackStatus));
  const zipMarked = (await appMessage(workspaceB, tabB.id, "GET_IMAGES")).images.find(image => image.id === zipFallbackImage.id);
  assert.equal(zipMarked.hdRejected, true, 'ordinary offscreen ZIP must retain its collection scope for fallback marking');
  passed("offscreen ZIP downloads and contains the actual PNG", { status: zipStatus.status, file: zipFile.filename, bytes: zipBytes.length, fallbackMarked: zipMarked.hdRejected });

  const controller = await context.newPage();
  await controller.goto(`${extensionOrigin}/workspace/workspace.html?tabId=${tabId}`);
  await appMessage(controller, tabId, "SET_SELECTION", { imageIds: [original.id], selected: true });
  const direct = await appMessage(controller, tabId, "DOWNLOAD_BATCH", { downloadMode: "direct", enableConvertToJpg: false });
  assert.equal(direct.success, true, JSON.stringify(direct));
  assert.equal(direct.succeeded, 1, JSON.stringify(direct));
  assert.equal(direct.failed, 0, JSON.stringify(direct));
  const directDownloads = await worker.evaluate(() => chrome.downloads.search({ state: "complete" }));
  const imageDownload = directDownloads.find((download) => download.url.includes("/thumb.svg") || download.url.includes("/fallback.svg"));
  assert.ok(imageDownload, JSON.stringify(directDownloads));
  assert.ok(requestLog.some((request) => request.path === "/original.svg"));
  await appMessage(controller, tabId, "SET_SELECTION", { imageIds: [original.id], selected: false });
  await appMessage(controller, tabId, "INCREMENTAL_SCAN", { images: [{
    src: `${origin}/direct-thumb.svg`, hdSrc: `${origin}/direct-full.svg`,
    width: 320, height: 180, sourceUrl: `${origin}/fixture`
  }] });
  const scopedImage = (await appMessage(controller, tabId, "GET_IMAGES")).images.find(image => image.src.endsWith('/direct-thumb.svg'));
  assert.ok(scopedImage); assert.notEqual(scopedImage.hdSrc, scopedImage.src);
  await appMessage(controller, tabId, "SET_SELECTION", { imageIds: [scopedImage.id], selected: true });
  const scopedDownload = await appMessage(controller, tabId, "DOWNLOAD_BATCH", { downloadMode: "direct", enableConvertToJpg: false });
  assert.equal(scopedDownload.succeeded, 1, JSON.stringify(scopedDownload));
  assert.equal(scopedDownload.results[0].fallbackUsed, true);
  const markedImage = (await appMessage(controller, tabId, "GET_IMAGES")).images.find(image => image.id === scopedImage.id);
  assert.equal(markedImage.hdRejected, true, "a download without orderedImageIds must persist its current fallback marker");
  passed("direct batch waits for completion and falls back after original HTTP 403", { status: direct, url: imageDownload.url, file: imageDownload.filename, fallbackMarked: markedImage.hdRejected });

  const bitmapFixtures = await foreground.evaluate(() => {
    const bitmap = (width, height, fill) => {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const paint = canvas.getContext("2d");
      paint.fillStyle = fill; paint.fillRect(0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    return { thumbnail: bitmap(320, 180, "#356bb6"), highResolution: bitmap(1920, 1080, "#245493") };
  });
  generatedPng.set("/retina-320x180.png", Buffer.from(bitmapFixtures.thumbnail, "base64"));
  generatedPng.set("/retina.png", Buffer.from(bitmapFixtures.highResolution, "base64"));
  generatedPng.set("/retry.png", Buffer.from(bitmapFixtures.highResolution, "base64"));
  const sourceUI = await context.newPage();
  await sourceUI.goto(`${origin}/source-ui`);
  const tabUI = await findChromeTab(`${origin}/source-ui`);
  await until("UI source content ready", () => worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "START_AUTO_SCAN" }), tabUI.id).catch(() => null), (reply) => reply?.success === true);
  const workspaceUI = await context.newPage();
  await workspaceUI.goto(`${extensionOrigin}/workspace/workspace.html?tabId=${tabUI.id}`);
  await workspaceUI.bringToFront();
  const uiCollection = await until("UI source collection", () => appMessage(workspaceUI, tabUI.id, "GET_IMAGES"), (result) => result?.images?.length === 3);
  const highImage = uiCollection.images.find((image) => image.src.endsWith("/retina-320x180.png"));
  const retryImage = uiCollection.images.find((image) => image.src.endsWith("/retry.png"));
  const smallImage = uiCollection.images.find((image) => image.src.endsWith("/cdn.png"));
  assert.ok(highImage && retryImage && smallImage);
  await until("HD card dimensions", () => workspaceUI.locator(`.gallery-card[data-id="${highImage.id}"] .dimensions`).textContent(), (text) => text === "1920 × 1080");
  await workspaceUI.locator('[data-preset="1080p"]').click();
  const hdOnlyCards = await until("1080p excludes low-resolution images", () => workspaceUI.locator(".gallery-card").evaluateAll((cards) => cards.map((card) => ({ id: card.dataset.id, dimensions: card.querySelector(".dimensions").textContent, area: card.querySelector(".area").textContent }))), (cards) => cards.length === 1 && cards[0].id === highImage.id);
  assert.equal(hdOnlyCards[0].area, "2074K");
  passed("workspace 1080p filter uses consistent HD width height and area", { thumbnail: [320, 180], visibleCards: hdOnlyCards, excludedId: smallImage.id });

  await workspaceUI.locator('[data-preset="all"]').click();
  await workspaceUI.waitForFunction(() => document.querySelectorAll(".gallery-card").length === 3 && cardDimensionPending.size === 0);
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 350));
  await workspaceUI.evaluate(() => { globalThis.__PIC_SMOKE_CARD_NODES__ = [...document.querySelectorAll(".gallery-card")]; });
  const getImagesCount = () => worker.evaluate((url) => globalThis.__PIC_SMOKE_SENDERS__.filter((sender) => sender.type === "GET_IMAGES" && sender.url === url).length, workspaceUI.url());
  const beforeSelectionRequests = await getImagesCount();
  await workspaceUI.locator(`.gallery-card[data-id="${highImage.id}"] .checkbox`).click();
  await until("single-card selected state", () => workspaceUI.locator("#stat-selected").textContent(), (text) => text === "1");
  const retainedCards = await workspaceUI.evaluate(() => globalThis.__PIC_SMOKE_CARD_NODES__.every((card) => card.isConnected && document.querySelector(`.gallery-card[data-id="${card.dataset.id}"]`) === card));
  assert.equal(retainedCards, true);
  assert.equal(await getImagesCount(), beforeSelectionRequests);
  assert.equal(await workspaceUI.locator(`.gallery-card[data-id="${highImage.id}"]`).evaluate((card) => card.classList.contains("selected")), true);
  passed("single-card selection keeps existing card nodes and avoids refetching the gallery", { retainedCards, additionalGetImagesRequests: 0, selectedCount: 1 });

  const failedCache = await workspaceUI.evaluate((id) => {
    const cached = cardDimensionCache.get(id);
    return { retryAt: cached?.retryAt, width: cached?.width, height: cached?.height };
  }, retryImage.id);
  assert.ok(Number.isFinite(failedCache.retryAt) && failedCache.retryAt > Date.now(), JSON.stringify(failedCache));
  assert.ok(requestLog.some((request) => request.path === "/retry.png" && request.status === 503));
  retryAvailable = true;
  const waitForRetry = Math.max(0, failedCache.retryAt - Date.now()) + 400;
  console.log(`Waiting ${waitForRetry} ms for the real failed-dimension cache TTL before a UI refresh`);
  await new Promise((resolveTimer) => setTimeout(resolveTimer, waitForRetry));
  await workspaceUI.locator('[data-preset="1080p"]').click();
  const recoveredCards = await until("failed image becomes available after cache TTL", () => workspaceUI.locator(".gallery-card").evaluateAll((cards) => cards.map((card) => ({ id: card.dataset.id, dimensions: card.querySelector(".dimensions").textContent }))), (cards) => cards.length === 2 && cards.some((card) => card.id === retryImage.id && card.dimensions === "1920 × 1080"));
  assert.ok(!recoveredCards.some((card) => card.id === smallImage.id));
  const retryRequests = requestLog.filter((request) => request.path === "/retry.png");
  assert.ok(retryRequests.some((request) => request.status === 200));
  passed("workspace retries failed dimensions after the real cache TTL and updates the 1080p view", { failedCache, waitForRetry, visibleCards: recoveredCards, retryRequests });
  await workspaceUI.screenshot({ path: resolve(output, "workspace-ui-smoke.png") });
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = error.stack || String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  await new Promise((resolveClosed) => server.close(resolveClosed));
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, "browser-smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${resolve(output, "browser-smoke-report.json")}`);
}
