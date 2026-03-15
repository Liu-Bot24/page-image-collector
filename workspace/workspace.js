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
  GET_COMIC_SEQUENCE: "GET_COMIC_SEQUENCE",
  GET_COMIC_PAGINATION: "GET_COMIC_PAGINATION",
  LOAD_COMIC_PAGINATION_PAGES: "LOAD_COMIC_PAGINATION_PAGES",
  START_AUTO_SCAN: "START_AUTO_SCAN",
  STOP_AUTO_SCAN: "STOP_AUTO_SCAN",
  START_AUTO_SCROLL: "START_AUTO_SCROLL",
  STOP_AUTO_SCROLL: "STOP_AUTO_SCROLL",
  AUTO_SCROLL_STATE_CHANGED: "AUTO_SCROLL_STATE_CHANGED",
  FOCUS_SOURCE_TAB_AND_START_AUTO_SCROLL: "FOCUS_SOURCE_TAB_AND_START_AUTO_SCROLL",
  IMAGES_UPDATED: "IMAGES_UPDATED",
  DOWNLOAD_PROGRESS: "DOWNLOAD_PROGRESS",
  PROBE_IMAGE_DIMENSIONS: "PROBE_IMAGE_DIMENSIONS",
  OPEN_DOWNLOAD_DIRECTORY: "OPEN_DOWNLOAD_DIRECTORY",
  OPEN_SOURCE_URL: "OPEN_SOURCE_URL",
  CLEAR_IMAGES: "CLEAR_IMAGES"
};

const elements = {
  btnScan: document.getElementById("btn-scan"),
  btnClear: document.getElementById("btn-clear"),
  toggleAutoScan: document.getElementById("toggle-auto-scan"),
  toggleHd: document.getElementById("toggle-hd"),
  toggleSortSize: document.getElementById("toggle-sort-size"),
  toggleComicMode: document.getElementById("toggle-comic-mode"),
  togglePortraitOnly: document.getElementById("toggle-portrait-only"),
  toggleWebP: document.getElementById("toggle-webp"),
  toggleBatchZipDownload: document.getElementById("toggle-batch-zip-download"),
  btnSelectAll: document.getElementById("btn-select-all"),
  btnDownloadBatch: document.getElementById("btn-download-batch"),
  btnCopyBatch: document.getElementById("btn-copy-batch"),
  btnOpenDownloadDir: document.getElementById("btn-open-download-dir"),
  resolutionPresets: document.getElementById("resolution-presets"),
  filterMinShort: document.getElementById("filter-min-short"),
  filterMinLong: document.getElementById("filter-min-long"),
  filterMinMp: document.getElementById("filter-min-mp"),
  comicBanner: document.getElementById("comic-banner"),
  comicBannerTitle: document.getElementById("comic-banner-title"),
  comicBannerDescription: document.getElementById("comic-banner-description"),
  comicBannerDescriptionText: document.getElementById("comic-banner-description-text"),
  comicBannerDescriptionNote: document.getElementById("comic-banner-description-note"),
  comicBannerAutoScrollLink: document.getElementById("comic-banner-autoscroll-link"),
  comicBannerPagination: document.getElementById("comic-banner-pagination"),
  comicBannerPaginationText: document.getElementById("comic-banner-pagination-text"),
  comicBannerPaginationLimit: document.getElementById("comic-banner-pagination-limit"),
  comicBannerPaginationWait: document.getElementById("comic-banner-pagination-wait"),
  comicBannerPaginationGo: document.getElementById("comic-banner-pagination-go"),
  formatFilters: document.getElementById("format-filters"),
  actionStatus: document.getElementById("action-status"),
  statTotal: document.getElementById("stat-total"),
  statFiltered: document.getElementById("stat-filtered"),
  statSelected: document.getElementById("stat-selected"),
  gallery: document.getElementById("gallery"),
  emptyState: document.getElementById("empty-state"),
  lightbox: document.getElementById("lightbox"),
  lightboxContent: document.querySelector(".lightbox-content"),
  lightboxImageStage: document.getElementById("lightbox-image-stage"),
  lightboxImage: document.getElementById("lightbox-image"),
  lightboxMode: document.getElementById("lightbox-mode"),
  lightboxDimensions: document.getElementById("lightbox-dimensions"),
  lightboxArea: document.getElementById("lightbox-area"),
  lightboxFormat: document.getElementById("lightbox-format"),
  lightboxUrl: document.getElementById("lightbox-url"),
  lightboxDownload: document.getElementById("lightbox-download"),
  lightboxCopy: document.getElementById("lightbox-copy"),
  lightboxSource: document.getElementById("lightbox-source"),
  lightboxOriginal: document.getElementById("lightbox-original"),
  lightboxFullscreen: document.getElementById("lightbox-fullscreen"),
  lightboxClose: document.getElementById("lightbox-close"),
  lightboxPrev: document.getElementById("lightbox-prev"),
  lightboxNext: document.getElementById("lightbox-next"),
  fullscreenViewer: document.getElementById("fullscreen-viewer"),
  fullscreenStage: document.getElementById("fullscreen-stage"),
  fullscreenImage: document.getElementById("fullscreen-image"),
  fullscreenLoading: document.getElementById("fullscreen-loading"),
  fullscreenPrev: document.getElementById("fullscreen-prev"),
  fullscreenNext: document.getElementById("fullscreen-next"),
  fullscreenClose: document.getElementById("fullscreen-close")
};

let sourceTabId = null;
let currentImages = [];
let selectedIds = new Set();
let lightboxImage = null;
let lightboxMode = "preview";
let lightboxCurrentSrc = "";
let lightboxPreviewSrc = "";
let lightboxOriginalSrc = "";
let lightboxSourceUrl = "";
let lightboxHasMeaningfulOriginal = false;
let lightboxOriginalEvalPending = false;
let lightboxCanOneToOne = false;
let lightboxSessionId = 0;
let lightboxIndex = -1;
let fullscreenActive = false;
let fullscreenZoomed = false;
let fullscreenCanZoom = false;
let fullscreenIndex = -1;
let fullscreenImageId = "";
let fullscreenScrollLock = {
  htmlOverflow: "",
  bodyOverflow: ""
};
let activePreset = "all";
let currentConfig = {
  enableHD: true,
  enableSizeSort: false,
  enablePortraitOnly: false,
  enableAutoScan: false,
  enableAutoScroll: false,
  enableWebPConvert: false,
  enableBatchZipDownload: false
};
let hasScannedOnce = false;
let comicModeEnabled = false;
let comicSequenceCache = null;
let comicSequenceTask = null;
let comicAssistState = {
  ownedAutoScan: false
};
let comicPaginationInfo = null;
let comicPaginationLoading = false;
const COMIC_PAGINATION_DETECT_TIMEOUT_MS = 8000;
const COMIC_PAGINATION_LIMIT_STORAGE_KEY = "comic_pagination_limit";
const COMIC_PAGINATION_WAIT_STORAGE_KEY = "comic_pagination_wait_seconds";
const clipboardPayloadCache = new Map();
const CLIPBOARD_CACHE_TTL = 5 * 60 * 1000;
const imageDimensionCache = new Map();
const cardDimensionCache = new Map();
const cardDimensionPending = new Set();
const cardDimensionTasks = new Map();
const fullscreenCache = new Map();
const fullscreenPendingTasks = new Map();
let actionStatusTimer = null;
let pinnedActionStatusTimer = null;
let autoRefreshTimer = null;
let manualScanInProgress = false;
let batchDownloadInProgress = false;
let activeDownloadStatus = null;
let downloadStatusPollTimer = null;
let suppressLightboxClickUntil = 0;
let dragSelectState = null;
let dragSelectionBox = null;
let dragPreviewIds = new Set();
let transientActionStatus = "";
let transientActionStatusTitle = "";
let pinnedActionStatus = "";
let pinnedActionStatusTitle = "";
const FULLSCREEN_PRELOAD_RADIUS = 4;
const DRAG_SELECT_MOVE_THRESHOLD = 6;
const DRAG_CLICK_SUPPRESS_MS = 260;
const FORMAT_GROUPS = [
  { value: "jpg", label: "JPG", aliases: ["jpg", "jpeg"] },
  { value: "png", label: "PNG", aliases: ["png"] },
  { value: "webp", label: "WebP", aliases: ["webp"] },
  { value: "gif", label: "GIF", aliases: ["gif"] },
  { value: "svg", label: "SVG", aliases: ["svg"] },
  { value: "avif", label: "AVIF", aliases: ["avif"] }
];
const PRIMARY_FORMATS = new Set(FORMAT_GROUPS.flatMap((item) => item.aliases));

const RESOLUTION_PRESETS = {
  all: { type: "all", minShort: 0, minLong: 0, minArea: 0 },
  "720p": { type: "resolution", minShort: 720, minLong: 1280, minArea: 1280 * 720 },
  "1080p": { type: "resolution", minShort: 1080, minLong: 1920, minArea: 1920 * 1080 },
  "2k": { type: "resolution", minShort: 1440, minLong: 2560, minArea: 2560 * 1440 },
  "4k": { type: "resolution", minShort: 2160, minLong: 3840, minArea: 3840 * 2160 }
};
const SELECT_ALL_LABEL = "全 选";
const UNSELECT_ALL_LABEL = "取消全选";

const workspaceQueryParams = new URLSearchParams(location.search);
const shouldAutoScanOnOpen = workspaceQueryParams.get("autoScan") === "1";
const shouldComicModeOnOpen = workspaceQueryParams.get("comicMode") === "1";
const sourceTabIdFromQuery = (() => {
  const urlTabId = workspaceQueryParams.get("tabId");
  const numeric = Number(urlTabId);
  return Number.isInteger(numeric) ? numeric : null;
})();

const withPromiseTimeout = (promise, timeoutMs, errorMessage) =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(errorMessage));
    }, timeoutMs);

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

const getSourceTabId = async () => {
  return sourceTabIdFromQuery;
};

const sendMessage = async (type, payload = {}) => {
  if (!Number.isInteger(sourceTabId)) {
    sourceTabId = await getSourceTabId();
  }
  if (!Number.isInteger(sourceTabId)) {
    return { success: false, error: "未绑定原网页标签页，请从原网页重新打开 Workspace" };
  }
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

const syncAutoScrollRuntime = async (enabled, options = {}) => {
  const response = await sendMessage(
    enabled ? MSG.START_AUTO_SCROLL : MSG.STOP_AUTO_SCROLL,
    enabled && options.profile ? { profile: options.profile } : {}
  );
  if (!response?.success) {
    const action = enabled ? "开启自动滚动" : "关闭自动滚动";
    setActionStatus(`${action}失败: ${response?.error || "未知错误"}`, 3200);
    return false;
  }
  return true;
};

const focusSourceTabAndStartAutoScroll = async () => {
  const response = await sendMessage(MSG.FOCUS_SOURCE_TAB_AND_START_AUTO_SCROLL);
  if (!response?.success) {
    setActionStatus(`切换原网页失败: ${response?.error || "未知错误"}`, 3200);
    return false;
  }
  return true;
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

const getImageDimensions = async (url) => {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return { width: 0, height: 0 };

  const cached = imageDimensionCache.get(normalizedUrl);
  if (cached) {
    return await cached;
  }

  const domProbe = () =>
    new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => {
        resolve({
          width: probe.naturalWidth || 0,
          height: probe.naturalHeight || 0
        });
      };
      probe.onerror = () => resolve({ width: 0, height: 0 });
      probe.src = normalizedUrl;
    });

  const promise = (async () => {
    if (/^https?:/i.test(normalizedUrl)) {
      const response = await sendMessage(MSG.PROBE_IMAGE_DIMENSIONS, { url: normalizedUrl });
      if (response?.success) {
        return {
          width: Number(response.width) || 0,
          height: Number(response.height) || 0
        };
      }
      return { width: 0, height: 0 };
    }
    return await domProbe();
  })();

  imageDimensionCache.set(normalizedUrl, promise);
  return await promise;
};

const computeArea = (width, height) => Math.max(0, (Number(width) || 0) * (Number(height) || 0));
const formatAreaMp = (area) => `${(Math.max(0, Number(area) || 0) / 1000000).toFixed(2)} MP`;

const getCardMeta = (image) => {
  const cached = cardDimensionCache.get(image.id);
  if (cached && currentConfig.enableHD) return cached;
  return {
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
    area: Math.max(Number(image.area) || 0, computeArea(image.width, image.height))
  };
};

const isHdBadge = (image) => {
  const currentMeta = getCardMeta(image);
  const maxMeta = cardDimensionCache.get(image.id) || {
    width: Number(image.width) || 0,
    height: Number(image.height) || 0,
    area: Math.max(Number(image.area) || 0, computeArea(image.width, image.height))
  };
  const hasLargeVariant = Boolean(image.hdSrc && image.hdSrc !== image.src);
  const highResolution = currentMeta.area >= (1280 * 720);
  if (!currentConfig.enableHD) {
    return highResolution;
  }
  return hasLargeVariant || maxMeta.area >= (1280 * 720);
};

const updateCardMetaInDom = (imageId, meta) => {
  const card = document.querySelector(`.gallery-card[data-id="${imageId}"]`);
  if (!card) return;
  if (!currentConfig.enableHD) return;
  const dim = card.querySelector(".dimensions");
  const area = card.querySelector(".area");
  if (dim) dim.textContent = `${meta.width} × ${meta.height}`;
  if (area) area.textContent = `${Math.round(meta.area / 1000)}K`;
  const image = currentImages.find((item) => item.id === imageId);
  if (!image) return;
  const existingBadge = card.querySelector(".hd-badge");
  if (isHdBadge(image) && !existingBadge) {
    const badge = document.createElement("span");
    badge.className = "hd-badge";
    badge.textContent = "HD";
    card.querySelector(".card-image")?.appendChild(badge);
  }
};

const resolveCardMaxDimensions = async (image) => {
  if (!image?.id) return getCardMeta(image);

  const cached = cardDimensionCache.get(image.id);
  if (cached) return cached;

  const pendingTask = cardDimensionTasks.get(image.id);
  if (pendingTask) return await pendingTask;

  const hasHdCandidate = Boolean(image.hdSrc && image.hdSrc !== image.src);

  const task = (async () => {
    cardDimensionPending.add(image.id);
    try {
      const probes = [getImageDimensions(image.src)];
      if (hasHdCandidate) {
        probes.push(getImageDimensions(image.hdSrc));
      }
      const [srcDim, hdDim = { width: 0, height: 0 }] = await Promise.all(probes);

      const srcArea = computeArea(srcDim.width, srcDim.height);
      const hdArea = computeArea(hdDim.width, hdDim.height);
      const baseWidth = Number(image.width) || 0;
      const baseHeight = Number(image.height) || 0;
      const baseArea = Math.max(Number(image.area) || 0, computeArea(baseWidth, baseHeight));

      let width = baseWidth;
      let height = baseHeight;
      let area = baseArea;

      if (srcArea >= area) {
        width = srcDim.width;
        height = srcDim.height;
        area = srcArea;
      }
      if (hdArea >= area) {
        width = hdDim.width;
        height = hdDim.height;
        area = hdArea;
      }

      const resolved = { width, height, area };
      cardDimensionCache.set(image.id, resolved);
      updateCardMetaInDom(image.id, resolved);
      return resolved;
    } finally {
      cardDimensionPending.delete(image.id);
      cardDimensionTasks.delete(image.id);
    }
  })();

  cardDimensionTasks.set(image.id, task);
  return await task;
};

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
  if (existing) {
    return existing;
  }

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
  if (!existing) {
    ensureMinMpOption(normalized);
  }
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
  if (!RESOLUTION_PRESETS[preset]) {
    return;
  }
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

// Experimental comic mode: workspace-local only. It never changes popup flow,
// background state shape, or the normal image collection path.
// Once enabled, the DOM-order sequence is intentionally frozen as a baseline.
// Later images are appended after the baseline instead of reordering the whole
// gallery again on every incremental update.
const invalidateComicSequenceCache = () => {
  comicSequenceCache = null;
  comicSequenceTask = null;
};

const fetchComicSequence = async () => {
  if (comicSequenceCache) return comicSequenceCache;
  if (comicSequenceTask) return await comicSequenceTask;

  const task = (async () => {
    const response = await sendMessage(MSG.GET_COMIC_SEQUENCE);
    if (!response?.success) {
      throw new Error(response?.error || "获取漫画顺序失败");
    }
    const sequence = Array.isArray(response.sequence) ? response.sequence : [];
    comicSequenceCache = sequence;
    return sequence;
  })();

  comicSequenceTask = task;
  try {
    return await task;
  } finally {
    if (comicSequenceTask === task) {
      comicSequenceTask = null;
    }
  }
};

const applyComicSequenceOrder = async (images = []) => {
  if (!comicModeEnabled || !Array.isArray(images) || images.length <= 1) {
    return images;
  }

  let sequence = [];
  try {
    const baselineSequence = await fetchComicSequence();
    sequence = baselineSequence;
  } catch (error) {
    setActionStatus(`漫画模式顺序分析失败: ${error?.message || "未知错误"}`, 3200);
    return images;
  }

  if (!Array.isArray(sequence) || sequence.length === 0) {
    return images;
  }

  const byNormalized = new Map();
  for (const image of images) {
    const normalized = String(image?.normalized || "");
    if (!normalized || byNormalized.has(normalized)) continue;
    byNormalized.set(normalized, image);
  }

  const ordered = [];
  const usedIds = new Set();

  for (const item of sequence) {
    const candidate =
      (item?.hdNormalized && byNormalized.get(item.hdNormalized)) ||
      (item?.normalized && byNormalized.get(item.normalized));
    if (!candidate || usedIds.has(candidate.id)) continue;
    ordered.push(candidate);
    usedIds.add(candidate.id);
  }

  if (ordered.length === 0) {
    return images;
  }

  for (const image of images) {
    if (usedIds.has(image.id)) continue;
    ordered.push(image);
  }

  return ordered;
};

const updateComicBanner = () => {
  if (!elements.comicBanner) return;
  elements.comicBanner.classList.toggle("is-active", comicModeEnabled);
  if (elements.toggleComicMode) {
    elements.toggleComicMode.checked = comicModeEnabled;
  }
  if (elements.comicBannerTitle) {
    elements.comicBannerTitle.textContent = comicModeEnabled
      ? "当前处于漫画模式（实验性）"
      : "漫画模式（实验性）";
  }
  if (elements.comicBannerDescription) {
    if (elements.comicBannerDescriptionText) {
      elements.comicBannerDescriptionText.textContent = "图片结果会按原网页中的阅读顺序排列。";
    } else {
      elements.comicBannerDescription.textContent = "图片结果会按原网页中的阅读顺序排列。";
    }
  }
  if (elements.comicBannerDescriptionNote) {
    elements.comicBannerDescriptionNote.hidden = !comicModeEnabled;
  }
  updateComicPaginationUi();
};

const getComicPaginationLimit = () => {
  const el = elements.comicBannerPaginationLimit;
  return el ? Math.max(1, Math.min(48, parseInt(el.value, 10) || 48)) : 48;
};

const getComicPaginationWaitSeconds = () => {
  const el = elements.comicBannerPaginationWait;
  return el ? Math.max(1, Math.min(30, parseInt(el.value, 10) || 6)) : 6;
};

const persistComicPaginationSettings = () => {
  try {
    chrome.storage.local.set({
      [COMIC_PAGINATION_LIMIT_STORAGE_KEY]: getComicPaginationLimit(),
      [COMIC_PAGINATION_WAIT_STORAGE_KEY]: getComicPaginationWaitSeconds()
    });
  } catch { /* ignore */ }
};

const restoreComicPaginationSettings = async () => {
  try {
    const stored = await chrome.storage.local.get([
      COMIC_PAGINATION_LIMIT_STORAGE_KEY,
      COMIC_PAGINATION_WAIT_STORAGE_KEY
    ]);
    const limit = Number(stored[COMIC_PAGINATION_LIMIT_STORAGE_KEY]);
    const wait = Number(stored[COMIC_PAGINATION_WAIT_STORAGE_KEY]);
    if (elements.comicBannerPaginationLimit && limit >= 1 && limit <= 48) {
      elements.comicBannerPaginationLimit.value = String(limit);
    }
    if (elements.comicBannerPaginationWait && wait >= 1 && wait <= 30) {
      elements.comicBannerPaginationWait.value = String(wait);
    }
  } catch { /* ignore */ }
};

const updateComicPaginationUi = () => {
  const el = elements.comicBannerPagination;
  if (!el) return;

  if (!comicModeEnabled || !comicPaginationInfo?.supported) {
    el.hidden = true;
    return;
  }

  el.hidden = false;

  if (elements.comicBannerPaginationGo) {
    elements.comicBannerPaginationGo.disabled = comicPaginationLoading;
  }
  if (elements.comicBannerPaginationLimit) {
    elements.comicBannerPaginationLimit.disabled = comicPaginationLoading;
  }
  if (elements.comicBannerPaginationWait) {
    elements.comicBannerPaginationWait.disabled = comicPaginationLoading;
  }
};

const refreshComicPaginationInfo = async () => {
  if (!comicModeEnabled || !Number.isInteger(sourceTabId)) {
    comicPaginationInfo = null;
    updateComicPaginationUi();
    return;
  }

  try {
    const response = await withPromiseTimeout(
      sendMessage(MSG.GET_COMIC_PAGINATION),
      COMIC_PAGINATION_DETECT_TIMEOUT_MS,
      "分页检测超时"
    );
    if (response?.success && response.pagination?.supported) {
      comicPaginationInfo = response.pagination;
    } else {
      comicPaginationInfo = null;
    }
  } catch {
    comicPaginationInfo = null;
  }

  updateComicPaginationUi();
};

const resetComicPaginationState = () => {
  comicPaginationInfo = null;
  comicPaginationLoading = false;
  updateComicPaginationUi();
};

const loadComicPaginationPages = async () => {
  if (!comicPaginationInfo?.supported || comicPaginationLoading) return;
  if (!comicPaginationInfo.nextUrl) return;

  const limit = getComicPaginationLimit();
  const waitSeconds = getComicPaginationWaitSeconds();

  comicPaginationLoading = true;
  updateComicPaginationUi();
  persistComicPaginationSettings();
  setActionStatus("正在获取后续分页图片，请稍候…", 0);

  try {
    const response = await sendMessage(MSG.LOAD_COMIC_PAGINATION_PAGES, {
      nextUrl: comicPaginationInfo.nextUrl,
      limit,
      waitSeconds
    });

    if (response?.success) {
      const loaded = response.loadedPages || 0;
      const added = (response.results || []).reduce((sum, r) => sum + (r.added || 0), 0);
      setActionStatus(`分页加载完成，共加载 ${loaded} 页，新增 ${added} 张图片`, 8000);
      invalidateComicSequenceCache();
      await renderGallery();
    } else {
      setActionStatus(`分页加载失败: ${response?.error || "未知错误"}`, 8000);
    }
  } catch (error) {
    setActionStatus(`分页加载出错: ${error?.message || "未知错误"}`, 8000);
  } finally {
    comicPaginationLoading = false;
    updateComicPaginationUi();
  }
};

const releaseComicRuntimeAssist = async () => {
  const ownedAutoScan = comicAssistState.ownedAutoScan === true;
  const configResponse = await sendMessage(MSG.GET_CONFIG);
  const runtimeConfig = configResponse?.success ? (configResponse.config || {}) : {};

  comicAssistState = {
    ownedAutoScan: false
  };

  if (ownedAutoScan && runtimeConfig.enableAutoScan !== true) {
    await syncAutoScanRuntime(false);
  }
};

const ensureComicRuntimeAssist = async () => {
  if (comicAssistState.ownedAutoScan) {
    return true;
  }

  const configResponse = await sendMessage(MSG.GET_CONFIG);
  const runtimeConfig = configResponse?.success ? (configResponse.config || {}) : {};

  const owned = {
    ownedAutoScan: false
  };

  if (runtimeConfig.enableAutoScan !== true) {
    const ok = await syncAutoScanRuntime(true);
    if (!ok) {
      return false;
    }
    owned.ownedAutoScan = true;
  }

  comicAssistState = owned;
  return true;
};

const setComicModeEnabled = async (enabled, options = {}) => {
  const nextValue = enabled === true;
  if (comicModeEnabled === nextValue) {
    updateComicBanner();
    return true;
  }

  if (nextValue && !Number.isInteger(sourceTabId)) {
    setActionStatus("未绑定原网页，无法开启漫画模式", 2400);
    updateComicBanner();
    return false;
  }

  if (nextValue) {
    const assistReady = await ensureComicRuntimeAssist();
    if (!assistReady) {
      updateComicBanner();
      return false;
    }
  } else {
    await releaseComicRuntimeAssist();
  }

  comicModeEnabled = nextValue;
  invalidateComicSequenceCache();
  updateComicBanner();

  if (nextValue) {
    refreshComicPaginationInfo().catch(() => {});
  } else {
    resetComicPaginationState();
  }

  if (options.showStatus !== false) {
    setActionStatus(comicModeEnabled ? "已开启漫画模式（实验性）" : "已关闭漫画模式", 1800);
  }

  await renderGallery();
  return true;
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
    label.innerHTML = `
      <input type="checkbox" value="${option.value}" ${selected.has(option.value) ? "checked" : ""}>
      <span class="format-name">${option.label}</span>
      <span class="format-count">${option.count}</span>
    `;
    fragment.appendChild(label);
  }

  elements.formatFilters.appendChild(fragment);
};

const ACTION_STATUS_MAX_LENGTH = 72;

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
  if (phase === "completed") return mode === "zip" ? "打包下载完毕" : "批量下载完毕";
  if (phase === "failed") return `下载失败: ${status.error || "未知错误"}`;
  return "";
};

const formatDownloadButtonText = (status) => {
  if (!status || status.active !== true) return "批量下载";
  const phase = String(status.phase || "");
  const current = Number(status.current);
  const total = Number(status.total);
  const partIndex = Math.max(1, Number(status.partIndex) || 1);

  if (phase === "zip_prepare") return "准备打包";
  if (phase === "zip") return Number.isInteger(current) && Number.isInteger(total) ? `打包中 ${current}/${total}` : "打包中";
  if (phase === "zip_part_build") return `生成ZIP ${partIndex}`;
  if (phase === "zip_part_download") return `下载ZIP ${partIndex}`;
  if (phase === "direct_prepare") return "准备下载";
  if (phase === "direct") return Number.isInteger(current) && Number.isInteger(total) ? `下载中 ${current}/${total}` : "下载中";
  return "批量下载";
};

const syncBatchDownloadUiState = () => {
  const selected = selectedIds.size;
  elements.btnDownloadBatch.disabled = batchDownloadInProgress || selected === 0;
  elements.btnDownloadBatch.textContent = formatDownloadButtonText(activeDownloadStatus);
};

const applyDownloadStatus = (status) => {
  activeDownloadStatus = status || null;
  batchDownloadInProgress = activeDownloadStatus?.active === true;
  syncBatchDownloadUiState();
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
  const timeoutMs = activeDownloadStatus?.active === true ? -1 : activeDownloadStatus?.phase === "failed" ? 4200 : 2600;
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
  const preservePersistentStatus = hasActiveDownloadTask() || comicPaginationLoading;
  if (!preservePersistentStatus) {
    setActionStatus("采集中...", -1);
  }
  autoRefreshTimer = setTimeout(() => {
    autoRefreshTimer = null;
    renderGallery()
      .then(() => {
        if (!preservePersistentStatus) {
          setActionStatus("采集完成", 1200);
        }
      })
      .catch(() => {
        if (!preservePersistentStatus) {
          setActionStatus("刷新失败，请重试", 2400);
        }
      });
  }, 120);
};

const syncScanButtonLabel = () => {
  if (elements.btnScan.disabled) return;
  elements.btnScan.textContent = hasScannedOnce ? "继续扫描" : "开始扫描";
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
  if (presetRule.type === "mp") {
    if (meta.area < presetRule.minArea) return false;
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

const formatFromUrl = (url) => {
  if (!url) return "unknown";
  try {
    const parsed = new URL(url);
    if (
      String(url).startsWith("blob:https://web.telegram.org/") ||
      (parsed.protocol === "blob:" && /web\.telegram\.org/i.test(String(parsed.pathname || "")))
    ) {
      return "jpg";
    }
    const fromParam = parsed.searchParams.get("format");
    if (fromParam) return fromParam.toLowerCase();

    const formatByRule = parsed.href.match(/(?:format=|\/format\/)(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[&/?#]|$)/i);
    if (formatByRule?.[1]) return formatByRule[1].toLowerCase();

    const formatFromSuffix = parsed.pathname.match(/(?:^|[_!.-])(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[_!.-]|$)/i);
    if (formatFromSuffix?.[1]) return formatFromSuffix[1].toLowerCase();

    if (/xhscdn\.com$/i.test(parsed.hostname) && (/webpic/i.test(parsed.hostname) || /notes_pre_post/i.test(parsed.pathname))) {
      return "webp";
    }
  } catch {
    // Ignore parse failures.
  }
  const match = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "unknown";
};

const resolveImageFormat = (image) => {
  const raw = String(image?.format || "").toLowerCase();
  if (raw && raw !== "unknown") return raw;
  return formatFromUrl(image?.displaySrc || image?.hdSrc || image?.src || image?.originalSrc || "");
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

const LIGHTBOX_NAV_BUCKET_CLASSES = [
  "nav-bucket-portrait",
  "nav-bucket-square",
  "nav-bucket-landscape",
  "nav-bucket-ultrawide"
];

const applyLightboxNavBucket = (width, height) => {
  const safeWidth = Number(width) || 0;
  const safeHeight = Number(height) || 0;
  const ratio = safeWidth > 0 && safeHeight > 0 ? safeWidth / safeHeight : 1;
  let bucketClass = "nav-bucket-square";
  if (ratio < 0.82) {
    bucketClass = "nav-bucket-portrait";
  } else if (ratio > 1.85) {
    bucketClass = "nav-bucket-ultrawide";
  } else if (ratio > 1.18) {
    bucketClass = "nav-bucket-landscape";
  }
  elements.lightboxContent.classList.remove(...LIGHTBOX_NAV_BUCKET_CLASSES);
  elements.lightboxContent.classList.add(bucketClass);
};

const getFullscreenSourceForImage = (image) => {
  const { previewSrc, originalSrc } = getViewSources(image);
  return originalSrc || previewSrc || image?.hdSrc || image?.src || image?.originalSrc || "";
};

const setFullscreenLoading = (loading, text = "加载中...") => {
  elements.fullscreenLoading.textContent = text;
  elements.fullscreenLoading.classList.toggle("active", loading);
};

const releaseFullscreenCacheEntry = (url) => {
  const entry = fullscreenCache.get(url);
  if (!entry) return;
  if (entry.objectUrl) {
    URL.revokeObjectURL(entry.objectUrl);
  }
  fullscreenCache.delete(url);
};

const clearFullscreenCache = () => {
  for (const url of fullscreenCache.keys()) {
    releaseFullscreenCacheEntry(url);
  }
  fullscreenPendingTasks.clear();
};

const ensureFullscreenCache = async (url) => {
  if (!url) return { displayUrl: "", cached: false };

  const cached = fullscreenCache.get(url);
  if (cached) {
    cached.lastUsed = Date.now();
    return { displayUrl: cached.objectUrl || url, cached: Boolean(cached.objectUrl) };
  }

  const pending = fullscreenPendingTasks.get(url);
  if (pending) {
    return await pending;
  }

  const task = (async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      fullscreenCache.set(url, {
        objectUrl,
        size: blob.size || 0,
        lastUsed: Date.now()
      });
      return { displayUrl: objectUrl, cached: true };
    } catch {
      fullscreenCache.set(url, {
        objectUrl: "",
        size: 0,
        lastUsed: Date.now(),
        failed: true
      });
      return { displayUrl: url, cached: false };
    } finally {
      fullscreenPendingTasks.delete(url);
    }
  })();

  fullscreenPendingTasks.set(url, task);
  return await task;
};

const getFullscreenWindowIndexes = (centerIndex) => {
  if (!currentImages.length) return [];
  const start = Math.max(0, centerIndex - FULLSCREEN_PRELOAD_RADIUS);
  const end = Math.min(currentImages.length - 1, centerIndex + FULLSCREEN_PRELOAD_RADIUS);
  const indexes = [];
  for (let i = start; i <= end; i += 1) {
    indexes.push(i);
  }
  return indexes;
};

const pruneFullscreenCache = (centerIndex) => {
  const keepUrls = new Set(
    getFullscreenWindowIndexes(centerIndex)
      .map((index) => getFullscreenSourceForImage(currentImages[index]))
      .filter(Boolean)
  );
  for (const url of fullscreenCache.keys()) {
    if (!keepUrls.has(url)) {
      releaseFullscreenCacheEntry(url);
    }
  }
};

const preloadFullscreenAround = (centerIndex) => {
  if (!fullscreenActive) return;
  const indexes = getFullscreenWindowIndexes(centerIndex);
  for (const index of indexes) {
    if (index === centerIndex) continue;
    const image = currentImages[index];
    const source = getFullscreenSourceForImage(image);
    if (!source) continue;
    ensureFullscreenCache(source).catch(() => {});
  }
  pruneFullscreenCache(centerIndex);
};

const updateFullscreenNavigation = () => {
  const hasMultiple = currentImages.length > 1;
  elements.fullscreenPrev.disabled = !hasMultiple;
  elements.fullscreenNext.disabled = !hasMultiple;
};

const lockFullscreenPageScroll = () => {
  fullscreenScrollLock = {
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow
  };
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
};

const unlockFullscreenPageScroll = () => {
  document.documentElement.style.overflow = fullscreenScrollLock.htmlOverflow;
  document.body.style.overflow = fullscreenScrollLock.bodyOverflow;
};

const setFullscreenStagePadding = (padX = 0, padY = 0) => {
  const x = Math.max(0, Math.round(Number(padX) || 0));
  const y = Math.max(0, Math.round(Number(padY) || 0));
  elements.fullscreenStage.style.paddingLeft = `${x}px`;
  elements.fullscreenStage.style.paddingRight = `${x}px`;
  elements.fullscreenStage.style.paddingTop = `${y}px`;
  elements.fullscreenStage.style.paddingBottom = `${y}px`;
};

const setLightboxStagePadding = (padX = 0, padY = 0) => {
  const x = Math.max(0, Math.round(Number(padX) || 0));
  const y = Math.max(0, Math.round(Number(padY) || 0));
  elements.lightboxImageStage.style.paddingLeft = `${x}px`;
  elements.lightboxImageStage.style.paddingRight = `${x}px`;
  elements.lightboxImageStage.style.paddingTop = `${y}px`;
  elements.lightboxImageStage.style.paddingBottom = `${y}px`;
};

const syncLightboxOriginalScrollLayout = () => {
  if (lightboxMode !== "original") {
    setLightboxStagePadding(0, 0);
    elements.lightboxImageStage.scrollTo({ left: 0, top: 0, behavior: "auto" });
    return;
  }

  const stage = elements.lightboxImageStage;
  const imageWidth = elements.lightboxImage.naturalWidth || elements.lightboxImage.scrollWidth || 0;
  const imageHeight = elements.lightboxImage.naturalHeight || elements.lightboxImage.scrollHeight || 0;
  const padX = Math.max(0, (stage.clientWidth - imageWidth) / 2);
  const padY = Math.max(0, (stage.clientHeight - imageHeight) / 2);
  setLightboxStagePadding(padX, padY);

  const maxLeft = Math.max(0, (stage.scrollWidth || 0) - stage.clientWidth);
  const maxTop = Math.max(0, (stage.scrollHeight || 0) - stage.clientHeight);
  const targetLeft = Math.min(Math.max(0, (padX + (imageWidth / 2)) - (stage.clientWidth / 2)), maxLeft);
  const targetTop = Math.min(Math.max(0, (padY + (imageHeight / 2)) - (stage.clientHeight / 2)), maxTop);
  stage.scrollTo({ left: targetLeft, top: targetTop, behavior: "auto" });
};

const updateFullscreenZoomCapability = () => {
  const image = elements.fullscreenImage;
  const displayedWidth = image.getBoundingClientRect().width || 0;
  const displayedHeight = image.getBoundingClientRect().height || 0;
  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  // 至少有一个维度还能明显放大，才提供缩放能力。
  fullscreenCanZoom =
    (naturalWidth - displayedWidth > 2) ||
    (naturalHeight - displayedHeight > 2);
  elements.fullscreenViewer.classList.toggle("is-zoomable", fullscreenCanZoom);
  if (!fullscreenCanZoom && fullscreenZoomed) {
    setFullscreenZoom(false);
  }
};

const setFullscreenZoom = (zoomed, focus = null) => {
  if (zoomed && !fullscreenCanZoom) return;
  fullscreenZoomed = zoomed;
  elements.fullscreenViewer.classList.toggle("is-zoomed", zoomed);
  if (zoomed) {
    requestAnimationFrame(() => {
      const stage = elements.fullscreenStage;
      const imageWidth = elements.fullscreenImage.naturalWidth || elements.fullscreenImage.scrollWidth || 0;
      const imageHeight = elements.fullscreenImage.naturalHeight || elements.fullscreenImage.scrollHeight || 0;
      const padX = Math.max(0, (stage.clientWidth - imageWidth) / 2);
      const padY = Math.max(0, (stage.clientHeight - imageHeight) / 2);
      setFullscreenStagePadding(padX, padY);

      const maxLeft = Math.max(0, (stage.scrollWidth || 0) - stage.clientWidth);
      const maxTop = Math.max(0, (stage.scrollHeight || 0) - stage.clientHeight);
      let targetLeft = Math.max(0, (padX + (imageWidth / 2)) - (stage.clientWidth / 2));
      let targetTop = Math.max(0, (padY + (imageHeight / 2)) - (stage.clientHeight / 2));

      if (focus && Number.isFinite(focus.ratioX) && Number.isFinite(focus.ratioY)) {
        const viewportX = Number.isFinite(focus.viewportX) ? focus.viewportX : (stage.clientWidth / 2);
        const viewportY = Number.isFinite(focus.viewportY) ? focus.viewportY : (stage.clientHeight / 2);
        targetLeft = (padX + (imageWidth * focus.ratioX)) - viewportX;
        targetTop = (padY + (imageHeight * focus.ratioY)) - viewportY;
      }

      targetLeft = Math.min(Math.max(0, targetLeft), maxLeft);
      targetTop = Math.min(Math.max(0, targetTop), maxTop);
      stage.scrollTo({ left: targetLeft, top: targetTop, behavior: "auto" });
    });
    return;
  }
  setFullscreenStagePadding(0, 0);
  elements.fullscreenStage.scrollTo({ left: 0, top: 0, behavior: "auto" });
};

const renderFullscreenImage = async () => {
  if (!fullscreenActive) return;
  const image = currentImages[fullscreenIndex];
  if (!image) return;
  fullscreenImageId = image.id;
  const source = getFullscreenSourceForImage(image);
  if (!source) return;
  elements.fullscreenImage.dataset.source = source;
  setFullscreenLoading(true, "加载原图...");
  const { displayUrl } = await ensureFullscreenCache(source);
  if (!fullscreenActive) return;
  if (elements.fullscreenImage.dataset.source !== source) return;
  elements.fullscreenImage.src = displayUrl || source;
  elements.fullscreenImage.onerror = () => {
    elements.fullscreenImage.src = source;
    setFullscreenLoading(false);
    requestAnimationFrame(updateFullscreenZoomCapability);
  };
  elements.fullscreenImage.onload = () => {
    setFullscreenLoading(false);
    requestAnimationFrame(updateFullscreenZoomCapability);
  };
  updateFullscreenNavigation();
  preloadFullscreenAround(fullscreenIndex);
};

const openFullscreenViewer = (startIndex = 0) => {
  if (!currentImages.length) return;
  const safeIndex = Math.min(Math.max(0, startIndex), currentImages.length - 1);
  fullscreenActive = true;
  fullscreenIndex = safeIndex;
  lockFullscreenPageScroll();
  setFullscreenZoom(false);
  elements.fullscreenViewer.classList.add("active");
  renderFullscreenImage().catch(() => {
    setFullscreenLoading(false);
  });
};

const closeFullscreenViewer = () => {
  fullscreenActive = false;
  fullscreenIndex = -1;
  fullscreenImageId = "";
  fullscreenCanZoom = false;
  setFullscreenZoom(false);
  elements.fullscreenImage.src = "";
  elements.fullscreenViewer.classList.remove("active");
  elements.fullscreenViewer.classList.remove("is-zoomable");
  setFullscreenLoading(false);
  clearFullscreenCache();
  unlockFullscreenPageScroll();
};

const navigateFullscreen = (step) => {
  if (!fullscreenActive || !currentImages.length) return;
  const total = currentImages.length;
  if (total === 1) return;
  fullscreenIndex = (fullscreenIndex + step + total) % total;
  setFullscreenZoom(false);
  renderFullscreenImage().catch(() => {
    setFullscreenLoading(false);
  });
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
  elements.lightboxArea.textContent = formatAreaMp(width * height);
  const format = String(resolveImageFormat(lightboxImage) || formatFromUrl(src) || "unknown").toUpperCase();
  elements.lightboxFormat.textContent = format;
  elements.lightboxUrl.textContent = src;
  syncLightboxModeChip();
  applyLightboxNavBucket(width, height);
};

const getLightboxModeText = () => {
  if (lightboxOriginalEvalPending) return "";
  if (!lightboxHasMeaningfulOriginal) return "原图模式";
  return lightboxMode === "original" ? "原图模式" : "预览模式";
};

const syncLightboxModeChip = () => {
  if (!elements.lightboxMode) return;
  const text = getLightboxModeText();
  elements.lightboxMode.textContent = text;
  elements.lightboxMode.style.visibility = text ? "visible" : "hidden";
};

const canToggleOneToOne = () => !lightboxOriginalEvalPending && !lightboxHasMeaningfulOriginal && lightboxCanOneToOne;

const updateOneToOneCapabilityFromCurrentDisplay = () => {
  if (lightboxHasMeaningfulOriginal || lightboxOriginalEvalPending) {
    lightboxCanOneToOne = false;
    return;
  }
  if (lightboxMode !== "preview") return;
  const naturalWidth = elements.lightboxImage.naturalWidth || 0;
  const naturalHeight = elements.lightboxImage.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) {
    lightboxCanOneToOne = false;
    return;
  }
  const rect = elements.lightboxImage.getBoundingClientRect();
  const displayedWidth = rect.width || 0;
  const displayedHeight = rect.height || 0;
  lightboxCanOneToOne =
    (naturalWidth - displayedWidth > 2) ||
    (naturalHeight - displayedHeight > 2);
};

const updateOriginalButton = () => {
  const canUseOriginal = lightboxHasMeaningfulOriginal;
  const canUseOneToOne = canToggleOneToOne();
  elements.lightboxOriginal.disabled = !canUseOriginal && !canUseOneToOne;
  elements.lightboxOriginal.textContent = canUseOneToOne ? "1:1查看" : "查看大图";
  elements.lightboxOriginal.classList.toggle("is-active", (canUseOriginal || canUseOneToOne) && lightboxMode === "original");
  if (elements.lightboxSource) {
    const hasSource = Boolean(lightboxSourceUrl);
    elements.lightboxSource.disabled = !hasSource;
    elements.lightboxSource.title = hasSource ? lightboxSourceUrl : "未记录图片来源";
  }
  syncLightboxModeChip();
};

const updateLightboxNavigation = () => {
  const hasMultiple = currentImages.length > 1;
  elements.lightboxPrev.disabled = !hasMultiple;
  elements.lightboxNext.disabled = !hasMultiple;
};

const setLightboxSource = (src, mode) => {
  if (!src) return;
  lightboxMode = mode;
  lightboxCurrentSrc = src;
  elements.lightboxContent.classList.toggle("is-original", mode === "original");
  elements.lightboxImage.dataset.fallbackApplied = "0";
  elements.lightboxImage.src = src;
  elements.lightboxImage.onload = () => {
    syncLightboxMeta(src);
    updateOneToOneCapabilityFromCurrentDisplay();
    updateOriginalButton();
    syncLightboxOriginalScrollLayout();
  };
  elements.lightboxImage.onerror = () => fallbackImageError(elements.lightboxImage, lightboxImage?.src, lightboxImage);
  syncLightboxMeta(src);
  syncLightboxOriginalScrollLayout();
  updateOriginalButton();
  preloadClipboardPayload(lightboxImage, src, false).catch(() => {});
};

const evaluateMeaningfulOriginal = async (sessionId) => {
  const hasOriginalCandidate = Boolean(lightboxOriginalSrc && lightboxOriginalSrc !== lightboxPreviewSrc);
  if (!hasOriginalCandidate) {
    lightboxOriginalEvalPending = false;
    lightboxHasMeaningfulOriginal = false;
    updateOneToOneCapabilityFromCurrentDisplay();
    updateOriginalButton();
    return;
  }

  const [previewDim, originalDim] = await Promise.all([
    getImageDimensions(lightboxPreviewSrc),
    getImageDimensions(lightboxOriginalSrc)
  ]);

  if (sessionId !== lightboxSessionId) return;

  const bothKnown = previewDim.width > 0 && previewDim.height > 0 && originalDim.width > 0 && originalDim.height > 0;
  const sameDimensions =
    bothKnown &&
    previewDim.width === originalDim.width &&
    previewDim.height === originalDim.height;

  lightboxOriginalEvalPending = false;
  lightboxHasMeaningfulOriginal = !sameDimensions;
  if (lightboxHasMeaningfulOriginal) {
    lightboxCanOneToOne = false;
  } else {
    updateOneToOneCapabilityFromCurrentDisplay();
  }
  if (!lightboxHasMeaningfulOriginal && lightboxMode === "original") {
    setLightboxSource(lightboxPreviewSrc, "preview");
  }
  updateOriginalButton();
};

const updateStats = async ({ visibleImages = [], facetStats = {} } = {}) => {
  const response = await sendMessage(MSG.GET_STATS);
  if (!response.success) return;
  const { total, selected } = response.stats;
  elements.statTotal.textContent = String(total);
  elements.statFiltered.textContent = String(visibleImages.length);
  elements.statSelected.textContent = String(selected);
  elements.btnDownloadBatch.disabled = batchDownloadInProgress || selected === 0;
  elements.btnCopyBatch.disabled = selected === 0;
  elements.btnDownloadBatch.textContent = formatDownloadButtonText(activeDownloadStatus);
  renderFormatFilters(facetStats);
};

const refreshSelectedState = async () => {
  const response = await sendMessage(MSG.GET_SELECTED);
  if (!response.success) return new Set();
  return new Set(response.images.map((image) => image.id));
};

const getVisibleSelectionInfo = () => {
  const visibleIds = currentImages.map((image) => image.id);
  const selectedVisibleCount = visibleIds.reduce(
    (count, id) => count + (selectedIds.has(id) ? 1 : 0),
    0
  );
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  return { visibleIds, selectedVisibleCount, allVisibleSelected };
};

const syncSelectAllButtonLabel = () => {
  const { allVisibleSelected } = getVisibleSelectionInfo();
  elements.btnSelectAll.textContent = allVisibleSelected ? UNSELECT_ALL_LABEL : SELECT_ALL_LABEL;
};

const createCard = (image, index) => {
  const displaySrc = image.displaySrc || image.src;
  const ext = String(resolveImageFormat(image) || formatFromUrl(displaySrc) || "unknown").toUpperCase();
  const isSelected = selectedIds.has(image.id);
  const meta = getCardMeta(image);

  const card = document.createElement("div");
  card.className = `gallery-card${isSelected ? " selected" : ""}`;
  card.dataset.id = image.id;
  card.innerHTML = `
    <div class="card-image">
      <img src="${displaySrc}" alt="Image preview" loading="lazy">
      ${isHdBadge(image) ? '<span class="hd-badge">HD</span>' : ""}
      <span class="format-badge">${ext}</span>
    </div>
    <div class="card-footer">
      <span class="dimensions">${meta.width} × ${meta.height}</span>
      <span class="area">${Math.round(meta.area / 1000)}K</span>
    </div>
    <div class="card-select">
      <button class="checkbox ${isSelected ? "checked" : ""}" type="button">${isSelected ? "✓" : ""}</button>
    </div>
  `;

  const imageNode = card.querySelector("img");
  imageNode.addEventListener("error", () => fallbackImageError(imageNode, image.src, image));
  imageNode.addEventListener("click", (event) => {
    if (Date.now() < suppressLightboxClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    openLightbox(image, index);
  });

  const checkbox = card.querySelector(".checkbox");
  checkbox.addEventListener("click", async (event) => {
    event.stopPropagation();
    await toggleSelect(image.id);
  });

  resolveCardMaxDimensions(image).catch(() => {});

  return card;
};

const renderGallery = async () => {
  teardownDragSelect();
  const filters = getFilters();
  const allResponse = await sendMessage(MSG.GET_IMAGES, { filtered: false });
  if (!allResponse.success) return;
  const allImages = allResponse.images || [];

  const needsDimensionHydration =
    currentConfig.enableHD &&
    (
      currentConfig.enableSizeSort ||
      currentConfig.enablePortraitOnly ||
      filters.preset !== "all" ||
      filters.formats.length > 0 ||
      filters.minShort > 0 ||
      filters.minLong > 0 ||
      filters.minArea > 0
    );

  if (needsDimensionHydration) {
    await Promise.all(allImages.map((image) => resolveCardMaxDimensions(image)));
  }

  const metricAndOrientationFiltered = allImages
    .filter((image) => passesMetricFilters(image, filters))
    .filter((image) => passesOrientationFilter(image));
  const facetStats = computeFormatStatsFromImages(metricAndOrientationFiltered);

  currentImages = metricAndOrientationFiltered
    .filter((image) => passesFormatFilters(image, filters.formats));

  if (comicModeEnabled) {
    currentImages = await applyComicSequenceOrder(currentImages);
  } else if (currentConfig.enableSizeSort) {
    currentImages = currentImages.sort((a, b) => {
      const aMeta = getImageMetaForFilters(a);
      const bMeta = getImageMetaForFilters(b);
      return bMeta.area - aMeta.area;
    });
  }
  selectedIds = await refreshSelectedState();

  if (elements.lightbox.classList.contains("active") && lightboxImage) {
    const nextIndex = currentImages.findIndex((item) => item.id === lightboxImage.id);
    if (nextIndex === -1) {
      closeLightbox();
    } else {
      lightboxIndex = nextIndex;
      updateLightboxNavigation();
    }
  }

  if (fullscreenActive) {
    if (currentImages.length === 0) {
      closeFullscreenViewer();
    } else {
      const nextIndexById = fullscreenImageId
        ? currentImages.findIndex((item) => item.id === fullscreenImageId)
        : -1;
      if (nextIndexById >= 0) {
        fullscreenIndex = nextIndexById;
      } else if (fullscreenIndex >= currentImages.length || fullscreenIndex < 0) {
        fullscreenIndex = 0;
      }
      renderFullscreenImage().catch(() => {
        setFullscreenLoading(false);
      });
    }
  }

  elements.gallery.innerHTML = "";
  if (currentImages.length === 0) {
    elements.emptyState.style.display = "flex";
    elements.gallery.appendChild(elements.emptyState);
    elements.btnSelectAll.textContent = SELECT_ALL_LABEL;
    await updateStats({ visibleImages: currentImages, facetStats });
    hasScannedOnce = hasScannedOnce || allImages.length > 0;
    syncScanButtonLabel();
    return;
  }

  elements.emptyState.style.display = "none";
  const fragment = document.createDocumentFragment();
  for (const [index, image] of currentImages.entries()) {
    fragment.appendChild(createCard(image, index));
  }
  elements.gallery.appendChild(fragment);

  syncSelectAllButtonLabel();
  await updateStats({ visibleImages: currentImages, facetStats });
  hasScannedOnce = true;
  syncScanButtonLabel();
};

const toggleSelect = async (imageId) => {
  const response = await sendMessage(MSG.TOGGLE_SELECT, { imageId });
  if (!response.success) return;
  selectedIds = new Set(response.selectedIds || []);
  await renderGallery();
};

const isSelectableCardTarget = (target) => {
  if (!(target instanceof Element)) return false;
  if (!target.closest("#gallery")) return false;
  if (target.closest(".empty-state")) return false;
  if (target.closest(".checkbox")) return false;
  if (target.closest("button, a, input, select, textarea, label")) return false;
  return true;
};

const getGalleryPoint = (clientX, clientY) => {
  const rect = elements.gallery.getBoundingClientRect();
  const x = clientX - rect.left + elements.gallery.scrollLeft;
  const y = clientY - rect.top + elements.gallery.scrollTop;
  return { x, y };
};

const normalizeSelectionRect = (start, end) => {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top
  };
};

const ensureDragSelectionBox = () => {
  if (dragSelectionBox?.isConnected) return dragSelectionBox;
  const node = document.createElement("div");
  node.className = "drag-selection-box";
  elements.gallery.appendChild(node);
  dragSelectionBox = node;
  return dragSelectionBox;
};

const updateDragSelectionBox = (rect) => {
  const box = ensureDragSelectionBox();
  box.style.display = "block";
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${Math.max(rect.width, 1)}px`;
  box.style.height = `${Math.max(rect.height, 1)}px`;
};

const hideDragSelectionBox = () => {
  if (!dragSelectionBox) return;
  dragSelectionBox.style.display = "none";
};

const clearDragPreview = () => {
  for (const id of dragPreviewIds) {
    const node = elements.gallery.querySelector(`.gallery-card[data-id="${id}"]`);
    node?.classList.remove("drag-preview");
  }
  dragPreviewIds = new Set();
};

const updateDragPreview = (ids) => {
  const next = new Set(ids);
  for (const id of dragPreviewIds) {
    if (next.has(id)) continue;
    const node = elements.gallery.querySelector(`.gallery-card[data-id="${id}"]`);
    node?.classList.remove("drag-preview");
  }
  for (const id of next) {
    if (dragPreviewIds.has(id)) continue;
    const node = elements.gallery.querySelector(`.gallery-card[data-id="${id}"]`);
    node?.classList.add("drag-preview");
  }
  dragPreviewIds = next;
};

const hitTestSelectionCards = (rect) => {
  const hitIds = new Set();
  const cards = elements.gallery.querySelectorAll(".gallery-card[data-id]");
  for (const card of cards) {
    const cardLeft = card.offsetLeft;
    const cardTop = card.offsetTop;
    const cardRight = cardLeft + card.offsetWidth;
    const cardBottom = cardTop + card.offsetHeight;
    const intersects =
      rect.left <= cardRight &&
      rect.right >= cardLeft &&
      rect.top <= cardBottom &&
      rect.bottom >= cardTop;
    if (!intersects) continue;
    if (card.dataset.id) hitIds.add(card.dataset.id);
  }
  return hitIds;
};

const applyDragSelection = async (hitIds, replaceMode) => {
  const targetIds = Array.from(hitIds);
  if (!replaceMode) {
    if (targetIds.length === 0) return;

    const addIds = targetIds.filter((id) => !selectedIds.has(id));
    const removeIds = targetIds.filter((id) => selectedIds.has(id));

    if (removeIds.length > 0) {
      const removeResp = await sendMessage(MSG.SET_SELECTION, {
        imageIds: removeIds,
        selected: false
      });
      if (!removeResp.success) {
        setActionStatus(`框选失败: ${removeResp.error || "未知错误"}`, 2800);
        return;
      }
      selectedIds = new Set(removeResp.selectedIds || []);
    }

    if (addIds.length > 0) {
      const addResp = await sendMessage(MSG.SET_SELECTION, {
        imageIds: addIds,
        selected: true
      });
      if (!addResp.success) {
        setActionStatus(`框选失败: ${addResp.error || "未知错误"}`, 2800);
        return;
      }
      selectedIds = new Set(addResp.selectedIds || []);
    }

    await renderGallery();
    return;
  }

  const visibleIds = currentImages.map((item) => item.id);
  const clearResp = await sendMessage(MSG.SET_SELECTION, {
    imageIds: visibleIds,
    selected: false
  });
  if (!clearResp.success) {
    setActionStatus(`框选失败: ${clearResp.error || "未知错误"}`, 2800);
    return;
  }

  if (targetIds.length === 0) {
    selectedIds = new Set(clearResp.selectedIds || []);
    await renderGallery();
    return;
  }

  const selectResp = await sendMessage(MSG.SET_SELECTION, {
    imageIds: targetIds,
    selected: true
  });
  if (!selectResp.success) {
    setActionStatus(`框选失败: ${selectResp.error || "未知错误"}`, 2800);
    return;
  }
  selectedIds = new Set(selectResp.selectedIds || []);
  await renderGallery();
};

const teardownDragSelect = () => {
  clearDragPreview();
  hideDragSelectionBox();
  elements.gallery.classList.remove("drag-select-active");
  dragSelectState = null;
  window.removeEventListener("pointermove", onGalleryPointerMove, true);
  window.removeEventListener("pointerup", onGalleryPointerUp, true);
  window.removeEventListener("pointercancel", onGalleryPointerCancel, true);
};

const onGalleryPointerMove = (event) => {
  if (!dragSelectState) return;
  const point = getGalleryPoint(event.clientX, event.clientY);
  dragSelectState.current = point;
  const dx = point.x - dragSelectState.start.x;
  const dy = point.y - dragSelectState.start.y;
  if (!dragSelectState.moved) {
    if (Math.hypot(dx, dy) < DRAG_SELECT_MOVE_THRESHOLD) return;
    dragSelectState.moved = true;
  }

  event.preventDefault();
  elements.gallery.classList.add("drag-select-active");
  const rect = normalizeSelectionRect(dragSelectState.start, point);
  updateDragSelectionBox(rect);
  updateDragPreview(hitTestSelectionCards(rect));
};

const onGalleryPointerCancel = () => {
  teardownDragSelect();
};

const onGalleryPointerUp = async (event) => {
  if (!dragSelectState) return;
  const replaceMode = dragSelectState.replaceMode || event.ctrlKey || event.metaKey;
  const moved = dragSelectState.moved;
  const hitIds = new Set(dragPreviewIds);
  teardownDragSelect();
  if (!moved) return;

  suppressLightboxClickUntil = Date.now() + DRAG_CLICK_SUPPRESS_MS;
  await applyDragSelection(hitIds, replaceMode);
  setActionStatus(replaceMode ? `框选覆盖 ${hitIds.size} 张` : `框选切换 ${hitIds.size} 张`, 1200);
};

const onGalleryPointerDown = (event) => {
  if (event.button !== 0) return;
  if (!currentImages.length) return;
  if (!isSelectableCardTarget(event.target)) return;

  elements.gallery.classList.add("drag-select-active");
  dragSelectState = {
    start: getGalleryPoint(event.clientX, event.clientY),
    current: null,
    moved: false,
    replaceMode: event.ctrlKey || event.metaKey
  };
  window.addEventListener("pointermove", onGalleryPointerMove, true);
  window.addEventListener("pointerup", onGalleryPointerUp, true);
  window.addEventListener("pointercancel", onGalleryPointerCancel, true);
};

const openLightbox = (image, index = -1) => {
  lightboxSessionId += 1;
  lightboxImage = image;
  if (index >= 0) {
    lightboxIndex = index;
  } else {
    lightboxIndex = currentImages.findIndex((item) => item.id === image?.id);
  }
  if (currentConfig.enableHD) {
    const { previewSrc, originalSrc } = getViewSources(image);
    lightboxPreviewSrc = previewSrc || image.src || image.originalSrc || image.displaySrc || image.hdSrc;
    lightboxOriginalSrc = originalSrc || "";
  } else {
    lightboxPreviewSrc = image.src || image.originalSrc || image.displaySrc || image.hdSrc;
    lightboxOriginalSrc = "";
  }
  lightboxSourceUrl = getImageSourceUrl(image);
  const initialMeta = getImageMetaForFilters(image);
  applyLightboxNavBucket(initialMeta.width, initialMeta.height);
  lightboxHasMeaningfulOriginal = false;
  lightboxCanOneToOne = false;
  lightboxOriginalEvalPending = Boolean(lightboxOriginalSrc && lightboxOriginalSrc !== lightboxPreviewSrc);
  setLightboxSource(lightboxPreviewSrc, "preview");
  if (lightboxOriginalSrc) {
    preloadClipboardPayload(lightboxImage, lightboxOriginalSrc, false).catch(() => {});
  }
  evaluateMeaningfulOriginal(lightboxSessionId).catch(() => {});
  updateLightboxNavigation();
  elements.lightbox.classList.add("active");
};

const navigateLightbox = (step) => {
  if (!elements.lightbox.classList.contains("active")) return;
  if (!currentImages.length || !lightboxImage) return;
  if (currentImages.length === 1) return;
  const current = lightboxIndex >= 0 ? lightboxIndex : currentImages.findIndex((item) => item.id === lightboxImage.id);
  const nextIndex = (current + step + currentImages.length) % currentImages.length;
  const target = currentImages[nextIndex];
  if (!target) return;
  openLightbox(target, nextIndex);
};

const closeLightbox = () => {
  lightboxSessionId += 1;
  elements.lightbox.classList.remove("active");
  elements.lightboxContent.classList.remove("is-original");
  elements.lightboxContent.classList.remove(...LIGHTBOX_NAV_BUCKET_CLASSES);
  lightboxImage = null;
  lightboxIndex = -1;
  lightboxMode = "preview";
  lightboxCurrentSrc = "";
  lightboxPreviewSrc = "";
  lightboxOriginalSrc = "";
  lightboxSourceUrl = "";
  lightboxHasMeaningfulOriginal = false;
  lightboxCanOneToOne = false;
  lightboxOriginalEvalPending = false;
  if (elements.lightboxMode) {
    elements.lightboxMode.style.visibility = "visible";
  }
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
  if (preferredUrl) {
    setClipboardCache(preferredUrl, backgroundResponse);
  }
  if (canWriteImage && backgroundResponse?.success && backgroundResponse.dataUrl) {
    try {
      await writeClipboardImage(backgroundResponse);
      return { success: true, mode: "image" };
    } catch {
      // Fall through to URL copy fallback.
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
    invalidateComicSequenceCache();
    hasScannedOnce = true;
    await renderGallery();
    if (comicModeEnabled) {
      refreshComicPaginationInfo().catch(() => {});
    }
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
  if (fullscreenActive) {
    closeFullscreenViewer();
  }
  invalidateComicSequenceCache();
  resetComicPaginationState();
  currentImages = [];
  selectedIds = new Set();
  hasScannedOnce = false;
  await renderGallery();
  setActionStatus("已清理采集结果", 1400);
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
  await renderGallery();
};

const downloadBatch = async () => {
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
    if (response.zipped) {
      applyDownloadStatus({
        active: false,
        mode: "zip",
        phase: "completed",
        current: Number(response.packed) || Number(response.results?.length) || 0,
        total: Number(response.packed) || Number(response.results?.length) || 0,
        partIndex: Number(response.zipPartCount) || 1,
        partCount: Number(response.zipPartCount) || 1
      });
      return;
    }
    applyDownloadStatus({
      active: false,
      mode: "direct",
      phase: "completed",
      current: response.results.filter((item) => item.success).length,
      total: response.results.length
    });
  } finally {
    batchDownloadInProgress = activeDownloadStatus?.active === true;
    renderGallery();
  }
};

const copyBatch = async () => {
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

  await navigator.clipboard.writeText(urls);
  setActionStatus(`已复制 ${response.images.length} 条链接`);
};

const bindEvents = () => {
  elements.btnScan.addEventListener("click", scanImages);
  elements.btnClear.addEventListener("click", clearImages);
  elements.btnSelectAll.addEventListener("click", toggleSelectAll);
  elements.btnDownloadBatch.addEventListener("click", downloadBatch);
  elements.btnCopyBatch.addEventListener("click", copyBatch);
  elements.btnOpenDownloadDir.addEventListener("click", openDownloadDirectory);
  elements.gallery.addEventListener("pointerdown", onGalleryPointerDown);

  elements.resolutionPresets.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const preset = target.dataset.preset;
    if (!preset) return;
    applyResolutionPreset(preset);
    renderGallery();
  });

  const refreshFromSideInputs = () => {
    syncMinMpFromSideFilters();
    const matchedPreset = detectPresetFromInputs();
    setActivePreset(matchedPreset || "custom");
    renderGallery();
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
    renderGallery();
  });

  elements.formatFilters.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
      renderGallery();
    }
  });

  const applyConfigToggle = async (configKey, checked, failurePrefix = "设置失败") => {
    const response = await sendMessage(MSG.SET_CONFIG, { [configKey]: checked });
    if (!response?.success) {
      setActionStatus(`${failurePrefix}: ${response?.error || "未知错误"}`, 3200);
      return false;
    }
    currentConfig[configKey] = checked;
    return true;
  };

  elements.toggleHd.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const ok = await applyConfigToggle("enableHD", checked);
    if (!ok) {
      event.target.checked = !checked;
      return;
    }
    if (elements.lightbox.classList.contains("active") && lightboxImage) {
      openLightbox(lightboxImage);
    }
    await renderGallery();
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
      comicAssistState.ownedAutoScan = false;
    } else if (comicModeEnabled) {
      const preserved = await syncAutoScanRuntime(true);
      if (preserved) {
        comicAssistState.ownedAutoScan = true;
      }
    }

    if (checked) {
      if (!hasScannedOnce && currentImages.length === 0) {
        const scanned = await scanImages({ syncAutoScanAfterScan: false });
        if (!scanned) return;
      }
      setActionStatus("已开启自动采集");
    } else {
      setActionStatus(
        comicModeEnabled && comicAssistState.ownedAutoScan
          ? "已关闭自动采集，漫画模式仍会在后台继续采集"
          : "已关闭自动采集"
      );
    }
  });

  elements.toggleSortSize.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const ok = await applyConfigToggle("enableSizeSort", checked);
    if (!ok) {
      event.target.checked = !checked;
      return;
    }
    await renderGallery();
  });

  elements.toggleComicMode.addEventListener("change", async (event) => {
    const ok = await setComicModeEnabled(event.target.checked === true);
    if (!ok) {
      event.target.checked = false;
      updateComicBanner();
    }
  });
  if (elements.comicBannerAutoScrollLink) {
    elements.comicBannerAutoScrollLink.addEventListener("click", async (event) => {
      event.preventDefault();
      await focusSourceTabAndStartAutoScroll();
    });
  }

  if (elements.comicBannerPaginationGo) {
    elements.comicBannerPaginationGo.addEventListener("click", () => {
      loadComicPaginationPages().catch(() => {});
    });
  }
  if (elements.comicBannerPaginationLimit) {
    elements.comicBannerPaginationLimit.addEventListener("change", persistComicPaginationSettings);
  }
  if (elements.comicBannerPaginationWait) {
    elements.comicBannerPaginationWait.addEventListener("change", persistComicPaginationSettings);
  }

  elements.togglePortraitOnly.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const ok = await applyConfigToggle("enablePortraitOnly", checked);
    if (!ok) {
      event.target.checked = !checked;
      return;
    }
    await renderGallery();
  });

  elements.toggleWebP.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    const ok = await applyConfigToggle("enableWebPConvert", checked);
    if (!ok) {
      event.target.checked = !checked;
    }
  });

  elements.toggleBatchZipDownload.addEventListener("change", async (event) => {
    const checked = event.target.checked;
    currentConfig.enableBatchZipDownload = checked;
    setActionStatus(checked ? "已开启批量ZIP下载" : "已关闭批量ZIP下载", 1800);
  });

  elements.lightbox.querySelector(".lightbox-backdrop").addEventListener("click", closeLightbox);
  elements.lightboxClose.addEventListener("click", closeLightbox);
  elements.lightboxPrev.addEventListener("click", () => navigateLightbox(-1));
  elements.lightboxNext.addEventListener("click", () => navigateLightbox(1));
  elements.lightboxFullscreen.addEventListener("click", () => {
    if (!currentImages.length) return;
    const start = lightboxIndex >= 0 ? lightboxIndex : currentImages.findIndex((item) => item.id === lightboxImage?.id);
    openFullscreenViewer(start >= 0 ? start : 0);
  });
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
  elements.lightboxOriginal.addEventListener("click", () => {
    if (!lightboxImage) return;
    if (!lightboxHasMeaningfulOriginal && !canToggleOneToOne()) return;

    if (lightboxMode === "original") {
      setLightboxSource(lightboxPreviewSrc, "preview");
    } else {
      const targetSrc = lightboxHasMeaningfulOriginal ? lightboxOriginalSrc : lightboxPreviewSrc;
      setLightboxSource(targetSrc, "original");
    }
  });

  elements.fullscreenPrev.addEventListener("click", () => navigateFullscreen(-1));
  elements.fullscreenNext.addEventListener("click", () => navigateFullscreen(1));
  elements.fullscreenClose.addEventListener("click", closeFullscreenViewer);
  elements.fullscreenImage.addEventListener("click", (event) => {
    if (!fullscreenActive) return;
    if (!fullscreenZoomed) {
      if (!fullscreenCanZoom) return;
      const imageRect = elements.fullscreenImage.getBoundingClientRect();
      const stageRect = elements.fullscreenStage.getBoundingClientRect();
      const ratioX = imageRect.width > 0
        ? Math.min(1, Math.max(0, (event.clientX - imageRect.left) / imageRect.width))
        : 0.5;
      const ratioY = imageRect.height > 0
        ? Math.min(1, Math.max(0, (event.clientY - imageRect.top) / imageRect.height))
        : 0.5;
      const viewportX = Math.min(
        stageRect.width,
        Math.max(0, event.clientX - stageRect.left)
      );
      const viewportY = Math.min(
        stageRect.height,
        Math.max(0, event.clientY - stageRect.top)
      );
      setFullscreenZoom(true, { ratioX, ratioY, viewportX, viewportY });
      return;
    }
    setFullscreenZoom(false);
  });

  window.addEventListener("resize", () => {
    if (elements.lightbox.classList.contains("active") && lightboxMode === "original") {
      syncLightboxOriginalScrollLayout();
    }
    if (!fullscreenActive) return;
    if (!fullscreenZoomed) {
      updateFullscreenZoomCapability();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (fullscreenActive) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFullscreenViewer();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateFullscreen(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateFullscreen(1);
      }
      return;
    }

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

  window.addEventListener("beforeunload", () => {
    teardownDragSelect();
    unlockFullscreenPageScroll();
    clearFullscreenCache();
    if (comicAssistState.ownedAutoScan) {
      chrome.runtime.sendMessage({ type: MSG.STOP_AUTO_SCAN, tabId: sourceTabId }).catch(() => {});
    }
  });
};

const init = async () => {
  sourceTabId = await getSourceTabId();
  if (!Number.isInteger(sourceTabId)) {
    setActionStatus("未绑定原网页标签页，请从原网页重新打开 Workspace", 4800);
  }
  bindEvents();

  const configResponse = await sendMessage(MSG.GET_CONFIG);
  if (configResponse.success) {
    elements.toggleAutoScan.checked = configResponse.config.enableAutoScan === true;
    elements.toggleHd.checked = configResponse.config.enableHD !== false;
    elements.toggleSortSize.checked = configResponse.config.enableSizeSort === true;
    elements.togglePortraitOnly.checked = configResponse.config.enablePortraitOnly === true;
    elements.toggleWebP.checked = configResponse.config.enableWebPConvert === true;
    elements.toggleBatchZipDownload.checked = false;
    currentConfig.enableAutoScan = elements.toggleAutoScan.checked;
    currentConfig.enableHD = elements.toggleHd.checked;
    currentConfig.enableSizeSort = elements.toggleSortSize.checked;
    currentConfig.enablePortraitOnly = elements.togglePortraitOnly.checked;
    currentConfig.enableAutoScroll = configResponse.config.enableAutoScroll === true;
    currentConfig.enableWebPConvert = elements.toggleWebP.checked;
    currentConfig.enableBatchZipDownload = false;
  }
  if (elements.toggleComicMode) {
    elements.toggleComicMode.checked = false;
  }
  updateComicBanner();

  await restoreComicPaginationSettings();

  if (shouldComicModeOnOpen) {
    const enabled = await setComicModeEnabled(true, { showStatus: false });
    if (!enabled) {
      setActionStatus("漫画模式启动失败", 3200);
    }
  }

  setMetricInputs(RESOLUTION_PRESETS.all);
  setActivePreset("all");
  await renderGallery();

  if (shouldAutoScanOnOpen) {
    await scanImages();
    return;
  }

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

  if (message?.type === MSG.AUTO_SCROLL_STATE_CHANGED) {
    const updatedTabId = Number(message?.payload?.tabId);
    if (!Number.isInteger(updatedTabId) || updatedTabId !== sourceTabId) return;
    currentConfig.enableAutoScroll = message?.payload?.enabled === true;
    return;
  }

  if (message?.type === MSG.IMAGES_UPDATED) {
    const updatedTabId = Number(message?.payload?.tabId);
    if (!Number.isInteger(updatedTabId) || updatedTabId !== sourceTabId) return;
    if (manualScanInProgress) return;
    scheduleRenderRefresh();
  }
});

document.addEventListener("DOMContentLoaded", init);
