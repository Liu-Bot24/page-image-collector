# Parser Libraries and Workspace Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分两期引入明确有收益的外部库：第一期增强图片候选解析，第二期用虚拟化改善 Workspace 大批量图片浏览性能。

**Architecture:** 第一期只引入 `srcset` 和 `postcss-value-parser`，并把它们打成扩展本地文件，避免 Chrome MV3 运行时解析 bare npm import。第二期单独引入 `@tanstack/virtual-core`，先虚拟化 Workspace `grid` 网格模式，`waterfall` 瀑布流保持现有完整渲染，等网格稳定后再评估。

**Tech Stack:** Chrome MV3, vanilla JavaScript, Node `node --test`, npm packages `srcset`, `postcss-value-parser`, `@tanstack/virtual-core`, `esbuild` for local vendor bundles.

---

## Fixed Scope

本计划的最终推荐库固定为：

- Phase 1: `srcset`
- Phase 1: `postcss-value-parser`
- Phase 2: `@tanstack/virtual-core`

本计划不引入：

- `image-type`
- `file-type`
- `fflate`
- `zip.js`
- `p-limit`

原因：

- 当前 `shared/zipCore.js` 已有主流图片 magic bytes 检测和 HTML 响应拒绝逻辑，格式方向先统一现有链路，不换库。
- ZIP 可靠性主要受 Chrome downloads、offscreen document、Blob URL 和分卷策略影响，换 ZIP 库不能直接解决平台限制。
- 并发控制已有本地 `runWithConcurrency()`，不需要引 `p-limit`。

---

## Non-Regression Gates

这些是执行本计划时的硬约束，不是建议：

- 产品功能优先。任何改动如果会让原本能抓到的图片变得抓不到，必须回退或改成保留旧路径的增强方案。
- 第一阶段 parser 改造只能做“新增候选和更可靠解析”，不能删掉现有候选来源。新 parser 失败、返回空、或结果低于旧逻辑覆盖时，必须继续使用现有解析结果。
- `srcset` 和 CSS parser 的结果应与现有解析结果做 union/dedupe，而不是简单替换。排序可以继续用现有大图优先策略。
- 不扩大危险协议和不可信输入范围。新 parser 产出的 URL 仍必须经过现有 `resolveUrl()`、协议过滤、图片候选质量判断和去重逻辑。
- 第二阶段 Workspace 虚拟化只能先作用于 `grid` 网格模式；`waterfall` 瀑布流、下载、ZIP、图片采集、分页加载链路不得被顺手重构。
- 虚拟化必须保持用户可见行为：选择、隐藏、筛选、排序、灯箱、1:1、全屏、键盘切换、批量复制、批量下载的目标图片都必须和非虚拟渲染一致。
- Chrome 插件现实约束优先。运行时代码必须是扩展目录内的本地文件；不能依赖 CDN、远程脚本、bare npm import、Node-only API，不能让“直接在 Chrome 加载项目目录”失效。
- 每一期结束前必须做子代理审查：至少一个看功能退化风险，一个看 Chrome MV3/打包发布风险。审查未关闭前不得提交。

---

## File Structure

### Phase 1 Files

- Modify: `package.json`
  - Add `build:vendor` script.
  - Add npm dependencies needed to generate local vendor bundles.
- Create: `scripts/build-vendor.mjs`
  - Build browser-safe vendor files with `esbuild`.
  - Output committed runtime files under `vendor/`.
- Create: `src/vendor/content-parsers.entry.js`
  - Import `srcset` and `postcss-value-parser`.
  - Expose a small stable global API on `globalThis.PageImageCollectorParsers`.
- Create: `vendor/content-parsers.js`
  - Generated local runtime file loaded before `content/content.js`.
  - Must be committed so loading the project directory still works.
- Modify: `manifest.json`
  - Load `vendor/content-parsers.js` before `content/content.js`.
- Modify: `content/content.js`
  - Merge `PageImageCollectorParsers.parseSrcsetUrls()` with the existing parser result.
  - Merge `PageImageCollectorParsers.extractCssImageUrls()` with existing `extractBgUrls()` results.
- Create: `test/contentParsers.test.mjs`
  - Unit tests for srcset and CSS value parsing.
- Modify: `docs/release-checklist.md`
  - Add build step and generated-vendor verification.

### Phase 2 Files

- Modify: `package.json`
  - Add `@tanstack/virtual-core`.
  - Reuse `build:vendor`.
- Create: `src/vendor/workspace-virtual.entry.js`
  - Import `Virtualizer`, `observeElementRect`, `observeElementOffset`, `elementScroll`.
  - Expose `globalThis.PageImageCollectorVirtual`.
- Create: `vendor/workspace-virtual.js`
  - Generated local runtime file loaded before `workspace/workspace.js`.
- Modify: `workspace/workspace.html`
  - Load `vendor/workspace-virtual.js` before `workspace/workspace.js`.
- Modify: `workspace/workspace.js`
  - Add a grid-mode virtual renderer.
  - Keep `waterfall` 瀑布流 on existing full rendering path.
  - Preserve selection, hidden filters, lightbox, fullscreen, keyboard navigation, and current image index behavior.
- Modify: `styles/workspace.css`
  - Add virtual scroll layer styles.
- Create: `test/workspaceVirtual.test.mjs`
  - Test small pure helpers used by virtual grid math, not browser layout.
- Modify: `docs/release-checklist.md`
  - Add Workspace virtual grid smoke checks.

---

# Phase 1: Parser Libraries

## Task 1: Add Vendor Build Pipeline

**Files:**
- Modify: `package.json`
- Create: `scripts/build-vendor.mjs`
- Create: `src/vendor/content-parsers.entry.js`
- Create: `vendor/content-parsers.js`

- [ ] **Step 1: Install packages**

Run:

```bash
npm install srcset postcss-value-parser
npm install -D esbuild
```

Expected:

```text
package.json and package-lock.json are updated.
```

- [ ] **Step 2: Add build script to `package.json`**

Update scripts to:

```json
{
  "scripts": {
    "test": "node --test",
    "build:vendor": "node scripts/build-vendor.mjs"
  }
}
```

Expected:

```bash
npm run build:vendor
```

fails until `scripts/build-vendor.mjs` exists.

- [ ] **Step 3: Create `src/vendor/content-parsers.entry.js`**

Create:

```js
import { parseSrcset } from "srcset";
import valueParser from "postcss-value-parser";

const scoreSrcsetCandidate = (candidate, order) => {
  if (Number.isFinite(candidate?.width)) return candidate.width;
  if (Number.isFinite(candidate?.density)) return Math.round(candidate.density * 1000);
  return Math.max(1, 100 - order);
};

const parseSrcsetUrls = (srcsetValue) => {
  const raw = String(srcsetValue || "").trim();
  if (!raw) return [];
  try {
    return parseSrcset(raw)
      .map((candidate, order) => ({
        url: String(candidate.url || "").trim(),
        score: scoreSrcsetCandidate(candidate, order)
      }))
      .filter((candidate) => candidate.url)
      .sort((a, b) => b.score - a.score)
      .map((candidate) => candidate.url);
  } catch {
    return [];
  }
};

const scoreCssDescriptor = (descriptor, order) => {
  const raw = String(descriptor || "").trim().toLowerCase();
  if (/^\d+(?:\.\d+)?x$/.test(raw)) return Math.round(parseFloat(raw) * 1000);
  if (/^\d+w$/.test(raw)) return parseInt(raw, 10);
  return Math.max(1, 100 - order);
};

const nodeText = (node) => {
  if (!node) return "";
  if (node.type === "string" || node.type === "word") return String(node.value || "").trim();
  return "";
};

const collectImageSetCandidates = (node, pushCandidate, getOrder) => {
  let pendingUrl = "";
  for (const child of node.nodes || []) {
    if (child.type === "function" && String(child.value || "").toLowerCase() === "url") {
      pendingUrl = nodeText(child.nodes?.[0]);
      continue;
    }
    if ((child.type === "string" || child.type === "word") && !pendingUrl) {
      pendingUrl = nodeText(child);
      continue;
    }
    if (child.type === "word" && pendingUrl && /^(?:\d+(?:\.\d+)?x|\d+w)$/i.test(child.value || "")) {
      pushCandidate(pendingUrl, child.value, getOrder());
      pendingUrl = "";
    }
    if (child.type === "div" && child.value === "," && pendingUrl) {
      pushCandidate(pendingUrl, "", getOrder());
      pendingUrl = "";
    }
  }
  if (pendingUrl) pushCandidate(pendingUrl, "", getOrder());
};

const extractCssImageUrls = (cssValue) => {
  const css = String(cssValue || "").trim();
  if (!css || css === "none") return [];

  const candidates = [];
  let order = 0;
  const nextOrder = () => order++;
  const pushCandidate = (url, descriptor, candidateOrder) => {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) return;
    candidates.push({
      url: rawUrl,
      score: scoreCssDescriptor(descriptor, candidateOrder)
    });
  };

  try {
    valueParser(css).walk((node) => {
      const name = String(node.value || "").toLowerCase();
      if (node.type === "function" && name === "url") {
        pushCandidate(nodeText(node.nodes?.[0]), "", nextOrder());
        return false;
      }
      if (node.type === "function" && (name === "image-set" || name === "-webkit-image-set")) {
        collectImageSetCandidates(node, pushCandidate, nextOrder);
        return false;
      }
      return undefined;
    });
  } catch {
    return [];
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((candidate) => candidate.url);
};

globalThis.PageImageCollectorParsers = Object.freeze({
  parseSrcsetUrls,
  extractCssImageUrls
});
```

- [ ] **Step 4: Create `scripts/build-vendor.mjs`**

Create:

```js
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("vendor", { recursive: true });

await build({
  entryPoints: ["src/vendor/content-parsers.entry.js"],
  outfile: "vendor/content-parsers.js",
  bundle: true,
  format: "iife",
  target: ["chrome110"],
  platform: "browser",
  legalComments: "linked",
  sourcemap: false
});

console.log("vendor bundles built");
```

- [ ] **Step 5: Build vendor file**

Run:

```bash
npm run build:vendor
```

Expected:

```text
vendor bundles built
```

And:

```bash
test -s vendor/content-parsers.js
```

Expected: exit code `0`.

- [ ] **Step 6: Commit Phase 1 build pipeline**

Run:

```bash
git add package.json package-lock.json scripts/build-vendor.mjs src/vendor/content-parsers.entry.js vendor/content-parsers.js
git commit -m "build: add parser vendor bundle"
```

## Task 2: Wire Parser Bundle Into Content Script

**Files:**
- Modify: `manifest.json`
- Modify: `content/content.js`

- [ ] **Step 1: Load vendor file before content script**

In `manifest.json`, update content script JS order:

```json
"js": [
  "vendor/content-parsers.js",
  "content/content.js"
]
```

Expected: Chrome loads parser globals before `content/content.js`.

- [ ] **Step 2: Update `parseSrcset()` as additive merge**

In `content/content.js`, split the old body into a legacy helper and make the public function merge vendor and legacy candidates:

```js
const parseSrcsetLegacy = (srcset) => {
  if (!srcset || typeof srcset !== "string") return null;
  const candidates = splitSrcsetCandidates(srcset)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, order) => {
      const [url, descriptor] = item.split(/\s+/, 2);
      const score = descriptor?.endsWith("w")
        ? parseInt(descriptor, 10)
        : descriptor?.endsWith("x")
          ? Math.round(parseFloat(descriptor) * 1000)
          : Math.max(1, 100 - order);
      return { url, score: Number.isFinite(score) ? score : Math.max(1, 100 - order) };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.url || null;
};

const parseSrcset = (srcset) => {
  if (!srcset || typeof srcset !== "string") return null;
  const vendorUrls = globalThis.PageImageCollectorParsers?.parseSrcsetUrls?.(srcset);
  const legacyUrl = parseSrcsetLegacy(srcset);
  const merged = [];
  for (const url of [...(Array.isArray(vendorUrls) ? vendorUrls : []), legacyUrl]) {
    if (!url || merged.includes(url)) continue;
    merged.push(url);
  }
  return chooseBestSource(merged) || legacyUrl || merged[0] || null;
};
```

Expected: the old best URL remains eligible even when the vendor parser returns a partial result.

- [ ] **Step 3: Update `extractBgUrls()` as additive merge**

In `content/content.js`, split the old body into a legacy helper and make the public function merge vendor and legacy candidates:

```js
const mergeUrlLists = (...lists) => {
  const merged = [];
  for (const list of lists) {
    for (const url of Array.isArray(list) ? list : []) {
      if (!url || merged.includes(url)) continue;
      merged.push(url);
    }
  }
  return merged;
};

const extractBgUrlsLegacy = (value) => {
  const css = String(value || "").trim();
  if (!css || css === "none") return [];

  const candidates = [];
  const pushCandidate = (url, descriptor, order) => {
    const rawUrl = String(url || "").trim();
    if (!rawUrl) return;
    const score = /x$/i.test(descriptor || "")
      ? Math.round(parseFloat(descriptor) * 1000)
      : /w$/i.test(descriptor || "")
        ? parseInt(descriptor, 10)
        : Math.max(1, 100 - order);
    candidates.push({
      url: rawUrl,
      score: Number.isFinite(score) ? score : Math.max(1, 100 - order)
    });
  };

  const urlRe = /url\(\s*(['"]?)(.*?)\1\s*\)(?:\s+type\([^)]+\))?(?:\s+(\d+(?:\.\d+)?x|\d+w))?/gi;
  let match;
  let order = 0;
  while ((match = urlRe.exec(css))) {
    pushCandidate(match[2], match[3], order);
    order += 1;
  }

  const imageSetRe = /(?:-webkit-)?image-set\((.*)\)/gi;
  while ((match = imageSetRe.exec(css))) {
    const quotedItemRe = /(['"])(.*?)\1(?:\s+type\([^)]+\))?\s+(\d+(?:\.\d+)?x|\d+w)/gi;
    let quotedMatch;
    while ((quotedMatch = quotedItemRe.exec(match[1]))) {
      pushCandidate(quotedMatch[2], quotedMatch[3], order);
      order += 1;
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .map((item) => item.url);
};

const extractBgUrls = (value) => {
  const css = String(value || "").trim();
  if (!css || css === "none") return [];
  const vendorUrls = globalThis.PageImageCollectorParsers?.extractCssImageUrls?.(css);
  const legacyUrls = extractBgUrlsLegacy(css);
  return mergeUrlLists(vendorUrls, legacyUrls);
};
```

Expected: vendor CSS parsing can add better candidates, but old regex-supported candidates are not lost.

- [ ] **Step 4: Syntax check**

Run:

```bash
node --check content/content.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest-ok')"
```

Expected:

```text
manifest-ok
```

- [ ] **Step 5: Commit content wiring**

Run:

```bash
git add manifest.json content/content.js
git commit -m "feat: use bundled parsers in content scanning"
```

## Task 3: Add Parser Tests

**Files:**
- Create: `test/contentParsers.test.mjs`

- [ ] **Step 1: Write tests**

Create:

```js
import test from "node:test";
import assert from "node:assert/strict";

await import("../src/vendor/content-parsers.entry.js");

const parsers = globalThis.PageImageCollectorParsers;

test("selects the largest srcset candidate by width or density", () => {
  assert.deepEqual(
    parsers.parseSrcsetUrls("small.jpg 400w, large.jpg 1600w, retina.jpg 2x"),
    ["large.jpg", "retina.jpg", "small.jpg"]
  );
  assert.deepEqual(
    parsers.parseSrcsetUrls("small.jpg 1x, large.jpg 3x"),
    ["large.jpg", "small.jpg"]
  );
});

test("extracts highest resolution CSS image-set URL", () => {
  const value = 'image-set(url("a.avif") type("image/avif") 1x, url("a@2x.jpg") type("image/jpeg") 2x)';
  assert.deepEqual(parsers.extractCssImageUrls(value), ["a@2x.jpg", "a.avif"]);
});

test("extracts quoted and unquoted CSS url values", () => {
  assert.deepEqual(parsers.extractCssImageUrls('url("hero large.jpg")'), ["hero large.jpg"]);
  assert.deepEqual(parsers.extractCssImageUrls("url(/images/hero.webp)"), ["/images/hero.webp"]);
});
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test
```

Expected:

```text
pass
```

- [ ] **Step 3: Commit tests**

Run:

```bash
git add test/contentParsers.test.mjs
git commit -m "test: cover bundled content parsers"
```

## Task 4: Phase 1 Manual Verification

**Files:**
- Modify: `docs/release-checklist.md`

- [ ] **Step 1: Add release checklist items**

Add under static checks:

```markdown
npm run build:vendor
test -s vendor/content-parsers.js
```

Add under core smoke:

```markdown
- Parser bundle: confirm `vendor/content-parsers.js` is loaded before `content/content.js`.
- `srcset`: fixture with `small.jpg 400w, large.jpg 1600w` should collect the large candidate.
- CSS background: fixture with `image-set(... 1x, ... 2x)` should collect the 2x candidate first.
```

- [ ] **Step 2: Run final Phase 1 verification**

Run:

```bash
npm run build:vendor
npm test
node --check content/content.js
node --check vendor/content-parsers.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest-ok')"
```

Expected:

```text
vendor bundles built
manifest-ok
```

`npm test` must report all tests passing.

- [ ] **Step 3: Commit checklist**

Run:

```bash
git add docs/release-checklist.md
git commit -m "docs: add parser bundle release checks"
```

---

# Phase 2: Workspace Virtualization

## Task 5: Add Workspace Virtual Vendor Bundle

**Files:**
- Modify: `package.json`
- Modify: `scripts/build-vendor.mjs`
- Create: `src/vendor/workspace-virtual.entry.js`
- Create: `vendor/workspace-virtual.js`
- Modify: `workspace/workspace.html`

- [ ] **Step 1: Install virtual core**

Run:

```bash
npm install @tanstack/virtual-core
```

Expected:

```text
package.json and package-lock.json are updated.
```

- [ ] **Step 2: Create `src/vendor/workspace-virtual.entry.js`**

Create:

```js
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect
} from "@tanstack/virtual-core";

globalThis.PageImageCollectorVirtual = Object.freeze({
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect
});
```

- [ ] **Step 3: Extend `scripts/build-vendor.mjs`**

Add a second build call:

```js
await build({
  entryPoints: ["src/vendor/workspace-virtual.entry.js"],
  outfile: "vendor/workspace-virtual.js",
  bundle: true,
  format: "iife",
  target: ["chrome110"],
  platform: "browser",
  legalComments: "linked",
  sourcemap: false
});
```

Keep the existing content parser build.

- [ ] **Step 4: Build vendor files**

Run:

```bash
npm run build:vendor
test -s vendor/content-parsers.js
test -s vendor/workspace-virtual.js
```

Expected:

```text
vendor bundles built
```

- [ ] **Step 5: Load workspace vendor before workspace app**

In `workspace/workspace.html`, add:

```html
<script src="../vendor/workspace-virtual.js"></script>
<script src="workspace.js"></script>
```

Ensure `workspace-virtual.js` appears before `workspace.js`.

- [ ] **Step 6: Commit virtual vendor setup**

Run:

```bash
git add package.json package-lock.json scripts/build-vendor.mjs src/vendor/workspace-virtual.entry.js vendor/workspace-virtual.js workspace/workspace.html
git commit -m "build: add workspace virtual vendor bundle"
```

## Task 6: Add Virtual Grid Rendering Path

**Files:**
- Modify: `workspace/workspace.js`
- Modify: `styles/workspace.css`

- [ ] **Step 1: Add virtual state**

In `workspace/workspace.js`, near gallery constants, add:

```js
const VIRTUAL_GRID_MIN_COUNT = 500;
const VIRTUAL_GRID_BASE_MIN_WIDTH = 220;
const VIRTUAL_GRID_DEFAULT_GAP = 20;
const VIRTUAL_GRID_ESTIMATED_FOOTER_HEIGHT = 38;
const VIRTUAL_GRID_OVERSCAN = 8;

let virtualGrid = {
  enabled: false,
  virtualizer: null,
  columns: 1,
  rowHeight: 258,
  rows: [],
  renderToken: 0
};
```

- [ ] **Step 2: Add grid metric and row helpers**

Add:

```js
const getCssPixels = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getVirtualGridMetrics = () => {
  const gallery = elements.gallery;
  const style = window.getComputedStyle(gallery);
  const paddingLeft = getCssPixels(style.paddingLeft);
  const paddingRight = getCssPixels(style.paddingRight);
  const gap = getCssPixels(style.columnGap || style.gap, VIRTUAL_GRID_DEFAULT_GAP);
  const scale = currentZoom / 100;
  const minCardWidth = Math.round(VIRTUAL_GRID_BASE_MIN_WIDTH * scale);
  const innerWidth = Math.max(0, gallery.clientWidth - paddingLeft - paddingRight);
  const columns = Math.max(1, Math.floor((innerWidth + gap) / (minCardWidth + gap)));
  const cardWidth = Math.max(
    minCardWidth,
    Math.floor((innerWidth - gap * (columns - 1)) / columns)
  );
  return {
    columns,
    gap,
    cardWidth,
    rowHeight: Math.ceil(cardWidth + VIRTUAL_GRID_ESTIMATED_FOOTER_HEIGHT + gap)
  };
};

const buildVirtualGridRows = (images, columns) => {
  const rows = [];
  for (let index = 0; index < images.length; index += columns) {
    rows.push({
      startIndex: index,
      images: images.slice(index, index + columns)
    });
  }
  return rows;
};
```

- [ ] **Step 3: Add virtual grid teardown**

Add:

```js
const teardownVirtualGrid = () => {
  if (virtualGrid.virtualizer) {
    virtualGrid.virtualizer.destroy?.();
  }
  virtualGrid = {
    enabled: false,
    virtualizer: null,
    columns: 1,
    rowHeight: 258,
    rows: [],
    renderToken: virtualGrid.renderToken + 1
  };
  elements.gallery.classList.remove("is-virtual-grid");
  elements.gallery.style.height = "";
  elements.gallery.style.position = "";
  elements.gallery.style.removeProperty("--virtual-grid-columns");
  elements.gallery.style.removeProperty("--virtual-grid-gap");
  elements.gallery.style.removeProperty("--virtual-grid-card-width");
  elements.gallery.style.removeProperty("--virtual-grid-row-height");
};
```

- [ ] **Step 4: Add virtual row renderer**

Add:

```js
const renderVirtualGridRows = (renderToken) => {
  if (!virtualGrid.enabled || renderToken !== virtualGrid.renderToken) return;
  const virtualizer = virtualGrid.virtualizer;
  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  elements.gallery.innerHTML = "";
  const spacer = document.createElement("div");
  spacer.className = "virtual-grid-spacer";
  spacer.style.height = `${totalSize}px`;

  for (const virtualRow of virtualRows) {
    const row = virtualGrid.rows[virtualRow.index];
    if (!row) continue;
    const rowNode = document.createElement("div");
    rowNode.className = "virtual-grid-row";
    rowNode.style.transform = `translateY(${virtualRow.start}px)`;
    rowNode.dataset.index = String(virtualRow.index);
    rowNode.setAttribute("data-index", String(virtualRow.index));

    row.images.forEach((image, offset) => {
      rowNode.appendChild(createCard(image, row.startIndex + offset));
    });

    spacer.appendChild(rowNode);
  }

  elements.gallery.appendChild(spacer);
};
```

- [ ] **Step 5: Add virtual grid mount**

Add:

```js
const shouldUseVirtualGrid = (images) =>
  currentLayoutMode === "grid" &&
  Array.isArray(images) &&
  images.length >= VIRTUAL_GRID_MIN_COUNT &&
  Boolean(globalThis.PageImageCollectorVirtual?.Virtualizer);

const mountVirtualGrid = async (images, renderToken) => {
  teardownVirtualGrid();
  virtualGrid.renderToken = renderToken;
  virtualGrid.enabled = true;
  const metrics = getVirtualGridMetrics();
  virtualGrid.columns = metrics.columns;
  virtualGrid.rowHeight = metrics.rowHeight;
  virtualGrid.rows = buildVirtualGridRows(images, virtualGrid.columns);
  elements.gallery.classList.add("is-virtual-grid");
  elements.gallery.style.setProperty("--virtual-grid-columns", String(metrics.columns));
  elements.gallery.style.setProperty("--virtual-grid-gap", `${metrics.gap}px`);
  elements.gallery.style.setProperty("--virtual-grid-card-width", `${metrics.cardWidth}px`);
  elements.gallery.style.setProperty("--virtual-grid-row-height", `${metrics.rowHeight}px`);

  const {
    Virtualizer,
    observeElementRect,
    observeElementOffset,
    elementScroll
  } = globalThis.PageImageCollectorVirtual;

  virtualGrid.virtualizer = new Virtualizer({
    count: virtualGrid.rows.length,
    getScrollElement: () => elements.gallery,
    estimateSize: () => virtualGrid.rowHeight,
    overscan: VIRTUAL_GRID_OVERSCAN,
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: () => renderVirtualGridRows(renderToken)
  });

  virtualGrid.virtualizer.measure();
  renderVirtualGridRows(renderToken);
  await waitForNextFrame();
  applyGalleryLayout();
};
```

When implementing, verify this call against the installed `@tanstack/virtual-core` version and use only public API from the package.

- [ ] **Step 6: Switch render path in `renderGallery()`**

Replace the existing full render section:

```js
const completed = await appendGalleryCardsBatched(currentImages, renderToken);
if (!completed) return;
applyGalleryLayout();
```

with:

```js
if (shouldUseVirtualGrid(currentImages)) {
  await mountVirtualGrid(currentImages, renderToken);
} else {
  teardownVirtualGrid();
  const completed = await appendGalleryCardsBatched(currentImages, renderToken);
  if (!completed) return;
  applyGalleryLayout();
}
```

- [ ] **Step 7: Add CSS**

Add to `styles/workspace.css`:

```css
.gallery.is-virtual-grid {
  display: block;
  position: relative;
  overflow-y: auto;
}

.virtual-grid-spacer {
  position: relative;
  width: 100%;
}

.virtual-grid-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: grid;
  grid-template-columns: repeat(var(--virtual-grid-columns), minmax(0, var(--virtual-grid-card-width)));
  gap: var(--virtual-grid-gap);
  min-height: var(--virtual-grid-row-height);
  padding: 0 0 var(--virtual-grid-gap);
  will-change: transform;
}
```

- [ ] **Step 8: Syntax check**

Run:

```bash
node --check workspace/workspace.js
node --check vendor/workspace-virtual.js
```

Expected: exit code `0`.

- [ ] **Step 9: Commit virtual grid first pass**

Run:

```bash
git add workspace/workspace.js styles/workspace.css
git commit -m "feat: virtualize workspace grid rendering"
```

## Task 7: Preserve Workspace Interactions

**Files:**
- Modify: `workspace/workspace.js`
- Test: browser smoke test

- [ ] **Step 1: Re-render when layout or zoom changes virtual grid metrics**

Replace the layout and zoom event handlers with:

```js
elements.layoutMode.addEventListener("change", async () => {
  const previousLayoutMode = currentLayoutMode;
  currentLayoutMode = elements.layoutMode.value;
  if (virtualGrid.enabled || previousLayoutMode !== currentLayoutMode) {
    await renderGallery();
    return;
  }
  applyGalleryLayout();
});

elements.zoomSlider.addEventListener("input", async () => {
  currentZoom = Number(elements.zoomSlider.value) || 100;
  elements.zoomValue.textContent = `${currentZoom}%`;
  if (virtualGrid.enabled) {
    await renderGallery();
    return;
  }
  applyGalleryLayout();
});

window.addEventListener("resize", async () => {
  if (virtualGrid.enabled) {
    await renderGallery();
    return;
  }
  if (currentLayoutMode === "waterfall") applyGalleryLayout();
});
```

Expected: switching from `grid` to `waterfall` destroys virtual state and restores the existing full render path.

- [ ] **Step 2: Make drag selection geometry transform-safe**

Replace `hitTestSelectionCards()` with:

```js
const getCardSelectionRect = (card) => {
  const galleryRect = elements.gallery.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const left = cardRect.left - galleryRect.left + elements.gallery.scrollLeft;
  const top = cardRect.top - galleryRect.top + elements.gallery.scrollTop;
  return {
    left,
    top,
    right: left + cardRect.width,
    bottom: top + cardRect.height
  };
};

const hitTestSelectionCards = (rect) => {
  const hitIds = new Set();
  const cards = elements.gallery.querySelectorAll(".gallery-card[data-id]");
  for (const card of cards) {
    const cardRect = getCardSelectionRect(card);
    const intersects =
      rect.left <= cardRect.right &&
      rect.right >= cardRect.left &&
      rect.top <= cardRect.bottom &&
      rect.bottom >= cardRect.top;
    if (!intersects) continue;
    if (card.dataset.id) hitIds.add(card.dataset.id);
  }
  return hitIds;
};
```

Expected: transformed virtual rows and normal grid cards both use viewport-measured geometry.

- [ ] **Step 3: Verify card selection works with virtual rows**

Manual smoke:

```text
1. Load a fixture page with at least 600 images.
2. Open Workspace in grid mode.
3. Select one visible card.
4. Scroll down.
5. Scroll back.
6. Confirm the same card remains selected.
```

Expected:

```text
Selected state comes from background selectedIds, not DOM persistence.
```

If it fails, update `createCard()` usage so `selectedIds.has(image.id)` is always read from the current `selectedIds` set before rendering each virtual row.

- [ ] **Step 4: Verify drag selection works with virtual rows**

Manual smoke:

```text
1. Load a fixture page with at least 600 images.
2. Open Workspace in grid mode.
3. Drag-select visible cards in the first viewport.
4. Scroll down and drag-select visible cards far below the first viewport.
5. Confirm only the cards inside the selection box are selected.
```

Expected:

```text
Drag selection uses transformed card geometry and does not depend on offsetTop.
```

- [ ] **Step 5: Verify lightbox index is data index, not DOM index**

Manual smoke:

```text
1. Scroll to a virtualized row far below the first viewport.
2. Click an image.
3. Confirm the lightbox opens that exact image.
4. Press next/previous.
5. Confirm navigation follows currentImages order.
```

Expected:

```text
Lightbox index uses `row.startIndex + offset`, not the current DOM row position.
```

- [ ] **Step 6: Verify sorting, hiding, and batch operations**

Manual smoke:

```text
1. Enable large-to-small sorting in virtual grid mode.
2. Click a visible card and confirm lightbox next/previous follows the sorted order.
3. Hide several visible images and confirm normal filters remove them.
4. Show hidden images and confirm the same hidden images can be restored.
5. Select filtered images, then run copy links and batch download.
6. Confirm copied/downloaded targets match the selected filtered images.
```

Expected:

```text
Virtualization changes DOM count only; it does not change currentImages order or selectedIds targets.
```

- [ ] **Step 7: Verify waterfall still uses full render**

Manual smoke:

```text
1. Switch layout mode to waterfall.
2. Confirm Workspace uses existing full layout.
3. Confirm no `is-virtual-grid` class remains on `.gallery`.
```

Expected:

```text
Waterfall is not virtualized in this phase.
```

- [ ] **Step 8: Commit interaction fixes**

Run:

```bash
git add workspace/workspace.js styles/workspace.css
git commit -m "fix: preserve workspace interactions with virtual grid"
```

## Task 8: Phase 2 Performance Verification

**Files:**
- Modify: `docs/release-checklist.md`

- [ ] **Step 1: Add virtual grid checklist**

Add under Workspace smoke:

```markdown
- Workspace virtual grid: with 600+ images in grid mode, confirm DOM card count stays near the visible range plus overscan rather than total image count.
- Workspace virtual grid: confirm select, hide, format filters, resolution filters, lightbox, fullscreen, and keyboard navigation still target the correct image.
- Workspace virtual grid: confirm drag selection works in the first viewport and after scrolling far down.
- Workspace virtual grid: confirm large-to-small sorting order matches lightbox next/previous order.
- Workspace virtual grid: confirm hidden images can be hidden, shown, and restored without changing selected download targets.
- Workspace waterfall: confirm waterfall mode still renders with the existing non-virtual layout.
```

- [ ] **Step 2: Run static verification**

Run:

```bash
npm run build:vendor
npm test
node --check workspace/workspace.js
node --check vendor/workspace-virtual.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest-ok')"
```

Expected:

```text
vendor bundles built
manifest-ok
```

`npm test` must report all tests passing.

- [ ] **Step 3: Run DOM count smoke**

In Chrome DevTools Console on Workspace with 600+ images:

```js
document.querySelectorAll(".gallery-card").length
```

Expected:

```text
The count is near visible rows * columns plus overscan, not 600+.
```

- [ ] **Step 4: Commit checklist**

Run:

```bash
git add docs/release-checklist.md
git commit -m "docs: add virtual grid release checks"
```

---

## Execution Rules

- Do not reduce image candidate collection. If a parser fails, keep current fallback logic and keep existing candidates.
- Prefer additive parsing. Parser libraries should expand or correct candidate interpretation, not narrow the source set.
- Treat every parser change as high-risk until proven by fixtures and Chrome smoke tests against pages that already worked.
- Do not change ZIP architecture in either phase.
- Do not add Popup ZIP分卷 settings.
- Do not virtualize `waterfall` in Phase 2 first pass.
- Do not rely on remote code or CDN scripts. All vendor code must be local and included in release packages.
- Do not update README public wording without explicit user approval.
- Do not commit a phase until subagent review has checked both product regression risk and Chrome MV3/release-package risk.

---

## Final Verification Commands

Run after each phase:

```bash
npm run build:vendor
npm test
node --check content/content.js
node --check workspace/workspace.js
node --check vendor/content-parsers.js
node --check vendor/workspace-virtual.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest-ok')"
git diff --check
```

Expected:

```text
vendor bundles built
manifest-ok
```

`npm test` must report all tests passing.

For Phase 1 browser smoke:

- `srcset` fixture collects the largest candidate.
- CSS `image-set()` fixture collects the highest density candidate.
- Existing pages that already collected images must not lose candidates.
- A mixed fixture with old parser-supported lazy fields still collects every previous URL.
- When vendor parser is unavailable or throws, existing parser fallback still returns the old result.

For Phase 2 browser smoke:

- Grid mode with 600+ images keeps DOM card count near visible range plus overscan.
- Selection, hidden filters, lightbox, fullscreen, and keyboard navigation still target correct images.
- Drag selection works in visible rows before and after scrolling.
- Sorting, hiding, restore hidden, copy links, and batch download target the same image ids as non-virtual rendering.
- Waterfall mode remains usable through the existing full render path.
- Toggling layout mode back from grid to waterfall destroys virtual DOM state and restores the old full-render path.
- Batch operations use the same filtered/selected image ids before and after virtualization.

Subagent review required before commit:

- Product regression review: verify the phase does not reduce capture coverage or break Workspace behavior.
- Chrome MV3/release review: verify all runtime files are local, manifest/HTML references are valid, and unpacked loading still works.

---

## Self-Review

- Spec coverage: two phases are covered; Phase 1 handles `srcset` and `postcss-value-parser`; Phase 2 handles `@tanstack/virtual-core`.
- Boundary coverage: `image-type`, `file-type`, `fflate`, `zip.js`, and `p-limit` are explicitly excluded.
- Chrome MV3 coverage: plan avoids remote code and requires local vendor bundles in release packages.
- Product safety: parser failures preserve existing fallback logic; virtualization starts with grid only and does not alter waterfall behavior.
- User constraints coverage: non-regression, Chrome extension platform constraints, and required subagent review gates are written as blocking execution rules.
