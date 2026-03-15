import { createTabStateManager } from "./stateManager.js";

const MSG = {
  SCAN: "SCAN",
  SCAN_IMAGES: "SCAN_IMAGES",
  INCREMENTAL_SCAN: "INCREMENTAL_SCAN",
  IMAGES_UPDATED: "IMAGES_UPDATED",
  AUTO_SCROLL_STATE_CHANGED: "AUTO_SCROLL_STATE_CHANGED",
  GET_IMAGES: "GET_IMAGES",
  TOGGLE_SELECT: "TOGGLE_SELECT",
  SET_SELECTION: "SET_SELECTION",
  GET_SELECTED: "GET_SELECTED",
  GET_STATS: "GET_STATS",
  DOWNLOAD: "DOWNLOAD",
  DOWNLOAD_BATCH: "DOWNLOAD_BATCH",
  GET_DOWNLOAD_STATUS: "GET_DOWNLOAD_STATUS",
  COPY_TO_CLIPBOARD: "COPY_TO_CLIPBOARD",
  SET_CONFIG: "SET_CONFIG",
  GET_CONFIG: "GET_CONFIG",
  GET_COMIC_SEQUENCE: "GET_COMIC_SEQUENCE",
  GET_COMIC_PAGINATION: "GET_COMIC_PAGINATION",
  LOAD_COMIC_PAGINATION_PAGES: "LOAD_COMIC_PAGINATION_PAGES",
  TOGGLE_RIGHT_CLICK: "TOGGLE_RIGHT_CLICK",
  START_AUTO_SCAN: "START_AUTO_SCAN",
  STOP_AUTO_SCAN: "STOP_AUTO_SCAN",
  START_AUTO_SCROLL: "START_AUTO_SCROLL",
  STOP_AUTO_SCROLL: "STOP_AUTO_SCROLL",
  AUTO_SCROLL_STOPPED: "AUTO_SCROLL_STOPPED",
  FOCUS_SOURCE_TAB_AND_START_AUTO_SCROLL: "FOCUS_SOURCE_TAB_AND_START_AUTO_SCROLL",
  DOWNLOAD_PROGRESS: "DOWNLOAD_PROGRESS",
  COPY_IMAGE_DATA_URL: "COPY_IMAGE_DATA_URL",
  PROBE_IMAGE_DIMENSIONS: "PROBE_IMAGE_DIMENSIONS",
  OPEN_DOWNLOAD_DIRECTORY: "OPEN_DOWNLOAD_DIRECTORY",
  OPEN_SOURCE_URL: "OPEN_SOURCE_URL",
  CLEAR_IMAGES: "CLEAR_IMAGES",
  CLEAR_RUNTIME_CACHE: "CLEAR_RUNTIME_CACHE"
};

const CONTEXT_MENU_IDS = {
  SCAN_OPEN_WORKSPACE: "pic-collector-scan-open-workspace",
  SCAN_OPEN_WORKSPACE_COMIC: "pic-collector-scan-open-workspace-comic",
  IMAGE_ACTIONS_PARENT: "pic-collector-image-actions-parent",
  VIEW_ORIGINAL_IMAGE: "pic-collector-view-original-image",
  COPY_ORIGINAL_IMAGE: "pic-collector-copy-original-image",
  DOWNLOAD_ORIGINAL_IMAGE: "pic-collector-download-original-image"
};
const SINAIMG_REFERER_RULE_ID = 10086;
const JPG_CONVERT_QUALITY = 1.0;
// 分卷策略优先稳定性，避免单卷过大导致浏览器下载链路异常（0B/损坏）。
const ZIP_PART_MAX_BYTES = 192 * 1024 * 1024;
const ZIP_PART_MAX_FILES = 300;

const stateManager = createTabStateManager();
const TEXT_ENCODER = new TextEncoder();
const pendingFilenameHints = new Map();
const activeBatchDownloads = new Set();
const batchDownloadStatusByTab = new Map();
const DOWNLOAD_STATUS_TTL_MS = 15 * 1000;
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const cloneDownloadStatus = (status) => (status ? { ...status } : null);

const cleanupExpiredDownloadStatuses = (tabId = null) => {
  const now = Date.now();
  if (Number.isInteger(tabId)) {
    const status = batchDownloadStatusByTab.get(tabId);
    if (status && status.active !== true && Number(status.expiresAt) > 0 && Number(status.expiresAt) <= now) {
      batchDownloadStatusByTab.delete(tabId);
    }
    return;
  }

  for (const [key, status] of batchDownloadStatusByTab.entries()) {
    if (status?.active === true) continue;
    if (Number(status?.expiresAt) > 0 && Number(status.expiresAt) <= now) {
      batchDownloadStatusByTab.delete(key);
    }
  }
};

const updateDownloadStatus = (tabId, patch = {}) => {
  if (!Number.isInteger(tabId)) return null;
  cleanupExpiredDownloadStatuses(tabId);
  const previous = batchDownloadStatusByTab.get(tabId) || {};
  const next = {
    ...previous,
    ...patch,
    tabId,
    updatedAt: Date.now()
  };

  if (next.active === false) {
    next.expiresAt = Date.now() + DOWNLOAD_STATUS_TTL_MS;
  } else {
    delete next.expiresAt;
  }

  batchDownloadStatusByTab.set(tabId, next);
  return cloneDownloadStatus(next);
};

const emitDownloadStatus = (tabId, patch = {}) => {
  const status = updateDownloadStatus(tabId, patch);
  if (!status) return null;
  chrome.runtime.sendMessage({
    type: MSG.DOWNLOAD_PROGRESS,
    payload: status
  }).catch(() => {});
  return status;
};

const getDownloadStatus = (tabId) => {
  if (!Number.isInteger(tabId)) return null;
  cleanupExpiredDownloadStatuses(tabId);
  return cloneDownloadStatus(batchDownloadStatusByTab.get(tabId) || null);
};

if (chrome.downloads?.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    const hint = pendingFilenameHints.get(downloadItem?.url || "");
    if (!hint) return;
    pendingFilenameHints.delete(downloadItem.url);
    suggest({
      filename: hint.filename,
      conflictAction: hint.conflictAction || "uniquify"
    });
  });
}

const buildSinaimgRefererRule = () => ({
  id: SINAIMG_REFERER_RULE_ID,
  priority: 1,
  action: {
    type: "modifyHeaders",
    requestHeaders: [
      {
        header: "referer",
        operation: "set",
        value: "https://weibo.com/"
      }
    ]
  },
  condition: {
    urlFilter: "||sinaimg.cn/",
    resourceTypes: ["main_frame", "sub_frame", "image", "xmlhttprequest", "media", "other"]
  }
});

const ensureSinaimgRefererRule = async () => {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [SINAIMG_REFERER_RULE_ID],
      addRules: [buildSinaimgRefererRule()]
    });
  } catch (error) {
    console.warn("[图片采集查看器] Failed to install sinaimg referer rule:", error);
  }
};

const timeout = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getDownloadStats = async (downloadId) => {
  try {
    const result = await chrome.downloads.search({ id: downloadId });
    const item = result?.[0];
    return {
      state: String(item?.state || "unknown"),
      fileSize: Number(item?.fileSize) || Number(item?.bytesReceived) || 0,
      error: String(item?.error || "")
    };
  } catch (_error) {
    return { state: "unknown", fileSize: 0, error: "" };
  }
};

const waitForDownloadTerminal = async (downloadId, timeoutMs = 20 * 60 * 1000) => {
  if (!Number.isInteger(downloadId) || !chrome.downloads?.onChanged) {
    return { state: "unknown", error: "", fileSize: 0 };
  }

  const existing = await getDownloadStats(downloadId);
  if (existing.state === "complete") {
    return existing;
  }
  if (existing.state === "interrupted") {
    return existing;
  }

  const normalizedTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 20 * 60 * 1000;
  return await new Promise((resolve) => {
    let settled = false;

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      try {
        chrome.downloads.onChanged.removeListener(onChanged);
      } catch (_error) {
        // Ignore remove listener errors.
      }
      clearTimeout(timer);
      resolve(result);
    };

    const onChanged = async (delta) => {
      if (!delta || delta.id !== downloadId) return;
      const state = delta.state?.current;
      if (state === "complete") {
        const stats = await getDownloadStats(downloadId);
        finalize({
          state: "complete",
          error: "",
          fileSize: Number(stats.fileSize) || 0
        });
        return;
      }
      if (state === "interrupted") {
        finalize({
          state: "interrupted",
          error: String(delta.error?.current || "download_interrupted"),
          fileSize: 0
        });
      }
    };

    const timer = setTimeout(() => {
      finalize({ state: "timeout", error: "download_timeout", fileSize: 0 });
    }, normalizedTimeout);

    chrome.downloads.onChanged.addListener(onChanged);

    // 再兜底一次，避免极端情况下 onChanged 漏触发。
    setTimeout(async () => {
      if (settled) return;
      const polled = await getDownloadStats(downloadId);
      if (polled.state === "complete" || polled.state === "interrupted") {
        finalize(polled);
      }
    }, 1500);
  });
};

const waitForDownloadNonZeroSize = async (downloadId, timeoutMs = 12_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stats = await getDownloadStats(downloadId);
    if (Number(stats.fileSize) > 0) {
      return Number(stats.fileSize);
    }
    await timeout(350);
  }
  return 0;
};

const isTruthyFlag = (value) =>
  value === true ||
  value === 1 ||
  value === "1" ||
  String(value || "").toLowerCase() === "true";

const pad2 = (num) => String(num).padStart(2, "0");

const formatTimestampMinute = (date = new Date()) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  return `${year}${month}${day}-${hour}${minute}`;
};

const getTabHostname = async (tabId) => {
  if (!Number.isInteger(tabId)) return "unknown";
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = String(tab?.url || "");
    if (!url) return "unknown";
    const parsed = new URL(url);
    const host = String(parsed.hostname || "")
      .toLowerCase()
      .replace(/^www\./, "");
    return host || "unknown";
  } catch (_error) {
    return "unknown";
  }
};

const mimeFromFormat = (format) => {
  const normalized = String(format || "").toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "png") return "image/png";
  if (normalized === "webp") return "image/webp";
  if (normalized === "gif") return "image/gif";
  if (normalized === "bmp") return "image/bmp";
  return "";
};

const formatFromUrl = (url) => {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (
      String(url).startsWith("blob:https://web.telegram.org/") ||
      (parsed.protocol === "blob:" && /web\.telegram\.org/i.test(String(parsed.pathname || "")))
    ) {
      return "jpg";
    }
    const format = parsed.searchParams.get("format");
    if (format) return format.toLowerCase();

    const formatByRule = parsed.href.match(/(?:format=|\/format\/)(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[&/?#]|$)/i);
    if (formatByRule?.[1]) return formatByRule[1].toLowerCase();

    const formatFromSuffix = parsed.pathname.match(/(?:^|[_!.-])(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[_!.-]|$)/i);
    if (formatFromSuffix?.[1]) return formatFromSuffix[1].toLowerCase();

    if (/xhscdn\.com$/i.test(parsed.hostname) && (/webpic/i.test(parsed.hostname) || /notes_pre_post/i.test(parsed.pathname))) {
      return "webp";
    }
  } catch (_error) {
    // Ignore parse failures.
  }

  const match = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
};

const extensionFromUrl = (url, fallback = "jpg") => {
  if (!url) return fallback;
  const format = formatFromUrl(url);
  if (format) return format;
  return fallback;
};

const looksLikeImageUrl = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    if (/\.(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:$|[?#])/i.test(pathname)) return true;
    const format = parsed.searchParams.get("format");
    if (format && /^(jpg|jpeg|png|webp|gif|svg|avif|bmp)$/i.test(format)) return true;
    if (/\/media\//i.test(pathname) && /twimg\.com$/i.test(parsed.hostname)) return true;
    if (/sinaimg\.cn$/i.test(parsed.hostname)) return true;
    if (/\/imagecache\//i.test(pathname)) return true;
    return false;
  } catch (_error) {
    return false;
  }
};

const resolveOriginalImageUrl = (url) => {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || "";

    if (/twimg\.com$/.test(host) && /\/media\//i.test(pathname)) {
      parsed.searchParams.set("name", "orig");
      return parsed.toString();
    }

    if (/sinaimg\.cn$/.test(host)) {
      const cropMatch = pathname.match(/\/crop\.[^/]+\/([^/?#]+\.(jpg|jpeg|png|webp|gif))$/i);
      if (cropMatch?.[1]) {
        return `https://wx2.sinaimg.cn/large/${cropMatch[1]}`;
      }

      parsed.pathname = pathname
        .replace(/\/(bmiddle|orj360|mw690|thumb150)\//i, "/large/")
        .replace(/\/wx\d+\//i, "/large/");

      return parsed.toString();
    }

    if (/\/imagecache\//i.test(pathname)) {
      parsed.pathname = pathname.replace(/\/imagecache\/[^/]+\//i, "/");
    }

    parsed.pathname = parsed.pathname
      .replace(/-\d{2,4}x\d{2,4}(?=\.(jpg|jpeg|png|webp|gif|svg|avif|bmp)$)/i, "")
      .replace(/_(\d{2,4})x(\d{2,4})(?=\.(jpg|jpeg|png|webp|gif|svg|avif|bmp)$)/i, "");

    return parsed.toString();
  } catch (_error) {
    return url;
  }
};

const pickContextImageUrl = (info) => {
  const linkUrl = String(info?.linkUrl || "");
  const srcUrl = String(info?.srcUrl || "");

  if (linkUrl && looksLikeImageUrl(linkUrl)) {
    return linkUrl;
  }
  return srcUrl || linkUrl || "";
};

const filenameFromImageUrl = (url) => {
  const fallbackBase = `image_${Date.now()}`;
  try {
    const parsed = new URL(url);
    const ext = extensionFromUrl(url, "jpg");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const lastPart = pathParts[pathParts.length - 1] || fallbackBase;
    const withoutExt = lastPart.replace(/\.[a-z0-9]+$/i, "");
    const safeBase = safeFilenamePart(withoutExt) || fallbackBase;
    return `${safeBase}.${ext}`;
  } catch (_error) {
    const ext = extensionFromUrl(url, "jpg");
    return `${fallbackBase}.${ext}`;
  }
};

const openOriginalImageInTab = async (url) => {
  if (!url) return { success: false, error: "No image URL available" };
  const resolved = resolveOriginalImageUrl(url);
  await chrome.tabs.create({ url: resolved });
  return { success: true, url: resolved };
};

const decodeUrlMaybe = (value) => {
  if (!value) return "";
  let current = String(value);
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch (_error) {
      break;
    }
  }
  return current;
};

const resolveOpenableSourceUrl = (rawUrl) => {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return "";

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";

    if (/xiaohongshu\.com$/i.test(host) && /^\/404(?:\/|$)/i.test(path)) {
      const redirectPath = decodeUrlMaybe(parsed.searchParams.get("redirectPath") || "");
      if (redirectPath) {
        try {
          const redirected = new URL(redirectPath, `${parsed.protocol}//${parsed.host}`);
          if (/^https?:$/i.test(redirected.protocol)) {
            return redirected.toString();
          }
        } catch (_error) {
          // Ignore parse failures and fall through.
        }
      }
    }

    return parsed.toString();
  } catch (_error) {
    return "";
  }
};

const openSourceUrlInTab = async (tabId, url) => {
  let sourceUrl = String(url || "");
  if (!sourceUrl && Number.isInteger(tabId)) {
    try {
      const tab = await chrome.tabs.get(tabId);
      sourceUrl = String(tab?.url || "");
    } catch (_error) {
      sourceUrl = "";
    }
  }
  if (!sourceUrl) return { success: false, error: "No source URL available" };
  const resolved = resolveOpenableSourceUrl(sourceUrl);
  if (!resolved) {
    return { success: false, error: "Invalid source URL" };
  }
  try {
    await chrome.tabs.create({ url: resolved });
    return { success: true, url: resolved };
  } catch (error) {
    return { success: false, error: error?.message || "Failed to open source URL" };
  }
};

const downloadOriginalImageByUrl = async (tabId, url) => {
  if (!url) return { success: false, error: "No image URL available" };

  const resolved = resolveOriginalImageUrl(url);
  const filename = filenameFromImageUrl(resolved);
  try {
    return await downloadByUrl(resolved, filename);
  } catch (directError) {
    try {
      const blob = await fetchBlob(resolved, 12000);
      return await downloadByBlob(blob, filename);
    } catch (blobError) {
      return {
        success: false,
        error: blobError?.message || directError?.message || "Download failed"
      };
    }
  }
};

const copyOriginalImageByUrl = async (tabId, url) => {
  if (!tabId) return { success: false, error: "No active tab id" };
  if (!url) return { success: false, error: "No image URL available" };

  const resolved = resolveOriginalImageUrl(url);
  const payload = await prepareClipboardPayload(
    {
      src: resolved,
      hdSrc: resolved,
      originalSrc: resolved,
      displaySrc: resolved
    },
    { preferredUrl: resolved, preferHD: true }
  );

  const response = await sendMessageToTab(tabId, {
    type: MSG.COPY_IMAGE_DATA_URL,
    payload: {
      dataUrl: payload?.success ? payload.dataUrl : "",
      fallbackUrl: resolved
    }
  });

  return {
    success: response?.success !== false,
    mode: response?.mode || (payload?.success ? "image" : "url"),
    url: resolved
  };
};

const openWorkspaceAndScan = async (tabId, options = {}) => {
  if (!tabId) return { success: false, error: "No active tab id" };
  const params = new URLSearchParams({
    tabId: String(tabId),
    autoScan: "1"
  });
  if (options.comicMode === true) {
    params.set("comicMode", "1");
  }
  const workspaceUrl = chrome.runtime.getURL(`workspace/workspace.html?${params.toString()}`);
  await chrome.tabs.create({ url: workspaceUrl });
  return { success: true };
};

// === Comic Pagination Page Loading (Experimental, Isolated) ===

const COMIC_PAGE_GRACE_MS = 500;

const waitForTabComplete = (tabId, timeoutMs = 30000) =>
  new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch { /* ignore */ }
      clearTimeout(timer);
    };
    const onUpdated = (id, info) => {
      if (id !== tabId || info.status !== "complete") return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => { cleanup(); resolve(); }, Math.max(5000, timeoutMs));
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId)
      .then((tab) => { if (tab?.status === "complete" && !settled) { cleanup(); resolve(); } })
      .catch(() => { cleanup(); resolve(); });
  });

const loadComicPaginationPages = async (sourceTabId, startUrl, options = {}) => {
  const maxPages = Math.max(1, Math.min(48, Number(options.limit) || 48));
  const waitMs = Math.max(1000, Math.min(30000, (Number(options.waitSeconds) || 6) * 1000));
  const results = [];
  const seen = new Set();
  let nextUrl = startUrl;

  while (nextUrl && results.length < maxPages) {
    if (seen.has(nextUrl)) break;
    seen.add(nextUrl);
    const url = nextUrl;
    nextUrl = null;
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await waitForTabComplete(tab.id, waitMs);
      await new Promise((r) => setTimeout(r, COMIC_PAGE_GRACE_MS));

      const scan = await sendMessageToTab(tab.id, { type: MSG.SCAN_IMAGES });
      if (scan?.success && Array.isArray(scan.images) && scan.images.length > 0) {
        const merge = stateManager.mergeImages(sourceTabId, scan.images);
        results.push({ url, success: true, added: merge.added || 0 });
      } else {
        results.push({ url, success: true, added: 0 });
      }

      const paginationResult = await sendMessageToTab(tab.id, { type: MSG.GET_COMIC_PAGINATION });
      if (paginationResult?.success && paginationResult.pagination?.supported && paginationResult.pagination.nextUrl) {
        nextUrl = paginationResult.pagination.nextUrl;
      }

      notifyImagesUpdated(sourceTabId);
    } catch (error) {
      results.push({ url, success: false, error: error?.message || "加载失败" });
    } finally {
      if (tab?.id) { try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ } }
    }
  }

  notifyImagesUpdated(sourceTabId);
  return { success: true, results, loadedPages: results.length };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
const withTimeout = (promise, timeoutMs, errorMessage) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(errorMessage || "操作超时"));
    }, Math.max(0, Number(timeoutMs) || 0));

    Promise.resolve(promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });

const notifyImagesUpdated = (tabId) => {
  if (!Number.isInteger(tabId)) return;
  chrome.runtime.sendMessage({
    type: MSG.IMAGES_UPDATED,
    payload: { tabId }
  }).catch(() => {});
};

const notifyAutoScrollStateChanged = (tabId, payload = {}) => {
  if (!Number.isInteger(tabId)) return;
  chrome.runtime.sendMessage({
    type: MSG.AUTO_SCROLL_STATE_CHANGED,
    payload: {
      tabId,
      ...payload
    }
  }).catch(() => {});
};

const safeFilenamePart = (text) =>
  String(text || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

const normalizeDomainForFolder = (domain) =>
  String(domain || "")
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

const baseFilename = (image, index = 0) => {
  const idPart = safeFilenamePart(image?.id || `img_${Date.now()}`);
  return index > 0 ? `${idPart}_${index}` : idPart;
};

const buildBatchZipFilename = async (tabId) => {
  const domain = normalizeDomainForFolder(await getTabHostname(tabId)) || "unknown";
  return `${domain}-${formatTimestampMinute()}-images.zip`;
};

const buildBatchZipPartFilename = (baseZipFilename, partIndex, totalParts) => {
  if (!Number.isInteger(totalParts) || totalParts <= 1) return baseZipFilename;
  const base = String(baseZipFilename || "images.zip");
  const withoutExt = base.replace(/\.zip$/i, "");
  const current = String(partIndex + 1).padStart(3, "0");
  return `${withoutExt}.part${current}.zip`;
};

const mimeToExtension = (mimeType, fallback = "jpg") => {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("svg")) return "svg";
  if (normalized.includes("avif")) return "avif";
  if (normalized.includes("bmp")) return "bmp";
  return fallback;
};

const ensureUniqueArchiveFilename = (filename, usedNames) => {
  const safe = safeFilenamePart(filename || "image") || "image";
  const match = safe.match(/^(.*?)(\.[a-z0-9]{1,8})$/i);
  const base = match ? match[1] : safe;
  const ext = match ? match[2] : "";
  if (!usedNames.has(safe)) {
    usedNames.add(safe);
    return safe;
  }
  let counter = 2;
  while (counter < 100000) {
    const candidate = `${base}_${counter}${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }
  const fallback = `${base}_${Date.now()}${ext}`;
  usedNames.add(fallback);
  return fallback;
};

const calculateCrc32 = (bytes) => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const toDosDateTime = (date = new Date()) => {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const month = Math.max(1, date.getMonth() + 1);
  const day = Math.max(1, date.getDate());
  const hour = Math.max(0, date.getHours());
  const minute = Math.max(0, date.getMinutes());
  const second = Math.max(0, date.getSeconds());

  const dosTime = ((hour & 0x1f) << 11) | ((minute & 0x3f) << 5) | ((Math.floor(second / 2)) & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
};

const createZipLocalHeader = ({ filenameBytes, crc32, size, dosTime, dosDate }) => {
  const buffer = new ArrayBuffer(30 + filenameBytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc32, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, filenameBytes.length, true);
  view.setUint16(28, 0, true);
  new Uint8Array(buffer, 30, filenameBytes.length).set(filenameBytes);
  return new Uint8Array(buffer);
};

const createZipCentralHeader = ({ filenameBytes, crc32, size, dosTime, dosDate, localOffset }) => {
  const buffer = new ArrayBuffer(46 + filenameBytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc32, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, filenameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localOffset, true);
  new Uint8Array(buffer, 46, filenameBytes.length).set(filenameBytes);
  return new Uint8Array(buffer);
};

const createZipEndRecord = ({ entries, centralSize, centralOffset }) => {
  const buffer = new ArrayBuffer(22);
  const view = new DataView(buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entries, true);
  view.setUint16(10, entries, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return new Uint8Array(buffer);
};

const buildZipBlob = (entries) => {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const filenameBytes = TEXT_ENCODER.encode(entry.filename);
    const size = entry.bytes.length >>> 0;
    const crc32 = calculateCrc32(entry.bytes);
    const { dosTime, dosDate } = toDosDateTime(entry.date || new Date());

    const localHeader = createZipLocalHeader({ filenameBytes, crc32, size, dosTime, dosDate });
    localParts.push(localHeader, entry.bytes);

    const centralHeader = createZipCentralHeader({
      filenameBytes,
      crc32,
      size,
      dosTime,
      dosDate,
      localOffset: offset
    });
    centralParts.push(centralHeader);
    offset += localHeader.length + size;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = createZipEndRecord({
    entries: entries.length,
    centralSize,
    centralOffset: offset
  });

  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
};

const getDownloadCandidates = (image, preferHD = true, preferredUrl = null) => {
  const first = preferHD ? image?.hdSrc || image?.src : image?.src || image?.hdSrc;
  const second = preferHD ? image?.src : image?.hdSrc;
  return [...new Set([preferredUrl, first, second, image?.originalSrc].filter(Boolean))];
};

const isNoReceiverError = (message) =>
  /Receiving end does not exist|Could not establish connection/i.test(String(message || ""));

const ensureContentScript = async (tabId) => {
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.__PIC_COLLECTOR_CONTENT_READY__)
    });
    const alreadyReady = Array.isArray(probe) && probe.some((item) => item?.result === true);
    if (alreadyReady) return;
  } catch (_error) {
    // Ignore probe failures and try direct injection.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/content.js"]
    });
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/has already been declared|Identifier .* already been declared/i.test(message)) {
      return;
    }
    throw error;
  }
};

const sendMessageToTab = async (tabId, message, options = {}) => {
  const retryOnNoReceiver = options.retryOnNoReceiver !== false;
  if (!tabId) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const errorMessage = error?.message || String(error);
    if (retryOnNoReceiver && isNoReceiverError(errorMessage)) {
      try {
        await ensureContentScript(tabId);
        return await chrome.tabs.sendMessage(tabId, message);
      } catch (retryError) {
        return { success: false, error: retryError?.message || String(retryError) };
      }
    }
    return { success: false, error: errorMessage };
  }
};

const fetchBlob = async (url, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseOptions = {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow"
    };

    const tryFetch = async (extraOptions = {}) => {
      const response = await fetch(url, { ...baseOptions, ...extraOptions });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.blob();
    };

    const isSinaImage = (() => {
      try {
        const parsed = new URL(url);
        return /\.sinaimg\.cn$/i.test(parsed.hostname);
      } catch (_error) {
        return false;
      }
    })();

    try {
      return await tryFetch();
    } catch (error) {
      if (!isSinaImage) throw error;
      // 微博图床经常要求 Referer，扩展上下文请求容易 403。
      return await tryFetch({
        referrer: "https://weibo.com/",
        referrerPolicy: "strict-origin-when-cross-origin"
      });
    }
  } finally {
    clearTimeout(timer);
  }
};

const arrayBufferToBase64 = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const blobToDataUrl = async (blob, fallbackMime = "application/octet-stream") => {
  const arrayBuffer = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const mime = blob.type || fallbackMime;
  return `data:${mime};base64,${base64}`;
};

const convertBlobToJpg = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: JPG_CONVERT_QUALITY });
  } finally {
    bitmap.close();
  }
};

const convertBlobToPng = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
};

const probeImageDimensions = async (url) => {
  if (!url || typeof url !== "string") {
    return { success: false, error: "Invalid image URL" };
  }
  try {
    const blob = await fetchBlob(url);
    if (!blob) {
      return { success: false, error: "Empty blob" };
    }
    const bitmap = await createImageBitmap(blob);
    try {
      return {
        success: true,
        width: Number(bitmap.width) || 0,
        height: Number(bitmap.height) || 0
      };
    } finally {
      bitmap.close();
    }
  } catch (error) {
    return {
      success: false,
      error: error?.message || "Probe failed",
      width: 0,
      height: 0
    };
  }
};

const downloadByUrl = async (url, filename, options = {}) => {
  const awaitCompletion = options.awaitCompletion === true;
  const requireNonZeroSize = options.requireNonZeroSize === true;
  const downloadTimeoutMs = Number(options.downloadTimeoutMs) > 0
    ? Number(options.downloadTimeoutMs)
    : 20 * 60 * 1000;
  const targetFilename = String(filename || "").replace(/^[/\\]+/, "");
  const urlKey = String(url || "");
  let shouldCleanupHint = false;
  if (options.overrideFilenameByUrl === true) {
    pendingFilenameHints.set(urlKey, {
      filename: targetFilename,
      conflictAction: "uniquify"
    });
    shouldCleanupHint = true;
  }

  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url,
      filename: targetFilename,
      saveAs: false,
      conflictAction: "uniquify"
    });
  } catch (error) {
    if (shouldCleanupHint) {
      pendingFilenameHints.delete(urlKey);
    }
    throw error;
  }

  if (awaitCompletion) {
    const terminal = await waitForDownloadTerminal(downloadId, downloadTimeoutMs);
    if (terminal.state !== "complete") {
      if (shouldCleanupHint) {
        pendingFilenameHints.delete(urlKey);
      }
      throw new Error(`Download ${terminal.state}${terminal.error ? `: ${terminal.error}` : ""}`);
    }
    if (requireNonZeroSize && Number(terminal.fileSize) <= 0) {
      const confirmedSize = await waitForDownloadNonZeroSize(downloadId);
      if (confirmedSize > 0) {
        return { success: true, downloadId, url };
      }
      if (shouldCleanupHint) {
        pendingFilenameHints.delete(urlKey);
      }
      throw new Error("Download complete but file is empty");
    }
  }

  if (shouldCleanupHint) {
    if (awaitCompletion) {
      pendingFilenameHints.delete(urlKey);
    } else {
      setTimeout(() => {
        pendingFilenameHints.delete(urlKey);
      }, 5 * 60 * 1000);
    }
  }

  return { success: true, downloadId, url };
};

const downloadBlobAsFile = async (
  blob,
  filename,
  fallbackMime = "application/octet-stream",
  options = {}
) => {
  const awaitCompletion = options.awaitCompletion === true;
  const revokeDelayMs = Number(options.objectUrlRevokeDelayMs) > 0
    ? Number(options.objectUrlRevokeDelayMs)
    : 5 * 60 * 1000;
  const canUseObjectUrl =
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof URL.revokeObjectURL === "function";

  if (canUseObjectUrl && options.forceDataUrl !== true) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await downloadByUrl(objectUrl, filename, {
        overrideFilenameByUrl: options.overrideFilenameByUrl === true,
        awaitCompletion,
        downloadTimeoutMs: options.downloadTimeoutMs,
        requireNonZeroSize: options.requireNonZeroSize === true
      });
    } finally {
      const revoke = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_error) {
          // Ignore revoke errors.
        }
      };
      setTimeout(revoke, awaitCompletion ? 30 * 1000 : revokeDelayMs);
    }
  }

  const dataUrl = await blobToDataUrl(blob, fallbackMime);
  return await downloadByUrl(dataUrl, filename, {
    overrideFilenameByUrl: options.overrideFilenameByUrl === true,
    awaitCompletion,
    downloadTimeoutMs: options.downloadTimeoutMs,
    requireNonZeroSize: options.requireNonZeroSize === true
  });
};

const downloadByBlob = async (blob, filename) => {
  return await downloadBlobAsFile(blob, filename, "image/jpeg");
};

const shouldConvertToJpg = (mimeType, url) => {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return false;
  if (type.includes("gif") || type.includes("svg")) return false;

  const format = formatFromUrl(url);
  if (format === "jpg" || format === "jpeg") return false;
  if (format === "gif" || format === "svg") return false;

  return true;
};

const buildZipEntryFromImage = async (image, options = {}) => {
  const { convertToJpg = false, index = 0, preferHD = true } = options;
  const candidates = getDownloadCandidates(image, preferHD);
  if (candidates.length === 0) {
    return { success: false, error: "No image URL available", fallbackUsed: false };
  }

  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const url = candidates[i];
    try {
      let blob = await fetchBlob(url);
      let filename = "";
      let converted = false;

      const type = String(blob.type || "").toLowerCase() || mimeFromFormat(formatFromUrl(url)).toLowerCase();
      if (convertToJpg && shouldConvertToJpg(type, url)) {
        try {
          blob = await convertBlobToJpg(blob);
          filename = `${baseFilename(image, index)}.jpg`;
          converted = true;
        } catch (_convertError) {
          // Conversion failure should not break ZIP download; fallback to original blob.
          const extFromUrl = extensionFromUrl(url, "");
          const ext = extFromUrl || mimeToExtension(blob.type, "jpg");
          filename = `${baseFilename(image, index)}.${ext}`;
        }
      } else {
        const extFromUrl = extensionFromUrl(url, "");
        const ext = extFromUrl || mimeToExtension(blob.type, "jpg");
        filename = `${baseFilename(image, index)}.${ext}`;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length === 0) {
        lastError = new Error("Empty image data");
        continue;
      }

      return {
        success: true,
        filename,
        bytes,
        converted,
        fallbackUsed: i > 0
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    success: false,
    error: lastError?.message || "Download failed",
    fallbackUsed: false
  };
};

const finalizeZipPartDownload = async (tabId, entries, options = {}) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { success: true, partFilename: "" };
  }

  const partIndex = Number.isInteger(options.partIndex) ? options.partIndex : 0;
  const baseZipFilename = String(options.baseZipFilename || "images.zip");
  const partLabel = `${partIndex + 1}`;

  emitDownloadStatus(tabId, {
    active: true,
    mode: "zip",
    phase: "zip_part_build",
    partIndex: partIndex + 1
  });

  const partFilename = buildBatchZipPartFilename(baseZipFilename, partIndex, Number(options.partCount) || 1);
  const zipBlob = buildZipBlob(entries);
  if (!zipBlob || Number(zipBlob.size) <= 0) {
    return {
      success: false,
      error: `ZIP第 ${partLabel} 卷构建失败: Empty zip blob`,
      partFilename
    };
  }

  emitDownloadStatus(tabId, {
    active: true,
    mode: "zip",
    phase: "zip_part_download",
    partIndex: partIndex + 1
  });

  try {
    await downloadBlobAsFile(zipBlob, partFilename, "application/zip", {
      overrideFilenameByUrl: true,
      awaitCompletion: true,
      downloadTimeoutMs: 30 * 60 * 1000,
      requireNonZeroSize: true
    });
    return { success: true, partFilename };
  } catch (error) {
    return {
      success: false,
      error: `ZIP第 ${partLabel} 卷下载失败: ${error?.message || "未知错误"}`,
      partFilename
    };
  }
};

const downloadBatchAsZip = async (tabId, selectedImages, options = {}) => {
  const { convertToJpg = false, preferHD = true } = options;
  const results = [];
  const usedNames = new Set();
  const totalSelected = Number(selectedImages.length) || 0;
  const baseZipFilename = await buildBatchZipFilename(tabId);
  const zipFileNames = [];
  const currentPartEntries = [];
  let currentPartBytes = 0;
  let downloadedParts = 0;
  let packedCount = 0;

  const flushCurrentPart = async (expectMoreParts = false) => {
    if (currentPartEntries.length === 0) {
      return { success: true };
    }

    const entriesToFlush = currentPartEntries.splice(0, currentPartEntries.length);
    currentPartBytes = 0;
    const result = await finalizeZipPartDownload(tabId, entriesToFlush, {
      baseZipFilename,
      partIndex: downloadedParts,
      partCount: expectMoreParts ? downloadedParts + 2 : downloadedParts + 1
    });
    if (!result.success) {
      emitDownloadStatus(tabId, {
        active: false,
        mode: "zip",
        phase: "failed",
        current: packedCount,
        total: selectedImages.length,
        partIndex: downloadedParts + 1,
        partCount: zipFileNames.length + 1,
        error: result.error
      });
      return {
        success: false,
        error: result.error,
        zipped: true,
        zipPartCount: zipFileNames.length + 1,
        downloadedPartCount: downloadedParts,
        zipFileNames,
        packed: packedCount,
        failed: selectedImages.length - packedCount,
        results
      };
    }

    zipFileNames.push(result.partFilename);
    downloadedParts += 1;
    await timeout(0);
    return { success: true };
  };

  for (let i = 0; i < selectedImages.length; i += 1) {
    const image = selectedImages[i];
    const entryResult = await buildZipEntryFromImage(image, {
      convertToJpg,
      preferHD,
      index: i + 1
    });

    if (image.id && image.hdSrc && image.hdSrc !== image.src) {
      stateManager.markHdRejected(tabId, image.id, entryResult.fallbackUsed === true);
    }

    if (entryResult.success) {
      const uniqueName = ensureUniqueArchiveFilename(entryResult.filename, usedNames);
      const entryBytes = Number(entryResult.bytes?.length) || 0;
      const willOverflowByFiles = currentPartEntries.length >= ZIP_PART_MAX_FILES;
      const willOverflowByBytes =
        currentPartEntries.length > 0 &&
        currentPartBytes + entryBytes > ZIP_PART_MAX_BYTES;

      if (willOverflowByFiles || willOverflowByBytes) {
        const flushResult = await flushCurrentPart(true);
        if (!flushResult.success) {
          return flushResult;
        }
      }

      currentPartEntries.push({
        filename: uniqueName,
        bytes: entryResult.bytes,
        date: new Date()
      });
      currentPartBytes += entryBytes;
      packedCount += 1;
      results.push({
        imageId: image.id,
        success: true,
        converted: entryResult.converted,
        fallbackUsed: entryResult.fallbackUsed
      });
    } else {
      results.push({
        imageId: image.id,
        success: false,
        error: entryResult.error || "Download failed",
        fallbackUsed: entryResult.fallbackUsed === true
      });
    }

    emitDownloadStatus(tabId, {
      active: true,
      mode: "zip",
      current: i + 1,
      total: selectedImages.length,
      phase: "zip",
      partIndex: downloadedParts + 1,
      result: {
        success: entryResult.success === true,
        converted: entryResult.converted === true,
        fallbackUsed: entryResult.fallbackUsed === true,
        filename: entryResult.filename || "",
        error: entryResult.error ? String(entryResult.error).slice(0, 200) : ""
      }
    });
  }

  if (packedCount === 0) {
    emitDownloadStatus(tabId, {
      active: false,
      mode: "zip",
      phase: "failed",
      current: 0,
      total: selectedImages.length,
      error: "未能获取可打包的图片"
    });
    return { success: false, error: "未能获取可打包的图片", results, zipped: true };
  }

  const finalFlushResult = await flushCurrentPart(false);
  if (!finalFlushResult.success) {
    return finalFlushResult;
  }

  emitDownloadStatus(tabId, {
    active: false,
    mode: "zip",
    phase: "completed",
    current: selectedImages.length,
    total: selectedImages.length,
    partIndex: zipFileNames.length,
    partCount: zipFileNames.length,
    error: ""
  });

  return {
    success: true,
    zipped: true,
    zipFileName: zipFileNames[0] || baseZipFilename,
    zipFileNames,
    zipPartCount: zipFileNames.length,
    splitZip: zipFileNames.length > 1,
    packed: packedCount,
    failed: selectedImages.length - packedCount,
    results
  };
};

const downloadImage = async (image, options = {}) => {
  const { convertToJpg = false, index = 0, preferHD = true } = options;
  const candidates = getDownloadCandidates(image, preferHD);
  if (candidates.length === 0) {
    return { success: false, error: "No image URL available", fallbackUsed: false };
  }

  let lastError = null;
  const jpgBaseName = `${baseFilename(image, index)}.jpg`;

  if (convertToJpg) {
    for (let i = 0; i < candidates.length; i += 1) {
      const url = candidates[i];
      try {
        const blob = await fetchBlob(url);
        const type = String(blob.type || "").toLowerCase() || mimeFromFormat(formatFromUrl(url)).toLowerCase();
        if (shouldConvertToJpg(type, url)) {
          const jpgBlob = await convertBlobToJpg(blob);
          try {
            return {
              ...(await downloadByBlob(jpgBlob, jpgBaseName)),
              converted: true,
              fallbackUsed: i > 0
            };
          } catch (downloadError) {
            // Conversion result download failed, continue and fallback to direct URL.
            lastError = downloadError;
          }
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const url = candidates[i];
    const ext = extensionFromUrl(url, "jpg");
    const filename = `${baseFilename(image, index)}.${ext}`;
    try {
      return {
        ...(await downloadByUrl(url, filename)),
        converted: false,
        fallbackUsed: i > 0
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    success: false,
    error: lastError?.message || "Download failed",
    fallbackUsed: false
  };
};

const prepareClipboardPayload = async (image, options = {}) => {
  const preferredUrl = options?.preferredUrl || null;
  const preferHD = options?.preferHD === true;
  const candidates = getDownloadCandidates(image, preferHD, preferredUrl);
  if (candidates.length === 0) {
    return { success: false, error: "COPY_URL_ONLY", url: "" };
  }

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    try {
      let blob = await fetchBlob(candidate, 10000);
      let mime =
        String(blob.type || "").toLowerCase() ||
        mimeFromFormat(formatFromUrl(candidate)).toLowerCase();

      if (!mime.startsWith("image/")) {
        const fromUrl = mimeFromFormat(formatFromUrl(candidate));
        mime = fromUrl || "image/png";
      }

      // Clipboard 写入在 Chrome 里对 PNG 兼容性最好，统一转成 PNG。
      const pngBlob = await convertBlobToPng(blob);
      const dataUrl = await blobToDataUrl(pngBlob, "image/png");
      return {
        success: true,
        dataUrl,
        mime: "image/png",
        sourceUrl: candidate,
        fallbackUsed: i > 0
      };
    } catch (_error) {
      // Continue fallback candidates.
    }
  }

  const fallbackUrl = candidates[0];
  return { success: false, error: "COPY_URL_ONLY", url: fallbackUrl };
};

const getTabIdFromMessage = (message, sender) => {
  if (Number.isInteger(message?.tabId)) return message.tabId;
  if (Number.isInteger(sender?.tab?.id)) return sender.tab.id;
  return null;
};

const withDisplaySource = (image, enableHD) => {
  const useHd = enableHD && image.hdSrc && image.hdSrc !== image.src && !image.hdRejected;
  const area = Number(image.area) || ((Number(image.width) || 0) * (Number(image.height) || 0));
  const isHighResolution = area >= 1280 * 720;
  const hasLargerCandidate = Boolean(image.hdSrc && image.hdSrc !== image.src && !image.hdRejected);
  return {
    ...image,
    displaySrc: useHd ? image.hdSrc : image.src,
    isHD: hasLargerCandidate || isHighResolution
  };
};

const runScanForTab = async (tabId) => {
  stateManager.setScanning(tabId, true);
  try {
    const response = await sendMessageToTab(tabId, { type: MSG.SCAN_IMAGES });
    if (!response?.success) {
      const error = response?.error || "Content script unavailable";
      return { success: false, error };
    }

    const merge = stateManager.mergeImages(tabId, response.images || []);
    notifyImagesUpdated(tabId);
    return {
      success: true,
      ...merge
    };
  } finally {
    stateManager.setScanning(tabId, false);
  }
};

const syncRightClickForTab = async (tabId, enabled, options = {}) => {
  const result = await sendMessageToTab(tabId, {
    type: MSG.TOGGLE_RIGHT_CLICK,
    enabled: enabled === true
  }, options);
  return {
    success: result?.success === true,
    error: result?.error || "同步右键解锁状态失败"
  };
};

const syncAutoScrollForTab = async (tabId, enabled, options = {}) => {
  const result = await sendMessageToTab(tabId, {
    type: enabled === true ? MSG.START_AUTO_SCROLL : MSG.STOP_AUTO_SCROLL,
    payload: enabled === true && options.profile ? { profile: options.profile } : {}
  }, options);
  return {
    success: result?.success === true,
    error: result?.error || "同步自动滚动状态失败"
  };
};

const focusSourceTabAndStartAutoScroll = async (tabId) => {
  if (!Number.isInteger(tabId)) {
    return { success: false, error: "No active tab id" };
  }

  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch (error) {
    return { success: false, error: error?.message || "切换原网页失败" };
  }

  const autoScanResult = await sendMessageToTab(tabId, {
    type: MSG.START_AUTO_SCAN
  }, { retryOnNoReceiver: false });

  const autoScrollResult = await sendMessageToTab(tabId, {
    type: MSG.START_AUTO_SCROLL,
    payload: { profile: "comic" }
  }, { retryOnNoReceiver: false });

  if (autoScrollResult?.success !== false) {
    notifyAutoScrollStateChanged(tabId, {
      enabled: true,
      reason: "workspace_jump",
      finished: false
    });
  }

  return {
    success: autoScrollResult?.success !== false,
    autoScanSuccess: autoScanResult?.success !== false,
    error: autoScrollResult?.error || ""
  };
};

const handleMessage = async (message, sender) => {
  await stateManager.ensureReady();
  const tabId = getTabIdFromMessage(message, sender);
  const payload = message?.payload || {};

  switch (message?.type) {
    case MSG.OPEN_DOWNLOAD_DIRECTORY: {
      try {
        if (typeof chrome.downloads.showDefaultFolder === "function") {
          chrome.downloads.showDefaultFolder();
          return { success: true };
        }
        await chrome.tabs.create({ url: "chrome://downloads/" });
        return { success: true };
      } catch (error) {
        return { success: false, error: error?.message || "打开下载目录失败" };
      }
    }

    case MSG.OPEN_SOURCE_URL: {
      const sourceUrl = payload.url || message.url || "";
      return await openSourceUrlInTab(tabId, sourceUrl);
    }

    case MSG.FOCUS_SOURCE_TAB_AND_START_AUTO_SCROLL: {
      return await focusSourceTabAndStartAutoScroll(tabId);
    }

    case MSG.SCAN: {
      if (!tabId) return { success: false, error: "No active tab id" };
      return await runScanForTab(tabId);
    }

    case MSG.INCREMENTAL_SCAN: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const images = payload.images || message.images || [];
      if (!Array.isArray(images)) {
        return { success: false, error: "Invalid incremental payload" };
      }
      const merged = stateManager.mergeImages(tabId, images);
      if ((merged.added || 0) > 0 || (merged.updated || 0) > 0) {
        notifyImagesUpdated(tabId);
      }
      return { success: true, ...merged };
    }

    case MSG.AUTO_SCROLL_STOPPED: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const config = stateManager.getConfig(tabId);
      if (config.enableAutoScroll === true) {
        stateManager.setConfig(tabId, { enableAutoScroll: false });
      }
      notifyAutoScrollStateChanged(tabId, {
        enabled: false,
        reason: String(payload.reason || "complete"),
        finished: true
      });
      return { success: true };
    }

    case MSG.GET_IMAGES: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const config = stateManager.getConfig(tabId);
      const images = stateManager.getAllImages(tabId);
      return {
        success: true,
        images: images.map((image) => withDisplaySource(image, config.enableHD)),
        count: images.length
      };
    }

    case MSG.TOGGLE_SELECT: {
      if (!tabId) return { success: false, error: "No active tab id" };
      return {
        success: true,
        selectedIds: stateManager.toggleSelectImage(tabId, payload.imageId)
      };
    }

    case MSG.SET_SELECTION: {
      if (!tabId) return { success: false, error: "No active tab id" };
      return {
        success: true,
        selectedIds: stateManager.setSelectionByIds(
          tabId,
          Array.isArray(payload.imageIds) ? payload.imageIds : [],
          payload.selected !== false
        )
      };
    }

    case MSG.GET_SELECTED: {
      if (!tabId) return { success: false, error: "No active tab id" };
      return { success: true, images: stateManager.getSelectedImages(tabId) };
    }

    case MSG.GET_STATS: {
      if (!tabId) return { success: false, error: "No active tab id" };
      return { success: true, stats: stateManager.getStats(tabId) };
    }

    case MSG.CLEAR_IMAGES: {
      if (!tabId) return { success: false, error: "No active tab id" };
      stateManager.clearTabImages(tabId);
      await sendMessageToTab(tabId, {
        type: MSG.CLEAR_RUNTIME_CACHE
      }, { retryOnNoReceiver: false });
      notifyImagesUpdated(tabId);
      return { success: true };
    }

    case MSG.DOWNLOAD: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const image = payload.image;
      if (!image) return { success: false, error: "No image data provided" };

      const config = stateManager.getConfig(tabId);
      const result = await downloadImage(image, {
        convertToJpg: config.enableWebPConvert,
        preferHD: config.enableHD
      });
      if (image.id && image.hdSrc && image.hdSrc !== image.src) {
        stateManager.markHdRejected(tabId, image.id, result.fallbackUsed === true);
      }
      return result;
    }

    case MSG.DOWNLOAD_BATCH: {
      if (!tabId) return { success: false, error: "No active tab id" };
      if (activeBatchDownloads.has(tabId)) {
        return { success: false, error: "当前已有批量下载任务进行中，请稍后再试" };
      }

      const selected = stateManager.getSelectedImages(tabId);
      if (selected.length === 0) return { success: false, error: "No selected images" };

      const config = stateManager.getConfig(tabId);
      const convertToJpg = typeof payload.enableConvertToJpg === "boolean"
        ? payload.enableConvertToJpg
        : config.enableWebPConvert === true;
      const useZip =
        isTruthyFlag(payload.enableBatchZipDownload) ||
        isTruthyFlag(payload.enableBatchZip) ||
        isTruthyFlag(payload.zip) ||
        String(payload.downloadMode || payload.mode || "").toLowerCase() === "zip";

      activeBatchDownloads.add(tabId);
      try {
        if (useZip) {
          emitDownloadStatus(tabId, {
            active: true,
            mode: "zip",
            phase: "zip_prepare",
            current: 0,
            total: selected.length,
            partIndex: 0,
            partCount: 0,
            error: ""
          });
          return await downloadBatchAsZip(tabId, selected, {
            convertToJpg,
            preferHD: config.enableHD
          });
        }

        emitDownloadStatus(tabId, {
          active: true,
          mode: "direct",
          phase: "direct_prepare",
          current: 0,
          total: selected.length,
          error: ""
        });

        const results = [];
        for (let i = 0; i < selected.length; i += 1) {
          const image = selected[i];
          const result = await downloadImage(image, {
            convertToJpg,
            index: i + 1,
            preferHD: config.enableHD
          });
          if (image.id && image.hdSrc && image.hdSrc !== image.src) {
            stateManager.markHdRejected(tabId, image.id, result.fallbackUsed === true);
          }
          results.push({ imageId: image.id, ...result });

          emitDownloadStatus(tabId, {
            active: true,
            mode: "direct",
            phase: "direct",
            current: i + 1,
            total: selected.length,
            result
          });

          if (i < selected.length - 1) {
            await timeout(120);
          }
        }

        emitDownloadStatus(tabId, {
          active: false,
          mode: "direct",
          phase: "completed",
          current: selected.length,
          total: selected.length,
          error: ""
        });

        return {
          success: true,
          results,
          zipped: false
        };
      } catch (error) {
        emitDownloadStatus(tabId, {
          active: false,
          mode: useZip ? "zip" : "direct",
          phase: "failed",
          error: error?.message || "批量下载失败"
        });
        throw error;
      } finally {
        activeBatchDownloads.delete(tabId);
      }
    }

    case MSG.COPY_TO_CLIPBOARD: {
      const image = payload.image;
      if (!image) return { success: false, error: "No image URL available" };
      return await prepareClipboardPayload(image, {
        preferredUrl: payload.preferredUrl,
        preferHD: payload.preferHD === true
      });
    }

    case MSG.PROBE_IMAGE_DIMENSIONS: {
      const url = String(payload.url || message.url || "");
      return await probeImageDimensions(url);
    }

    case MSG.SET_CONFIG: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const previousConfig = stateManager.getConfig(tabId);
      const config = stateManager.setConfig(tabId, payload);

      if (Object.prototype.hasOwnProperty.call(payload, "enableRightClick")) {
        const rightClickResult = await syncRightClickForTab(tabId, config.enableRightClick);
        if (!rightClickResult.success) {
          const restoredConfig = stateManager.setConfig(tabId, {
            enableRightClick: previousConfig.enableRightClick === true
          });
          return {
            success: false,
            error: rightClickResult.error,
            config: restoredConfig
          };
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, "enableAutoScan")) {
        const autoScanResult = await sendMessageToTab(tabId, {
          type: config.enableAutoScan ? MSG.START_AUTO_SCAN : MSG.STOP_AUTO_SCAN
        });
        if (autoScanResult?.success !== true) {
          const restoredConfig = stateManager.setConfig(tabId, {
            enableAutoScan: previousConfig.enableAutoScan === true
          });
          return {
            success: false,
            error: autoScanResult?.error || "同步自动采集运行状态失败",
            config: restoredConfig
          };
        }
      }

      if (Object.prototype.hasOwnProperty.call(payload, "enableAutoScroll")) {
        const autoScrollResult = await syncAutoScrollForTab(tabId, config.enableAutoScroll);
        if (!autoScrollResult.success) {
          const restoredConfig = stateManager.setConfig(tabId, {
            enableAutoScroll: previousConfig.enableAutoScroll === true
          });
          return {
            success: false,
            error: autoScrollResult.error,
            config: restoredConfig
          };
        }
        notifyAutoScrollStateChanged(tabId, {
          enabled: config.enableAutoScroll === true,
          reason: config.enableAutoScroll === true ? "manual_start" : "manual_stop",
          finished: false
        });
      }

      return { success: true, config };
    }

    case MSG.GET_CONFIG: {
      if (!tabId) return { success: false, error: "No active tab id" };
      return { success: true, config: stateManager.getConfig(tabId) };
    }

    case MSG.GET_COMIC_SEQUENCE: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const result = await sendMessageToTab(tabId, { type: MSG.GET_COMIC_SEQUENCE });
      if (!result?.success) {
        return { success: false, error: result?.error || "获取漫画顺序失败" };
      }
      return {
        success: true,
        sequence: Array.isArray(result.sequence) ? result.sequence : []
      };
    }

    case MSG.GET_COMIC_PAGINATION: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const result = await sendMessageToTab(tabId, { type: MSG.GET_COMIC_PAGINATION });
      if (!result?.success) {
        return { success: false, error: result?.error || "获取分页信息失败" };
      }
      return { success: true, pagination: result.pagination || { supported: false } };
    }

    case MSG.LOAD_COMIC_PAGINATION_PAGES: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const startUrl = payload.nextUrl;
      if (!startUrl) return { success: false, error: "No next URL provided" };
      return await loadComicPaginationPages(tabId, startUrl, {
        limit: payload.limit,
        waitSeconds: payload.waitSeconds
      });
    }

    case MSG.GET_DOWNLOAD_STATUS: {
      if (!tabId) return { success: false, error: "No active tab id" };
      return { success: true, status: getDownloadStatus(tabId) };
    }

    case MSG.TOGGLE_RIGHT_CLICK: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const previousConfig = stateManager.getConfig(tabId);
      const enabled = payload.enabled === true || payload === true;
      const config = stateManager.setConfig(tabId, { enableRightClick: enabled });
      const result = await syncRightClickForTab(tabId, config.enableRightClick);
      if (!result.success) {
        const restoredConfig = stateManager.setConfig(tabId, {
          enableRightClick: previousConfig.enableRightClick === true
        });
        return {
          success: false,
          error: result.error,
          enabled: restoredConfig.enableRightClick
        };
      }

      return { success: true, enabled: config.enableRightClick };
    }

    case MSG.START_AUTO_SCAN: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const result = await sendMessageToTab(tabId, { type: MSG.START_AUTO_SCAN });
      return { success: result?.success !== false };
    }

    case MSG.STOP_AUTO_SCAN: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const result = await sendMessageToTab(tabId, { type: MSG.STOP_AUTO_SCAN });
      return { success: result?.success !== false };
    }

    case MSG.START_AUTO_SCROLL: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const result = await sendMessageToTab(tabId, {
        type: MSG.START_AUTO_SCROLL,
        payload: payload.profile ? { profile: payload.profile } : {}
      });
      return { success: result?.success !== false };
    }

    case MSG.STOP_AUTO_SCROLL: {
      if (!tabId) return { success: false, error: "No active tab id" };
      const result = await sendMessageToTab(tabId, { type: MSG.STOP_AUTO_SCROLL });
      return { success: result?.success !== false };
    }

    default:
      return { success: false, error: `Unknown message type: ${message?.type}` };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        success: false,
        error: error?.message || String(error)
      });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stateManager.removeTabState(tabId);
  batchDownloadStatusByTab.delete(tabId);
  activeBatchDownloads.delete(tabId);
});

const handleTabUpdated = async (tabId, changeInfo) => {
  if (!Number.isInteger(tabId) || !changeInfo?.status) return;

  await stateManager.ensureReady();

  if (changeInfo.status === "loading") {
    stateManager.clearTabImages(tabId);
    return;
  }

  if (changeInfo.status !== "complete") return;

  const config = stateManager.getConfig(tabId);
  if (config.enableRightClick) {
    await syncRightClickForTab(tabId, true);
  }

  if (config.enableAutoScan) {
    await runScanForTab(tabId).catch(() => ({ success: false }));
    await sendMessageToTab(tabId, { type: MSG.START_AUTO_SCAN }, { retryOnNoReceiver: false });
  }

  if (config.enableAutoScroll) {
    await sendMessageToTab(tabId, { type: MSG.START_AUTO_SCROLL }, { retryOnNoReceiver: false });
  }
};

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  handleTabUpdated(tabId, changeInfo).catch(() => {});
});

let contextMenuBuildTask = null;

const isContextMenuNotFoundError = (message) =>
  /Cannot find menu item with id|No item with id|not found/i.test(String(message || ""));

const createContextMenuItem = (options) =>
  new Promise((resolve) => {
    chrome.contextMenus.create(options, () => {
      const error = chrome.runtime.lastError;
      if (error && !/duplicate id/i.test(String(error.message || ""))) {
        console.warn("[图片采集查看器] context menu create failed:", error.message);
      }
      resolve();
    });
  });

const updateContextMenuItem = (id, updateProperties) =>
  new Promise((resolve) => {
    chrome.contextMenus.update(id, updateProperties, () => {
      const error = chrome.runtime.lastError;
      if (!error) {
        resolve(true);
        return;
      }

      const message = String(error.message || "");
      if (isContextMenuNotFoundError(message)) {
        resolve(false);
        return;
      }

      console.warn("[图片采集查看器] context menu update failed:", message);
      resolve(false);
    });
  });

const upsertContextMenuItem = async (options) => {
  const { id, ...updateProperties } = options;
  const updated = await updateContextMenuItem(id, updateProperties);
  if (updated) return;
  await createContextMenuItem(options);
};

const createContextMenu = async () => {
  if (contextMenuBuildTask) return contextMenuBuildTask;

  contextMenuBuildTask = (async () => {
    await upsertContextMenuItem({
      id: CONTEXT_MENU_IDS.SCAN_OPEN_WORKSPACE,
      title: "扫描当前页面图片",
      contexts: ["page"]
    });

    await upsertContextMenuItem({
      id: CONTEXT_MENU_IDS.SCAN_OPEN_WORKSPACE_COMIC,
      title: "扫描当前页面图片（漫画模式）",
      contexts: ["page"]
    });

    await upsertContextMenuItem({
      id: CONTEXT_MENU_IDS.IMAGE_ACTIONS_PARENT,
      title: "图片操作",
      contexts: ["image"]
    });

    await upsertContextMenuItem({
      id: CONTEXT_MENU_IDS.VIEW_ORIGINAL_IMAGE,
      title: "查看原图",
      contexts: ["image"],
      parentId: CONTEXT_MENU_IDS.IMAGE_ACTIONS_PARENT
    });

    await upsertContextMenuItem({
      id: CONTEXT_MENU_IDS.COPY_ORIGINAL_IMAGE,
      title: "复制原图",
      contexts: ["image"],
      parentId: CONTEXT_MENU_IDS.IMAGE_ACTIONS_PARENT
    });

    await upsertContextMenuItem({
      id: CONTEXT_MENU_IDS.DOWNLOAD_ORIGINAL_IMAGE,
      title: "下载原图",
      contexts: ["image"],
      parentId: CONTEXT_MENU_IDS.IMAGE_ACTIONS_PARENT
    });
  })()
    .catch((error) => {
      console.warn("[图片采集查看器] createContextMenu failed:", error);
    })
    .finally(() => {
      contextMenuBuildTask = null;
    });

  return contextMenuBuildTask;
};

chrome.runtime.onInstalled.addListener(() => {
  ensureSinaimgRefererRule().catch(() => {});
  createContextMenu().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureSinaimgRefererRule().catch(() => {});
  createContextMenu().catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === CONTEXT_MENU_IDS.SCAN_OPEN_WORKSPACE) {
    await openWorkspaceAndScan(tab.id);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.SCAN_OPEN_WORKSPACE_COMIC) {
    await openWorkspaceAndScan(tab.id, { comicMode: true });
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.VIEW_ORIGINAL_IMAGE) {
    const contextUrl = pickContextImageUrl(info);
    await openOriginalImageInTab(contextUrl);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.COPY_ORIGINAL_IMAGE) {
    const contextUrl = pickContextImageUrl(info);
    await copyOriginalImageByUrl(tab.id, contextUrl);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.DOWNLOAD_ORIGINAL_IMAGE) {
    const contextUrl = pickContextImageUrl(info);
    await downloadOriginalImageByUrl(tab.id, contextUrl);
  }
});

ensureSinaimgRefererRule().catch(() => {});
