import { formatFromUrl } from "../shared/zipCore.js";

const STORAGE_KEY = "pic_collector_tab_states_v2";
const METADATA_STORAGE_KEY = "pic_collector_tab_metadata_v1";
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

const normalizePageUrl = (url) => {
  try {
    const parsed = new URL(String(url || ""));
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.href;
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

// An album message and dimensions alone do not identify an individual photo.
const isStrongTelegramIdentity = (value) =>
  /^tg:generic\|[^:|]+:(?:\d+:(?:m|i):[^|]+|x:[^|]+)$/.test(String(value || ""));

const getImageFormat = (url) => {
  return formatFromUrl(url);
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

const normalizePositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const normalizeMaxDimensions = ({ width = 0, height = 0, area = 0, maxWidth = 0, maxHeight = 0, maxArea = 0 } = {}) => {
  const normalizedWidth = normalizePositiveNumber(width);
  const normalizedHeight = normalizePositiveNumber(height);
  const normalizedArea = normalizedWidth > 0 && normalizedHeight > 0
    ? normalizedWidth * normalizedHeight
    : normalizePositiveNumber(area);
  const candidateMaxWidth = normalizePositiveNumber(maxWidth);
  const candidateMaxHeight = normalizePositiveNumber(maxHeight);
  const candidateMaxArea = candidateMaxWidth > 0 && candidateMaxHeight > 0
    ? candidateMaxWidth * candidateMaxHeight
    : normalizePositiveNumber(maxArea);

  if (candidateMaxWidth > 0 && candidateMaxHeight > 0 && candidateMaxArea > normalizedArea) {
    return {
      maxWidth: candidateMaxWidth,
      maxHeight: candidateMaxHeight,
      maxArea: candidateMaxArea
    };
  }

  return {
    maxWidth: normalizedWidth,
    maxHeight: normalizedHeight,
    maxArea: normalizedArea
  };
};

const mergeMaxDimensions = (existing, incoming) => {
      const existingMax = normalizeMaxDimensions(existing);
  const incomingMax = normalizeMaxDimensions(incoming);
  if (incomingMax.maxArea > existingMax.maxArea) {
    return incomingMax;
  }
  return existingMax;
};

const shouldUpgradeHdSrc = (existing, incoming) => {
  const incomingHd = String(incoming?.hdSrc || "").trim();
  if (!incomingHd) return false;
  if (incomingHd === incoming?.src && incomingHd === existing?.hdSrc) return false;

  const existingHd = String(existing?.hdSrc || "").trim();
  if (existing?.hdSrcVerified && !incoming?.hdSrcVerified) return false;
  if (!existingHd || existingHd === existing?.src) {
    return incomingHd !== existingHd;
  }

  const existingMaxArea = normalizeMaxDimensions(existing).maxArea;
  const incomingMaxArea = normalizeMaxDimensions(incoming).maxArea;
  return incomingMaxArea > existingMaxArea && incomingHd !== existingHd;
};

const normalizeCandidateUrls = (values) => {
  const urls = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== "string") continue;
    const raw = value.trim();
    try {
      const parsed = new URL(raw);
      if (/^(https?:|blob:|data:)$/.test(parsed.protocol)) urls.add(raw);
    } catch (_error) {
      // Relative and malformed candidates cannot be downloaded independently.
    }
  }
  return [...urls];
};

const sanitizeImage = (rawImage) => {
  if (!rawImage) return null;

  const originalSrc = rawImage.originalSrc || rawImage.src;
  const src = rawImage.src || originalSrc;
  if (!src) return null;

  const incomingNormalized = String(rawImage.normalized || "").trim();
  const normalized = isTelegramBlobUrl(src) && incomingNormalized.startsWith("tg:") && !isStrongTelegramIdentity(incomingNormalized)
    ? normalizeUrl(src)
    : incomingNormalized || normalizeUrl(src);
  if (!normalized) return null;

  const width = Number(rawImage.width) || 0;
  const height = Number(rawImage.height) || 0;
  const area = width > 0 && height > 0 ? width * height : normalizePositiveNumber(rawImage.area);
  const maxDimensions = normalizeMaxDimensions({
    width,
    height,
    area,
    maxWidth: rawImage.maxWidth,
    maxHeight: rawImage.maxHeight,
    maxArea: rawImage.maxArea
  });
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
    hdSrcVerified: rawImage.hdSrcVerified === true,
    candidateUrls: normalizeCandidateUrls(rawImage.candidateUrls),
    aliases: Array.isArray(rawImage.aliases) ? rawImage.aliases.filter((alias) => typeof alias === "string" && alias) : [],
    width,
    height,
    area,
    ...maxDimensions,
    format: resolvedFormat,
    formatTrusted: rawImage.formatTrusted === true && resolvedFormat !== "unknown",
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
  // The loaded originalSrc may be a shared lazy-load placeholder. Keep it as
  // a download fallback, but only primary/HD sources establish image identity.
  for (const value of [image?.normalized, image?.hdSrc, image?.src, ...(image?.aliases || [])]) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    keys.add(raw);
    const normalized = normalizeUrl(raw);
    if (normalized) keys.add(normalized);
  }
  return [...keys];
};

const requestOrigin = (value) => {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin : ''; } catch { return ''; }
};
// Request aliases may be shared by distinct images; they are not identity keys.
const indexRequestSources = (state, image, imageId) => {
  const previous = state.requestKeysByImage.get(imageId);
  if (previous) for (const url of previous.urls) {
    const entry = state.requestSourcesByUrl.get(url);
    const source = entry?.get(previous.origin);
    if (source && --source.count === 0) entry.delete(previous.origin);
    if (entry?.size === 0) state.requestSourcesByUrl.delete(url);
  }
  const urls = new Set([image.src, image.hdSrc, image.originalSrc, ...(image.candidateUrls || [])].filter(Boolean));
  const origin = requestOrigin(image.sourceUrl);
  for (const url of urls) {
    if (!state.requestSourcesByUrl.has(url)) state.requestSourcesByUrl.set(url, new Map());
    const entry = state.requestSourcesByUrl.get(url);
    const source = entry.get(origin);
    if (source) source.count += 1;
    else entry.set(origin, { count: 1, sourceUrl: origin ? image.sourceUrl : '' });
  }
  state.requestKeysByImage.set(imageId, { urls, origin });
};

const indexImage = (state, image, imageId) => {
  if (!state || !image || !imageId) return;
  if (state.images.get(imageId) === image) indexRequestSources(state, image, imageId);
  if (image.normalized) {
    state.imagesByNormalized.set(image.normalized, imageId);
  }
  for (const key of imageLookupKeys(image)) {
    state.imagesByHdSrc.set(key, imageId);
  }
};

const allocateImageId = (state, image) => {
  const baseId = image?.id || generateImageId(image?.normalized);
  if (!baseId) return null;

  const baseImage = state.images.get(baseId);
  if (!baseImage || baseImage.normalized === image.normalized) {
    return baseId;
  }

  let suffix = 2;
  while (suffix < 100000) {
    const candidateId = `${baseId}_${suffix}`;
    const candidateImage = state.images.get(candidateId);
    if (!candidateImage || candidateImage.normalized === image.normalized) {
      return candidateId;
    }
    suffix += 1;
  }

  return `${baseId}_${Date.now()}`;
};

const addNewImage = (state, image) => {
  const imageId = allocateImageId(state, image);
  if (!imageId) return null;
  const storedImage = image.id === imageId ? image : { ...image, id: imageId };
  state.images.set(imageId, storedImage);
  indexImage(state, storedImage, imageId);
  return storedImage;
};

const findExistingImageId = (state, image) => {
  if (!state || !image) return null;
  const compatibleId = (id) => {
    const existing = state.images.get(id);
    if (isStrongTelegramIdentity(existing?.normalized) && isStrongTelegramIdentity(image.normalized) && existing.normalized !== image.normalized) {
      return null;
    }
    return id || null;
  };
  if (image.normalized && state.imagesByNormalized.has(image.normalized)) {
    const id = compatibleId(state.imagesByNormalized.get(image.normalized));
    if (id) return id;
  }
  for (const key of imageLookupKeys(image)) {
    const existingId = state.imagesByHdSrc.get(key) || state.imagesByNormalized.get(key);
    if (compatibleId(existingId)) return existingId;
  }
  return null;
};

const findImageIdByUrl = (state, url) => {
  if (!state || !url) return null;
  const raw = String(url || "").trim();
  if (!raw) return null;

  const keys = new Set([raw]);
  const normalized = normalizeUrl(raw);
  if (normalized) keys.add(normalized);

  for (const key of keys) {
    const existingId = state.imagesByHdSrc.get(key) || state.imagesByNormalized.get(key);
    if (existingId) return existingId;
  }

  for (const [id, image] of state.images.entries()) {
    for (const value of [image.src, image.hdSrc, image.originalSrc, image.displaySrc, image.normalized]) {
      const candidate = String(value || "").trim();
      if (!candidate) continue;
      if (keys.has(candidate)) return id;
      const normalizedCandidate = normalizeUrl(candidate);
      if (normalizedCandidate && keys.has(normalizedCandidate)) return id;
    }
  }

  return null;
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

let collectionSequence = 0;
const createCollectionId = () => 'collection_' + Date.now().toString(36) + '_' + (++collectionSequence) + '_' + Math.random().toString(36).slice(2);
const createState = () => {
  const defaults = cloneDefaults();
  return {
    collectionId: createCollectionId(),
    images: new Map(),
    requestSourcesByUrl: new Map(),
    requestKeysByImage: new Map(),
    imagesByNormalized: new Map(),
    imagesByHdSrc: new Map(),
    selectedIds: new Set(),
    hiddenIds: new Set(),
    config: defaults.config,
    pageUrl: null,
    lastScanTime: null,
    isScanning: false
  };
};

const serializeState = (state) => ({
  collectionId: state.collectionId,
  images: Array.from(state.images.values()),
  selectedIds: Array.from(state.selectedIds),
  hiddenIds: Array.from(state.hiddenIds || []),
  config: state.config,
  pageUrl: state.pageUrl,
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
  const storedTabIds = new Set();
  let ready = false;
  let readyPromise = null;
  let loadError = null;
  let persistPromise = null;
  let persistQueued = false;
  let persistenceError = null;
  let snapshotDirty = false;
  let persistenceRevision = 0;

  const initTabState = (tabId) => {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, createState());
      snapshotDirty = true;
    }
    return tabStates.get(tabId);
  };

  const persist = () => {
    if (persistPromise) return persistPromise;
    persistPromise = Promise.resolve()
      .then(async () => {
        do {
          persistQueued = false;
          const writeSnapshot = snapshotDirty;
          snapshotDirty = false;
          const revision = persistenceRevision;
          const payload = {};
          for (const [tabId, state] of tabStates.entries()) {
            payload[String(tabId)] = writeSnapshot
              ? { ...serializeState(state), persistenceRevision: revision }
              : { collectionId: state.collectionId, persistenceRevision: revision,
                selectedIds: Array.from(state.selectedIds), hiddenIds: Array.from(state.hiddenIds), config: { ...state.config } };
          }
          try {
            await chrome.storage.local.set(writeSnapshot
              ? { [STORAGE_KEY]: payload, [METADATA_STORAGE_KEY]: {} }
              : { [METADATA_STORAGE_KEY]: payload });
          } catch (error) {
            snapshotDirty = snapshotDirty || writeSnapshot;
            throw error;
          }
        } while (persistQueued);
        persistenceError = null;
      })
      .catch((error) => {
        persistQueued = true;
        persistenceError = error?.message || String(error);
        throw error;
      })
      .finally(() => {
        persistPromise = null;
        if (persistQueued && !persistenceError && !loadError) persist();
      });
    // Keep fire-and-forget mutations safe while allowing flush callers to see failures.
    persistPromise.catch((error) => {
      console.error("[图片采集查看器] Failed to persist state:", error);
    });
    return persistPromise;
  };

  const schedulePersist = (metadataOnly = false) => {
    persistenceRevision += 1;
    snapshotDirty = snapshotDirty || !metadataOnly;
    persistQueued = true;
    if (!loadError) persist();
  };

  const ensureReady = async () => {
    if (ready) return;
    if (readyPromise) {
      await readyPromise;
      return;
    }

    readyPromise = (async () => {
      try {
        const stored = await chrome.storage.local.get([STORAGE_KEY, METADATA_STORAGE_KEY]);
        const rawStates = stored?.[STORAGE_KEY] || {};
        const loadedStates = new Map();
        for (const [tabIdString, rawState] of Object.entries(rawStates)) {
          const tabId = Number(tabIdString);
          if (!Number.isInteger(tabId) || !rawState || typeof rawState !== "object") continue;

          const overlay = stored?.[METADATA_STORAGE_KEY]?.[tabIdString];
          const baseRevision = Number(rawState.persistenceRevision) || 0;
          const overlayRevision = Number(overlay?.persistenceRevision) || 0;
          persistenceRevision = Math.max(persistenceRevision, baseRevision, overlayRevision);
          const metadata = overlay?.collectionId === rawState.collectionId && overlayRevision > baseRevision
            ? overlay : rawState;

          const state = createState();
          if (typeof rawState.collectionId === 'string' && /^collection_[a-z0-9_]+$/i.test(rawState.collectionId) && rawState.collectionId.length < 120) {
            state.collectionId = rawState.collectionId;
          } else {
            // The next write must establish the generated identity before using an overlay.
            snapshotDirty = true;
          }
          state.config = { ...cloneDefaults().config, ...normalizeConfig(metadata.config) };
          state.pageUrl = normalizePageUrl(rawState.pageUrl);
          state.lastScanTime = Number(rawState.lastScanTime) || null;

          const images = Array.isArray(rawState.images) ? rawState.images : [];
          const restoredIds = new Map();
          for (const image of images) {
            const normalizedImage = sanitizeImage(image);
            if (!normalizedImage) continue;
            // IDs are stable handles for selections even after URL aliases merge.
            const storedId = typeof image.id === "string" && /^img_[a-z0-9]+(?:_\d+)?$/.test(image.id) ? image.id : normalizedImage.id;
            const restoredImage = addNewImage(state, { ...normalizedImage, id: storedId });
            if (restoredImage) restoredIds.set(image.id || normalizedImage.id, restoredImage.id);
          }

          const selectedIds = Array.isArray(metadata.selectedIds) ? metadata.selectedIds : [];
          for (const id of selectedIds) {
            const restoredId = restoredIds.get(id) || id;
            if (state.images.has(restoredId)) {
              state.selectedIds.add(restoredId);
            }
          }

          const hiddenIds = Array.isArray(metadata.hiddenIds) ? metadata.hiddenIds : [];
          for (const id of hiddenIds) {
            const restoredId = restoredIds.get(id) || id;
            if (state.images.has(restoredId)) {
              state.hiddenIds.add(restoredId);
            }
          }
          loadedStates.set(tabId, state);
        }
        for (const [tabId, state] of loadedStates) {
          tabStates.set(tabId, state);
          storedTabIds.add(tabId);
        }
        loadError = null;
        ready = true;
      } catch (error) {
        loadError = error;
        console.error("[图片采集查看器] Failed to load state:", error);
        throw error;
      }
    })();

    try {
      await readyPromise;
    } finally {
      readyPromise = null;
    }
  };

  const getPersistenceStatus = () => ({
    pending: persistQueued || Boolean(persistPromise),
    error: persistenceError || loadError?.message || null
  });

  const flushPersistence = async () => {
    if (loadError) await ensureReady();
    while (persistQueued || persistPromise) await persist();
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
        if (addNewImage(state, image)) {
          added += 1;
        }
        continue;
      }

      const existing = state.images.get(existingId);
      if (!existing) {
        if (addNewImage(state, image)) {
          added += 1;
        }
        continue;
      }

      indexImage(state, image, existingId);
      const existingKeys = new Set(imageLookupKeys(existing));
      const aliases = [...new Set([...existingKeys, ...imageLookupKeys(image)])];
      const candidateUrls = normalizeCandidateUrls([...image.candidateUrls, ...existing.candidateUrls]);
      const shouldUpdateAliases = aliases.some((alias) => !existingKeys.has(alias));
      const shouldUpdateCandidates = candidateUrls.some((url) => !existing.candidateUrls.includes(url));
      const hdSrc = shouldUpgradeHdSrc(existing, image) ? image.hdSrc : existing.hdSrc;
      const hdSrcVerified = hdSrc === existing.hdSrc ? existing.hdSrcVerified : image.hdSrcVerified;
      const format = existing.formatTrusted
        ? existing.format
        : image.format !== "unknown" ? image.format : existing.format;
      const formatTrusted = existing.formatTrusted || image.formatTrusted;

      const shouldReplace =
        image.area > existing.area ||
        (image.area === existing.area && image.timestamp > existing.timestamp);

      if (shouldReplace) {
        const maxDimensions = mergeMaxDimensions(existing, image);
        const merged = {
          ...existing,
          ...image,
          id: existingId,
          normalized: existing.normalized,
          aliases,
          candidateUrls,
          hdSrc,
          hdSrcVerified,
          format,
          formatTrusted,
          ...maxDimensions,
          ...preserveHdState(existing, { ...image, hdSrc }),
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
      const maxDimensions = mergeMaxDimensions(existing, image);
      const shouldUpdateMaxDimensions = maxDimensions.maxArea > normalizeMaxDimensions(existing).maxArea;
      const shouldUpdateHdSrc = shouldUpgradeHdSrc(existing, image);
      if (
        (preferredSource && preferredSource !== existing.sourceUrl) ||
        shouldUpgradeFormat ||
        shouldUpdateComicMetadata ||
        shouldUpdateMaxDimensions ||
        shouldUpdateHdSrc ||
        shouldUpdateAliases ||
        shouldUpdateCandidates
      ) {
        const preservedHdState = preserveHdState(existing, { ...existing, hdSrc });
        const merged = {
          ...existing,
          sourceUrl: preferredSource || existing.sourceUrl,
          format: shouldUpgradeFormat ? image.format : existing.format,
          formatTrusted: shouldUpgradeFormat ? image.formatTrusted : existing.formatTrusted,
          hdSrc,
          hdSrcVerified,
          aliases,
          candidateUrls,
          ...maxDimensions,
          ...preservedHdState,
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
      collectionId: state.collectionId,
      hidden: state.hiddenIds.has(image.id)
    }));
  };

  const getCollectionId = (tabId) => tabStates.get(tabId)?.collectionId || '';
  const getImageById = (tabId, imageId) => {
    const state = tabStates.get(tabId);
    const image = state?.images.get(imageId);
    return image ? { ...image, collectionId: state.collectionId } : null;
  };
  const getImageRequestSource = (tabId, url) => {
    const state = tabStates.get(tabId);
    const sources = state?.requestSourcesByUrl.get(String(url || ''));
    if (!sources?.size) return { found: false, ambiguous: false, sourceUrl: '' };
    const known = sources.size - (sources.has('') ? 1 : 0);
    const pageOrigin = requestOrigin(state.pageUrl);
    const unknownAddsOrigin = sources.has('') && pageOrigin && !sources.has(pageOrigin);
    if (known + (unknownAddsOrigin ? 1 : 0) > 1) return { found: true, ambiguous: true, sourceUrl: '' };
    for (const [origin, source] of sources) if (origin) return { found: true, ambiguous: false, sourceUrl: source.sourceUrl };
    return { found: true, ambiguous: false, sourceUrl: pageOrigin ? state.pageUrl : '' };
  };

  const getPageUrl = (tabId) => {
    const state = tabStates.get(tabId);
    return state?.pageUrl || null;
  };

  const hasTabState = (tabId) => tabStates.has(tabId);

  const setPageUrl = (tabId, url) => {
    const normalized = normalizePageUrl(url);
    if (!normalized) return false;
    const state = initTabState(tabId);
    if (state.pageUrl === normalized) return false;
    state.pageUrl = normalized;
    schedulePersist();
    return true;
  };

  const toggleSelectImage = (tabId, imageId) => {
    const state = initTabState(tabId);
    if (!state.images.has(imageId)) return Array.from(state.selectedIds);

    if (state.selectedIds.has(imageId)) {
      state.selectedIds.delete(imageId);
    } else {
      state.selectedIds.add(imageId);
    }
    schedulePersist(true);
    return Array.from(state.selectedIds);
  };

  const setSelectionByIds = (tabId, imageIds = [], selected = true) => {
    const state = initTabState(tabId);
    const ids = Array.isArray(imageIds) ? imageIds : [];
    let changed = false;
    for (const imageId of ids) {
      if (!state.images.has(imageId)) continue;
      if (selected) {
        if (!state.selectedIds.has(imageId)) {
          state.selectedIds.add(imageId);
          changed = true;
        }
      } else {
        changed = state.selectedIds.delete(imageId) || changed;
      }
    }
    if (changed) schedulePersist(true);
    return Array.from(state.selectedIds);
  };

  // onlyIds, when an array, limits the result to selected images in it, so a
  // batch action can act on the selected images the UI currently shows.
  const getSelectedImages = (tabId, orderedImageIds = [], onlyIds = null) => {
    const state = tabStates.get(tabId);
    if (!state) return [];
    const allowed = Array.isArray(onlyIds) ? new Set(onlyIds) : null;
    const selected = Array.from(state.selectedIds)
      .filter((imageId) => !allowed || allowed.has(imageId))
      .map((imageId) => state.images.get(imageId))
      .filter(Boolean)
      .map(image => ({ ...image, collectionId: state.collectionId }))
      .sort((a, b) => b.area - a.area);
    if (!Array.isArray(orderedImageIds) || orderedImageIds.length === 0) {
      return selected;
    }

    const selectedById = new Map(selected.map((image) => [image.id, image]));
    const ordered = [];
    const seen = new Set();
    for (const imageId of orderedImageIds) {
      const image = selectedById.get(imageId);
      if (!image || seen.has(imageId)) continue;
      seen.add(imageId);
      ordered.push(image);
    }
    for (const image of selected) {
      if (seen.has(image.id)) continue;
      ordered.push(image);
    }
    return ordered;
  };

  const setHiddenByIds = (tabId, imageIds = [], hidden = true) => {
    const state = initTabState(tabId);
    const ids = Array.isArray(imageIds) ? imageIds : [];
    let changed = false;
    for (const imageId of ids) {
      if (!state.images.has(imageId)) continue;
      changed = state.selectedIds.delete(imageId) || changed;
      if (hidden) {
        if (!state.hiddenIds.has(imageId)) {
          state.hiddenIds.add(imageId);
          changed = true;
        }
      } else {
        changed = state.hiddenIds.delete(imageId) || changed;
      }
    }
    if (changed) schedulePersist(true);
    return Array.from(state.hiddenIds);
  };

  const setConfig = (tabId, config) => {
    const state = initTabState(tabId);
    const patch = normalizeConfig(config, true);
    const changed = Object.entries(patch).some(([key, value]) => state.config[key] !== value);
    if (changed) {
      state.config = { ...state.config, ...patch };
      schedulePersist(true);
    }
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

  const getMaxComicPageIndex = (tabId) => {
    const state = tabStates.get(tabId);
    if (!state) return 0;
    let maxIndex = 0;
    for (const image of state.images.values()) {
      const index = Number(image?.comicPageIndex);
      if (Number.isInteger(index) && index > maxIndex) {
        maxIndex = index;
      }
    }
    return maxIndex;
  };

  const setScanning = (tabId, isScanning) => {
    const nextScanning = Boolean(isScanning);
    const state = nextScanning ? initTabState(tabId) : tabStates.get(tabId);
    if (!state) return;
    state.isScanning = nextScanning;
    if (nextScanning) {
      state.lastScanTime = Date.now();
      schedulePersist();
    }
  };

  const removeTabState = (tabId) => {
    if (tabStates.delete(tabId)) {
      schedulePersist();
    }
  };

  // Tabs closed while the extension was not listening (browser quit, crash,
  // extension disabled) never get onRemoved. Only states read from storage are
  // considered, so a tab that appeared after the live list was taken is kept.
  const pruneStoredTabStates = (liveTabIds) => {
    let removed = 0;
    for (const tabId of storedTabIds) {
      if (!liveTabIds.has(tabId) && tabStates.delete(tabId)) removed += 1;
    }
    storedTabIds.clear();
    if (removed) schedulePersist();
    return removed;
  };

  const markHdRejected = (tabId, imageId, rejected = true, collectionId) => {
    const state = tabStates.get(tabId);
    if (!state || !collectionId || collectionId !== state.collectionId) return;
    const image = state.images.get(imageId);
    if (!image) return;
    const nextRejected = Boolean(rejected);
    const nextIsHD = Boolean(image.hdSrc && image.hdSrc !== image.src && !nextRejected);
    if (image.hdRejected === nextRejected && image.isHD === nextIsHD) return;
    image.hdRejected = nextRejected;
    image.isHD = nextIsHD;
    schedulePersist();
  };

  const updateImageMetadata = (tabId, metadata = {}) => {
    const state = tabStates.get(tabId);
    if (!state) return { updated: false };
    if (!metadata.collectionId || metadata.collectionId !== state.collectionId) return { updated: false, stale: true, collectionId: state.collectionId };

    const requestedId = String(metadata.imageId || metadata.id || "").trim();
    const loadedUrl = String(metadata.url || metadata.src || metadata.displaySrc || "").trim();
    const imageId = state.images.has(requestedId)
      ? requestedId
      : findImageIdByUrl(state, loadedUrl);
    if (!imageId) return { updated: false };

    const existing = state.images.get(imageId);
    if (!existing) return { updated: false };

    const incomingDimensions = {
      width: existing.width,
      height: existing.height,
      area: existing.area,
      maxWidth: metadata.maxWidth ?? metadata.width,
      maxHeight: metadata.maxHeight ?? metadata.height,
        maxArea: metadata.maxArea ?? metadata.area
      };
      const measuredArea = Math.max(0, Number(incomingDimensions.maxWidth) || 0) *
        Math.max(0, Number(incomingDimensions.maxHeight) || 0);
      const existingMax = normalizeMaxDimensions(existing);
    const maxDimensions = mergeMaxDimensions(existing, incomingDimensions);
    const shouldUpdateMaxDimensions = maxDimensions.maxArea > existingMax.maxArea;

    const incomingFormat = String(metadata.format || "").trim().toLowerCase();
    const existingFormat = String(existing.format || "").toLowerCase();
    const formatTrusted = metadata.formatTrusted === true;
    const shouldUpgradeFormat =
      incomingFormat &&
      incomingFormat !== "unknown" &&
      (
        existingFormat === "unknown" ||
        (formatTrusted && incomingFormat !== existingFormat)
      );
    const shouldTrustFormat = formatTrusted && incomingFormat && incomingFormat !== "unknown" && !existing.formatTrusted;

    const isUsableLoadedImageUrl =
      loadedUrl &&
      !/^data:/i.test(loadedUrl) &&
      !/^blob:/i.test(loadedUrl) &&
      !/^chrome-extension:/i.test(loadedUrl) &&
      loadedUrl !== existing.src;
      // A larger-than-layout thumbnail cannot disprove an HD candidate that has not been measured.
      const comparedCurrentHd = metadata.comparedHdSrc === existing.hdSrc &&
        measuredArea >= existingMax.maxArea;
      const primaryBecameLargest = loadedUrl === existing.src && existing.hdSrc && existing.hdSrc !== existing.src &&
        ((shouldUpdateMaxDimensions && existing.hdSrcVerified === true) || comparedCurrentHd);
    const shouldUpdateHdSrc = primaryBecameLargest || (
      isUsableLoadedImageUrl &&
      (
        shouldUpdateMaxDimensions ||
          ((!existing.hdSrc || existing.hdSrc === existing.src) &&
            measuredArea >= existingMax.maxArea)
      ));
    const shouldVerifyHdSrc = isUsableLoadedImageUrl &&
      (shouldUpdateHdSrc || loadedUrl === existing.hdSrc) && !existing.hdSrcVerified;

    if (!shouldUpdateMaxDimensions && !shouldUpgradeFormat && !shouldUpdateHdSrc && !shouldTrustFormat && !shouldVerifyHdSrc) {
      return { updated: false, image: existing };
    }

    const hdSrc = shouldUpdateHdSrc ? loadedUrl : existing.hdSrc;
    const merged = {
      ...existing,
      ...maxDimensions,
      hdSrc,
      hdSrcVerified: shouldVerifyHdSrc || existing.hdSrcVerified,
      format: shouldUpgradeFormat ? incomingFormat : existing.format,
      formatTrusted: shouldTrustFormat || existing.formatTrusted,
      ...preserveHdState(existing, { ...existing, hdSrc })
    };

    state.images.set(imageId, merged);
    indexImage(state, merged, imageId);
    state.lastScanTime = Date.now();
    schedulePersist();
    return { updated: true, image: merged };
  };

  const clearTabImages = (tabId) => {
    const state = tabStates.get(tabId);
    if (!state) return;
    state.collectionId = createCollectionId();
    state.requestSourcesByUrl.clear();
    state.requestKeysByImage.clear();
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
    getPersistenceStatus,
    flushPersistence,
    initTabState,
    mergeImages,
    getAllImages,
    getCollectionId,
    getImageById,
    getImageRequestSource,
    getPageUrl,
    hasTabState,
    setPageUrl,
    toggleSelectImage,
    setSelectionByIds,
    getSelectedImages,
    setHiddenByIds,
    setConfig,
    getConfig,
    getStats,
    getMaxComicPageIndex,
    setScanning,
    markHdRejected,
    updateImageMetadata,
    removeTabState,
    pruneStoredTabStates,
    clearTabImages
  };
};
