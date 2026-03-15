(() => {
if (globalThis.__PIC_COLLECTOR_CONTENT_READY__) {
  return;
}
globalThis.__PIC_COLLECTOR_CONTENT_READY__ = true;

const MSG = {
  SCAN_IMAGES: "SCAN_IMAGES",
  INCREMENTAL_SCAN: "INCREMENTAL_SCAN",
  GET_COMIC_SEQUENCE: "GET_COMIC_SEQUENCE",
  GET_COMIC_PAGINATION: "GET_COMIC_PAGINATION",
  TOGGLE_RIGHT_CLICK: "TOGGLE_RIGHT_CLICK",
  START_AUTO_SCAN: "START_AUTO_SCAN",
  STOP_AUTO_SCAN: "STOP_AUTO_SCAN",
  START_AUTO_SCROLL: "START_AUTO_SCROLL",
  STOP_AUTO_SCROLL: "STOP_AUTO_SCROLL",
  AUTO_SCROLL_STOPPED: "AUTO_SCROLL_STOPPED",
  COPY_IMAGE_DATA_URL: "COPY_IMAGE_DATA_URL",
  CLEAR_RUNTIME_CACHE: "CLEAR_RUNTIME_CACHE"
};

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

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

const HD_RULES = [
  {
    test: /twimg\.com\/media\//i,
    replace: (url) => {
      try {
        const parsed = new URL(url, location.href);
        if (!/twimg\.com$/i.test(parsed.hostname)) return url;
        if (!/\/media\//i.test(parsed.pathname)) return url;
        parsed.searchParams.set("name", "orig");
        return parsed.toString();
      } catch {
        return url;
      }
    }
  },
  {
    test: /sinaimg\.cn\/(bmiddle|orj360|mw690|thumb150)\//i,
    replace: (url) => url.replace(/\/(bmiddle|orj360|mw690|thumb150)\//i, "/large/")
  },
  {
    test: /sinaimg\.cn\/wx[0-9]+\//i,
    replace: (url) => url.replace(/\/wx[0-9]+\//i, "/large/")
  },
  {
    test: /tvax?\d*\.sinaimg\.cn\/crop\.[^/]+\/[^/?#]+\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i,
    replace: (url) => {
      try {
        const parsed = new URL(url, location.href);
        const matched = parsed.pathname.match(/\/crop\.[^/]+\/([^/?#]+\.(jpg|jpeg|png|webp|gif))$/i);
        if (!matched?.[1]) return url;
        return `https://wx2.sinaimg.cn/large/${matched[1]}`;
      } catch {
        return url;
      }
    }
  },
  {
    test: /-\d{1,5}x\d{1,5}\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i,
    replace: (url) => url.replace(/-\d{1,5}x\d{1,5}(\.[a-z]+(\?.*)?)$/i, "$1")
  },
  {
    test: /_\d{1,5}x\d{1,5}\.(jpg|jpeg|png|webp)(\?.*)?$/i,
    replace: (url) => url.replace(/_\d{1,5}x\d{1,5}(\.[a-z]+(\?.*)?)$/i, "$1")
  },
  {
    test: /cdn\.discordapp\.com.*\.(jpg|jpeg|png|webp|gif)\?size=\d+/i,
    replace: (url) => url.replace(/\?size=\d+/i, "")
  }
];

const normalizeUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url, location.href);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (NOISE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    const query = parsed.searchParams.toString();
    let pathname = parsed.pathname;
    // 小红书同图不同尺寸常见后缀: !nc_n_webp_x / !nd_dft_wlteh_webp_x
    if (/xhscdn\.com$/i.test(parsed.hostname) && /notes_pre_post/i.test(pathname)) {
      pathname = pathname.replace(/![^/?#]+$/i, "");
    }
    return `${parsed.origin}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
};

const absoluteUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    return new URL(url, location.href).href;
  } catch {
    return null;
  }
};

const hashText = (text) => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

const imageIdFromNormalized = (normalized) => `img_${hashText(normalized)}`;

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

const copyImagePayloadToClipboard = async (dataUrl, fallbackUrl = "") => {
  const canWriteImage =
    typeof ClipboardItem !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === "function";

  if (canWriteImage && dataUrl) {
    try {
      const blob = dataUrlToBlob(dataUrl);
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        return { success: true, mode: "image" };
      }
    } catch {
      // Fall through to URL fallback.
    }
  }

  if (fallbackUrl && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(fallbackUrl);
      return { success: true, mode: "url" };
    } catch {
      // Continue and return failure below.
    }
  }

  return { success: false, error: "Clipboard write failed" };
};

const parseSrcset = (srcset) => {
  if (!srcset || typeof srcset !== "string") return null;
  const candidates = srcset
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [url, descriptor] = item.split(/\s+/, 2);
      const score = descriptor?.endsWith("w")
        ? parseInt(descriptor, 10)
        : descriptor?.endsWith("x")
          ? Math.round(parseFloat(descriptor) * 1000)
          : 0;
      return { url, score: Number.isFinite(score) ? score : 0 };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.url || null;
};

const getHDUrl = (url) => {
  if (!url || /\.gif(\?.*)?$/i.test(url)) return url;
  for (const rule of HD_RULES) {
    if (rule.test.test(url)) return rule.replace(url);
  }
  return url;
};

const inferFormat = (url) => {
  try {
    const parsed = new URL(url, location.href);
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

    // 小红书常见图片域名: sns-webpic-*.xhscdn.com（无扩展名，但实际是 webp）。
    if (/xhscdn\.com$/i.test(parsed.hostname) && (/webpic/i.test(parsed.hostname) || /notes_pre_post/i.test(parsed.pathname))) {
      return "webp";
    }
  } catch {
    // Ignore parse failures.
  }

  const match = url?.split("?")[0].match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "unknown";
};

const isInvalidSource = (url) => {
  if (!url) return true;
  if (url === TRANSPARENT_PIXEL) return true;
  if (url.startsWith("javascript:")) return true;
  if (url.startsWith("about:")) return true;
  if (url.startsWith("chrome-extension:")) return true;
  if (url.startsWith("data:") && url.length < 1000) return true;
  try {
    const parsed = new URL(url, location.href);
    if (
      /^tvax?\d*\.sinaimg\.cn$/i.test(parsed.hostname) &&
      /\/crop\.[^/]*\.(?:50|72|180)\//i.test(parsed.pathname)
    ) {
      return true;
    }
  } catch {
    // Ignore parse failures.
  }
  return false;
};

const isWeiboPage = () => /(^|\.)weibo\.com$/i.test(location.hostname) || /(^|\.)weibo\.cn$/i.test(location.hostname);

const isLikelyWeiboContentUrl = (url) => {
  try {
    const parsed = new URL(url, location.href);
    if (!/\.sinaimg\.cn$/i.test(parsed.hostname)) return false;
    const path = parsed.pathname || "";

    if (/\/(large|mw\d+|orj360|bmiddle|thumb150)\//i.test(path)) return true;
    if (/\/crop\.[^/]*\.(?:50|72|180)\//i.test(path)) return false;
    if (/\/(avatar|ad|icon|emoji|badge)\//i.test(path)) return false;
    return false;
  } catch {
    return false;
  }
};

const sourceQualityScore = (url, order = 0) => {
  try {
    const parsed = new URL(url, location.href);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    const query = parsed.search || "";
    let score = 0;

    if (/^wx\d+\.sinaimg\.cn$/i.test(host)) score += 240;
    if (/^tvax?\d*\.sinaimg\.cn$/i.test(host)) score -= 90;
    if (/^tvax?\d*\.sinaimg\.cn$/i.test(host) && /\/crop\./i.test(path)) score -= 140;
    if (/xhscdn\.com$/i.test(host)) score += 90;

    if (/\/(large|original|orj360)\//i.test(path)) score += 70;
    if (/\/mw\d+\//i.test(path)) score += 42;
    if (/\.(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:$|\?)/i.test(url)) score += 18;
    if (/[?&](Expires|ssig|KID)=/i.test(query)) score -= 32;
    else score += 22;

    score += Math.max(0, 10 - order);
    return score;
  } catch {
    return Math.max(0, 10 - order);
  }
};

const chooseBestSource = (candidates = []) => {
  const seen = new Set();
  const items = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const absolute = absoluteUrl(candidates[i]);
    if (!absolute || isInvalidSource(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    items.push({
      url: absolute,
      score: sourceQualityScore(absolute, i)
    });
  }

  if (items.length === 0) return null;

  let ranked = items;
  if (isWeiboPage()) {
    const preferred = items.filter((item) => isLikelyWeiboContentUrl(item.url));
    if (preferred.length > 0) {
      ranked = preferred;
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked[0].url;
};

const isLikelyImageHref = (url) => {
  if (!url) return false;
  try {
    const parsed = new URL(url, location.href);
    const pathname = parsed.pathname || "";
    if (/\.(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:$|[?#])/i.test(pathname)) return true;

    const format = parsed.searchParams.get("format");
    if (format && /^(jpg|jpeg|png|webp|gif|svg|avif|bmp)$/i.test(format)) return true;

    // Some galleries use imagecache-style paths without explicit extension in link text.
    if (/\/imagecache\//i.test(pathname) && /(jpg|jpeg|png|webp|gif|svg|avif|bmp)/i.test(pathname)) return true;

    return false;
  } catch {
    return false;
  }
};

const isXSite = () => /(^|\.)x\.com$/i.test(location.hostname) || /(^|\.)twitter\.com$/i.test(location.hostname);
const isTumblrSite = () => /(^|\.)tumblr\.com$/i.test(location.hostname);
const isXiaohongshuSite = () => /(^|\.)xiaohongshu\.com$/i.test(location.hostname);
const isTelegramSite = () => /(^|\.)web\.telegram\.org$/i.test(location.hostname);
const isInstagramSite = () => /(^|\.)instagram\.com$/i.test(location.hostname);
const isTelegramBlobUrl = (url) => /^blob:https?:\/\/web\.telegram\.org\//i.test(String(url || ""));

const SOCIAL_SOURCE_PATTERNS = [
  /\/[^/]+\/status\/\d+/i,
  /\/i\/web\/status\/\d+/i,
  /\/(status|detail)\/[A-Za-z0-9]+/i,
  /\/p\/[A-Za-z0-9_-]+/i,
  /\/\d+\/[A-Za-z0-9]+/i,
  /\/(explore|discovery\/item)\/[A-Za-z0-9_-]+/i,
  /\/post\/\d+/i
];

const normalizeSourceUrl = (url) => {
  const absolute = absoluteUrl(url);
  if (!absolute) return null;
  try {
    const parsed = new URL(absolute, location.href);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (NOISE_QUERY_KEYS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";

    if (isXSite() && (/x\.com$/i.test(host) || /twitter\.com$/i.test(host))) {
      const userStatus = path.match(/^\/([^/]+)\/status\/(\d+)/i);
      const webStatus = path.match(/^\/i\/web\/status\/(\d+)/i);
      if (userStatus) {
        parsed.pathname = `/${userStatus[1]}/status/${userStatus[2]}`;
        parsed.search = "";
      } else if (webStatus) {
        parsed.pathname = `/i/web/status/${webStatus[1]}`;
        parsed.search = "";
      }
    } else if (isInstagramSite() && /instagram\.com$/i.test(host)) {
      const post = path.match(/^\/p\/([A-Za-z0-9_-]+)/i);
      if (post) {
        parsed.pathname = `/p/${post[1]}/`;
        parsed.search = "";
      }
    } else if (isTumblrSite() && /tumblr\.com$/i.test(host)) {
      const post = path.match(/^\/post\/(\d+)/i);
      if (post) {
        parsed.pathname = `/post/${post[1]}`;
        parsed.search = "";
      }
    } else if (isXiaohongshuSite() && /xiaohongshu\.com$/i.test(host)) {
      const note = path.match(/^\/(explore|discovery\/item)\/([A-Za-z0-9_-]+)/i);
      if (note) {
        parsed.pathname = `/${note[1]}/${note[2]}`;
        // Keep xsec_token / xsec_source for XHS note links; removing them can lead to 404 wrappers.
      }
    } else if (isWeiboPage() && /weibo\.(com|cn)$/i.test(host)) {
      const status = path.match(/^\/(status|detail)\/([A-Za-z0-9]+)/i);
      if (status) {
        parsed.pathname = `/${status[1]}/${status[2]}`;
        parsed.search = "";
      }
    }

    const query = parsed.searchParams.toString();
    return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
};

const isLikelySourcePageHref = (url) => {
  if (!url) return false;
  if (isLikelyImageHref(url)) return false;
  try {
    const parsed = new URL(url, location.href);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    const path = parsed.pathname || "";
    if (!path || path === "/") return false;
    if (SOCIAL_SOURCE_PATTERNS.some((pattern) => pattern.test(path))) return true;
    if (/\/(item|product|goods)\.htm/i.test(path) && parsed.searchParams.has("id")) return true;
    if (/\/(article|news|post|p)\//i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
};

const scoreSourceHref = (url) => {
  try {
    const parsed = new URL(url, location.href);
    if (!/^https?:$/i.test(parsed.protocol)) return -1000;
    if (isLikelyImageHref(parsed.toString())) return -1000;

    const currentHost = String(location.hostname || "").toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "";
    let score = 0;

    if (host === currentHost) score += 60;
    if (host.endsWith(`.${currentHost}`) || currentHost.endsWith(`.${host}`)) score += 24;
    if (isLikelySourcePageHref(parsed.toString())) score += 260;
    if (/^\/404(?:\/|$)/i.test(path)) score -= 800;
    if (/\/(photo|media)\//i.test(path)) score -= 30;
    if (/\/(explore|discovery\/item|post|status|detail)\//i.test(path)) score += 120;
    if (/(^|\.)t\.me$/i.test(host) && /\/\d+$/i.test(path)) score += 240;
    if (/web\.telegram\.org$/i.test(host) && /^\/[ak]\/$/i.test(path) && /^#@[^/]+\/\d+$/i.test(parsed.hash || "")) score += 280;
    if (/web\.telegram\.org$/i.test(host) && /^\/[ak]\/$/i.test(path) && /^#-?\d{6,}\/\d+$/i.test(parsed.hash || "")) score += 280;
    if (/\/(item|product|goods)\.htm/i.test(path) && parsed.searchParams.has("id")) score += 120;
    if (/xiaohongshu\.com$/i.test(host) && /^\/explore\/[A-Za-z0-9_-]+/i.test(path)) score += 120;
    if (/xiaohongshu\.com$/i.test(host) && parsed.searchParams.has("xsec_token")) score += 60;
    if (/xiaohongshu\.com$/i.test(host) && parsed.searchParams.has("xsec_source")) score += 20;
    if (path === "/" || path === "") score -= 100;
    if (parsed.toString() === location.href) score += 12;

    return score;
  } catch {
    return -1000;
  }
};

const sourceContainerCache = new WeakMap();
const sourceElementCache = new WeakMap();
const getCurrentPageSourceUrl = () => normalizeSourceUrl(location.href) || location.href;

const extractTelegramNumericId = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{2,}$/.test(raw)) return raw;

  const byNamedKey = raw.match(/(?:^|[^\d])(mid|msg|message|post|history|item)[-_:/=]?(\d{2,})(?:$|[^\d])/i);
  if (byNamedKey?.[2]) return byNamedKey[2];

  const byQuery = raw.match(/(?:^|[?&#/])(message_id|msg_id|mid|msg|post|item)=(\d{2,})(?:$|[&#])/i);
  if (byQuery?.[2]) return byQuery[2];

  const byPathTail = raw.match(/\/(\d{2,})(?:\/?$)/);
  if (byPathTail?.[1]) return byPathTail[1];

  return "";
};

const parseTelegramMessageId = (element) => {
  if (!element) return "";
  const msgNode = element.closest?.(
    "[data-mid], [data-message-id], [id*='message'], [id*='msg'], .Message, .message, [class*='message']"
  );
  if (msgNode) {
    const explicitCandidates = [
      msgNode.getAttribute?.("data-mid"),
      msgNode.getAttribute?.("data-message-id"),
      msgNode.getAttribute?.("data-id")
    ];
    for (const candidate of explicitCandidates) {
      const id = extractTelegramNumericId(candidate);
      if (id) return id;
    }

    const attrNames = typeof msgNode.getAttributeNames === "function" ? msgNode.getAttributeNames() : [];
    for (const attr of attrNames) {
      if (!/(mid|msg|message|history|post|item)/i.test(attr)) continue;
      const id = extractTelegramNumericId(msgNode.getAttribute(attr));
      if (id) return id;
    }

    // Avoid generic UUID-like ids; only parse ids that include message-like prefixes.
    const idByName = extractTelegramNumericId(msgNode.id);
    if (idByName) return idByName;
  }

  const scopedAnchors = collectScopedAnchorCandidates(msgNode || element.closest?.("article, section, main") || document.body || document);
  const maxAnchors = Math.min(scopedAnchors.length, 96);
  for (let i = 0; i < maxAnchors; i += 1) {
    const parsed = parseTelegramPeerFromHref(scopedAnchors[i]);
    if (parsed.messageId) return parsed.messageId;
  }

  try {
    const hash = String(location.hash || "").replace(/^#/, "");
    const byUser = hash.match(/^@[^/?#]+\/(\d+)/);
    if (byUser?.[1]) return byUser[1];
    const byPeer = hash.match(/^-?\d{6,}\/(\d+)/);
    if (byPeer?.[1]) return byPeer[1];
    const byLegacy = hash.match(/^p=c\d+_(\d+)/i);
    if (byLegacy?.[1]) return byLegacy[1];
  } catch {
    // Ignore parse failures.
  }
  return "";
};

const parseTelegramPeerFromHash = (hashValue) => {
  const raw = String(hashValue || "").replace(/^#/, "");
  if (!raw) return { peer: "", messageId: "" };

  const directAt = raw.match(/^@([^/?#]+)(?:\/(\d+))?/i);
  if (directAt?.[1]) {
    return { peer: `@${directAt[1]}`, messageId: directAt[2] || "" };
  }

  const directPeer = raw.match(/^(-?\d{6,})(?:\/(\d+))?/);
  if (directPeer?.[1]) {
    return { peer: directPeer[1], messageId: directPeer[2] || "" };
  }

  const legacy = raw.match(/p=c(\d{4,})_(\d+)/i);
  if (legacy?.[1]) {
    return { peer: `-100${legacy[1]}`, messageId: legacy[2] || "" };
  }

  const queryMatch = raw.match(/(?:^|[?&])p=([^&]+)/i);
  if (queryMatch?.[1]) {
    let decoded = queryMatch[1];
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep raw.
    }

    const qAt = decoded.match(/^@([^/?#]+)(?:\/(\d+))?/i);
    if (qAt?.[1]) {
      return { peer: `@${qAt[1]}`, messageId: qAt[2] || "" };
    }

    const qC = decoded.match(/^c(\d{4,})(?:_(\d+)|\/(\d+))?/i);
    if (qC?.[1]) {
      return { peer: `-100${qC[1]}`, messageId: qC[2] || qC[3] || "" };
    }

    const qPeer = decoded.match(/^(-?\d{6,})(?:_(\d+)|\/(\d+))?/);
    if (qPeer?.[1]) {
      return { peer: qPeer[1], messageId: qPeer[2] || qPeer[3] || "" };
    }
  }

  return { peer: "", messageId: "" };
};

const parseTelegramPeerFromHref = (href) => {
  if (!href) return { peer: "", messageId: "" };
  try {
    const parsed = new URL(href, location.href);
    if (/(^|\.)t\.me$/i.test(parsed.hostname)) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && parts[0].toLowerCase() === "c" && /^\d+$/.test(parts[1])) {
        const msg = parts[2] && /^\d+$/.test(parts[2]) ? parts[2] : "";
        return { peer: `-100${parts[1]}`, messageId: msg };
      }
      if (parts.length >= 1) {
        const channel = parts[0];
        const msg = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : "";
        return { peer: `@${channel}`, messageId: msg };
      }
    }
    if (/web\.telegram\.org$/i.test(parsed.hostname)) {
      const fromHash = parseTelegramPeerFromHash(parsed.hash);
      if (fromHash.peer) return fromHash;
      const p = parsed.searchParams.get("p");
      if (p) {
        return parseTelegramPeerFromHash(`#p=${p}`);
      }
    }
  } catch {
    // Ignore parse failures.
  }
  return { peer: "", messageId: "" };
};

const parseTelegramPeerFromElement = (element) => {
  if (!element) return "";
  const fromLocation = parseTelegramPeerFromHash(location.hash);
  if (fromLocation.peer) return fromLocation.peer;

  let node = element;
  for (let depth = 0; node && depth < 12; depth += 1) {
    const attrNames = typeof node.getAttributeNames === "function" ? node.getAttributeNames() : [];
    for (const attr of attrNames) {
      const value = String(node.getAttribute(attr) || "");
      if (!value) continue;

      if (/(peer|chat|dialog|history|thread|channel)/i.test(attr)) {
        const match = value.match(/-?\d{6,}/);
        if (match?.[0]) {
          return match[0].startsWith("-") ? match[0] : `-100${match[0]}`;
        }
      }
      if (/(username|user|channel)/i.test(attr)) {
        const match = value.match(/^@?([A-Za-z0-9_]{4,})$/);
        if (match?.[1]) return `@${match[1]}`;
      }
    }

    const idText = String(node.id || "");
    if (idText) {
      const peerMatch = idText.match(/-?\d{6,}/);
      if (peerMatch?.[0]) {
        return peerMatch[0].startsWith("-") ? peerMatch[0] : `-100${peerMatch[0]}`;
      }
    }

    if (node.tagName === "A") {
      const href = node.getAttribute("href") || node.href;
      const parsed = parseTelegramPeerFromHref(href);
      if (parsed.peer) return parsed.peer;
    }

    node = node.parentElement;
  }

  const messageId = parseTelegramMessageId(element);
  const anchors = (element.closest?.("[data-mid], [data-message-id], [class*='message']") || document).querySelectorAll?.("a[href]") || [];
  const max = Math.min(anchors.length, 96);
  for (let i = 0; i < max; i += 1) {
    const href = anchors[i].getAttribute("href") || anchors[i].href;
    const parsed = parseTelegramPeerFromHref(href);
    if (!parsed.peer) continue;
    if (!messageId || !parsed.messageId || parsed.messageId === messageId) {
      return parsed.peer;
    }
  }

  if (messageId) {
    const globalAnchors = document.querySelectorAll?.("a[href*='t.me/'], a[href*='web.telegram.org/']") || [];
    const globalMax = Math.min(globalAnchors.length, 320);
    for (let i = 0; i < globalMax; i += 1) {
      const href = globalAnchors[i].getAttribute("href") || globalAnchors[i].href;
      const parsed = parseTelegramPeerFromHref(href);
      if (parsed.peer && parsed.messageId === messageId) {
        return parsed.peer;
      }
    }
  }

  return "";
};

const buildTelegramDeepLink = (peer, messageId = "") => {
  const safePeer = String(peer || "").trim();
  const safeMessageId = String(messageId || "").trim();
  if (!safePeer) return "";

  if (/^@[A-Za-z0-9_]{4,}$/i.test(safePeer)) {
    const channel = safePeer.slice(1);
    return safeMessageId ? `https://t.me/${channel}/${safeMessageId}` : `https://t.me/${channel}`;
  }

  if (/^-100\d{4,}$/.test(safePeer)) {
    const channelId = safePeer.replace(/^-100/, "");
    return safeMessageId ? `https://t.me/c/${channelId}/${safeMessageId}` : `https://t.me/c/${channelId}`;
  }

  if (/^-?\d{6,}$/.test(safePeer)) {
    const channelId = safePeer.replace(/^-/, "");
    return safeMessageId ? `https://t.me/c/${channelId}/${safeMessageId}` : `https://t.me/c/${channelId}`;
  }

  return "";
};

const resolveTelegramSourceUrl = (element) => {
  const messageId = parseTelegramMessageId(element);
  const peerHint = parseTelegramPeerFromElement(element);
  const rawCandidates = [];
  const parsedCandidates = [];
  const pushCandidate = (value) => {
    const href = absoluteUrl(value);
    if (!href) return;
    rawCandidates.push(href);
    const parsed = parseTelegramPeerFromHref(href);
    if (parsed.peer) {
      parsedCandidates.push({
        href,
        peer: parsed.peer,
        messageId: parsed.messageId || ""
      });
    }
  };

  let node = element;
  for (let depth = 0; node && depth < 10; depth += 1) {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || node.href;
      if (href) pushCandidate(href);
    }
    const dataPermalink = node.getAttribute?.("data-permalink");
    const dataHref = node.getAttribute?.("data-href");
    if (dataPermalink) pushCandidate(dataPermalink);
    if (dataHref) pushCandidate(dataHref);
    node = node.parentElement;
  }

  const msgContainer = element.closest?.("[data-mid], [data-message-id], .Message, .message, [class*='message']");
  const scopedLinks = collectScopedAnchorCandidates(msgContainer || document.body || document);
  for (const href of scopedLinks) {
    if (!/t\.me\//i.test(href) && !/web\.telegram\.org\//i.test(href)) continue;
    pushCandidate(href);
  }

  if (messageId) {
    const globalLinks = document.querySelectorAll?.("a[href*='t.me/'], a[href*='web.telegram.org/']") || [];
    const globalMax = Math.min(globalLinks.length, 320);
    for (let i = 0; i < globalMax; i += 1) {
      const href = globalLinks[i].getAttribute("href") || globalLinks[i].href;
      const parsed = parseTelegramPeerFromHref(href);
      if (!parsed.peer || parsed.messageId !== messageId) continue;
      pushCandidate(href);
    }
  }

  const fromLocationHash = parseTelegramPeerFromHash(location.hash);
  if (fromLocationHash.peer) {
    parsedCandidates.push({
      href: "",
      peer: fromLocationHash.peer,
      messageId: fromLocationHash.messageId || ""
    });
  }

  // Priority 1: strict match by message id.
  if (messageId) {
    const exact = parsedCandidates.find((item) => item.messageId === messageId && item.peer);
    if (exact) {
      const deep = buildTelegramDeepLink(exact.peer, messageId);
      if (deep) return deep;
      if (exact.href) return exact.href;
    }
  }

  // Priority 2: any candidate that already contains peer+message.
  const precise = parsedCandidates.find((item) => item.peer && item.messageId);
  if (precise) {
    const deep = buildTelegramDeepLink(precise.peer, precise.messageId);
    if (deep) return deep;
    if (precise.href) return precise.href;
  }

  // Priority 3: construct from inferred peer + message id.
  const fallbackPeer = peerHint || fromLocationHash.peer || "";
  if (fallbackPeer && messageId) {
    const deep = buildTelegramDeepLink(fallbackPeer, messageId);
    if (deep) return deep;
    const peerOnly = buildTelegramDeepLink(fallbackPeer);
    if (peerOnly) return peerOnly;
  }

  // Priority 4: peer-only t.me link.
  if (fallbackPeer) {
    const peerOnly = buildTelegramDeepLink(fallbackPeer);
    if (peerOnly) return peerOnly;
  }

  // Priority 5: non-generic Telegram links from existing candidates.
  const best = pickBestSourceHref(rawCandidates);
  if (best && !/^https:\/\/web\.telegram\.org\/[ak]\/?$/i.test(best)) {
    return best;
  }

  // Final fallback: explicit t.me root (user-accepted fallback).
  return "https://t.me/";
};

const TELEGRAM_MEDIA_ID_ATTRS = [
  "data-photo-id",
  "data-media-id",
  "data-file-id",
  "data-document-id",
  "data-entity-id",
  "data-item-id",
  "data-thumb-key"
];

const getTelegramMediaStableId = (element) => {
  if (!element) return "";
  let node = element;
  for (let depth = 0; node && depth < 8; depth += 1) {
    for (const attr of TELEGRAM_MEDIA_ID_ATTRS) {
      const value = String(node.getAttribute?.(attr) || "").trim();
      if (!value) continue;
      const cleaned = value.replace(/[^\w-]/g, "");
      if (cleaned && cleaned.length >= 4) return cleaned.slice(0, 64);
    }

    const attrNames = typeof node.getAttributeNames === "function" ? node.getAttributeNames() : [];
    for (const attr of attrNames) {
      if (!/(photo|media|file|document|entity|item)/i.test(attr)) continue;
      const value = String(node.getAttribute(attr) || "").trim();
      if (!value) continue;
      const cleaned = value.replace(/[^\w-]/g, "");
      if (cleaned && cleaned.length >= 4) return cleaned.slice(0, 64);
    }

    node = node.parentElement;
  }
  return "";
};

const getTelegramMediaIndexInMessage = (element) => {
  const messageNode = element?.closest?.("[data-mid], [data-message-id], [id*='message'], [class*='message']");
  if (!messageNode) return -1;
  const rawCandidates = Array.from(messageNode.querySelectorAll("img, picture"));
  if (rawCandidates.length === 0) return -1;

  const toImgNode = (node) => (node?.tagName === "PICTURE" ? node.querySelector("img") || node : node);
  const target = toImgNode(element);
  if (!target) return -1;

  const uniqueKeys = [];
  const keyIndex = new Map();
  for (const rawNode of rawCandidates) {
    const node = toImgNode(rawNode);
    if (!node) continue;
    const src = absoluteUrl(node.currentSrc || node.src || node.getAttribute?.("src") || "") || "";
    const { width, height } = measureElement(node);
    if (width <= 1 || height <= 1) continue;
    const key = `${src}|${Math.round(width / 10) * 10}x${Math.round(height / 10) * 10}`;
    if (!keyIndex.has(key)) {
      keyIndex.set(key, uniqueKeys.length);
      uniqueKeys.push(key);
    }
  }

  const targetSrc = absoluteUrl(target.currentSrc || target.src || target.getAttribute?.("src") || "") || "";
  const { width: tw, height: th } = measureElement(target);
  const targetKey = `${targetSrc}|${Math.round((tw || 0) / 10) * 10}x${Math.round((th || 0) / 10) * 10}`;
  if (keyIndex.has(targetKey)) {
    return keyIndex.get(targetKey);
  }

  // Last fallback: use DOM order among raw candidates.
  const exact = rawCandidates.indexOf(target);
  if (exact >= 0) return exact;
  return -1;
};

const getTelegramElementKey = (element, width = 0, height = 0) => {
  if (!isTelegramSite() || !element) return "";
  const messageId = parseTelegramMessageId(element);
  const peer = parseTelegramPeerFromElement(element) || "peer";
  const mediaStableId = getTelegramMediaStableId(element);
  const mediaIdx = getTelegramMediaIndexInMessage(element);

  const shortEdge = Math.min(Number(width) || 0, Number(height) || 0);
  const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
  const ratioBucket = longEdge > 0 ? Math.round((shortEdge / longEdge) * 1000) : 0;

  if (messageId) {
    if (mediaStableId) return `${peer}:${messageId}:m:${mediaStableId}`;
    if (mediaIdx >= 0) return `${peer}:${messageId}:i:${mediaIdx}`;
    if (ratioBucket > 0) return `${peer}:${messageId}:r:${ratioBucket}`;
    return `${peer}:${messageId}:f`;
  }

  if (mediaStableId) return `${peer}:x:${mediaStableId}`;
  if (mediaIdx >= 0) return `${peer}:i:${mediaIdx}`;
  if (shortEdge > 0 && longEdge > 0) {
    return `${peer}:s:${Math.round(shortEdge / 20) * 20}x${Math.round(longEdge / 20) * 20}`;
  }
  return `${peer}:f`;
};

const isTelegramLikelyMediaElement = (element) => {
  if (!isTelegramSite() || !element) return false;
  return Boolean(
    element.closest?.(
      "[data-mid], [data-message-id], [class*='message-media'], [class*='media-viewer'], [class*='MediaViewer'], [class*='album'], [class*='photo']"
    )
  );
};

const isTelegramNoiseElement = (element, src, width, height) => {
  if (!isTelegramSite()) return false;

  const marker = `${element?.className || ""} ${element?.id || ""} ${element?.getAttribute?.("aria-label") || ""} ${element?.getAttribute?.("alt") || ""}`.toLowerCase();
  const likelyUiNoise = /(emoji|sticker|reaction|avatar|icon|badge|toolbar|menu|btn|button)/i.test(marker);
  const likelyMediaMarker = /(media|photo|viewer|message)/i.test(marker);
  if (likelyUiNoise && !likelyMediaMarker) return true;
  if (!isTelegramLikelyMediaElement(element)) return true;

  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w > 0 && h > 0 && w <= 180 && h <= 180) return true;

  const lower = String(src || "").toLowerCase();
  if (/emoji|sticker|reaction|avatar|icon|badge/.test(lower)) return true;

  return false;
};

const pickBestSourceHref = (candidates = []) => {
  let bestUrl = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    const normalized = normalizeSourceUrl(candidate);
    if (!normalized) continue;
    const score = scoreSourceHref(normalized);
    if (score > bestScore) {
      bestScore = score;
      bestUrl = normalized;
    }
  }

  return bestUrl || getCurrentPageSourceUrl();
};

const collectScopedAnchorCandidates = (scope) => {
  if (!scope || typeof scope.querySelectorAll !== "function") return [];
  const links = [];
  const anchors = scope.querySelectorAll("a[href]");
  const max = Math.min(anchors.length, 48);
  for (let i = 0; i < max; i += 1) {
    const href = anchors[i].getAttribute("href") || anchors[i].href;
    if (!href) continue;
    links.push(href);
  }
  return links;
};

const getContainerSourceHref = (element) => {
  const container = element?.closest?.(
    "article, [role='article'], [data-testid*='tweet'], [data-testid*='cellInnerDiv'], [mid], [action-type*='feed'], [class*='feed'], [class*='note'], section, li"
  );
  if (!container) return null;
  if (!isXiaohongshuSite() && sourceContainerCache.has(container)) {
    return sourceContainerCache.get(container) || null;
  }

  const candidates = collectScopedAnchorCandidates(container);
  const picked = pickBestSourceHref(candidates);
  if (!isXiaohongshuSite()) {
    sourceContainerCache.set(container, picked || null);
  }
  return picked || null;
};

const resolveSourceUrl = (element) => {
  if (isTelegramSite()) {
    return resolveTelegramSourceUrl(element);
  }

  if (!element) return getCurrentPageSourceUrl();
  if (!isXiaohongshuSite() && sourceElementCache.has(element)) {
    return sourceElementCache.get(element) || getCurrentPageSourceUrl();
  }

  const candidates = [location.href];
  let node = element;
  for (let depth = 0; node && depth < 8; depth += 1) {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || node.href;
      if (href) candidates.push(href);
    }
    const dataPermalink = node.getAttribute?.("data-permalink");
    const dataHref = node.getAttribute?.("data-href");
    const dataUrl = node.getAttribute?.("data-url");
    if (dataPermalink) candidates.push(dataPermalink);
    if (dataHref) candidates.push(dataHref);
    if (dataUrl) candidates.push(dataUrl);
    node = node.parentElement;
  }

  const containerSource = getContainerSourceHref(element);
  if (containerSource) candidates.push(containerSource);

  if (isXSite()) {
    const xArticle = element.closest?.("article");
    if (xArticle) {
      const xLinks = collectScopedAnchorCandidates(xArticle);
      for (const href of xLinks) {
        if (/\/status\//i.test(href)) candidates.push(href);
      }
    }
  } else if (isWeiboPage()) {
    const wbScope = element.closest?.("article, [mid], [action-type*='feed'], [class*='feed']");
    if (wbScope) {
      const wbLinks = collectScopedAnchorCandidates(wbScope);
      for (const href of wbLinks) {
        if (/\/(status|detail)\//i.test(href) || /weibo\.com\/\d+\/[A-Za-z0-9]+/i.test(href)) {
          candidates.push(href);
        }
      }
    }
  } else if (isXiaohongshuSite()) {
    const xhsScope = element.closest?.("article, section, [class*='note'], [class*='feed']");
    if (xhsScope) {
      const xhsLinks = collectScopedAnchorCandidates(xhsScope);
      for (const href of xhsLinks) {
        if (/\/(explore|discovery\/item)\//i.test(href)) candidates.push(href);
      }
    }
  } else if (isInstagramSite()) {
    const igScope = element.closest?.("article, section, [role='presentation'], [class*='x1lliihq'], li");
    if (igScope) {
      const igLinks = collectScopedAnchorCandidates(igScope);
      for (const href of igLinks) {
        if (/\/p\/[A-Za-z0-9_-]+/i.test(href)) candidates.push(href);
      }
    }
  } else if (isTumblrSite()) {
    const tumblrScope = element.closest?.("article, li, section");
    if (tumblrScope) {
      const tumblrLinks = collectScopedAnchorCandidates(tumblrScope);
      for (const href of tumblrLinks) {
        if (/\/post\/\d+/i.test(href)) candidates.push(href);
      }
    }
  }

  const picked = pickBestSourceHref(candidates);
  if (!isXiaohongshuSite()) {
    sourceElementCache.set(element, picked || getCurrentPageSourceUrl());
  }
  return picked || getCurrentPageSourceUrl();
};

const getAnchorImageCandidate = (element) => {
  const anchor = element?.closest?.("a[href]");
  if (!anchor) return null;

  const href = absoluteUrl(anchor.getAttribute("href") || anchor.href);
  if (!href || isInvalidSource(href)) return null;
  if (!isLikelyImageHref(href)) return null;
  return href;
};

const measureElement = (element) => {
  const width =
    Number(element?.naturalWidth) ||
    Number(element?.videoWidth) ||
    Number(element?.width) ||
    Number(element?.dataset?.width) ||
    Math.round(element?.getBoundingClientRect?.().width || 0);

  const height =
    Number(element?.naturalHeight) ||
    Number(element?.videoHeight) ||
    Number(element?.height) ||
    Number(element?.dataset?.height) ||
    Math.round(element?.getBoundingClientRect?.().height || 0);

  return { width, height };
};

const collectShadowRoots = (root, out = []) => {
  out.push(root);
  const elements = root.querySelectorAll?.("*") || [];
  for (const element of elements) {
    if (element.shadowRoot) {
      collectShadowRoots(element.shadowRoot, out);
    }
  }
  return out;
};

const extractFromImg = (element) => {
  const anchorCandidate = getAnchorImageCandidate(element);
  const srcCandidates = [
    anchorCandidate,
    element.getAttribute("data-original"),
    element.getAttribute("data-original-src"),
    element.getAttribute("data-src"),
    element.getAttribute("data-lazy-src"),
    element.getAttribute("data-actualsrc"),
    element.getAttribute("data-zoom-image"),
    element.getAttribute("data-large-image"),
    element.getAttribute("data-url"),
    element.getAttribute("data-pic"),
    parseSrcset(element.getAttribute("data-srcset")),
    parseSrcset(element.srcset),
    element.currentSrc,
    element.src,
    element.getAttribute("src")
  ];

  const src = chooseBestSource(srcCandidates);
  if (!src || isInvalidSource(src)) return null;

  const { width, height } = measureElement(element);
  if (isTelegramNoiseElement(element, src, width, height)) return null;
  return {
    src,
    width,
    height,
    source: "img",
    sourceUrl: resolveSourceUrl(element),
    telegramKey: getTelegramElementKey(element, width, height)
  };
};

const extractFromPicture = (element) => {
  const sourceSet = element.querySelector("source[srcset]");
  const image = element.querySelector("img");
  const anchorCandidate = getAnchorImageCandidate(element);

  const srcCandidates = [
    anchorCandidate,
    parseSrcset(sourceSet?.srcset),
    parseSrcset(sourceSet?.getAttribute("data-srcset")),
    image?.getAttribute("data-original"),
    image?.getAttribute("data-original-src"),
    image?.getAttribute("data-src"),
    image?.getAttribute("data-lazy-src"),
    image?.getAttribute("data-actualsrc"),
    image?.getAttribute("data-zoom-image"),
    image?.getAttribute("data-large-image"),
    image?.getAttribute("data-url"),
    image?.getAttribute("data-pic"),
    parseSrcset(image?.getAttribute("data-srcset")),
    parseSrcset(image?.srcset),
    image?.currentSrc,
    image?.src
  ];

  const src = chooseBestSource(srcCandidates);
  if (!src || isInvalidSource(src)) return null;

  const { width, height } = measureElement(image || element);
  if (isTelegramNoiseElement(image || element, src, width, height)) return null;
  return {
    src,
    width,
    height,
    source: "picture",
    sourceUrl: resolveSourceUrl(element),
    telegramKey: getTelegramElementKey(image || element, width, height)
  };
};

const extractBgUrl = (value) => {
  if (!value || value === "none") return null;
  const match = value.match(/url\((['"]?)(.*?)\1\)/i);
  return match?.[2] || null;
};

const extractFromBackground = (element) => {
  if (isTelegramSite()) return null;
  const inlineBg = extractBgUrl(element.style?.backgroundImage);
  let computedBg = null;
  if (!inlineBg) {
    const computed = window.getComputedStyle(element);
    computedBg = extractBgUrl(computed?.backgroundImage);
  }

  const src = absoluteUrl(inlineBg || computedBg);
  if (!src || isInvalidSource(src)) return null;

  const { width, height } = measureElement(element);
  if (width < 2 || height < 2) return null;
  if (isTelegramNoiseElement(element, src, width, height)) return null;
  return {
    src,
    width,
    height,
    source: "background",
    sourceUrl: resolveSourceUrl(element),
    telegramKey: getTelegramElementKey(element)
  };
};

const isXiaohongshuPage = () => /(^|\.)xiaohongshu\.com$/i.test(location.hostname);

const decodeEscapedUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const cleaned = rawUrl
    .trim()
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u003F/gi, "?")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  return absoluteUrl(cleaned);
};

const extractFromXhsScripts = (root) => {
  if (!isXiaohongshuPage()) return [];
  const scripts = root.querySelectorAll("script");
  const imageRecords = [];
  const seen = new Set();
  const xhsUrlPattern = /(?:https?:)?\\?\/\\?\/[^\s"'<>]*xhscdn\.com\/[^\s"'<>]*/gi;

  for (const script of scripts) {
    const text = script.textContent || "";
    if (!text || !/xhscdn\.com/i.test(text)) continue;
    const matches = text.match(xhsUrlPattern) || [];
    for (const matched of matches) {
      const src = decodeEscapedUrl(matched);
      if (!src || isInvalidSource(src)) continue;
      if (!/xhscdn\.com/i.test(src)) continue;
      if (!/notes_pre_post|sns-webpic|image\/(?!avatar)/i.test(src)) continue;
      if (seen.has(src)) continue;
      seen.add(src);
      imageRecords.push({
        src,
        width: 0,
        height: 0,
        source: "xhs-script",
        sourceUrl: getCurrentPageSourceUrl()
      });
    }
  }

  return imageRecords;
};

const normalizeImageRecord = (record) => {
  if (!record?.src) return null;
  let normalized = normalizeUrl(record.src);
  if (!normalized) return null;

  const width = Number(record.width) || 0;
  const height = Number(record.height) || 0;
  const area = Math.max(Number(record.area) || 0, width * height);
  const hdSrc = getHDUrl(record.src);
  const sourceUrl = normalizeSourceUrl(record.sourceUrl) || getCurrentPageSourceUrl();
  const telegramKey = String(record.telegramKey || "");

  if (isTelegramSite() && isTelegramBlobUrl(record.src)) {
    if (telegramKey) {
      // Keep telegram dedupe stable across source-url refinements.
      normalized = `tg:generic|${telegramKey}`;
    } else {
      const shortEdge = Math.min(width || 0, height || 0);
      const longEdge = Math.max(width || 0, height || 0);
      const ratioBucket = longEdge > 0 ? Math.round((shortEdge / longEdge) * 100) : 0;
      normalized = `tg:generic|${ratioBucket}|${Math.round(shortEdge / 20) * 20}x${Math.round(longEdge / 20) * 20}`;
    }
  }

  if (isWeiboPage()) {
    const originalLooksLikeContent = isLikelyWeiboContentUrl(record.src);
    const hdLooksLikeContent = isLikelyWeiboContentUrl(hdSrc);
    if (!originalLooksLikeContent && !hdLooksLikeContent) {
      return null;
    }
  }

  return {
    id: imageIdFromNormalized(normalized),
    normalized,
    src: record.src,
    originalSrc: record.src,
    hdSrc,
    sourceUrl,
    width,
    height,
    area,
    format: inferFormat(hdSrc || record.src),
    source: record.source || "dom",
    timestamp: Date.now(),
    isHD: hdSrc !== record.src
  };
};

const MAX_DEEP_SOURCE_CONCURRENCY = 2;
const MAX_DEEP_IMAGES_PER_SOURCE = 36;
const deepSourceCache = new Map();
const deepSourceQueue = [];
const deepSourceQueued = new Set();
const deepSourceInFlight = new Set();
let deepSourceActiveCount = 0;

const isInstagramPostSourceUrl = (url) => {
  try {
    const parsed = new URL(url, location.href);
    return /(^|\.)instagram\.com$/i.test(parsed.hostname) && /^\/p\/[A-Za-z0-9_-]+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

const isXhsNoteSourceUrl = (url) => {
  try {
    const parsed = new URL(url, location.href);
    return /(^|\.)xiaohongshu\.com$/i.test(parsed.hostname) && /^\/(explore|discovery\/item)\/[A-Za-z0-9_-]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

const shouldDeepExpandSource = (sourceUrl) => isInstagramPostSourceUrl(sourceUrl) || isXhsNoteSourceUrl(sourceUrl);

const decodeEscapedMediaUrl = (rawUrl) => {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const cleaned = rawUrl
    .trim()
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u003F/gi, "?")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");
  return absoluteUrl(cleaned);
};

const collectRegexMatches = (text, regex, groupIndex = 1) => {
  const matches = [];
  if (!text || !(regex instanceof RegExp)) return matches;
  const local = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  let match = null;
  while ((match = local.exec(text)) !== null) {
    if (match[groupIndex]) matches.push(match[groupIndex]);
  }
  return matches;
};

const isLikelyInstagramMediaUrl = (url) => {
  try {
    const parsed = new URL(url, location.href);
    if (!/cdninstagram\.com$/i.test(parsed.hostname)) return false;
    if (!/\.(jpg|jpeg|png|webp)(?:$|[?#])/i.test(parsed.pathname)) return false;
    if (/\/(profile_pic|profilepic|avatar)\//i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
};

const isLikelyXhsMediaUrl = (url) => {
  try {
    const parsed = new URL(url, location.href);
    if (!/xhscdn\.com$/i.test(parsed.hostname)) return false;
    if (!/notes_pre_post|sns-webpic|image\//i.test(parsed.pathname)) return false;
    if (/avatar/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
};

const extractInstagramImagesFromHtml = (htmlText) => {
  const candidates = new Set();
  const push = (raw) => {
    const decoded = decodeEscapedMediaUrl(raw);
    if (!decoded || isInvalidSource(decoded)) return;
    if (!isLikelyInstagramMediaUrl(decoded)) return;
    candidates.add(decoded);
  };

  const displayUrls = collectRegexMatches(htmlText, /"display_url":"([^"]+)"/g, 1);
  const srcUrls = collectRegexMatches(htmlText, /"src":"(https?:\\\/\\\/[^"]*cdninstagram\.com[^"]*)"/gi, 1);
  const escapedHostUrls = collectRegexMatches(htmlText, /https?:\\\/\\\/[^"'\\\s<>]*cdninstagram\.com[^"'\\\s<>]*/gi, 0);
  const plainHostUrls = collectRegexMatches(htmlText, /https?:\/\/[^"'\s<>]*cdninstagram\.com[^"'\s<>]*/gi, 0);

  for (const raw of [...displayUrls, ...srcUrls, ...escapedHostUrls, ...plainHostUrls]) {
    push(raw);
    if (candidates.size >= MAX_DEEP_IMAGES_PER_SOURCE) break;
  }

  return Array.from(candidates);
};

const extractXhsImagesFromHtml = (htmlText) => {
  const candidates = new Set();
  const push = (raw) => {
    const decoded = decodeEscapedMediaUrl(raw);
    if (!decoded || isInvalidSource(decoded)) return;
    if (!isLikelyXhsMediaUrl(decoded)) return;
    candidates.add(decoded);
  };

  const escapedHostUrls = collectRegexMatches(htmlText, /https?:\\\/\\\/[^"'\\\s<>]*xhscdn\.com\/[^"'\\\s<>]*/gi, 0);
  const plainHostUrls = collectRegexMatches(htmlText, /https?:\/\/[^"'\s<>]*xhscdn\.com\/[^"'\s<>]*/gi, 0);

  for (const raw of [...escapedHostUrls, ...plainHostUrls]) {
    push(raw);
    if (candidates.size >= MAX_DEEP_IMAGES_PER_SOURCE) break;
  }

  return Array.from(candidates);
};

const fetchSourceHtml = async (sourceUrl, timeoutMs = 12000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(sourceUrl, {
      credentials: "include",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
};

const buildDeepImageRecords = (urls, sourceUrl, sourceTag) => {
  const map = new Map();
  for (const url of urls) {
    const record = normalizeImageRecord({
      src: url,
      width: 0,
      height: 0,
      source: sourceTag,
      sourceUrl
    });
    if (!record) continue;
    if (!map.has(record.normalized)) {
      map.set(record.normalized, record);
    }
  }
  return Array.from(map.values());
};

const expandSourceToImages = async (sourceUrl) => {
  if (!shouldDeepExpandSource(sourceUrl)) return [];

  const htmlText = await fetchSourceHtml(sourceUrl);
  let urls = [];

  if (isInstagramPostSourceUrl(sourceUrl)) {
    urls = extractInstagramImagesFromHtml(htmlText);
  } else if (isXhsNoteSourceUrl(sourceUrl)) {
    urls = extractXhsImagesFromHtml(htmlText);
  }

  if (urls.length === 0) return [];
  return buildDeepImageRecords(urls, sourceUrl, "source-deep");
};

const mergeImageLists = (baseImages = [], extraImages = []) => {
  const map = new Map();
  for (const image of [...baseImages, ...extraImages]) {
    if (!image?.normalized) continue;
    const existing = map.get(image.normalized);
    if (!existing) {
      map.set(image.normalized, image);
      continue;
    }
    if ((Number(image.area) || 0) > (Number(existing.area) || 0)) {
      map.set(image.normalized, image);
    }
  }
  return Array.from(map.values());
};

const getCachedDeepImagesForScan = (images = []) => {
  const sourceUrls = new Set();
  for (const image of images) {
    const sourceUrl = normalizeSourceUrl(image?.sourceUrl || "");
    if (sourceUrl) sourceUrls.add(sourceUrl);
  }

  const records = [];
  for (const sourceUrl of sourceUrls) {
    const cached = deepSourceCache.get(sourceUrl);
    if (Array.isArray(cached) && cached.length > 0) {
      records.push(...cached);
    }
  }
  return records;
};

const processDeepSourceQueue = () => {
  while (deepSourceActiveCount < MAX_DEEP_SOURCE_CONCURRENCY && deepSourceQueue.length > 0) {
    const sourceUrl = deepSourceQueue.shift();
    deepSourceQueued.delete(sourceUrl);
    if (!sourceUrl || deepSourceInFlight.has(sourceUrl) || deepSourceCache.has(sourceUrl)) {
      continue;
    }

    deepSourceActiveCount += 1;
    deepSourceInFlight.add(sourceUrl);

    Promise.resolve(expandSourceToImages(sourceUrl))
      .then(async (expandedImages) => {
        const safeImages = Array.isArray(expandedImages) ? expandedImages : [];
        deepSourceCache.set(sourceUrl, safeImages);

        const freshImages = safeImages.filter((image) => image?.normalized && !knownNormalizedUrls.has(image.normalized));
        if (freshImages.length === 0) return;

        const acked = await sendIncrementalToBackground(freshImages);
        if (acked) {
          recordKnownImages(freshImages);
          return;
        }

        deepSourceCache.delete(sourceUrl);
        setTimeout(() => {
          if (deepSourceInFlight.has(sourceUrl) || deepSourceQueued.has(sourceUrl)) return;
          deepSourceQueue.push(sourceUrl);
          deepSourceQueued.add(sourceUrl);
          processDeepSourceQueue();
        }, 1200);
      })
      .catch(() => {
        deepSourceCache.set(sourceUrl, []);
      })
      .finally(() => {
        deepSourceInFlight.delete(sourceUrl);
        deepSourceActiveCount = Math.max(0, deepSourceActiveCount - 1);
        processDeepSourceQueue();
      });
  }
};

const scheduleDeepExpansionFromScan = (images = []) => {
  const sourceUrls = new Set();
  for (const image of images) {
    const sourceUrl = normalizeSourceUrl(image?.sourceUrl || "");
    if (sourceUrl && shouldDeepExpandSource(sourceUrl)) {
      sourceUrls.add(sourceUrl);
    }
  }

  for (const sourceUrl of sourceUrls) {
    if (deepSourceCache.has(sourceUrl)) continue;
    if (deepSourceInFlight.has(sourceUrl)) continue;
    if (deepSourceQueued.has(sourceUrl)) continue;
    deepSourceQueue.push(sourceUrl);
    deepSourceQueued.add(sourceUrl);
  }

  processDeepSourceQueue();
};

const scanImagesFromRoots = (roots = [], options = {}) => {
  const includeBackground = options.includeBackground !== false;
  const includeScriptExtraction = options.includeScriptExtraction === true;
  const maxBgScanPerScope = Number(options.maxBgScanPerScope) > 0
    ? Number(options.maxBgScanPerScope)
    : 6000;

  const imageMap = new Map();

  for (const rootNode of roots) {
    if (!rootNode || typeof rootNode.querySelectorAll !== "function") continue;
    const scopes = collectShadowRoots(rootNode);

    for (const scope of scopes) {
      const imageElements = [];
      if (scope instanceof Element && scope.matches("img, picture")) {
        imageElements.push(scope);
      }
      imageElements.push(...scope.querySelectorAll("img, picture"));

      for (const element of imageElements) {
        const extracted =
          element.tagName === "PICTURE"
            ? extractFromPicture(element)
            : extractFromImg(element);
        const normalizedRecord = normalizeImageRecord(extracted);
        if (!normalizedRecord) continue;

        const existing = imageMap.get(normalizedRecord.normalized);
        if (!existing || normalizedRecord.area > existing.area) {
          imageMap.set(normalizedRecord.normalized, normalizedRecord);
        }
      }

      if (includeBackground) {
        const bgElements = [];
        if (scope instanceof Element) {
          bgElements.push(scope);
        }
        bgElements.push(...scope.querySelectorAll("*"));
        const maxBgScan = Math.min(bgElements.length, maxBgScanPerScope);
        for (let i = 0; i < maxBgScan; i += 1) {
          const extracted = extractFromBackground(bgElements[i]);
          const normalizedRecord = normalizeImageRecord(extracted);
          if (!normalizedRecord) continue;
          const existing = imageMap.get(normalizedRecord.normalized);
          if (!existing || normalizedRecord.area > existing.area) {
            imageMap.set(normalizedRecord.normalized, normalizedRecord);
          }
        }
      }

      if (includeScriptExtraction) {
        const xhsScriptImages = extractFromXhsScripts(scope);
        for (const extracted of xhsScriptImages) {
          const normalizedRecord = normalizeImageRecord(extracted);
          if (!normalizedRecord) continue;
          const existing = imageMap.get(normalizedRecord.normalized);
          if (!existing || normalizedRecord.area > existing.area) {
            imageMap.set(normalizedRecord.normalized, normalizedRecord);
          }
        }
      }
    }
  }

  return Array.from(imageMap.values());
};

const scanImages = () => {
  const scanned = scanImagesFromRoots([document], {
    includeBackground: true,
    includeScriptExtraction: true,
    maxBgScanPerScope: 6000
  });
  // Telegram blob URLs are volatile; forced HD pairing can produce wrong mappings.
  // Keep scan result conservative and avoid cross-item HD reassignment.
  scheduleDeepExpansionFromScan(scanned);
  const merged = mergeImageLists(scanned, getCachedDeepImagesForScan(scanned));
  return merged.sort((a, b) => (Number(b.area) || 0) - (Number(a.area) || 0));
};

// === Comic Pagination Detection (Experimental, Isolated) ===
// Detection is deliberately conservative: it only flags pagination when there is
// unambiguous structural evidence inside a dedicated pagination container. Pages
// that lack a real pagination widget (plain text, single-page sites, etc.) must
// NEVER be reported as paginated.

const COMIC_PAGINATION_SELECTORS =
  ".pager, .pagination, .pg, .pgs, .page-link, .page-links, .wp-pagenavi, " +
  "[class*='page-numbers'], [id*='pager'], [id*='pagination'], " +
  "nav[aria-label*='page' i], nav[aria-label*='next' i]";

const PAGINATION_QUERY_KEY_RE = /^(?:p|pg|pn|page|page_no|pageno|pageid|chapter|chap|ch|index|paged)$/i;

const NEXT_LABEL_RE = /^(?:下一页|下页|next|›|»|>|→)$/i;
const PREV_LABEL_RE = /^(?:上一页|上页|prev|previous|‹|«|<|←)$/i;

const normalizePaginationHref = (url) => {
  if (!url) return null;
  try {
    const parsed = new URL(url, location.href);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizePaginationPath = (pathname) =>
  String(pathname || "").replace(/\/+/g, "/").replace(/\/$/, "").replace(/\.(?:html?|php|aspx?|jsp)$/i, "");

const extractPageNumber = (text) => {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (/^\d{1,6}$/.test(raw)) return Number(raw);
  if (NEXT_LABEL_RE.test(raw) || PREV_LABEL_RE.test(raw)) return null;
  const contextual = raw.match(/(?:^|[^\d])(\d{1,6})(?:\s*页)?\s*$/u);
  return contextual ? Number(contextual[1]) : null;
};

const extractPathPaginationToken = (pathname) => {
  const normalized = normalizePaginationPath(pathname);
  if (!normalized) return null;
  const explicit = normalized.match(/^(.*?)(?:\/|_|-)(?:page|pg|p|chapter|chap|ch|index)(?:\/|_|-)?(\d{1,6})$/i);
  if (explicit) return { base: explicit[1], page: Number(explicit[2]) };
  const separated = normalized.match(/^(.*?)(?:\/|_|-)(\d{1,6})$/);
  if (separated) return { base: separated[1], page: Number(separated[2]) };
  return null;
};

const hasPaginationQueryTransition = (currentParsed, candidateParsed) => {
  const keys = new Set([
    ...Array.from(currentParsed.searchParams.keys()),
    ...Array.from(candidateParsed.searchParams.keys())
  ]);
  for (const key of keys) {
    if (!PAGINATION_QUERY_KEY_RE.test(key)) continue;
    const cv = currentParsed.searchParams.get(key);
    const nv = candidateParsed.searchParams.get(key);
    if (nv === null || !/^\d{1,6}$/.test(nv)) continue;
    if (cv === null || Number(nv) > Number(cv)) return true;
  }
  return false;
};

const isLikelyPaginationTransition = (currentHref, candidateHref) => {
  try {
    const cur = new URL(currentHref, location.href);
    const can = new URL(candidateHref, location.href);
    if (cur.origin !== can.origin) return false;
    if (cur.toString() === can.toString()) return false;
    if (hasPaginationQueryTransition(cur, can)) return true;
    const ct = extractPathPaginationToken(cur.pathname);
    const nt = extractPathPaginationToken(can.pathname);
    if (ct && nt && ct.base === nt.base) return nt.page > ct.page;
    if (!ct && nt) {
      if (nt.base === normalizePaginationPath(cur.pathname)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

const readNodeSignature = (node) => {
  if (!(node instanceof Element)) return "";
  const cls = typeof node.className === "string" ? node.className : String(node.className?.baseVal || "");
  return [node.tagName || "", cls, node.id || "", node.getAttribute?.("rel") || "",
    node.getAttribute?.("aria-label") || "", node.getAttribute?.("title") || ""].join(" ").toLowerCase();
};

const scorePaginationContainer = (container) => {
  if (!(container instanceof Element)) return null;
  const currentUrl = normalizePaginationHref(location.href);
  const anchors = Array.from(container.querySelectorAll("a[href]"));
  const links = [];
  const seen = new Set();
  let score = 0;
  let numericCount = 0;
  let nextCount = 0;
  let prevCount = 0;
  let pagerSignalCount = 0;

  for (const anchor of anchors) {
    const href = normalizePaginationHref(anchor.getAttribute("href") || anchor.href);
    if (!href || seen.has(href) || isLikelyImageHref(href)) continue;
    let parsed;
    try { parsed = new URL(href, location.href); } catch { continue; }
    if (parsed.origin !== location.origin) continue;

    const text = String(anchor.textContent || "").trim();
    const page = extractPageNumber(text);
    const sig = `${readNodeSignature(container)} ${readNodeSignature(anchor)}`;
    const innerMarkup = anchor.innerHTML || "";
    const isNext = anchor.rel?.includes?.("next") === true || /\b(next|nxt)\b/i.test(sig) || NEXT_LABEL_RE.test(text)
      || /\b(?:angle-right|arrow-right|chevron-right|right-arrow|icon-right|icon-next)\b/i.test(innerMarkup);
    const isPrev = anchor.rel?.includes?.("prev") === true || /\b(prev|previous)\b/i.test(sig) || PREV_LABEL_RE.test(text)
      || /\b(?:angle-left|arrow-left|chevron-left|left-arrow|icon-left|icon-prev)\b/i.test(innerMarkup);
    const hasPagerSig = /\b(pager|pagination|page-numbers|pg|pages?)\b/i.test(sig);
    const hasTransition = currentUrl ? isLikelyPaginationTransition(currentUrl, href) : false;

    if (!isNext && !isPrev && page === null && !hasPagerSig) continue;

    let s = 0;
    if (hasPagerSig) s += 4;
    if (page !== null) s += 4;
    if (isNext || isPrev) s += 5;
    if (hasTransition) s += 5;
    if (href === currentUrl) s += 1;

    seen.add(href);
    links.push({ url: href, label: text, pageNumber: page, isNext, isPrev, hasTransition,
      isCurrent: anchor.matches(".current, [aria-current='page']") });
    if (page !== null) numericCount++;
    if (isNext) nextCount++;
    if (isPrev) prevCount++;
    if (hasPagerSig) pagerSignalCount++;
    score += s;
  }

  if (links.length === 0) return null;

  const currentPageNode = container.querySelector(
    ".current, [aria-current='page'], strong, em, .pager-num.current, .page-numbers.current"
  );
  const currentPage = currentPageNode ? extractPageNumber(currentPageNode.textContent || "") : null;

  return { score, links, currentPage, numericCount, nextCount, prevCount, pagerSignalCount };
};

const buildComicPagination = () => {
  const currentUrl = normalizePaginationHref(location.href);
  if (!currentUrl) return { supported: false, currentUrl: location.href };

  const containers = new Set();
  try {
    for (const node of document.querySelectorAll(COMIC_PAGINATION_SELECTORS)) {
      if (node instanceof Element) containers.add(node);
    }
  } catch { /* ignore */ }

  for (const anchor of document.querySelectorAll("a[href]")) {
    const text = String(anchor.textContent || "").trim();
    const sig = readNodeSignature(anchor);
    if (
      NEXT_LABEL_RE.test(text) || PREV_LABEL_RE.test(text) ||
      /\b(next|prev|pager|pagination|page-numbers|pg)\b/i.test(sig)
    ) {
      const parent = (() => {
        try {
          const found = anchor.closest(COMIC_PAGINATION_SELECTORS);
          return found && found !== anchor ? found : null;
        } catch { return null; }
      })() || anchor.parentElement;
      if (parent instanceof Element) containers.add(parent);
    }
  }

  let best = null;
  for (const container of containers) {
    const candidate = scorePaginationContainer(container);
    if (!candidate || candidate.links.length === 0) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }

  if (!best || best.links.length === 0) return { supported: false, currentUrl };

  const currentPage = best.currentPage;
  const pageUrls = [];
  const seenUrls = new Set();
  let nextUrl = "";

  for (const link of best.links) {
    if (!link?.url || link.url === currentUrl || seenUrls.has(link.url)) continue;
    const fwdByNum = currentPage !== null && link.pageNumber !== null && link.pageNumber > currentPage;
    const fwdByUnknown = currentPage === null && link.pageNumber !== null;
    if (link.isNext && !nextUrl) nextUrl = link.url;
    if (!link.isNext && !fwdByNum && !fwdByUnknown) continue;
    seenUrls.add(link.url);
    pageUrls.push({ url: link.url, pageNumber: link.pageNumber });
  }
  if (nextUrl && !seenUrls.has(nextUrl)) {
    pageUrls.push({ url: nextUrl, pageNumber: null });
  }

  if (!nextUrl && pageUrls.length > 0) {
    const sorted = pageUrls
      .filter(p => p.pageNumber !== null && (currentPage === null || p.pageNumber > currentPage))
      .sort((a, b) => a.pageNumber - b.pageNumber);
    if (sorted.length > 0) nextUrl = sorted[0].url;
  }

  const forwardUrls = [...new Set([...pageUrls.map((i) => i.url), nextUrl].filter(Boolean))];
  const transitionCount = forwardUrls.filter((u) => isLikelyPaginationTransition(currentUrl, u)).length;
  const numericFwdCount = pageUrls.reduce((c, i) => c + (Number.isInteger(i.pageNumber) ? 1 : 0), 0);
  const hasStructural = best.pagerSignalCount >= 1 || best.numericCount >= 2 ||
    (best.nextCount > 0 && best.prevCount > 0);
  const hasReliableFlow = currentPage !== null
    ? numericFwdCount > 0 && (hasStructural || transitionCount > 0)
    : numericFwdCount >= 2 && transitionCount > 0;
  const supported = best.score >= 6 && hasReliableFlow;

  return {
    supported,
    currentUrl,
    currentPage,
    totalPages: null,
    nextUrl,
    candidates: forwardUrls
  };
};

// Comic mode is experimental and intentionally isolated from the normal scan path.
// It only builds a DOM-order sequence hint for Workspace to reorder already collected images.
const isLikelyComicImage = (record) => {
  const width = Number(record?.width) || 0;
  const height = Number(record?.height) || 0;
  const area = Math.max(Number(record?.area) || 0, width * height);
  if (width <= 0 || height <= 0) return false;
  if (width >= 180 || height >= 180) return true;
  return area >= 50000;
};

const buildComicSequence = () => {
  const sequence = [];
  const seen = new Set();
  const scopes = collectShadowRoots(document);

  for (const scope of scopes) {
    const imageElements = [];
    if (scope instanceof Element && scope.matches("img, picture")) {
      imageElements.push(scope);
    }
    imageElements.push(...scope.querySelectorAll("img, picture"));

    for (const element of imageElements) {
      const extracted =
        element.tagName === "PICTURE"
          ? extractFromPicture(element)
          : extractFromImg(element);
      const record = normalizeImageRecord(extracted);
      if (!record || !isLikelyComicImage(record)) continue;
      if (seen.has(record.normalized)) continue;
      seen.add(record.normalized);

      const hdNormalized = normalizeUrl(record.hdSrc);
      sequence.push({
        normalized: record.normalized,
        hdNormalized: hdNormalized && hdNormalized !== record.normalized ? hdNormalized : "",
        width: Number(record.width) || 0,
        height: Number(record.height) || 0,
        sourceUrl: record.sourceUrl || ""
      });
    }
  }

  return sequence;
};

let rightClickEnabled = false;
let unlockStyleNode = null;
let unlockInterval = null;
const unlockHandlers = new Map();
const unlockEvents = ["contextmenu", "selectstart", "copy", "cut", "paste", "dragstart"];

const unlockCss = `
  * {
    -webkit-user-select: text !important;
    user-select: text !important;
  }
  img, picture, video, canvas, svg {
    pointer-events: auto !important;
  }
`;

const clearInlineBlockers = () => {
  const targets = [document.documentElement, document.body];
  for (const target of targets) {
    if (!target) continue;
    target.oncontextmenu = null;
    target.onselectstart = null;
    target.ondragstart = null;
    target.style.webkitTouchCallout = "default";
  }
};

const setRightClickEnabled = (enabled) => {
  if (enabled === rightClickEnabled) return;
  rightClickEnabled = enabled;

  if (enabled) {
    unlockStyleNode = document.createElement("style");
    unlockStyleNode.id = "pic-collector-unlock-style";
    unlockStyleNode.textContent = unlockCss;
    (document.head || document.documentElement).appendChild(unlockStyleNode);

    for (const eventType of unlockEvents) {
      const handler = (event) => {
        event.stopImmediatePropagation();
      };
      unlockHandlers.set(eventType, handler);
      window.addEventListener(eventType, handler, true);
      document.addEventListener(eventType, handler, true);
    }

    clearInlineBlockers();
    unlockInterval = setInterval(clearInlineBlockers, 1200);
    return;
  }

  if (unlockStyleNode) {
    unlockStyleNode.remove();
    unlockStyleNode = null;
  }

  for (const [eventType, handler] of unlockHandlers.entries()) {
    window.removeEventListener(eventType, handler, true);
    document.removeEventListener(eventType, handler, true);
  }
  unlockHandlers.clear();

  if (unlockInterval) {
    clearInterval(unlockInterval);
    unlockInterval = null;
  }
};

let autoScanEnabled = false;
let autoScanObserver = null;
let autoScanTimer = null;
let autoScanDirty = false;
const knownNormalizedUrls = new Set();
const autoScanMutationRoots = new Set();
let autoScrollEnabled = false;
let autoScrollTimer = null;
let autoScrollStallCount = 0;
let autoScrollIdleCount = 0;
let autoScrollLastHeight = 0;
let autoScrollLastObservedCount = 0;
let autoScrollProfile = "normal";
let autoScrollStartedAt = 0;
let autoScrollLastGrowthAt = 0;
let autoScrollStableHeight = 0;
let autoScrollStableCount = 0;
let autoScrollStableSince = 0;
let autoScrollExpectedTop = 0;
let autoScrollProgrammaticUntil = 0;
let autoScrollUserIntentUntil = 0;
const AUTO_SCROLL_INTERVAL_MS = 680;
const AUTO_SCROLL_SETTLE_INTERVAL_MS = 980;
const AUTO_SCROLL_STEP_MIN = 280;
const AUTO_SCROLL_STEP_MAX = 620;
const AUTO_SCROLL_STEP_RATIO = 0.72;
const AUTO_SCROLL_STALL_RETRY_EVERY = 5;
const AUTO_SCROLL_NUDGE_BACK_MAX = 220;
const AUTO_SCROLL_HEIGHT_GROWTH_THRESHOLD = 24;
const AUTO_SCROLL_BOTTOM_THRESHOLD = 8;
const AUTO_SCROLL_IDLE_STOP_TICKS = 8;
const AUTO_SCROLL_COMIC_INTERVAL_MS = 430;
const AUTO_SCROLL_COMIC_SETTLE_INTERVAL_MS = 620;
const AUTO_SCROLL_COMIC_STEP_MIN = 360;
const AUTO_SCROLL_COMIC_STEP_MAX = 820;
const AUTO_SCROLL_COMIC_STEP_RATIO = 0.82;
const AUTO_SCROLL_COMIC_EARLY_STOP_MS = 12000;
const AUTO_SCROLL_COMIC_HEIGHT_GROWTH_THRESHOLD = 96;

const recordKnownImages = (images) => {
  for (const image of images) {
    if (image.normalized) {
      knownNormalizedUrls.add(image.normalized);
    }
  }
};

const resetRuntimeCaches = () => {
  knownNormalizedUrls.clear();
  autoScanMutationRoots.clear();
  deepSourceCache.clear();
  deepSourceQueue.length = 0;
  deepSourceQueued.clear();
  deepSourceInFlight.clear();
  deepSourceActiveCount = 0;
  autoScanDirty = false;
};

const addAutoScanMutationRoot = (node) => {
  if (!node) return;
  if (
    !(node instanceof Document) &&
    !(node instanceof ShadowRoot) &&
    !(node instanceof Element)
  ) {
    return;
  }
  if (autoScanMutationRoots.size > 48) {
    autoScanMutationRoots.clear();
    autoScanMutationRoots.add(document);
    return;
  }
  autoScanMutationRoots.add(node);
};

const consumeAutoScanMutationRoots = () => {
  if (autoScanMutationRoots.size === 0) {
    return [document];
  }
  const roots = Array.from(autoScanMutationRoots);
  autoScanMutationRoots.clear();
  return roots;
};

const sendIncrementalToBackground = async (images) => {
  if (!Array.isArray(images) || images.length === 0) return false;
  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG.INCREMENTAL_SCAN,
      payload: { images }
    });
    return response?.success !== false;
  } catch {
    return false;
  }
};

const pushIncrementalImages = async () => {
  const changedRoots = consumeAutoScanMutationRoots();
  const scanned = scanImagesFromRoots(changedRoots, {
    includeBackground: true,
    includeScriptExtraction: false,
    maxBgScanPerScope: 1200
  });
  if (scanned.length === 0) return;

  scheduleDeepExpansionFromScan(scanned);
  const merged = mergeImageLists(scanned, getCachedDeepImagesForScan(scanned));
  const newImages = merged.filter((image) => image?.normalized && !knownNormalizedUrls.has(image.normalized));
  if (newImages.length === 0) return;

  const acked = await sendIncrementalToBackground(newImages);
  if (acked) {
    recordKnownImages(newImages);
    return;
  }

  addAutoScanMutationRoot(document);
  setTimeout(() => {
    if (!autoScanEnabled) return;
    scheduleIncrementalScan();
  }, 1200);
};

const scheduleIncrementalScan = () => {
  if (!autoScanEnabled) return;
  autoScanDirty = true;
  if (autoScanTimer) return;
  autoScanTimer = setTimeout(() => {
    autoScanTimer = null;
    if (!autoScanEnabled) return;

    const shouldScan = autoScanDirty;
    autoScanDirty = false;
    if (!shouldScan) return;

    Promise.resolve(pushIncrementalImages())
      .catch(() => {})
      .finally(() => {
        if (autoScanDirty) {
          scheduleIncrementalScan();
        }
      });
  }, 220);
};

const startAutoScan = () => {
  if (autoScanEnabled) return;
  autoScanEnabled = true;
  autoScanMutationRoots.clear();

  const baseline = scanImages();
  recordKnownImages(baseline);

  autoScanObserver = new MutationObserver((mutations) => {
    let hasRelevantMutation = false;
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        hasRelevantMutation = true;
        addAutoScanMutationRoot(mutation.target);
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            addAutoScanMutationRoot(node);
          }
        }
        continue;
      }
      if (mutation.type === "attributes") {
        hasRelevantMutation = true;
        addAutoScanMutationRoot(mutation.target);
      }
    }
    if (hasRelevantMutation) {
      scheduleIncrementalScan();
    }
  });

  autoScanObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcset", "style", "data-src", "data-srcset"]
  });
};

const stopAutoScan = () => {
  autoScanEnabled = false;
  if (autoScanObserver) {
    autoScanObserver.disconnect();
    autoScanObserver = null;
  }
  if (autoScanTimer) {
    clearTimeout(autoScanTimer);
    autoScanTimer = null;
  }
  autoScanDirty = false;
  autoScanMutationRoots.clear();
};

const getScrollMetrics = () => {
  const root = document.scrollingElement || document.documentElement || document.body;
  const viewportHeight = Math.max(
    Number(window.innerHeight) || 0,
    Number(root?.clientHeight) || 0,
    Number(document.documentElement?.clientHeight) || 0,
    420
  );
  const scrollHeight = Math.max(
    Number(root?.scrollHeight) || 0,
    Number(document.documentElement?.scrollHeight) || 0,
    Number(document.body?.scrollHeight) || 0,
    viewportHeight
  );
  const scrollTop = Math.max(
    Number(root?.scrollTop) || 0,
    Number(window.scrollY) || 0,
    Number(document.documentElement?.scrollTop) || 0,
    0
  );

  return {
    root,
    viewportHeight,
    scrollHeight,
    scrollTop,
    maxTop: Math.max(0, scrollHeight - viewportHeight)
  };
};

const getAutoScrollObservedCount = () => {
  if (autoScrollProfile === "comic") {
    return buildComicSequence().length;
  }
  if (autoScanEnabled) {
    return knownNormalizedUrls.size;
  }
  return Number(document.images?.length) || 0;
};

const hasPendingAutoScrollGrowthSignals = () => {
  if (!autoScanEnabled) return false;
  return autoScanDirty || autoScanMutationRoots.size > 0 || autoScanTimer !== null;
};

const getAutoScrollProfileConfig = () => {
  if (autoScrollProfile === "comic") {
    return {
      intervalMs: AUTO_SCROLL_COMIC_INTERVAL_MS,
      settleIntervalMs: AUTO_SCROLL_COMIC_SETTLE_INTERVAL_MS,
      stepMin: AUTO_SCROLL_COMIC_STEP_MIN,
      stepMax: AUTO_SCROLL_COMIC_STEP_MAX,
      stepRatio: AUTO_SCROLL_COMIC_STEP_RATIO,
      earlyStopMs: AUTO_SCROLL_COMIC_EARLY_STOP_MS,
      heightGrowthThreshold: AUTO_SCROLL_COMIC_HEIGHT_GROWTH_THRESHOLD
    };
  }

  return {
    intervalMs: AUTO_SCROLL_INTERVAL_MS,
    settleIntervalMs: AUTO_SCROLL_SETTLE_INTERVAL_MS,
    stepMin: AUTO_SCROLL_STEP_MIN,
    stepMax: AUTO_SCROLL_STEP_MAX,
    stepRatio: AUTO_SCROLL_STEP_RATIO,
    earlyStopMs: 0,
    heightGrowthThreshold: AUTO_SCROLL_HEIGHT_GROWTH_THRESHOLD
  };
};

const reportAutoScrollStopped = (reason = "complete") => {
  chrome.runtime.sendMessage({
    type: MSG.AUTO_SCROLL_STOPPED,
    payload: { reason }
  }).catch(() => {});
};

const completeAutoScroll = (reason = "complete") => {
  stopAutoScroll();
  reportAutoScrollStopped(reason);
};

const markAutoScrollUserIntent = (durationMs = 1400) => {
  if (!autoScrollEnabled) return;
  autoScrollUserIntentUntil = Date.now() + Math.max(300, Number(durationMs) || 1400);
};

const updateAutoScrollIdleState = (metrics, options = {}) => {
  const {
    heightGrewBefore = false,
    heightGrewAfter = false,
    imageCountGrew = false
  } = options;
  const now = Date.now();
  const profile = getAutoScrollProfileConfig();
  if (heightGrewBefore || heightGrewAfter || imageCountGrew) {
    autoScrollLastGrowthAt = now;
  }
  const nearBottom = metrics.scrollTop >= metrics.maxTop - AUTO_SCROLL_BOTTOM_THRESHOLD;
  const pendingGrowthSignals = hasPendingAutoScrollGrowthSignals();
  const noMeasuredGrowth =
    !heightGrewBefore &&
    !heightGrewAfter &&
    !imageCountGrew;
  const shouldIdle =
    nearBottom &&
    noMeasuredGrowth &&
    !pendingGrowthSignals;

  if (shouldIdle) {
    autoScrollIdleCount += 1;
    if (autoScrollIdleCount >= AUTO_SCROLL_IDLE_STOP_TICKS) {
      completeAutoScroll("complete");
      return true;
    }
    return false;
  }

  if (
    autoScrollProfile === "comic" &&
    profile.earlyStopMs > 0
  ) {
    const meaningfulHeightGrowth = metrics.scrollHeight > autoScrollStableHeight + profile.heightGrowthThreshold;
    const meaningfulCountGrowth = getAutoScrollObservedCount() > autoScrollStableCount;

    if (meaningfulHeightGrowth || meaningfulCountGrowth) {
      autoScrollStableHeight = Math.max(autoScrollStableHeight, metrics.scrollHeight);
      autoScrollStableCount = Math.max(autoScrollStableCount, getAutoScrollObservedCount());
      autoScrollStableSince = now;
    } else if ((now - autoScrollStableSince) >= profile.earlyStopMs) {
      completeAutoScroll("complete");
      return true;
    }
  }

  autoScrollIdleCount = 0;
  return false;
};

const scheduleAutoScrollTick = (delayMs = getAutoScrollProfileConfig().intervalMs) => {
  if (!autoScrollEnabled || autoScrollTimer) return;
  autoScrollTimer = setTimeout(() => {
    autoScrollTimer = null;
    if (!autoScrollEnabled) return;

    const profile = getAutoScrollProfileConfig();
    const metrics = getScrollMetrics();
    if (metrics.maxTop <= 0) {
      const observedCount = getAutoScrollObservedCount();
      const imageCountGrew = observedCount > autoScrollLastObservedCount;
      autoScrollLastObservedCount = observedCount;
      autoScrollLastHeight = metrics.scrollHeight;
      if (updateAutoScrollIdleState(metrics, { imageCountGrew })) {
        return;
      }
      scheduleAutoScrollTick(profile.settleIntervalMs);
      return;
    }

    const heightGrewSinceLastTick =
      metrics.scrollHeight > autoScrollLastHeight + profile.heightGrowthThreshold;
    const stepRatio = heightGrewSinceLastTick ? 0.62 : profile.stepRatio;
    const step = Math.min(
      profile.stepMax,
      Math.max(profile.stepMin, Math.round(metrics.viewportHeight * stepRatio))
    );
    const nearBottom = metrics.scrollTop >= metrics.maxTop - 4;
    let targetTop = Math.min(metrics.maxTop, metrics.scrollTop + step);

    if (nearBottom && autoScrollStallCount > 0 && autoScrollStallCount % AUTO_SCROLL_STALL_RETRY_EVERY === 0) {
      targetTop = Math.max(0, metrics.scrollTop - Math.min(
        AUTO_SCROLL_NUDGE_BACK_MAX,
        Math.round(metrics.viewportHeight * 0.24)
      ));
    } else if (targetTop <= metrics.scrollTop + 2) {
      targetTop = metrics.maxTop;
    }

    autoScrollExpectedTop = targetTop;
    autoScrollProgrammaticUntil = Date.now() + 900;
    window.scrollTo({
      top: targetTop,
      behavior: "auto"
    });

    requestAnimationFrame(() => {
      if (!autoScrollEnabled) return;
      const nextMetrics = getScrollMetrics();
      const observedCount = getAutoScrollObservedCount();
      const heightGrewAfterScroll =
        nextMetrics.scrollHeight >
        Math.max(autoScrollLastHeight, metrics.scrollHeight) + profile.heightGrowthThreshold;
      const imageCountGrew = observedCount > autoScrollLastObservedCount;
      const moved = Math.abs(nextMetrics.scrollTop - metrics.scrollTop) > 4;
      const stillNearBottom = nextMetrics.scrollTop >= nextMetrics.maxTop - 4;

      if (heightGrewAfterScroll || moved || !stillNearBottom) {
        autoScrollStallCount = 0;
      } else {
        autoScrollStallCount += 1;
      }

      autoScrollLastHeight = nextMetrics.scrollHeight;
      autoScrollLastObservedCount = observedCount;
      if (updateAutoScrollIdleState(nextMetrics, {
        heightGrewBefore: heightGrewSinceLastTick,
        heightGrewAfter: heightGrewAfterScroll,
        imageCountGrew
      })) {
        return;
      }
      const nextDelay =
        heightGrewSinceLastTick || heightGrewAfterScroll
          ? profile.settleIntervalMs
          : profile.intervalMs;
      scheduleAutoScrollTick(nextDelay);
    });
  }, Math.max(80, Number(delayMs) || getAutoScrollProfileConfig().intervalMs));
};

const startAutoScroll = (profile = "normal") => {
  const nextProfile = profile === "comic" ? "comic" : "normal";
  autoScrollProfile = nextProfile;
  if (autoScrollEnabled) return;
  autoScrollEnabled = true;
  autoScrollStallCount = 0;
  autoScrollIdleCount = 0;
  autoScrollStartedAt = Date.now();
  autoScrollLastGrowthAt = autoScrollStartedAt;
  autoScrollLastHeight = getScrollMetrics().scrollHeight;
  autoScrollLastObservedCount = getAutoScrollObservedCount();
  autoScrollStableHeight = autoScrollLastHeight;
  autoScrollStableCount = autoScrollLastObservedCount;
  autoScrollStableSince = autoScrollStartedAt;
  autoScrollExpectedTop = getScrollMetrics().scrollTop;
  autoScrollProgrammaticUntil = 0;
  autoScrollUserIntentUntil = 0;
  scheduleAutoScrollTick(autoScrollProfile === "comic" ? 120 : 180);
};

const stopAutoScroll = () => {
  autoScrollEnabled = false;
  autoScrollStallCount = 0;
  autoScrollIdleCount = 0;
  autoScrollLastHeight = 0;
  autoScrollLastObservedCount = 0;
  autoScrollProfile = "normal";
  autoScrollStartedAt = 0;
  autoScrollLastGrowthAt = 0;
  autoScrollStableHeight = 0;
  autoScrollStableCount = 0;
  autoScrollStableSince = 0;
  autoScrollExpectedTop = 0;
  autoScrollProgrammaticUntil = 0;
  autoScrollUserIntentUntil = 0;
  if (autoScrollTimer) {
    clearTimeout(autoScrollTimer);
    autoScrollTimer = null;
  }
};

window.addEventListener("wheel", (event) => {
  if (!autoScrollEnabled || !event.isTrusted) return;
  if (Math.abs(Number(event.deltaY) || 0) < 4) return;
  completeAutoScroll("manual_interrupt");
}, { passive: true, capture: true });

window.addEventListener("mousedown", (event) => {
  if (!autoScrollEnabled || !event.isTrusted) return;
  markAutoScrollUserIntent(1600);
}, true);

window.addEventListener("touchstart", (event) => {
  if (!autoScrollEnabled || !event.isTrusted) return;
  markAutoScrollUserIntent(1800);
}, { passive: true, capture: true });

window.addEventListener("keydown", (event) => {
  if (!autoScrollEnabled || !event.isTrusted) return;
  if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Spacebar"].includes(event.key)) {
    return;
  }
  completeAutoScroll("manual_interrupt");
}, true);

window.addEventListener("scroll", () => {
  if (!autoScrollEnabled) return;
  const now = Date.now();
  if (now <= autoScrollProgrammaticUntil) return;
  if (now > autoScrollUserIntentUntil) return;
  const currentTop = getScrollMetrics().scrollTop;
  if (Math.abs(currentTop - autoScrollExpectedTop) <= 56) return;
  completeAutoScroll("manual_interrupt");
}, { passive: true, capture: true });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case MSG.SCAN_IMAGES: {
      const images = scanImages();
      recordKnownImages(images);
      sendResponse({ success: true, images, count: images.length });
      break;
    }

    case MSG.GET_COMIC_SEQUENCE: {
      sendResponse({ success: true, sequence: buildComicSequence() });
      break;
    }

    case MSG.GET_COMIC_PAGINATION: {
      sendResponse({ success: true, pagination: buildComicPagination() });
      break;
    }

    case MSG.TOGGLE_RIGHT_CLICK: {
      setRightClickEnabled(message.enabled === true);
      sendResponse({ success: true, enabled: rightClickEnabled });
      break;
    }

    case MSG.START_AUTO_SCAN: {
      startAutoScan();
      sendResponse({ success: true });
      break;
    }

    case MSG.STOP_AUTO_SCAN: {
      stopAutoScan();
      sendResponse({ success: true });
      break;
    }

    case MSG.START_AUTO_SCROLL: {
      startAutoScroll(message?.payload?.profile || message?.profile || "normal");
      sendResponse({ success: true });
      break;
    }

    case MSG.STOP_AUTO_SCROLL: {
      stopAutoScroll();
      sendResponse({ success: true });
      break;
    }

    case MSG.CLEAR_RUNTIME_CACHE: {
      resetRuntimeCaches();
      sendResponse({ success: true });
      break;
    }

    case MSG.COPY_IMAGE_DATA_URL: {
      Promise.resolve(
        copyImagePayloadToClipboard(
          message?.payload?.dataUrl || "",
          message?.payload?.fallbackUrl || ""
        )
      )
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ success: false, error: error?.message || "Clipboard write failed" }));
      break;
    }

    default:
      sendResponse({ success: false, error: `Unknown message: ${message?.type}` });
  }
  return true;
});

})();
