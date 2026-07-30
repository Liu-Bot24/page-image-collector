const MSG = {
  SCAN: "SCAN",
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
  START_AUTO_SCAN: "START_AUTO_SCAN",
  STOP_AUTO_SCAN: "STOP_AUTO_SCAN",
  IMAGES_UPDATED: "IMAGES_UPDATED",
  AUTO_SCROLL_STATE_CHANGED: "AUTO_SCROLL_STATE_CHANGED",
  DOWNLOAD_PROGRESS: "DOWNLOAD_PROGRESS",
  PROBE_IMAGE_DIMENSIONS: "PROBE_IMAGE_DIMENSIONS",
  UPDATE_IMAGE_METADATA: "UPDATE_IMAGE_METADATA",
  OPEN_DOWNLOAD_DIRECTORY: "OPEN_DOWNLOAD_DIRECTORY",
  OPEN_SOURCE_URL: "OPEN_SOURCE_URL",
  CLEAR_IMAGES: "CLEAR_IMAGES"
};

const elements = {
  btnScan: document.getElementById("btn-scan"),
  btnClear: document.getElementById("btn-clear"),
  btnWorkspace: document.getElementById("btn-workspace"),
  btnComicMode: document.getElementById("btn-comic-mode"),
  btnAutoScroll: document.getElementById("btn-auto-scroll"),
  btnSelectAll: document.getElementById("btn-select-all"),
  btnDownloadSelected: document.getElementById("btn-download-selected"),
  btnCopySelected: document.getElementById("btn-copy-selected"),
  btnOpenDownloadDir: document.getElementById("btn-open-download-dir"),
  toggleHd: document.getElementById("toggle-hd"),
  toggleAutoScan: document.getElementById("toggle-auto-scan"),
  toggleSortSize: document.getElementById("toggle-sort-size"),
  togglePortraitOnly: document.getElementById("toggle-portrait-only"),
  toggleWebP: document.getElementById("toggle-webp"),
  toggleBatchZipDownload: document.getElementById("toggle-batch-zip-download"),
  toggleRightClick: document.getElementById("toggle-right-click"),
  resolutionPresets: document.getElementById("resolution-presets"),
  filterMinShort: document.getElementById("filter-min-short"),
  filterMinLong: document.getElementById("filter-min-long"),
  filterMinMp: document.getElementById("filter-min-mp"),
  formatFilters: document.getElementById("format-filters"),
  actionStatus: document.getElementById("action-status"),
  statTotal: document.getElementById("stat-total"),
  statFiltered: document.getElementById("stat-filtered"),
  statSelected: document.getElementById("stat-selected"),
  imageGrid: document.getElementById("image-grid"),
  emptyState: document.getElementById("empty-state"),
  lightbox: document.getElementById("lightbox"),
  lightboxImage: document.getElementById("lightbox-image"),
  lightboxDimensions: document.getElementById("lightbox-dimensions"),
  lightboxSize: document.getElementById("lightbox-size"),
  lightboxDownload: document.getElementById("lightbox-download"),
  lightboxCopy: document.getElementById("lightbox-copy"),
  lightboxSource: document.getElementById("lightbox-source"),
  lightboxClose: document.getElementById("lightbox-close"),
  lightboxPrev: document.getElementById("lightbox-prev"),
  lightboxNext: document.getElementById("lightbox-next")
};

let sourceTabId = null;
let currentImages = [];
let selectedIds = new Set();
let lightboxImage = null;
let lightboxCurrentSrc = "";
let lightboxSourceUrl = "";
let lightboxIndex = -1;
let hasScannedOnce = false;
let activePreset = "all";
let actionStatusTimer = null;
let pinnedActionStatusTimer = null;
let autoRefreshTimer = null;
let manualScanInProgress = false;
let batchDownloadInProgress = false;
let activeDownloadStatus = null;
let downloadStatusPollTimer = null;
let imageRenderToken = 0;
let committedImageRenderToken = 0;
let metadataRefreshTimer = null;
let metadataRefreshRequested = false;
let transientActionStatus = "";
let transientActionStatusTitle = "";
let pinnedActionStatus = "";
let pinnedActionStatusTitle = "";
const clipboardPayloadCache = new Map();
const CLIPBOARD_CACHE_TTL = 5 * 60 * 1000;
const imageDimensionCache = new Map();
const cardDimensionCache = new Map();
const cardDimensionTasks = new Map();

let currentConfig = {
  enableHD: true,
  enableSizeSort: false,
  enablePortraitOnly: false,
  enableAutoScan: false,
  enableAutoScroll: false,
  enableWebPConvert: false,
  enableBatchZipDownload: false,
  enableRightClick: false
};

const FORMAT_GROUPS = [
  { value: "jpg", label: "JPG", aliases: ["jpg", "jpeg"] },
  { value: "png", label: "PNG", aliases: ["png"] },
  { value: "webp", label: "WebP", aliases: ["webp"] },
  { value: "gif", label: "GIF", aliases: ["gif"] },
  { value: "svg", label: "SVG", aliases: ["svg"] },
  { value: "avif", label: "AVIF", aliases: ["avif"] }
];
const PRIMARY_FORMATS = new Set(FORMAT_GROUPS.flatMap((item) => item.aliases));
const IMAGE_FORMAT_EXTENSIONS = new Set([...PRIMARY_FORMATS, "bmp"]);
const DIMENSION_PROBE_CONCURRENCY = 6;

const RESOLUTION_PRESETS = {
  all: { type: "all", minShort: 0, minLong: 0, minArea: 0 },
  "720p": { type: "resolution", minShort: 720, minLong: 1280, minArea: 1280 * 720 },
  "1080p": { type: "resolution", minShort: 1080, minLong: 1920, minArea: 1920 * 1080 },
  "2k": { type: "resolution", minShort: 1440, minLong: 2560, minArea: 2560 * 1440 },
  "4k": { type: "resolution", minShort: 2160, minLong: 3840, minArea: 3840 * 2160 }
};

const normalizeImageExtension = (value) => {
  const ext = String(value || "").trim().toLowerCase();
  if (ext === "jpeg") return "jpg";
  if (ext === "svg+xml") return "svg";
  return IMAGE_FORMAT_EXTENSIONS.has(ext) ? ext : "";
};
const SELECT_ALL_LABEL = "全 选";
const UNSELECT_ALL_LABEL = "取消全选";

const getCurrentTabId = async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
};

const sendMessage = async (type, payload = {}) => {
  if (!sourceTabId) sourceTabId = await getCurrentTabId();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type, payload, tabId: sourceTabId },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { success: false, error: "No response" });
      }
    );
  });
};

const normalizePreviewImageUrl = (url) => {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw, location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "blob:") {
      return parsed.href;
    }
    if (parsed.protocol === "data:" && /^data:image\//i.test(raw)) {
      return raw;
    }
    if (parsed.protocol === "chrome-extension:" && parsed.origin === location.origin) {
      return parsed.href;
    }
  } catch (_error) {
    // Ignore invalid URLs from page-controlled attributes.
  }
  return "";
};

const setImagePreviewSrc = (imgElement, ...candidates) => {
  for (const candidate of candidates) {
    const safeUrl = normalizePreviewImageUrl(candidate);
    if (safeUrl) {
      imgElement.src = safeUrl;
      return true;
    }
  }
  imgElement.removeAttribute("src");
  return false;
};

const openDownloadDirectory = async () => {
  const response = await sendMessage(MSG.OPEN_DOWNLOAD_DIRECTORY);
  if (!response.success) {
    setActionStatus(`打开下载目录失败: ${response.error || "未知错误"}`, 2800);
    return;
  }
  setActionStatus("已打开下载目录", 1200);
};

const syncAutoScanRuntime = async (enabled) => {
  const response = await sendMessage(enabled ? MSG.START_AUTO_SCAN : MSG.STOP_AUTO_SCAN);
  if (!response?.success) {
    const action = enabled ? "开启自动采集" : "关闭自动采集";
    setActionStatus(`${action}失败: ${response?.error || "未知错误"}`, 3200);
    return false;
  }
  return true;
};

const setAutoScrollButtonState = (enabled) => {
  const active = enabled === true;
  currentConfig.enableAutoScroll = active;
  if (!elements.btnAutoScroll) return;
  elements.btnAutoScroll.classList.toggle("active", active);
  elements.btnAutoScroll.setAttribute("aria-pressed", active ? "true" : "false");
  const title = active ? "关闭自动滚动" : "开启自动滚动";
  elements.btnAutoScroll.title = title;
  elements.btnAutoScroll.setAttribute("aria-label", title);
};

const ACTION_STATUS_MAX_LENGTH = 58;

const renderActionStatus = () => {
  const rawText = pinnedActionStatus || transientActionStatus;
  const title = pinnedActionStatus ? pinnedActionStatusTitle : transientActionStatusTitle;
  const displayText =
    rawText.length > ACTION_STATUS_MAX_LENGTH
      ? `${rawText.slice(0, ACTION_STATUS_MAX_LENGTH)}…`
      : rawText;
  elements.actionStatus.textContent = displayText;
  elements.actionStatus.title = title;
};

const clearTransientActionStatus = () => {
  if (actionStatusTimer) {
    clearTimeout(actionStatusTimer);
    actionStatusTimer = null;
  }
  transientActionStatus = "";
  transientActionStatusTitle = "";
};

const setPinnedActionStatus = (text = "", timeoutMs = -1) => {
  pinnedActionStatus = String(text || "");
  pinnedActionStatusTitle = pinnedActionStatus;
  if (pinnedActionStatusTimer) {
    clearTimeout(pinnedActionStatusTimer);
    pinnedActionStatusTimer = null;
  }
  renderActionStatus();
  if (!pinnedActionStatus || timeoutMs <= 0) return;
  pinnedActionStatusTimer = setTimeout(() => {
    pinnedActionStatus = "";
    pinnedActionStatusTitle = "";
    pinnedActionStatusTimer = null;
    renderActionStatus();
  }, timeoutMs);
};

const setActionStatus = (text = "", timeoutMs = 2400) => {
  transientActionStatus = String(text || "");
  transientActionStatusTitle = transientActionStatus;
  if (actionStatusTimer) {
    clearTimeout(actionStatusTimer);
    actionStatusTimer = null;
  }
  renderActionStatus();
  if (!transientActionStatus || timeoutMs <= 0) return;
  actionStatusTimer = setTimeout(() => {
    transientActionStatus = "";
    transientActionStatusTitle = "";
    actionStatusTimer = null;
    renderActionStatus();
  }, timeoutMs);
};

const hasActiveDownloadTask = () => activeDownloadStatus?.active === true;

const stopDownloadStatusPolling = () => {
  if (!downloadStatusPollTimer) return;
  clearTimeout(downloadStatusPollTimer);
  downloadStatusPollTimer = null;
};

const ensureDownloadStatusPolling = () => {
  if (downloadStatusPollTimer || !hasActiveDownloadTask()) return;
  downloadStatusPollTimer = setTimeout(async () => {
    downloadStatusPollTimer = null;
    if (!hasActiveDownloadTask()) return;
    await restoreDownloadStatus();
    ensureDownloadStatusPolling();
  }, 1200);
};

const syncBatchDownloadButtonState = () => {
  const selected = selectedIds.size;
  elements.btnDownloadSelected.disabled = batchDownloadInProgress || selected === 0;
};

const formatDownloadStatusText = (status) => {
  if (!status) return "";
  const phase = String(status.phase || "");
  const mode = String(status.mode || "");
  const current = Number(status.current);
  const total = Number(status.total);
  const partIndex = Math.max(1, Number(status.partIndex) || 1);

  if (phase === "zip_prepare") return "正在打包 ZIP，请稍候…";
  if (phase === "zip") return Number.isInteger(current) && Number.isInteger(total) ? `打包中 ${current}/${total}` : "正在打包 ZIP，请稍候…";
  if (phase === "zip_part_build") return `正在生成ZIP第 ${partIndex} 卷`;
  if (phase === "zip_part_download") return `正在下载ZIP第 ${partIndex} 卷`;
  if (phase === "direct_prepare") return "正在准备批量下载…";
  if (phase === "direct") return Number.isInteger(current) && Number.isInteger(total) ? `下载中 ${current}/${total}` : "下载中…";
  if (phase === "completed_with_errors") {
    const succeeded = Math.max(0, Number(status.succeeded) || current || 0);
    const failed = Math.max(0, Number(status.failed) || Math.max(0, total - succeeded));
    return mode === "zip"
      ? `打包完成 ${succeeded}/${total}，失败 ${failed}`
      : `下载完成 ${succeeded}/${total}，失败 ${failed}`;
  }
  if (phase === "completed") return mode === "zip" ? "打包下载完毕" : "批量下载完毕";
  if (phase === "failed") return `下载失败: ${status.error || "未知错误"}`;
  return "";
};

const applyDownloadStatus = (status) => {
  const incomingUpdatedAt = Number(status?.updatedAt) || 0;
  const currentUpdatedAt = Number(activeDownloadStatus?.updatedAt) || 0;
  if (incomingUpdatedAt > 0 && currentUpdatedAt > 0 && incomingUpdatedAt < currentUpdatedAt) {
    return;
  }
  activeDownloadStatus = status
    ? {
        ...status,
        updatedAt: incomingUpdatedAt || Math.max(Date.now(), currentUpdatedAt + 1)
      }
    : null;
  batchDownloadInProgress = activeDownloadStatus?.active === true;
  syncBatchDownloadButtonState();
  const text = formatDownloadStatusText(activeDownloadStatus);
  if (activeDownloadStatus?.active === true) {
    ensureDownloadStatusPolling();
  } else {
    stopDownloadStatusPolling();
  }
  clearTransientActionStatus();
  if (!text) {
    setPinnedActionStatus("");
    return;
  }
  const timeoutMs = activeDownloadStatus?.active === true
    ? -1
    : ["failed", "completed_with_errors"].includes(activeDownloadStatus?.phase)
      ? 4200
      : 2600;
  setPinnedActionStatus(text, timeoutMs);
};

const restoreDownloadStatus = async () => {
  const response = await sendMessage(MSG.GET_DOWNLOAD_STATUS);
  if (!response?.success) return;
  if (!response.status && hasActiveDownloadTask()) return;
  applyDownloadStatus(response.status || null);
};

const scheduleRenderRefresh = () => {
  if (autoRefreshTimer) return;
  const preserveDownloadStatus = hasActiveDownloadTask();
  if (!preserveDownloadStatus) {
    setActionStatus("采集中...", -1);
  }
  autoRefreshTimer = setTimeout(() => {
    autoRefreshTimer = null;
    renderImages()
      .then(() => {
        if (!preserveDownloadStatus) {
          setActionStatus("采集完成", 1200);
        }
      })
      .catch(() => {
        if (!preserveDownloadStatus) {
          setActionStatus("刷新失败，请重试", 2400);
        }
      });
  }, 120);
};

const scheduleMetadataRenderRefresh = () => {
  if (metadataRefreshTimer) return;
  metadataRefreshRequested = true;
  if (committedImageRenderToken !== imageRenderToken) return;
  metadataRefreshRequested = false;
  metadataRefreshTimer = setTimeout(() => {
    metadataRefreshTimer = null;
    renderImages().catch(() => {});
  }, 160);
};

const cleanupClipboardCache = () => {
  const now = Date.now();
  for (const [key, entry] of clipboardPayloadCache.entries()) {
    if (!entry || now - entry.time > CLIPBOARD_CACHE_TTL) {
      clipboardPayloadCache.delete(key);
    }
  }
};

const setClipboardCache = (key, payload) => {
  if (!key || !payload?.success || !payload?.dataUrl) return;
  clipboardPayloadCache.set(key, { ...payload, time: Date.now() });
  cleanupClipboardCache();
};

const getClipboardCache = (key) => {
  if (!key) return null;
  cleanupClipboardCache();
  return clipboardPayloadCache.get(key) || null;
};

const dataUrlToBlob = (dataUrl) => {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  const binary = atob(match[2]);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
};

const canWriteClipboardImage = () =>
  typeof ClipboardItem !== "undefined" &&
  navigator.clipboard &&
  typeof navigator.clipboard.write === "function";

const writeClipboardImage = async (payload) => {
  const blob = dataUrlToBlob(payload?.dataUrl);
  if (!blob) return false;
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  return true;
};

const preloadClipboardPayload = async (image, preferredUrl, preferHD = false) => {
  if (!image || !preferredUrl) return;
  if (getClipboardCache(preferredUrl)) return;
  const response = await sendMessage(MSG.COPY_TO_CLIPBOARD, {
    image,
    preferredUrl,
    preferHD
  });
  setClipboardCache(preferredUrl, response);
};

const getImageDimensions = async (url) => {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return { width: 0, height: 0 };

  const cached = imageDimensionCache.get(normalizedUrl);
  if (cached) return await cached;

  const domProbe = () =>
    new Promise((resolve) => {
      const probe = new Image();
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        probe.onload = null;
        probe.onerror = null;
        resolve(result);
      };
      const timer = setTimeout(() => finish({ width: 0, height: 0 }), 8000);
      probe.onload = () => finish({ width: probe.naturalWidth || 0, height: probe.naturalHeight || 0 });
      probe.onerror = () => finish({ width: 0, height: 0 });
      probe.src = normalizedUrl;
    });

  const promise = (async () => {
    if (/^https?:/i.test(normalizedUrl)) {
      const response = await sendMessage(MSG.PROBE_IMAGE_DIMENSIONS, { url: normalizedUrl });
      if (response?.success) {
        return {
          width: Number(response.width) || 0,
          height: Number(response.height) || 0,
          format: String(response.format || "").toLowerCase(),
          formatTrusted: response.formatTrusted === true
        };
      }
      return { width: 0, height: 0 };
    }
    return await domProbe();
  })();

  imageDimensionCache.set(normalizedUrl, promise);
  const result = await promise;
  if ((Number(result?.width) || 0) <= 0 || (Number(result?.height) || 0) <= 0) {
    imageDimensionCache.delete(normalizedUrl);
  }
  return result;
};

const computeArea = (width, height) => Math.max(0, (Number(width) || 0) * (Number(height) || 0));
const formatAreaMp = (area) => `${(Math.max(0, Number(area) || 0) / 1000000).toFixed(2)} MP`;

const shouldApplyDetectedFormat = (image, meta = {}) => {
  const format = String(meta.format || "").trim().toLowerCase();
  if (!image?.id || !format || format === "unknown") return false;
  const currentFormat = String(image.format || "").toLowerCase();
  return currentFormat === "unknown" || (meta.formatTrusted === true && format !== currentFormat);
};

const sendImageFormatUpdate = (image, meta = {}) => {
  const format = String(meta.format || "").trim().toLowerCase();
  if (!shouldApplyDetectedFormat(image, meta)) return;
  sendMessage(MSG.UPDATE_IMAGE_METADATA, {
    imageId: image.id,
    url: image.hdSrc || image.src || image.originalSrc || "",
    maxWidth: Number(meta.width) || Number(image.maxWidth) || Number(image.width) || 0,
    maxHeight: Number(meta.height) || Number(image.maxHeight) || Number(image.height) || 0,
    maxArea: Number(meta.area) || Number(image.maxArea) || Number(image.area) || 0,
    format,
    formatTrusted: meta.formatTrusted === true
  }).then((response) => {
    if (response?.updated) scheduleMetadataRenderRefresh();
  }).catch(() => {});
};

const applyDetectedFormat = (image, meta = {}) => {
  if (!shouldApplyDetectedFormat(image, meta)) return false;
  sendImageFormatUpdate(image, meta);
  image.format = String(meta.format || "").trim().toLowerCase();
  return true;
};

const runWithConcurrency = async (tasks, concurrency) => {
  const results = new Array(tasks.length);
  let next = 0;
  const run = async () => {
    while (next < tasks.length) {
      const idx = next;
      next += 1;
      results[idx] = await tasks[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => run()));
  return results;
};

const getCardMeta = (image) => {
  const cached = cardDimensionCache.get(image.id);
  if (cached && currentConfig.enableHD) return cached;
  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  return {
    width,
    height,
    area: Math.max(Number(image.area) || 0, computeArea(width, height))
  };
};

const resolveCardMaxDimensions = async (image) => {
  if (!image?.id) return getCardMeta(image);
  const cached = cardDimensionCache.get(image.id);
  if (cached) return cached;

  const pendingTask = cardDimensionTasks.get(image.id);
  if (pendingTask) return await pendingTask;

  const hasHdCandidate = Boolean(image.hdSrc && image.hdSrc !== image.src);

  const task = (async () => {
    try {
      const probes = [getImageDimensions(image.src)];
      if (hasHdCandidate) {
        probes.push(getImageDimensions(image.hdSrc));
      }
      const [srcDim, hdDim = { width: 0, height: 0 }] = await Promise.all(probes);
      const srcArea = computeArea(srcDim.width, srcDim.height);
      const hdArea = computeArea(hdDim.width, hdDim.height);
      const base = getCardMeta(image);
      let width = base.width;
      let height = base.height;
      let area = base.area;
      let bestDim = base;
      let bestFormatDim = srcDim.format ? srcDim : hdDim;

      if (srcArea >= area) {
        width = srcDim.width;
        height = srcDim.height;
        area = srcArea;
        bestDim = srcDim;
        if (srcDim.format) bestFormatDim = srcDim;
      }
      if (hdArea >= area) {
        width = hdDim.width;
        height = hdDim.height;
        area = hdArea;
        bestDim = hdDim;
        if (hdDim.format) bestFormatDim = hdDim;
      }

      const resolved = {
        width,
        height,
        area,
        format: bestDim.format || bestFormatDim.format || "",
        formatTrusted: bestDim.formatTrusted === true || bestFormatDim.formatTrusted === true
      };
      cardDimensionCache.set(image.id, resolved);
      return resolved;
    } finally {
      cardDimensionTasks.delete(image.id);
    }
  })();

  cardDimensionTasks.set(image.id, task);
  return await task;
};

const isHdBadge = (image) => {
  const meta = getCardMeta(image);
  const highResolution = meta.area >= 1280 * 720;
  const hasLargerCandidate = Boolean(image.hdSrc && image.hdSrc !== image.src);
  return hasLargerCandidate || highResolution;
};

const formatFromUrl = (url) => {
  if (!url) return "unknown";
  const dataMime = String(url || "").match(/^data:image\/([^;,]+)/i);
  if (dataMime?.[1]) return normalizeImageExtension(dataMime[1]) || "unknown";
  try {
    const parsed = new URL(url);
    if (
      String(url).startsWith("blob:https://web.telegram.org/") ||
      (parsed.protocol === "blob:" && /web\.telegram\.org/i.test(String(parsed.pathname || "")))
    ) {
      return "jpg";
    }
    if (/web\.telegram\.org$/i.test(parsed.hostname) && !/\.[a-z0-9]+$/i.test(parsed.pathname || "")) {
      return "jpg";
    }
    const fromParam = parsed.searchParams.get("format");
    const normalizedFormat = normalizeImageExtension(fromParam);
    if (normalizedFormat) return normalizedFormat;

    const formatByRule = parsed.href.match(/(?:format=|\/format\/)(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[&/?#]|$)/i);
    if (formatByRule?.[1]) return normalizeImageExtension(formatByRule[1]) || "unknown";

    const formatFromSuffix = parsed.pathname.match(/(?:^|[_!.-])(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[_!.-]|$)/i);
    if (formatFromSuffix?.[1]) return normalizeImageExtension(formatFromSuffix[1]) || "unknown";

    if (/xhscdn\.com$/i.test(parsed.hostname) && (/webpic/i.test(parsed.hostname) || /notes_pre_post/i.test(parsed.pathname))) {
      return "webp";
    }
  } catch {
    // Ignore parse failures.
  }
  const match = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return normalizeImageExtension(match?.[1]) || "unknown";
};

const resolveImageFormat = (image) => {
  const raw = String(image?.format || "").toLowerCase();
  if (raw && raw !== "unknown") return raw;
  return formatFromUrl(image?.displaySrc || image?.hdSrc || image?.src || image?.originalSrc || "");
};

const fallbackImageError = (imgElement, fallbackUrl, image = null) => {
  if (!fallbackUrl) return;
  if (imgElement.dataset.fallbackApplied && imgElement.dataset.fallbackApplied !== "0") return;
  imgElement.dataset.fallbackApplied = "1";
  imgElement.src = fallbackUrl;
  if (!image) return;
  const candidate = String(fallbackUrl || "");
  if (!/sinaimg\.cn/i.test(candidate)) return;
  sendMessage(MSG.COPY_TO_CLIPBOARD, {
    image,
    preferredUrl: candidate,
    preferHD: currentConfig.enableHD
  }).then((response) => {
    if (!response?.success || !response.dataUrl) return;
    imgElement.dataset.fallbackApplied = "2";
    imgElement.src = response.dataUrl;
  }).catch(() => {});
};

const getViewSources = (image) => {
  const hdCandidate = image?.hdSrc || "";
  if (/twimg\.com/i.test(hdCandidate) && /name=orig/i.test(hdCandidate)) {
    return {
      previewSrc: hdCandidate.replace(/name=orig/i, "name=large"),
      originalSrc: hdCandidate
    };
  }
  const base = image?.src || image?.originalSrc || image?.displaySrc || hdCandidate || "";
  if (!base) return { previewSrc: "", originalSrc: "" };
  const originalSrc = image?.hdSrc && image.hdSrc !== base ? image.hdSrc : "";
  return { previewSrc: base, originalSrc };
};

const getImageSourceUrl = (image) => {
  const sourceUrl = String(image?.sourceUrl || "").trim();
  if (!sourceUrl) return "";
  try {
    const parsed = new URL(sourceUrl);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
};

const syncLightboxMeta = (src) => {
  const width = elements.lightboxImage.naturalWidth || 0;
  const height = elements.lightboxImage.naturalHeight || 0;
  elements.lightboxDimensions.textContent = `${width} × ${height}`;
  const format = String(resolveImageFormat(lightboxImage) || formatFromUrl(src) || "unknown").toUpperCase();
  elements.lightboxSize.textContent = `${formatAreaMp(width * height)}  ${format}`;
  if (elements.lightboxSource) {
    const hasSource = Boolean(lightboxSourceUrl);
    elements.lightboxSource.disabled = !hasSource;
    elements.lightboxSource.title = hasSource ? lightboxSourceUrl : "未记录图片来源";
  }
};

const setActivePreset = (preset) => {
  activePreset = preset;
  elements.resolutionPresets.querySelectorAll(".preset-chip").forEach((chip) => {
    chip.classList.toggle("active", Boolean(preset) && chip.dataset.preset === preset);
  });
};

const formatMpLabel = (area) => `≥ ${(Math.max(0, Number(area) || 0) / 1000000).toFixed(2)} MP`;

const clearDynamicMinMpOptions = () => {
  elements.filterMinMp.querySelectorAll("option[data-dynamic='1']").forEach((option) => option.remove());
};

const ensureMinMpOption = (area) => {
  const normalized = Math.max(0, Math.round(Number(area) || 0));
  const value = String(normalized);
  const existing = Array.from(elements.filterMinMp.options).find((option) => option.value === value);
  if (existing) return existing;
  const option = document.createElement("option");
  option.value = value;
  option.dataset.dynamic = "1";
  option.textContent = formatMpLabel(normalized);
  elements.filterMinMp.appendChild(option);
  return option;
};

const setMinMpValue = (area, { allowDynamic = true } = {}) => {
  const normalized = Math.max(0, Math.round(Number(area) || 0));
  const value = String(normalized);
  if (allowDynamic) {
    clearDynamicMinMpOptions();
  }
  const existing = Array.from(elements.filterMinMp.options).find((option) => option.value === value);
  if (!existing) ensureMinMpOption(normalized);
  elements.filterMinMp.value = value;
};

const setMetricInputs = ({ minShort = 0, minLong = 0, minArea = 0 }) => {
  elements.filterMinShort.value = String(minShort);
  elements.filterMinLong.value = String(minLong);
  clearDynamicMinMpOptions();
  setMinMpValue(minArea, { allowDynamic: false });
};

const getCustomMetricFilters = () => ({
  minShort: parseInt(elements.filterMinShort.value, 10) || 0,
  minLong: parseInt(elements.filterMinLong.value, 10) || 0,
  minArea: parseInt(elements.filterMinMp.value, 10) || 0
});

const detectPresetFromInputs = () => {
  const current = getCustomMetricFilters();
  for (const [key, preset] of Object.entries(RESOLUTION_PRESETS)) {
    if (
      current.minShort === preset.minShort &&
      current.minLong === preset.minLong &&
      current.minArea === preset.minArea
    ) {
      return key;
    }
  }
  return null;
};

const applyResolutionPreset = (preset) => {
  if (!RESOLUTION_PRESETS[preset]) return;
  setMetricInputs(RESOLUTION_PRESETS[preset]);
  setActivePreset(preset);
};

const syncMinMpFromSideFilters = () => {
  const minShort = parseInt(elements.filterMinShort.value, 10) || 0;
  const minLong = parseInt(elements.filterMinLong.value, 10) || 0;
  const minArea = minShort > 0 && minLong > 0 ? minShort * minLong : 0;
  setMinMpValue(minArea);
};

const getSelectedFormatFilters = () => {
  const selectedValues = [];
  elements.formatFilters.querySelectorAll("input[type=\"checkbox\"]:checked").forEach((input) => {
    selectedValues.push(input.value.toLowerCase());
  });
  const formats = [];
  for (const value of selectedValues) {
    if (value === "other") {
      formats.push("other");
      continue;
    }
    const group = FORMAT_GROUPS.find((item) => item.value === value);
    if (group) {
      formats.push(...group.aliases);
      continue;
    }
    formats.push(value);
  }
  return [...new Set(formats)];
};

const getFilters = () => ({
  preset: activePreset || "custom",
  ...getCustomMetricFilters(),
  formats: getSelectedFormatFilters()
});

const hasRestrictiveFormatFilter = (selectedFormats = []) => {
  if (!Array.isArray(selectedFormats) || selectedFormats.length === 0) return false;
  const inputs = Array.from(elements.formatFilters.querySelectorAll("input[type=\"checkbox\"]"));
  if (inputs.length === 0) return false;
  const selectedCount = inputs.reduce((count, input) => count + (input.checked ? 1 : 0), 0);
  return selectedCount > 0 && selectedCount < inputs.length;
};

const normalizeFormatStats = (stats = {}) => {
  const normalized = {};
  for (const [formatKey, count] of Object.entries(stats)) {
    const key = String(formatKey || "unknown").toLowerCase();
    normalized[key] = (normalized[key] || 0) + (Number(count) || 0);
  }
  return normalized;
};

const buildFormatOptions = (stats = {}) => {
  const normalized = normalizeFormatStats(stats);
  const options = [];
  let assigned = 0;
  for (const group of FORMAT_GROUPS) {
    const count = group.aliases.reduce((sum, alias) => sum + (normalized[alias] || 0), 0);
    options.push({ value: group.value, label: group.label, count });
    assigned += count;
  }
  const total = Object.values(normalized).reduce((sum, count) => sum + count, 0);
  const otherCount = Math.max(0, total - assigned);
  options.push({ value: "other", label: "其他", count: otherCount });
  return options;
};

const renderFormatFilters = (stats = {}) => {
  const selected = new Set(
    Array.from(elements.formatFilters.querySelectorAll("input[type=\"checkbox\"]:checked")).map((input) => input.value)
  );
  const options = buildFormatOptions(stats);
  elements.formatFilters.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const option of options) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(option.value || "");
    input.checked = selected.has(option.value);
    const name = document.createElement("span");
    name.textContent = String(option.label || "");
    const count = document.createElement("span");
    count.className = "format-count";
    count.textContent = String(Number(option.count) || 0);
    label.append(input, name, count);
    fragment.appendChild(label);
  }
  elements.formatFilters.appendChild(fragment);
};

const getImageMetaForFilters = (image) => {
  if (currentConfig.enableHD) {
    const cached = cardDimensionCache.get(image.id);
    if (cached) return cached;
  }
  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  return {
    width,
    height,
    area: Math.max(Number(image.area) || 0, computeArea(width, height))
  };
};

const passesMetricFilters = (image, filters) => {
  const meta = getImageMetaForFilters(image);
  const presetRule = RESOLUTION_PRESETS[filters.preset] || { type: "custom" };
  const longSide = Math.max(meta.width, meta.height);
  const shortSide = Math.min(meta.width, meta.height);

  if (presetRule.type === "resolution") {
    if (shortSide < presetRule.minShort || longSide < presetRule.minLong) return false;
  }
  if (presetRule.type === "custom") {
    if (filters.minShort > 0 && shortSide < filters.minShort) return false;
    if (filters.minLong > 0 && longSide < filters.minLong) return false;
    if (filters.minArea > 0 && meta.area < filters.minArea) return false;
  }
  return true;
};

const passesOrientationFilter = (image) => {
  if (!currentConfig.enablePortraitOnly) return true;
  const meta = getImageMetaForFilters(image);
  return meta.height > meta.width;
};

const passesFormatFilters = (image, selectedFormats = []) => {
  if (!Array.isArray(selectedFormats) || selectedFormats.length === 0) return true;
  const formatSet = new Set(selectedFormats.map((item) => String(item).toLowerCase()));
  const format = resolveImageFormat(image) || "unknown";
  if (formatSet.has(format)) return true;
  if (formatSet.has("jpg") && format === "jpeg") return true;
  if (formatSet.has("jpeg") && format === "jpg") return true;
  if (formatSet.has("other") && !PRIMARY_FORMATS.has(format)) return true;
  return false;
};

const computeFormatStatsFromImages = (images = []) => {
  const stats = {};
  for (const image of images) {
    const key = resolveImageFormat(image) || "unknown";
    stats[key] = (stats[key] || 0) + 1;
  }
  return stats;
};

const refreshSelectedState = async () => {
  const response = await sendMessage(MSG.GET_SELECTED);
  if (!response.success) return new Set();
  return new Set(response.images.map((image) => image.id));
};

const updateStats = async ({ visibleImages = [], facetStats = {}, renderToken = null } = {}) => {
  const response = await sendMessage(MSG.GET_STATS);
  if (!response.success) return false;
  if (renderToken !== null && renderToken !== imageRenderToken) return false;
  const { total, selected } = response.stats;
  elements.statTotal.textContent = String(total);
  elements.statFiltered.textContent = String(visibleImages.length);
  elements.statSelected.textContent = String(selected);
  elements.btnDownloadSelected.disabled = batchDownloadInProgress || selected === 0;
  elements.btnCopySelected.disabled = selected === 0;
  renderFormatFilters(facetStats);
  return true;
};

const getVisibleSelectionInfo = () => {
  const visibleIds = currentImages.map((image) => image.id);
  const selectedVisibleCount = visibleIds.reduce(
    (count, id) => count + (selectedIds.has(id) ? 1 : 0),
    0
  );
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  return { visibleIds, allVisibleSelected };
};

const syncSelectAllButtonLabel = () => {
  const { allVisibleSelected } = getVisibleSelectionInfo();
  elements.btnSelectAll.textContent = allVisibleSelected ? UNSELECT_ALL_LABEL : SELECT_ALL_LABEL;
};

const syncScanButtonLabel = () => {
  if (elements.btnScan.disabled) return;
  elements.btnScan.textContent = hasScannedOnce ? "继续扫描" : "开始扫描";
};

const createCard = (image, index) => {
  const displaySrc = image.displaySrc || image.src;
  const format = String(resolveImageFormat(image) || formatFromUrl(displaySrc) || "unknown").toUpperCase();
  const isSelected = selectedIds.has(image.id);
  const meta = getCardMeta(image);
  const card = document.createElement("div");
  card.className = `image-card${isSelected ? " selected" : ""}`;
  card.dataset.id = image.id;

  const wrapper = document.createElement("div");
  wrapper.className = "image-wrapper";
  const imageNode = document.createElement("img");
  imageNode.alt = "Image preview";
  imageNode.loading = "lazy";
  setImagePreviewSrc(imageNode, displaySrc, image.src);
  wrapper.appendChild(imageNode);

  if (isHdBadge(image)) {
    const hdBadge = document.createElement("span");
    hdBadge.className = "hd-badge";
    hdBadge.textContent = "HD";
    wrapper.appendChild(hdBadge);
  }

  const formatBadge = document.createElement("span");
  formatBadge.className = "format-badge";
  formatBadge.textContent = format;
  wrapper.appendChild(formatBadge);

  const checkbox = document.createElement("button");
  checkbox.className = `checkbox${isSelected ? " checked" : ""}`;
  checkbox.type = "button";
  checkbox.textContent = isSelected ? "✓" : "";
  wrapper.appendChild(checkbox);

  const info = document.createElement("div");
  info.className = "image-info";
  const dimensions = document.createElement("span");
  dimensions.textContent = `${meta.width} × ${meta.height}`;
  const area = document.createElement("span");
  area.textContent = formatAreaMp(meta.area);
  info.append(dimensions, area);
  card.append(wrapper, info);

  imageNode.addEventListener("error", () => fallbackImageError(imageNode, image.src, image));
  imageNode.addEventListener("click", () => openLightbox(image, index));

  checkbox.addEventListener("click", async (event) => {
    event.stopPropagation();
    await toggleSelect(image.id);
  });

  resolveCardMaxDimensions(image).then((resolved) => {
    dimensions.textContent = `${resolved.width} × ${resolved.height}`;
    area.textContent = formatAreaMp(resolved.area);
    if (applyDetectedFormat(image, resolved)) {
      formatBadge.textContent = String(image.format || "unknown").toUpperCase();
    }
  }).catch(() => {});
  return card;
};

const renderImages = async () => {
  const renderToken = imageRenderToken + 1;
  imageRenderToken = renderToken;
  const filters = getFilters();
  const allResponse = await sendMessage(MSG.GET_IMAGES, { filtered: false });
  if (renderToken !== imageRenderToken) return;
  if (!allResponse.success) {
    setActionStatus(`加载失败: ${allResponse.error || "未知错误"}`, 3200);
    return;
  }
  const allImages = allResponse.images || [];
  const visibleAllImages = allImages.filter((image) => image.hidden !== true);

  const needsDimensionHydration =
    currentConfig.enableHD &&
    (
      currentConfig.enableSizeSort ||
      currentConfig.enablePortraitOnly ||
      filters.preset !== "all" ||
      hasRestrictiveFormatFilter(filters.formats) ||
      filters.minShort > 0 ||
      filters.minLong > 0 ||
      filters.minArea > 0
  );
  if (needsDimensionHydration) {
    await runWithConcurrency(
      visibleAllImages.map((image) => async () => {
        const resolved = await resolveCardMaxDimensions(image);
        applyDetectedFormat(image, resolved);
        return resolved;
      }),
      DIMENSION_PROBE_CONCURRENCY
    );
    if (renderToken !== imageRenderToken) return;
  }

  const metricAndOrientationFiltered = visibleAllImages
    .filter((image) => passesMetricFilters(image, filters))
    .filter((image) => passesOrientationFilter(image));
  const facetStats = computeFormatStatsFromImages(metricAndOrientationFiltered);

  currentImages = metricAndOrientationFiltered
    .filter((image) => passesFormatFilters(image, filters.formats));

  if (currentConfig.enableSizeSort) {
    currentImages = currentImages.sort((a, b) => {
      const aMeta = getImageMetaForFilters(a);
      const bMeta = getImageMetaForFilters(b);
      return bMeta.area - aMeta.area;
    });
  }

  selectedIds = await refreshSelectedState();
  if (renderToken !== imageRenderToken) return;

  if (elements.lightbox.classList.contains("active") && lightboxImage) {
    const nextIndex = currentImages.findIndex((item) => item.id === lightboxImage.id);
    if (nextIndex === -1) {
      closeLightbox();
    } else {
      lightboxIndex = nextIndex;
      updateLightboxNavigation();
    }
  }

  elements.imageGrid.innerHTML = "";

  if (currentImages.length === 0) {
    elements.emptyState.style.display = "flex";
    elements.imageGrid.appendChild(elements.emptyState);
    elements.btnSelectAll.textContent = SELECT_ALL_LABEL;
    const statsUpdated = await updateStats({
      visibleImages: currentImages,
      facetStats,
      renderToken
    });
    if (!statsUpdated) return;
    committedImageRenderToken = renderToken;
    if (metadataRefreshRequested) scheduleMetadataRenderRefresh();
    hasScannedOnce = hasScannedOnce || allImages.length > 0;
    syncScanButtonLabel();
    return;
  }

  elements.emptyState.style.display = "none";
  const fragment = document.createDocumentFragment();
  for (const [index, image] of currentImages.entries()) {
    fragment.appendChild(createCard(image, index));
  }
  elements.imageGrid.appendChild(fragment);
  syncSelectAllButtonLabel();
  const statsUpdated = await updateStats({
    visibleImages: currentImages,
    facetStats,
    renderToken
  });
  if (!statsUpdated) return;
  committedImageRenderToken = renderToken;
  if (metadataRefreshRequested) scheduleMetadataRenderRefresh();
  hasScannedOnce = true;
  syncScanButtonLabel();
};

const toggleSelect = async (imageId) => {
  const response = await sendMessage(MSG.TOGGLE_SELECT, { imageId });
  if (!response.success) return;
  selectedIds = new Set(response.selectedIds || []);
  await renderImages();
};

const toggleSelectAll = async () => {
  const { visibleIds, allVisibleSelected } = getVisibleSelectionInfo();
  if (visibleIds.length === 0) return;
  const response = await sendMessage(MSG.SET_SELECTION, {
    imageIds: visibleIds,
    selected: !allVisibleSelected
  });
  if (!response.success) {
    setActionStatus(`操作失败: ${response.error || "未知错误"}`, 3200);
    return;
  }
  await renderImages();
};

const updateLightboxNavigation = () => {
  const enabled = currentImages.length > 1;
  if (elements.lightboxPrev) elements.lightboxPrev.disabled = !enabled;
  if (elements.lightboxNext) elements.lightboxNext.disabled = !enabled;
};

const openLightbox = (image, index = -1) => {
  lightboxImage = image;
  if (index >= 0) {
    lightboxIndex = index;
  } else {
    lightboxIndex = currentImages.findIndex((item) => item.id === image?.id);
  }
  const { previewSrc } = getViewSources(image);
  const displaySrc = currentConfig.enableHD
    ? (previewSrc || image.src || image.originalSrc || image.displaySrc || image.hdSrc)
    : (image.src || image.originalSrc || image.displaySrc || image.hdSrc || previewSrc);
  lightboxCurrentSrc = displaySrc;
  lightboxSourceUrl = getImageSourceUrl(image);
  elements.lightboxImage.dataset.fallbackApplied = "0";
  elements.lightboxImage.src = displaySrc;
  elements.lightboxImage.onerror = () => fallbackImageError(elements.lightboxImage, image.src, image);
  elements.lightboxImage.onload = () => syncLightboxMeta(displaySrc);
  syncLightboxMeta(displaySrc);
  preloadClipboardPayload(image, displaySrc, false).catch(() => {});
  updateLightboxNavigation();
  elements.lightbox.classList.add("active");
};

const navigateLightbox = (step) => {
  if (!elements.lightbox.classList.contains("active")) return;
  if (!lightboxImage || currentImages.length <= 1) return;
  const current = lightboxIndex >= 0
    ? lightboxIndex
    : currentImages.findIndex((item) => item.id === lightboxImage.id);
  const nextIndex = (current + step + currentImages.length) % currentImages.length;
  const target = currentImages[nextIndex];
  if (!target) return;
  openLightbox(target, nextIndex);
};

const closeLightbox = () => {
  elements.lightbox.classList.remove("active");
  lightboxImage = null;
  lightboxCurrentSrc = "";
  lightboxSourceUrl = "";
  lightboxIndex = -1;
};

const copyImageOrUrl = async (image, options = {}) => {
  const canWriteImage = canWriteClipboardImage();
  const preferredUrl = options.preferredUrl || "";

  if (canWriteImage && preferredUrl) {
    const cached = getClipboardCache(preferredUrl);
    if (cached?.success && cached.dataUrl) {
      try {
        await writeClipboardImage(cached);
        return { success: true, mode: "image" };
      } catch {
        // Continue fallback attempts.
      }
    }
  }

  const backgroundResponse = await sendMessage(MSG.COPY_TO_CLIPBOARD, {
    image,
    preferredUrl,
    preferHD: options.preferHD === true
  });
  if (preferredUrl) setClipboardCache(preferredUrl, backgroundResponse);

  if (canWriteImage && backgroundResponse?.success && backgroundResponse.dataUrl) {
    try {
      await writeClipboardImage(backgroundResponse);
      return { success: true, mode: "image" };
    } catch {
      // Continue fallback.
    }
  }

  const candidates = [
    preferredUrl,
    backgroundResponse?.url,
    image.displaySrc,
    image.hdSrc,
    image.src,
    image.originalSrc
  ].filter(Boolean);

  if (!canWriteImage) {
    const fallback = candidates[0];
    if (fallback) {
      await navigator.clipboard.writeText(fallback);
      return { success: true, mode: "url" };
    }
    return { success: false };
  }

  const fallback = candidates[0];
  if (fallback) {
    await navigator.clipboard.writeText(fallback);
    return { success: true, mode: "url" };
  }
  return { success: false };
};

const scanImages = async ({ syncAutoScanAfterScan = true } = {}) => {
  manualScanInProgress = true;
  elements.btnScan.disabled = true;
  elements.btnScan.textContent = "采集中...";
  setActionStatus("采集中...", -1);
  try {
    const response = await sendMessage(MSG.SCAN);
    if (!response.success) {
      setActionStatus(`扫描失败: ${response.error || "未知错误"}`, 3200);
      return false;
    }
    hasScannedOnce = true;
    await renderImages();
    if (currentConfig.enableAutoScan && syncAutoScanAfterScan) {
      const synced = await syncAutoScanRuntime(true);
      if (!synced) {
        setActionStatus("采集完成，但自动采集启动失败", 3200);
        return false;
      }
    }
    setActionStatus("采集完成", 1400);
    return true;
  } finally {
    manualScanInProgress = false;
    elements.btnScan.disabled = false;
    syncScanButtonLabel();
  }
};

const clearImages = async () => {
  if (manualScanInProgress) return;
  const response = await sendMessage(MSG.CLEAR_IMAGES);
  if (!response?.success) {
    setActionStatus(`清理失败: ${response?.error || "未知错误"}`, 3200);
    return;
  }

  closeLightbox();
  if (metadataRefreshTimer) {
    clearTimeout(metadataRefreshTimer);
    metadataRefreshTimer = null;
  }
  metadataRefreshRequested = false;
  currentImages = [];
  selectedIds = new Set();
  hasScannedOnce = false;
  await renderImages();
  setActionStatus("已清理采集结果", 1400);
};

const downloadSelected = async () => {
  if (batchDownloadInProgress) return;
  batchDownloadInProgress = true;
  const enableBatchZipDownload = elements.toggleBatchZipDownload?.checked === true;
  const enableConvertToJpg = elements.toggleWebP?.checked === true;
  applyDownloadStatus({
    active: true,
    mode: enableBatchZipDownload ? "zip" : "direct",
    phase: enableBatchZipDownload ? "zip_prepare" : "direct_prepare",
    current: 0,
    total: selectedIds.size
  });
  try {
    const response = await sendMessage(MSG.DOWNLOAD_BATCH, {
      enableBatchZipDownload,
      enableBatchZip: enableBatchZipDownload,
      zip: enableBatchZipDownload,
      mode: enableBatchZipDownload ? "zip" : "direct",
      downloadMode: enableBatchZipDownload ? "zip" : "direct",
      enableConvertToJpg
    });
    if (!response.success) {
      if (response?.zipped && Number(response?.zipPartCount) > 1) {
        const done = Number(response?.downloadedPartCount) || 0;
        const total = Number(response?.zipPartCount) || 0;
        applyDownloadStatus({
          active: false,
          mode: "zip",
          phase: "failed",
          current: done,
          total,
          partIndex: done,
          partCount: total,
          error: response.error || "未知错误"
        });
        return;
      }
      applyDownloadStatus({
        active: false,
        mode: enableBatchZipDownload ? "zip" : "direct",
        phase: "failed",
        error: response.error || "未知错误"
      });
      return;
    }
    if (response.accepted) {
      await restoreDownloadStatus();
      return;
    }
    if (response.zipped) {
      const succeeded = Number(response.packed) || 0;
      const failed = Number(response.failed) || 0;
      const total = succeeded + failed || Number(response.results?.length) || 0;
      applyDownloadStatus({
        active: false,
        mode: "zip",
        phase: failed > 0 ? "completed_with_errors" : "completed",
        current: succeeded,
        total,
        succeeded,
        failed,
        partIndex: Number(response.zipPartCount) || 1,
        partCount: Number(response.zipPartCount) || 1
      });
      return;
    }
    const succeeded = Number(response.succeeded) || response.results.filter((item) => item.success).length;
    const failed = Number(response.failed) || Math.max(0, response.results.length - succeeded);
    applyDownloadStatus({
      active: false,
      mode: "direct",
      phase: failed > 0 ? "completed_with_errors" : "completed",
      current: succeeded,
      total: response.results.length,
      succeeded,
      failed
    });
  } finally {
    batchDownloadInProgress = activeDownloadStatus?.active === true;
    renderImages();
  }
};

const copySelected = async () => {
  const response = await sendMessage(MSG.GET_SELECTED);
  if (!response.success || response.images.length === 0) return;
  const useOriginal = currentConfig.enableHD;
  const urls = response.images
    .map((item) => {
      if (useOriginal) return item.hdSrc || item.src || item.originalSrc;
      return item.src || item.originalSrc || item.hdSrc;
    })
    .filter(Boolean)
    .join("\n");
  try {
    await navigator.clipboard.writeText(urls);
    setActionStatus(`已复制 ${response.images.length} 条链接`);
  } catch (error) {
    setActionStatus(`复制失败: ${error?.message || "剪贴板不可用"}`, 3200);
  }
};

const openWorkspace = async () => {
  if (!sourceTabId) sourceTabId = await getCurrentTabId();
  const workspaceUrl = chrome.runtime.getURL(`workspace/workspace.html?tabId=${sourceTabId}`);
  await chrome.tabs.create({ url: workspaceUrl });
};

const openComicMode = async () => {
  if (!sourceTabId) sourceTabId = await getCurrentTabId();
  const workspaceUrl = chrome.runtime.getURL(`workspace/workspace.html?tabId=${sourceTabId}&autoScan=1&comicMode=1`);
  await chrome.tabs.create({ url: workspaceUrl });
};

const bindEvents = () => {
  elements.btnScan.addEventListener("click", scanImages);
  elements.btnClear.addEventListener("click", clearImages);
  elements.btnWorkspace.addEventListener("click", openWorkspace);
  elements.btnComicMode.addEventListener("click", openComicMode);
  elements.btnSelectAll.addEventListener("click", toggleSelectAll);
  elements.btnDownloadSelected.addEventListener("click", downloadSelected);
  elements.btnCopySelected.addEventListener("click", copySelected);
  elements.btnOpenDownloadDir.addEventListener("click", openDownloadDirectory);

  elements.resolutionPresets.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const preset = target.dataset.preset;
    if (!preset) return;
    applyResolutionPreset(preset);
    renderImages();
  });

  const refreshFromSideInputs = () => {
    syncMinMpFromSideFilters();
    const matchedPreset = detectPresetFromInputs();
    setActivePreset(matchedPreset || "custom");
    renderImages();
  };
  for (const input of [elements.filterMinShort, elements.filterMinLong]) {
    input.addEventListener("change", refreshFromSideInputs);
    input.addEventListener("input", refreshFromSideInputs);
  }
  elements.filterMinMp.addEventListener("change", () => {
    const minArea = parseInt(elements.filterMinMp.value, 10) || 0;
    clearDynamicMinMpOptions();
    if (minArea > 0) {
      elements.filterMinShort.value = "0";
      elements.filterMinLong.value = "0";
    }
    setMinMpValue(minArea, { allowDynamic: false });
    const matchedPreset = detectPresetFromInputs();
    setActivePreset(matchedPreset || "custom");
    renderImages();
  });

  elements.formatFilters.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
      renderImages();
    }
  });

  elements.toggleHd.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const response = await sendMessage(MSG.SET_CONFIG, { enableHD: checked });
    if (!response.success) {
      setActionStatus(`设置失败: ${response.error || "未知错误"}`, 3200);
      event.target.checked = !checked;
      return;
    }
    currentConfig.enableHD = checked;
    if (elements.lightbox.classList.contains("active") && lightboxImage) {
      openLightbox(lightboxImage, lightboxIndex);
    }
    await renderImages();
  });

  elements.toggleAutoScan.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const response = await sendMessage(MSG.SET_CONFIG, { enableAutoScan: checked });
    if (!response.success) {
      setActionStatus(`设置失败: ${response.error || "未知错误"}`, 3200);
      event.target.checked = !checked;
      return;
    }

    currentConfig.enableAutoScan = checked;
    if (checked) {
      if (!hasScannedOnce && currentImages.length === 0) {
        const scanned = await scanImages({ syncAutoScanAfterScan: false });
        if (!scanned) return;
      }
      setActionStatus("已开启自动采集");
    } else {
      setActionStatus("已关闭自动采集");
    }
  });

  elements.btnAutoScroll.addEventListener("click", async () => {
    const nextEnabled = !currentConfig.enableAutoScroll;
    elements.btnAutoScroll.disabled = true;
    const response = await sendMessage(MSG.SET_CONFIG, { enableAutoScroll: nextEnabled });
    elements.btnAutoScroll.disabled = false;
    if (!response.success) {
      setActionStatus(`自动滚动失败: ${response.error || "未知错误"}`, 3200);
      return;
    }
    const enabled = response?.config?.enableAutoScroll === true;
    setAutoScrollButtonState(enabled);
    setActionStatus(enabled ? "已开启自动滚动" : "已关闭自动滚动");
  });

  elements.toggleSortSize.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const response = await sendMessage(MSG.SET_CONFIG, { enableSizeSort: checked });
    if (!response.success) {
      setActionStatus(`设置失败: ${response.error || "未知错误"}`, 3200);
      event.target.checked = !checked;
      return;
    }
    currentConfig.enableSizeSort = checked;
    await renderImages();
  });

  elements.togglePortraitOnly.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const response = await sendMessage(MSG.SET_CONFIG, { enablePortraitOnly: checked });
    if (!response.success) {
      setActionStatus(`设置失败: ${response.error || "未知错误"}`, 3200);
      event.target.checked = !checked;
      return;
    }
    currentConfig.enablePortraitOnly = checked;
    await renderImages();
  });

  elements.toggleWebP.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const response = await sendMessage(MSG.SET_CONFIG, { enableWebPConvert: checked });
    if (!response.success) {
      setActionStatus(`设置失败: ${response.error || "未知错误"}`, 3200);
      event.target.checked = !checked;
      return;
    }
    currentConfig.enableWebPConvert = checked;
  });

  elements.toggleBatchZipDownload.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    currentConfig.enableBatchZipDownload = checked;
    setActionStatus(checked ? "已开启批量ZIP下载" : "已关闭批量ZIP下载", 1800);
  });

  elements.toggleRightClick.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const response = await sendMessage(MSG.SET_CONFIG, { enableRightClick: checked });
    if (!response.success) {
      setActionStatus(`解锁右键失败: ${response.error || "未知错误"}`, 3200);
      event.target.checked = !checked;
      return;
    }
    currentConfig.enableRightClick = checked;
    setActionStatus(checked ? "已启用解锁右键" : "已关闭解锁右键");
  });

  elements.lightbox.querySelector(".lightbox-backdrop").addEventListener("click", closeLightbox);
  elements.lightboxClose.addEventListener("click", closeLightbox);
  elements.lightboxPrev.addEventListener("click", () => navigateLightbox(-1));
  elements.lightboxNext.addEventListener("click", () => navigateLightbox(1));
  elements.lightboxDownload.addEventListener("click", async () => {
    if (!lightboxImage) return;
    const result = await sendMessage(MSG.DOWNLOAD, { image: lightboxImage });
    if (!result.success) {
      setActionStatus(`下载失败: ${result.error || "未知错误"}`, 3200);
      return;
    }
    setActionStatus("已加入下载队列");
  });
  elements.lightboxCopy.addEventListener("click", async () => {
    if (!lightboxImage) return;
    try {
      const result = await copyImageOrUrl(lightboxImage, {
        preferredUrl: lightboxCurrentSrc,
        preferHD: false
      });
      if (!result.success) {
        setActionStatus("复制失败", 3200);
        return;
      }
      setActionStatus(result.mode === "image" ? "已复制图片" : "已复制链接");
    } catch (error) {
      setActionStatus(`复制失败: ${error?.message || "未知错误"}`, 3200);
    }
  });
  if (elements.lightboxSource) {
    elements.lightboxSource.addEventListener("click", async () => {
      if (!lightboxImage) return;
      const sourceUrl = lightboxSourceUrl || getImageSourceUrl(lightboxImage);
      const response = await sendMessage(MSG.OPEN_SOURCE_URL, { url: sourceUrl });
      if (!response?.success) {
        setActionStatus(`打开来源失败: ${response?.error || "未记录来源"}`, 3200);
        return;
      }
      setActionStatus("已打开图片来源", 1200);
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!elements.lightbox.classList.contains("active")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeLightbox();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateLightbox(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateLightbox(1);
    }
  });

};

const init = async () => {
  sourceTabId = await getCurrentTabId();
  bindEvents();
  setAutoScrollButtonState(false);

  const configResponse = await sendMessage(MSG.GET_CONFIG);
  if (configResponse.success) {
    elements.toggleHd.checked = configResponse.config.enableHD !== false;
    elements.toggleAutoScan.checked = configResponse.config.enableAutoScan === true;
    elements.toggleSortSize.checked = configResponse.config.enableSizeSort === true;
    elements.togglePortraitOnly.checked = configResponse.config.enablePortraitOnly === true;
    elements.toggleWebP.checked = configResponse.config.enableWebPConvert === true;
    elements.toggleBatchZipDownload.checked = false;
    elements.toggleRightClick.checked = configResponse.config.enableRightClick === true;
    setAutoScrollButtonState(configResponse.config.enableAutoScroll === true);
    currentConfig.enableHD = elements.toggleHd.checked;
    currentConfig.enableAutoScan = elements.toggleAutoScan.checked;
    currentConfig.enableSizeSort = elements.toggleSortSize.checked;
    currentConfig.enablePortraitOnly = elements.togglePortraitOnly.checked;
    currentConfig.enableWebPConvert = elements.toggleWebP.checked;
    currentConfig.enableBatchZipDownload = false;
    currentConfig.enableRightClick = elements.toggleRightClick.checked;
    if (currentConfig.enableRightClick) {
      const ensureRightClick = await sendMessage(MSG.SET_CONFIG, { enableRightClick: true });
      if (!ensureRightClick.success) {
        setActionStatus(`解锁右键失败: ${ensureRightClick.error || "未知错误"}`, 3200);
      }
    }
  }

  setMetricInputs(RESOLUTION_PRESETS.all);
  setActivePreset("all");
  await renderImages();
  if (currentConfig.enableAutoScan) {
    if (currentImages.length > 0) {
      await syncAutoScanRuntime(true);
    } else {
      await scanImages();
    }
  }
  await restoreDownloadStatus();
};

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === MSG.DOWNLOAD_PROGRESS) {
    const downloadTabId = Number(message?.payload?.tabId);
    if (!Number.isInteger(downloadTabId) || downloadTabId !== sourceTabId) return;
    applyDownloadStatus(message.payload || null);
    return;
  }

  if (message?.type === MSG.IMAGES_UPDATED) {
    const updatedTabId = Number(message?.payload?.tabId);
    if (!Number.isInteger(updatedTabId) || updatedTabId !== sourceTabId) return;
    if (manualScanInProgress) return;
    scheduleRenderRefresh();
    return;
  }

  if (message?.type === MSG.AUTO_SCROLL_STATE_CHANGED) {
    const updatedTabId = Number(message?.payload?.tabId);
    if (!Number.isInteger(updatedTabId) || updatedTabId !== sourceTabId) return;
    const enabled = message?.payload?.enabled === true;
    setAutoScrollButtonState(enabled);
    if (!enabled && message?.payload?.finished === true) {
      setActionStatus("当前页面已无新增内容，自动滚动已停止", 2200);
    }
  }
});

document.addEventListener("DOMContentLoaded", init);
