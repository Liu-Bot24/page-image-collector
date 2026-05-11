# Capture And Save Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复图片采集与保存链路里的功能型缺陷，让“可获取的大图”在采集、Workspace 展示、筛选、排序、格式识别、单图下载、ZIP 下载中尽量使用同一套真实结果。

**Architecture:** 本方案只做增量增强，不删除现有候选链路，不减少 `src / hdSrc / originalSrc / webp->jpg / ZIP 分卷 / Referer 规则` 等既有回退能力。优先把“更大图源、更大尺寸、真实格式”作为单调升级信息写回状态层，Workspace 与下载链路再读取同一份状态。Chrome MV3 约束下不引入远程代码，不默认自动点击页面，不把高风险页面交互伪装成自动采集。

**Tech Stack:** Chrome Manifest V3, plain JavaScript, extension service worker ES module, non-module popup/workspace/content scripts, `node --test`.

---

## Execution Boundaries

- 产品功能优先：任何修复不得让原本可抓到的图片变成抓不到；新增逻辑只能增加候选、升级元数据或更稳地回退。
- 现实平台约束优先：不采用远程 CDN 代码，不依赖 service worker 长任务，不引入必须由用户逐张选择保存位置的方案。
- 不默认自动点击页面上的图片、下一页、弹窗按钮；这种行为风险高，容易触发副作用、登录态操作、风控或卡顿。
- Popup 不新增 ZIP 分卷入口；Workspace 是 ZIP 分卷设置的唯一入口。
- README 在最终版本前必须单独给用户确认；本轮功能修复不主动改 README。
- 若引入第三方库，必须本地 vendor 或建立明确打包流程；本计划第一轮不引入库，先用小范围原生实现修复核心缺陷。

## Files And Responsibilities

- `background/stateManager.js`: 保存图片记录，负责去重、合并、最大已知尺寸、真实格式、HD 回退状态的单调更新。
- `background/background.js`: 负责图片探测、下载候选、单图下载、ZIP 后台回退、Workspace/Popup 获取图片时的展示源与元数据。
- `content/content.js`: 负责页面图片候选发现，包括常见大图属性、`picture/srcset`、CSS 背景与深度来源页提取。
- `workspace/workspace.js`: 负责 Workspace 卡片加载、尺寸探测、筛选排序、灯箱/1:1/全屏与状态回写。
- `popup/popup.js`: 只接收状态层改进后的结果，必要时做格式白名单和尺寸并发保护；不新增设置入口。
- `shared/zipCore.js`: 复用和增强真实图片格式检测、格式白名单、data URL MIME 解析。
- `shared/comicCore.js`: 若分页识别需要纯函数测试，在这里增加低风险分页工具。
- `test/stateManager.test.mjs`: 覆盖状态合并、最大尺寸、同 normalized 大图升级。
- `test/zipCore.test.mjs`: 覆盖真实格式识别、format query 白名单、data URL。
- `test/comicCore.test.mjs`: 覆盖分页识别纯函数增强。

## Phase 1: Maximum Image Source And Dimension Consistency

用户场景：页面卡片是缩略图，点进灯箱或全屏能看到大图，但 Workspace 列表尺寸、筛选、排序仍按小图算。

### Task 1: Add Monotonic Maximum Dimension State

**Files:**
- Modify: `background/stateManager.js`
- Test: `test/stateManager.test.mjs`

- [ ] **Step 1: Add failing state tests**

Append these tests to `test/stateManager.test.mjs`:

```js
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
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npm test
```

Expected before implementation: the new assertions for `maxWidth/maxHeight/maxArea` or same-area `hdSrc` upgrade fail.

- [ ] **Step 3: Implement state fields**

In `background/stateManager.js`, update image sanitization and merging rules:

- Store `maxWidth`, `maxHeight`, `maxArea` as numbers.
- Initialize them from explicit incoming `max*` values when present.
- Otherwise initialize them from `width`, `height`, `area`.
- During merge, upgrade max fields only when incoming `maxArea` is larger than existing `maxArea`.
- In the non-replace merge branch, allow `hdSrc` to upgrade when incoming `hdSrc` differs from `src`, existing `hdSrc` is missing/equal to `src`, or incoming max area is larger.
- Preserve `hdRejected`; do not mark a source rejected merely because a larger candidate exists.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test
```

Expected: all existing tests and the new state tests pass.

### Task 2: Persist Workspace Dimension Discoveries

**Files:**
- Modify: `background/background.js`
- Modify: `workspace/workspace.js`
- Test: `test/stateManager.test.mjs`

- [ ] **Step 1: Define state update message**

Add a background message handler named `UPDATE_IMAGE_METADATA` that accepts:

```js
{
  type: "UPDATE_IMAGE_METADATA",
  imageId: "stable image id",
  url: "https://cdn.example.com/photo-full.jpg",
  maxWidth: 1920,
  maxHeight: 1080,
  maxArea: 2073600,
  format: "jpg"
}
```

The handler must update only the matching image in the active tab state. If `imageId` is absent, it may match by `src`, `hdSrc`, `displaySrc`, or normalized URL. It must ignore zero or negative dimensions.

- [ ] **Step 2: Add card image onload feedback**

In `workspace/workspace.js`, when a card `<img>` successfully loads, call the same local cache update path used by lightbox and then send `UPDATE_IMAGE_METADATA` with natural dimensions:

```js
const width = imageElement.naturalWidth || 0;
const height = imageElement.naturalHeight || 0;
if (width > 0 && height > 0) {
  updateCardDimensionCache(image, { width, height, area: width * height });
  chrome.runtime.sendMessage({
    type: MSG.UPDATE_IMAGE_METADATA,
    imageId: image.id,
    url: imageElement.currentSrc || imageElement.src,
    maxWidth: width,
    maxHeight: height,
    maxArea: width * height
  }).catch(() => {});
}
```

Use the existing message naming style in the file; if `MSG.UPDATE_IMAGE_METADATA` does not exist, add it to the local constants where other message names are declared.

- [ ] **Step 3: Fallback from background probe to DOM image probe**

In `workspace/workspace.js` `getImageDimensions`, if `PROBE_IMAGE_DIMENSIONS` fails or returns `0 x 0`, fall back to the existing DOM `Image()` probe with a timeout. Do not remove the background probe, because it avoids loading full files on many normal URLs.

- [ ] **Step 4: Make filters use max dimensions first**

In `workspace/workspace.js`, update `getImageMetaForFilters` and card metadata display:

- Prefer `cardDimensionCache`.
- Then prefer `image.maxWidth/maxHeight/maxArea`.
- Then fall back to `image.width/height/area`.

This must affect `>= 720P`, `>= 1080P`, `>= 2K`, `>= 4K`, minimum short side, minimum long side, MP filter, portrait filter, and size sorting.

- [ ] **Step 5: Run tests and syntax checks**

Run:

```bash
npm test
node --check background/background.js
node --check background/stateManager.js
node --check workspace/workspace.js
```

Expected: all commands pass.

## Phase 2: Discover More Real Large Images Without Risky Auto-Clicking

用户场景：页面点击图片能看到大图，但扫描只能拿到缩略图。

### Task 3: Expand Safe Large-Image Attribute Extraction

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: Expand direct image attributes**

In `content/content.js`, expand the candidate attributes read directly from `<img>` and linked ancestors. Keep all existing attributes and add these common large-image hints:

```js
[
  "data-full",
  "data-full-src",
  "data-full-size",
  "data-full-image",
  "data-large",
  "data-large-src",
  "data-large-image",
  "data-original-url",
  "data-image-url",
  "data-img-url",
  "data-zoom-src",
  "data-hires",
  "data-high-res",
  "data-highres",
  "data-retina",
  "data-src-retina",
  "data-2x",
  "data-pswp-src",
  "data-mfp-src",
  "data-fancybox",
  "data-fancybox-href"
]
```

Each extracted value must pass the existing URL normalization and image-source allowlist before becoming `hdSrc`.

- [ ] **Step 2: Preserve fallback candidates**

The candidate order must keep current `src`, `currentSrc`, `srcset`, and existing data attributes. New large-image hints are additive. If a new large URL fails later download/probe, existing smaller candidates remain available.

- [ ] **Step 3: Manual fixture check**

Create a temporary local HTML fixture outside committed files or use a browser data page with:

```html
<img src="thumb.jpg" data-highres="large.jpg">
<a href="large-2.jpg"><img src="thumb-2.jpg"></a>
```

Expected: scan returns `hdSrc` as `large.jpg` / `large-2.jpg` while still retaining thumbnail source.

### Task 4: Improve Picture And Srcset Selection

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: Read all source srcsets**

Update `extractFromPicture` so it scans every `source[srcset]`, every `source[data-srcset]`, and the child `img[srcset]` / `img[data-srcset]`. It must choose the largest candidate by descriptor when possible.

- [ ] **Step 2: Keep currentSrc fallback**

If the browser has already selected `img.currentSrc`, keep it in candidates. Do not replace it blindly with a high-density candidate that cannot be normalized.

- [ ] **Step 3: Add parser regression cases**

If srcset parsing is refactored into a testable helper, add a `node --test` case for:

```js
const srcset = "small.jpg 400w, large.jpg 1600w, retina.jpg 2x";
```

Expected: the largest width candidate is `large.jpg`; if only density descriptors exist, the highest density candidate wins.

### Task 5: Improve CSS Background Extraction

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: Extract multiple CSS URLs**

Replace single first-URL extraction with a helper that collects all `url(...)` values in `background-image`, including multiple backgrounds.

- [ ] **Step 2: Support CSS image-set**

For `image-set(url(small.jpg) 1x, url(large.jpg) 2x)`, prefer the highest density candidate when descriptors are available. If parsing fails, keep the first existing URL behavior as fallback.

- [ ] **Step 3: Keep style-cost bounded**

Do not increase the broad `querySelectorAll("*")` background scan cap. If extra parsing increases cost, only parse backgrounds for elements whose inline style or computed background contains `url(` or `image-set(`.

## Phase 3: Real Format Detection And Save Consistency

用户场景：Workspace 显示 Unknown，但右键另存为可以得到 `.jpg`、`.webp` 或其他正确格式；或者单图下载扩展名错。

### Task 6: Unify Safe Format Guessing

**Files:**
- Modify: `shared/zipCore.js`
- Modify: `background/background.js`
- Modify: `background/stateManager.js`
- Modify: `workspace/workspace.js`
- Modify: `popup/popup.js`
- Modify: `content/content.js`
- Test: `test/zipCore.test.mjs`

- [ ] **Step 1: Add tests for format whitelist**

Append to `test/zipCore.test.mjs`:

```js
import { formatFromUrl } from "../shared/zipCore.js";

test("keeps only image format query values from URL guessing", () => {
  assert.equal(formatFromUrl("https://cdn.example.com/photo?format=webp"), "webp");
  assert.equal(formatFromUrl("https://cdn.example.com/photo?format=auto"), "");
  assert.equal(formatFromUrl("https://cdn.example.com/photo?format=raw"), "");
});

test("detects data URL image MIME during format guessing", () => {
  assert.equal(formatFromUrl("data:image/jpeg;base64,/9j/4AAQ"), "jpg");
  assert.equal(formatFromUrl("data:image/webp;base64,UklGRg=="), "webp");
  assert.equal(formatFromUrl("data:text/html;base64,PGh0bWw+"), "");
});
```

- [ ] **Step 2: Export safe URL format helper**

In `shared/zipCore.js`, export `formatFromUrl` if it is not already exported. It must:

- Return only supported image extensions.
- Convert `jpeg` to `jpg`.
- Parse `data:image/...` MIME.
- Ignore untrusted query values such as `auto`, `raw`, `unknown`, and non-image tokens.

- [ ] **Step 3: Align duplicate local format helpers**

Because `content.js`, `popup.js`, and `workspace.js` are non-module scripts, do not add a bundler in this phase. Instead, copy the same whitelist behavior into their existing local helpers with the same accepted extension set. Keep the implementation small and identical in behavior.

- [ ] **Step 4: Run tests and syntax checks**

Run:

```bash
npm test
node --check shared/zipCore.js
node --check background/background.js
node --check background/stateManager.js
node --check content/content.js
node --check popup/popup.js
node --check workspace/workspace.js
```

Expected: all commands pass.

### Task 7: Validate Direct Downloads Before Naming Unknown Files

**Files:**
- Modify: `background/background.js`
- Test: `test/zipCore.test.mjs`

- [ ] **Step 1: Reuse existing payload inspection**

For direct image download when the URL extension is missing, unknown, or conflicts with a detected content type, fetch the blob through existing `fetchBlob`, inspect with `inspectImagePayload`, and save with `downloadBlobAsFile`.

- [ ] **Step 2: Preserve direct URL fallback for hostile sites**

If extension fetch fails because of site constraints but the original direct `chrome.downloads.download` path historically works, keep the direct URL fallback behind the existing candidate order. Do not remove it. Mark the result as less verified internally if needed, but do not block the user from saving.

- [ ] **Step 3: Fix background ZIP conversion fallback**

In the background ZIP path, if JPG conversion fails, use `inspection.extension` before URL fallback. Match the offscreen behavior:

```js
const fallbackExtension = extFromUrl || inspection.extension || mimeToExtension(blob.type, "jpg");
```

- [ ] **Step 4: Run download syntax checks**

Run:

```bash
node --check background/background.js
npm test
```

Expected: syntax checks and tests pass.

## Phase 4: Pagination And Lazy Loading Coverage

用户场景：翻页仍识别不到，尤其是漫画/图集的下一章、下一话、按钮路由、内部滚动容器。

### Task 8: Add Conservative Pagination Signals

**Files:**
- Modify: `content/content.js`
- Test: `test/comicCore.test.mjs` if a pure helper is extracted to `shared/comicCore.js`

- [ ] **Step 1: Add safe next labels**

Expand next-page text recognition to include:

```js
[
  "下一章",
  "下一话",
  "下章",
  "下回",
  "下一集",
  "继续阅读",
  "Next Chapter",
  "Read Next"
]
```

Use these only inside likely pagination/reader/chapter containers, not arbitrary recommendation cards.

- [ ] **Step 2: Add rel next support**

Read:

```css
a[rel~="next"], link[rel~="next"]
```

Expected: a single strong `rel=next` link may count as supported pagination even if no numeric page list exists.

- [ ] **Step 3: Add data URL and role button support**

Inside likely pagination containers, support elements with:

```css
[role="button"], button, [data-href], [data-url], [data-next], router-link
```

Only accept values that resolve to http(s) URLs and pass transition checks.

- [ ] **Step 4: Traverse open shadow roots**

Reuse the existing open shadow-root traversal approach used by image scanning when collecting pagination candidates.

- [ ] **Step 5: Keep false positives low**

Do not treat arbitrary carousel arrows, product recommendations, or blog next-article links as comic pagination unless they appear in a strong reader/pagination context.

### Task 9: Improve Scroll Coverage Without Aggressive Page Interaction

**Files:**
- Modify: `content/content.js`

- [ ] **Step 1: Discover scrollable containers**

During auto-scroll, find visible containers where:

```js
element.scrollHeight > element.clientHeight + 120
```

and computed `overflow-y` is `auto`, `scroll`, or `overlay`.

- [ ] **Step 2: Scroll the best candidate container**

Prefer the scrolling element that contains the most visible images. Fall back to `window` when no good container exists.

- [ ] **Step 3: Preserve user control**

Do not auto-click “load more” buttons. If a button must be clicked to reveal content, report it as a boundary rather than simulating clicks.

## Phase 5: Performance Guardrails

用户场景：大批量图片下卡顿、探测并发过高、storage 写入太频繁。

### Task 10: Constrain Probes And Status Writes

**Files:**
- Modify: `popup/popup.js`
- Modify: `workspace/workspace.js`
- Modify: `background/background.js`

- [ ] **Step 1: Reuse bounded dimension probing**

Keep Workspace dimension hydration on a bounded queue. If Popup still does unbounded `Promise.all` dimension probing, add the same small concurrency limit there. This should improve responsiveness without changing scan results.

- [ ] **Step 2: Debounce active download status persistence**

In `background/background.js`, keep real-time in-memory status broadcasts, but debounce `chrome.storage.local.set` for active download progress to 250-500ms. Persist terminal statuses immediately.

- [ ] **Step 3: Run stress smoke test**

Use a local fixture or real page with hundreds of images. Expected behavior:

- Popup remains responsive.
- Workspace can still filter and sort.
- Download status updates appear during ZIP work.
- Reloading extension state after completion still shows terminal download status.

## Verification Matrix

Run after each phase:

```bash
npm test
node --check background/background.js
node --check background/stateManager.js
node --check content/content.js
node --check popup/popup.js
node --check workspace/workspace.js
node --check offscreen/offscreen.js
node --check shared/zipCore.js
node --check shared/comicCore.js
```

Manual Chrome checks before declaring done:

- Load unpacked extension from `/Users/liuqi/Desktop/code/codex/page-image-collector`.
- Confirm the version name clearly distinguishes this test build if `manifest.json` is intentionally changed.
- Scan a fixture with thumbnail plus high-res URL; Workspace card size, filter result, sort order, lightbox, and download all agree on the high-res source.
- Scan a fixture with no-extension WebP/JPEG/PNG URL; UI format, direct download extension, and ZIP extension agree.
- Scan a fixture with `picture/source[data-srcset]`; largest candidate is discovered.
- Scan a fixture with CSS `image-set`; larger density candidate is discovered.
- Scan a fixture with `rel=next` or “下一章”; pagination detection reports a next page.
- Confirm Popup layout is not changed by this work.
- Confirm Workspace ZIP 分卷 setting remains the only ZIP 分卷 setting entry.

## Deferred Work

- Full Workspace virtual list using `@tanstack/virtual-core`: useful for thousands of images, but too invasive for this functional repair round.
- Replacing ZIP implementation with `zip.js` or `fflate`: not needed for the current defects; current offscreen and分卷策略 should remain unless a separate ZIP-streaming project is approved.
- Generic auto-click-to-open-large-image: intentionally not implemented because it can cause side effects, login operations, rate limiting, or page freezes.
- README updates: deferred until user reviews final public-facing text.

## Execution Order

1. Phase 1: maximum image source and dimension consistency.
2. Phase 3: real format detection and save consistency.
3. Phase 2: broader large-image discovery.
4. Phase 4: pagination and lazy loading coverage.
5. Phase 5: performance guardrails.

This order fixes the most user-visible inconsistency first: when the extension already has or can load the large image, all visible metadata and saving paths should agree before adding broader discovery rules.
