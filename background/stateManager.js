const STORAGE_KEY = "pic_collector_tab_states_v2";
const NOISE_QUERY_KEYS = new Set([
  "t",
  "_",
  "v",
  "ts",
  "timestamp",
  "wx_co",
  "wx_fmt",
  "expires",
  "ssig",
  "kid",
  "spm",
  "utm_source",
  "utm_medium",
  "utm_campaign"
]);

const DEFAULT_CONFIG = Object.freeze({
  enableHD: true,
  enableSizeSort: false,
  enablePortraitOnly: false,
  enableAutoScan: false,
  enableAutoScroll: false,
  enableWebPConvert: false,
  enableRightClick: false
});

const cloneDefaults = () => ({
  config: { ...DEFAULT_CONFIG }
});

const hashText = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

export const normalizeUrl = (url) => {
  if (!url || typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol === "blob:") {
      return String(parsed.href || url).split("#")[0];
    }
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (NOISE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    const query = parsed.searchParams.toString();
    let pathname = parsed.pathname;
    if (/xhscdn\.com$/i.test(parsed.hostname) && /notes_pre_post/i.test(pathname)) {
      pathname = pathname.replace(/![^/?#]+$/i, "");
    }
    return `${parsed.origin}${pathname}${query ? `?${query}` : ""}`;
  } catch (_error) {
    return url.split("#")[0];
  }
};

const normalizeTelegramHash = (hashValue) => {
  const raw = String(hashValue || "").replace(/^#/, "");
  if (!raw) return "";

  const direct = raw.match(/^(@[^/?#]+|-?\d{6,})(?:\/(\d+))?/);
  if (direct?.[1]) {
    return `${direct[1]}${direct[2] ? `/${direct[2]}` : ""}`;
  }

  const legacy = raw.match(/p=c(\d{4,})_(\d+)/i);
  if (legacy?.[1]) {
    return `-100${legacy[1]}/${legacy[2]}`;
  }

  const query = raw.match(/(?:^|[?&])p=([^&]+)/i);
  if (query?.[1]) {
    let decoded = query[1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch (_error) {
      // Keep raw.
    }

    const qDirect = decoded.match(/^(@[^/?#]+|-?\d{6,})(?:\/(\d+)|_(\d+))?/);
    if (qDirect?.[1]) {
      const msg = qDirect[2] || qDirect[3] || "";
      return `${qDirect[1]}${msg ? `/${msg}` : ""}`;
    }

    const qLegacy = decoded.match(/^c(\d{4,})(?:_(\d+)|\/(\d+))?/i);
    if (qLegacy?.[1]) {
      const msg = qLegacy[2] || qLegacy[3] || "";
      return `-100${qLegacy[1]}${msg ? `/${msg}` : ""}`;
    }
  }

  return "";
};

const normalizeSourceUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    const originalHash = String(parsed.hash || "");
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (NOISE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";
    if (/web\.telegram\.org$/i.test(host) && /^\/[ak]\/$/i.test(path)) {
      const normalizedHash = normalizeTelegramHash(originalHash);
      if (normalizedHash) {
        parsed.hash = `#${normalizedHash}`;
      } else {
        const p = parsed.searchParams.get("p");
        const fromP = p ? normalizeTelegramHash(`#p=${p}`) : "";
        if (fromP) {
          parsed.hash = `#${fromP}`;
        }
      }
      if (!parsed.hash && originalHash) {
        parsed.hash = originalHash.startsWith("#") ? originalHash : `#${originalHash}`;
      }
      if (parsed.hash && parsed.searchParams.has("p")) {
        parsed.searchParams.delete("p");
      }
    }
    const query = parsed.searchParams.toString();
    const hash = parsed.hash || "";
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}${hash}`;
  } catch (_error) {
    return null;
  }
};

const sourceQualityScore = (url) => {
  if (!url) return -1;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return -1;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";
    let score = 0;

    if (path && path !== "/") score += 20;
    if (/^\/404(?:\/|$)/i.test(path)) score -= 800;
    if (/\/[^/]+\/status\/\d+/i.test(path) || /\/i\/web\/status\/\d+/i.test(path)) score += 240;
    if (/\/(status|detail)\/[A-Za-z0-9]+/i.test(path) || /weibo\.com\/\d+\/[A-Za-z0-9]+/i.test(url)) score += 210;
    if (/\/(explore|discovery\/item)\/[A-Za-z0-9_-]+/i.test(path)) score += 200;
    if (/\/post\/\d+/i.test(path)) score += 200;
    if (/web\.telegram\.org$/i.test(host) && /^\/[ak]\/$/i.test(path) && /^#@[^/]+\/\d+$/i.test(parsed.hash || "")) score += 280;
    if (/web\.telegram\.org$/i.test(host) && /^\/[ak]\/$/i.test(path) && /^#-?\d{6,}\/\d+$/i.test(parsed.hash || "")) score += 280;
    if (/\/(item|product|goods)\.htm/i.test(path) && parsed.searchParams.has("id")) score += 160;
    if (/\/(article|news|post|p)\//i.test(path)) score += 90;
    if (/(x|twitter|weibo|xiaohongshu|tumblr|telegram)\./i.test(host)) score += 18;
    if (/xiaohongshu\.com$/i.test(host) && parsed.searchParams.has("xsec_token")) score += 60;
    if (/xiaohongshu\.com$/i.test(host) && parsed.searchParams.has("xsec_source")) score += 20;
    if (path === "/" || path === "") score -= 80;

    return score;
  } catch (_error) {
    return -1;
  }
};

const pickPreferredSourceUrl = (existingUrl, incomingUrl) => {
  const existing = normalizeSourceUrl(existingUrl);
  const incoming = normalizeSourceUrl(incomingUrl);
  const existingScore = sourceQualityScore(existing);
  const incomingScore = sourceQualityScore(incoming);
  if (incomingScore > existingScore) return incoming;
  return existing || incoming || null;
};

const isTelegramBlobUrl = (url) => String(url || "").startsWith("blob:https://web.telegram.org/");

const parseTelegramSourceToken = (sourceUrl) => {
  if (!sourceUrl) return "";
  try {
    const parsed = new URL(sourceUrl);
    const host = String(parsed.hostname || "").toLowerCase();

    if (/(^|\.)t\.me$/i.test(host)) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 3 && parts[0].toLowerCase() === "c" && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
        return `-100${parts[1]}/${parts[2]}`;
      }
      if (parts.length >= 2 && /^[A-Za-z0-9_]{4,}$/i.test(parts[0]) && /^\d+$/.test(parts[1])) {
        return `@${parts[0]}/${parts[1]}`;
      }
      return "";
    }

    if (/web\.telegram\.org$/i.test(host)) {
      let hash = String(parsed.hash || "").replace(/^#/, "");
      if (!hash) {
        const p = parsed.searchParams.get("p");
        if (p) {
          const normalized = normalizeTelegramHash(`#p=${p}`);
          if (normalized) hash = normalized;
        }
      }
      const matched = hash.match(/^(@[^/]+\/\d+|-?\d{6,}\/\d+)/);
      return matched?.[1] || "";
    }

    return "";
  } catch (_error) {
    return "";
  }
};

const aspectRatio = (image) => {
  const w = Number(image?.width) || 0;
  const h = Number(image?.height) || 0;
  if (!w || !h) return 0;
  return w / h;
};

const findTelegramEquivalentId = (state, incomingImage) => {
  if (!isTelegramBlobUrl(incomingImage?.src)) return null;
  const incomingToken = parseTelegramSourceToken(incomingImage?.sourceUrl);
  if (!incomingToken) return null;

  const incomingRatio = aspectRatio(incomingImage);
  const incomingArea = Number(incomingImage?.area) || 0;

  for (const [id, existing] of state.images.entries()) {
    if (!isTelegramBlobUrl(existing?.src)) continue;
    const existingToken = parseTelegramSourceToken(existing?.sourceUrl);
    if (!existingToken || existingToken !== incomingToken) continue;

    const existingRatio = aspectRatio(existing);
    if (incomingRatio > 0 && existingRatio > 0 && Math.abs(incomingRatio - existingRatio) > 0.03) {
      continue;
    }

    const existingArea = Number(existing?.area) || 0;
    const areaFactor =
      incomingArea > 0 && existingArea > 0
        ? Math.max(incomingArea, existingArea) / Math.max(1, Math.min(incomingArea, existingArea))
        : 1;
    if (areaFactor > 4.0) continue;

    return id;
  }

  return null;
};

const getImageFormat = (url) => {
  if (!url) return "unknown";

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
    const formatFromParam = parsed.searchParams.get("format");
    if (formatFromParam) return formatFromParam.toLowerCase();

    const formatByRule = parsed.href.match(/(?:format=|\/format\/)(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[&/?#]|$)/i);
    if (formatByRule?.[1]) return formatByRule[1].toLowerCase();

    const formatFromSuffix = parsed.pathname.match(/(?:^|[_!.-])(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[_!.-]|$)/i);
    if (formatFromSuffix?.[1]) return formatFromSuffix[1].toLowerCase();

    if (/xhscdn\.com$/i.test(parsed.hostname) && (/webpic/i.test(parsed.hostname) || /notes_pre_post/i.test(parsed.pathname))) {
      return "webp";
    }
  } catch (_error) {
    // Ignore parse failures and continue with extension detection.
  }

  const match = url.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "unknown";
};

export const generateImageId = (normalizedUrl) => {
  if (!normalizedUrl) return null;
  return `img_${hashText(normalizedUrl)}`;
};

const normalizeComicIndex = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

const normalizeComicPageMetadata = (rawImage) => {
  const pageIndex = normalizeComicIndex(rawImage?.comicPageIndex);
  const pageOrder = normalizeComicIndex(rawImage?.comicPageOrder);
  if (pageIndex === null || pageOrder === null) return {};
  return {
    comicPageIndex: pageIndex,
    comicPageOrder: pageOrder,
    comicPageUrl: normalizeSourceUrl(rawImage?.comicPageUrl || rawImage?.sourceUrl || "") || null
  };
};

const sanitizeImage = (rawImage) => {
  if (!rawImage) return null;

  const originalSrc = rawImage.originalSrc || rawImage.src;
  const src = rawImage.src || originalSrc;
  if (!src) return null;

  const incomingNormalized = String(rawImage.normalized || "").trim();
  const normalized = incomingNormalized || normalizeUrl(originalSrc || src);
  if (!normalized) return null;

  const width = Number(rawImage.width) || 0;
  const height = Number(rawImage.height) || 0;
  const area = Math.max(Number(rawImage.area) || 0, width * height);
  const hdSrc = rawImage.hdSrc || src;
  const sourceUrl = normalizeSourceUrl(rawImage.sourceUrl || rawImage.pageUrl || rawImage.originUrl || "");
  const incomingFormat = String(rawImage.format || "").toLowerCase();
  const resolvedFormat =
    incomingFormat && incomingFormat !== "unknown"
      ? incomingFormat
      : getImageFormat(hdSrc) || getImageFormat(src) || "unknown";

  return {
    id: generateImageId(normalized),
    normalized,
    src,
    originalSrc: originalSrc || src,
    hdSrc,
    width,
    height,
    area,
    format: resolvedFormat,
    source: rawImage.source || "dom",
    sourceUrl,
    timestamp: Number(rawImage.timestamp) || Date.now(),
    hdRejected: Boolean(rawImage.hdRejected),
    isHD: Boolean(hdSrc && hdSrc !== src && !rawImage.hdRejected),
    ...normalizeComicPageMetadata(rawImage)
  };
};

const imageLookupKeys = (image) => {
  const keys = new Set();
  for (const value of [image?.normalized, image?.hdSrc, image?.originalSrc]) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    keys.add(raw);
    const normalized = normalizeUrl(raw);
    if (normalized) keys.add(normalized);
  }
  return [...keys];
};

const indexImage = (state, image, imageId) => {
  if (!state || !image || !imageId) return;
  if (image.normalized) {
    state.imagesByNormalized.set(image.normalized, imageId);
  }
  for (const key of imageLookupKeys(image)) {
    state.imagesByHdSrc.set(key, imageId);
  }
};

const findExistingImageId = (state, image) => {
  if (!state || !image) return null;
  if (image.normalized && state.imagesByNormalized.has(image.normalized)) {
    return state.imagesByNormalized.get(image.normalized);
  }
  for (const key of imageLookupKeys(image)) {
    const existingId = state.imagesByHdSrc.get(key) || state.imagesByNormalized.get(key);
    if (existingId) return existingId;
  }
  return findTelegramEquivalentId(state, image);
};

const preserveHdState = (existing, incoming) => {
  const hdRejected = existing?.hdRejected === true || incoming?.hdRejected === true;
  return {
    hdRejected,
    isHD: Boolean(incoming?.hdSrc && incoming.hdSrc !== incoming.src && !hdRejected)
  };
};

const hasComicPageMetadata = (image) =>
  Number.isInteger(image?.comicPageIndex) &&
  Number.isInteger(image?.comicPageOrder);

const mergeComicPageMetadata = (existing, incoming) => {
  if (hasComicPageMetadata(incoming) && !hasComicPageMetadata(existing)) {
    return {
      comicPageIndex: incoming.comicPageIndex,
      comicPageOrder: incoming.comicPageOrder,
      comicPageUrl: incoming.comicPageUrl || existing?.comicPageUrl || null
    };
  }
  if (hasComicPageMetadata(existing)) {
    return {
      comicPageIndex: existing.comicPageIndex,
      comicPageOrder: existing.comicPageOrder,
      comicPageUrl: existing.comicPageUrl || incoming?.comicPageUrl || null
    };
  }
  return {};
};

const createState = () => {
  const defaults = cloneDefaults();
  return {
    images: new Map(),
    imagesByNormalized: new Map(),
    imagesByHdSrc: new Map(),
    selectedIds: new Set(),
    hiddenIds: new Set(),
    config: defaults.config,
    lastScanTime: null,
    isScanning: false
  };
};

const serializeState = (state) => ({
  images: Array.from(state.images.values()),
  selectedIds: Array.from(state.selectedIds),
  hiddenIds: Array.from(state.hiddenIds || []),
  config: state.config,
  lastScanTime: state.lastScanTime
});

const normalizeConfig = (config = {}, partial = false) => {
  const next = {};

  if (!partial || Object.prototype.hasOwnProperty.call(config, "enableHD")) {
    next.enableHD = config.enableHD !== false;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(config, "enableSizeSort")) {
    next.enableSizeSort = config.enableSizeSort === true;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(config, "enablePortraitOnly")) {
    next.enablePortraitOnly = config.enablePortraitOnly === true;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(config, "enableAutoScan")) {
    next.enableAutoScan = config.enableAutoScan === true;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(config, "enableAutoScroll")) {
    next.enableAutoScroll = config.enableAutoScroll === true;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(config, "enableWebPConvert")) {
    next.enableWebPConvert = config.enableWebPConvert === true;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(config, "enableRightClick")) {
    next.enableRightClick = config.enableRightClick === true;
  }

  return next;
};

export const createTabStateManager = () => {
  const tabStates = new Map();
  let ready = false;
  let readyPromise = null;
  let persistInFlight = false;
  let persistQueued = false;

  const initTabState = (tabId) => {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, createState());
    }
    return tabStates.get(tabId);
  };

  const schedulePersist = () => {
    if (persistInFlight) {
      persistQueued = true;
      return;
    }

    persistInFlight = true;
    Promise.resolve()
      .then(async () => {
        do {
          persistQueued = false;
          const payload = {};
          for (const [tabId, state] of tabStates.entries()) {
            payload[String(tabId)] = serializeState(state);
          }
          await chrome.storage.local.set({ [STORAGE_KEY]: payload });
        } while (persistQueued);
      })
      .catch((error) => {
        console.error("[图片采集查看器] Failed to persist state:", error);
      })
      .finally(() => {
        persistInFlight = false;
        if (persistQueued) {
          persistQueued = false;
          schedulePersist();
        }
      });
  };

  const ensureReady = async () => {
    if (ready) return;
    if (readyPromise) {
      await readyPromise;
      return;
    }

    readyPromise = (async () => {
      try {
        const stored = await chrome.storage.local.get(STORAGE_KEY);
        const rawStates = stored?.[STORAGE_KEY] || {};
        for (const [tabIdString, rawState] of Object.entries(rawStates)) {
          const tabId = Number(tabIdString);
          if (!Number.isInteger(tabId)) continue;

          const state = initTabState(tabId);
          state.config = { ...cloneDefaults().config, ...normalizeConfig(rawState.config) };
          state.lastScanTime = Number(rawState.lastScanTime) || null;

          const images = Array.isArray(rawState.images) ? rawState.images : [];
          for (const image of images) {
            const normalizedImage = sanitizeImage(image);
            if (!normalizedImage) continue;
            state.images.set(normalizedImage.id, normalizedImage);
            indexImage(state, normalizedImage, normalizedImage.id);
          }

          const selectedIds = Array.isArray(rawState.selectedIds) ? rawState.selectedIds : [];
          for (const id of selectedIds) {
            if (state.images.has(id)) {
              state.selectedIds.add(id);
            }
          }

          const hiddenIds = Array.isArray(rawState.hiddenIds) ? rawState.hiddenIds : [];
          for (const id of hiddenIds) {
            if (state.images.has(id)) {
              state.hiddenIds.add(id);
            }
          }
        }
      } catch (error) {
        console.error("[图片采集查看器] Failed to load state:", error);
      } finally {
        ready = true;
      }
    })();

    await readyPromise;
  };

  const mergeImages = (tabId, images = []) => {
    const state = initTabState(tabId);
    let added = 0;
    let updated = 0;

    for (const rawImage of images) {
      const image = sanitizeImage(rawImage);
      if (!image) continue;

      const existingId = findExistingImageId(state, image);
      if (!existingId) {
        state.images.set(image.id, image);
        indexImage(state, image, image.id);
        added += 1;
        continue;
      }

      const existing = state.images.get(existingId);
      if (!existing) {
        state.images.set(image.id, image);
        indexImage(state, image, image.id);
        added += 1;
        continue;
      }

      indexImage(state, image, existingId);

      const shouldReplace =
        image.area > existing.area ||
        (image.area === existing.area && image.timestamp > existing.timestamp);

      if (shouldReplace) {
        const merged = {
          ...existing,
          ...image,
          id: existingId,
          ...preserveHdState(existing, image),
          ...mergeComicPageMetadata(existing, image)
        };
        merged.sourceUrl = pickPreferredSourceUrl(existing.sourceUrl, image.sourceUrl);
        state.images.set(existingId, merged);
        indexImage(state, merged, existingId);
        updated += 1;
        continue;
      }

      const preferredSource = pickPreferredSourceUrl(existing.sourceUrl, image.sourceUrl);
      const shouldUpgradeFormat =
        (String(existing.format || "").toLowerCase() === "unknown") &&
        (String(image.format || "").toLowerCase() !== "unknown");
      const shouldUpdateComicMetadata =
        hasComicPageMetadata(image) && !hasComicPageMetadata(existing);
      if (
        (preferredSource && preferredSource !== existing.sourceUrl) ||
        shouldUpgradeFormat ||
        shouldUpdateComicMetadata
      ) {
        const merged = {
          ...existing,
          sourceUrl: preferredSource || existing.sourceUrl,
          format: shouldUpgradeFormat ? image.format : existing.format,
          ...mergeComicPageMetadata(existing, image)
        };
        state.images.set(existingId, merged);
        indexImage(state, merged, existingId);
        updated += 1;
      }
    }

    if (added > 0 || updated > 0) {
      state.lastScanTime = Date.now();
      schedulePersist();
    }

    return { added, updated, total: state.images.size };
  };

  const getAllImages = (tabId) => {
    const state = tabStates.get(tabId);
    if (!state) return [];
    return Array.from(state.images.values()).map((image) => ({
      ...image,
      hidden: state.hiddenIds.has(image.id)
    }));
  };

  const toggleSelectImage = (tabId, imageId) => {
    const state = initTabState(tabId);
    if (!state.images.has(imageId)) return Array.from(state.selectedIds);

    if (state.selectedIds.has(imageId)) {
      state.selectedIds.delete(imageId);
    } else {
      state.selectedIds.add(imageId);
    }
    schedulePersist();
    return Array.from(state.selectedIds);
  };

  const setSelectionByIds = (tabId, imageIds = [], selected = true) => {
    const state = initTabState(tabId);
    const ids = Array.isArray(imageIds) ? imageIds : [];
    for (const imageId of ids) {
      if (!state.images.has(imageId)) continue;
      if (selected) {
        state.selectedIds.add(imageId);
      } else {
        state.selectedIds.delete(imageId);
      }
    }
    schedulePersist();
    return Array.from(state.selectedIds);
  };

  const getSelectedImages = (tabId) => {
    const state = tabStates.get(tabId);
    if (!state) return [];
    return Array.from(state.selectedIds)
      .map((imageId) => state.images.get(imageId))
      .filter(Boolean)
      .sort((a, b) => b.area - a.area);
  };

  const setHiddenByIds = (tabId, imageIds = [], hidden = true) => {
    const state = initTabState(tabId);
    const ids = Array.isArray(imageIds) ? imageIds : [];
    for (const imageId of ids) {
      if (!state.images.has(imageId)) continue;
      state.selectedIds.delete(imageId);
      if (hidden) {
        state.hiddenIds.add(imageId);
      } else {
        state.hiddenIds.delete(imageId);
      }
    }
    schedulePersist();
    return Array.from(state.hiddenIds);
  };

  const setConfig = (tabId, config) => {
    const state = initTabState(tabId);
    state.config = { ...state.config, ...normalizeConfig(config, true) };
    schedulePersist();
    return { ...state.config };
  };

  const getConfig = (tabId) => {
    const state = tabStates.get(tabId);
    if (!state) return { ...cloneDefaults().config };
    return { ...state.config };
  };

  const getStats = (tabId) => {
    const state = tabStates.get(tabId);
    if (!state) {
      return {
        total: 0,
        selected: 0,
        formats: {},
        lastScanTime: null
      };
    }

    const formatStats = {};
    for (const image of state.images.values()) {
      formatStats[image.format] = (formatStats[image.format] || 0) + 1;
    }

    return {
      total: state.images.size,
      selected: state.selectedIds.size,
      hidden: state.hiddenIds.size,
      formats: formatStats,
      lastScanTime: state.lastScanTime
    };
  };

  const setScanning = (tabId, isScanning) => {
    const state = initTabState(tabId);
    state.isScanning = Boolean(isScanning);
    if (isScanning) {
      state.lastScanTime = Date.now();
      schedulePersist();
    }
  };

  const removeTabState = (tabId) => {
    if (tabStates.delete(tabId)) {
      schedulePersist();
    }
  };

  const markHdRejected = (tabId, imageId, rejected = true) => {
    const state = tabStates.get(tabId);
    if (!state) return;
    const image = state.images.get(imageId);
    if (!image) return;
    image.hdRejected = Boolean(rejected);
    image.isHD = Boolean(image.hdSrc && image.hdSrc !== image.src && !image.hdRejected);
    schedulePersist();
  };

  const clearTabImages = (tabId) => {
    const state = tabStates.get(tabId);
    if (!state) return;
    state.images.clear();
    state.imagesByNormalized.clear();
    state.imagesByHdSrc.clear();
    state.selectedIds.clear();
    state.hiddenIds.clear();
    state.lastScanTime = null;
    schedulePersist();
  };

  return {
    ensureReady,
    initTabState,
    mergeImages,
    getAllImages,
    toggleSelectImage,
    setSelectionByIds,
    getSelectedImages,
    setHiddenByIds,
    setConfig,
    getConfig,
    getStats,
    setScanning,
    markHdRejected,
    removeTabState,
    clearTabImages
  };
};
