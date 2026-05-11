const TEXT_ENCODER = new TextEncoder();

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

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg", "avif", "bmp"]);
const MB = 1024 * 1024;

export const DEFAULT_ZIP_PART_PRESET = "balanced";

export const ZIP_PART_PRESETS = Object.freeze({
  stable: Object.freeze({ zipPartMaxMb: 96, zipPartMaxFiles: 200 }),
  balanced: Object.freeze({ zipPartMaxMb: 192, zipPartMaxFiles: 300 }),
  large: Object.freeze({ zipPartMaxMb: 384, zipPartMaxFiles: 500 }),
  xlarge: Object.freeze({ zipPartMaxMb: 768, zipPartMaxFiles: 800 })
});

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const normalizeImageExtension = (value) => {
  const ext = String(value || "").trim().toLowerCase();
  if (ext === "jpeg") return "jpg";
  if (ext === "svg+xml") return "svg";
  return IMAGE_EXTENSIONS.has(ext) ? ext : "";
};

export const normalizeZipPartOptions = (options = {}) => {
  const rawPreset = String(options.zipPartPreset || options.preset || "").trim().toLowerCase();
  const zipPartPreset = Object.prototype.hasOwnProperty.call(ZIP_PART_PRESETS, rawPreset)
    ? rawPreset
    : DEFAULT_ZIP_PART_PRESET;
  const preset = ZIP_PART_PRESETS[zipPartPreset];
  const presetBytes = preset.zipPartMaxMb * MB;

  const requestedBytes = Number(options.zipPartMaxBytes);
  const requestedMb = Number(options.zipPartMaxMb);
  const baseBytes = Number.isFinite(requestedBytes) && requestedBytes > 0
    ? requestedBytes
    : Number.isFinite(requestedMb) && requestedMb > 0
      ? requestedMb * MB
      : presetBytes;

  const zipPartMaxBytes = Math.round(clampNumber(baseBytes, 32 * MB, 1024 * MB, presetBytes));
  const zipPartMaxFiles = Math.round(clampNumber(
    options.zipPartMaxFiles,
    50,
    1000,
    preset.zipPartMaxFiles
  ));

  return {
    zipPartPreset,
    zipPartMaxBytes,
    zipPartMaxFiles,
    zipPartMaxMb: Math.round(zipPartMaxBytes / MB)
  };
};

export const formatFromUrl = (url) => {
  if (!url) return "";
  const dataMime = String(url).match(/^data:image\/([^;,]+)/i);
  if (dataMime?.[1]) {
    return normalizeImageExtension(dataMime[1]);
  }
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
    const format = parsed.searchParams.get("format");
    const normalizedFormat = normalizeImageExtension(format);
    if (normalizedFormat) return normalizedFormat;

    const formatByRule = parsed.href.match(/(?:format=|\/format\/)(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[&/?#]|$)/i);
    if (formatByRule?.[1]) return normalizeImageExtension(formatByRule[1]);

    const formatFromSuffix = parsed.pathname.match(/(?:^|[_!.-])(jpg|jpeg|png|webp|gif|svg|avif|bmp)(?:[_!.-]|$)/i);
    if (formatFromSuffix?.[1]) return normalizeImageExtension(formatFromSuffix[1]);

    if (/xhscdn\.com$/i.test(parsed.hostname) && (/webpic/i.test(parsed.hostname) || /notes_pre_post/i.test(parsed.pathname))) {
      return "webp";
    }
  } catch (_error) {
    // Ignore parse failures.
  }

  const match = String(url).split("?")[0].match(/\.([a-z0-9]+)$/i);
  return normalizeImageExtension(match?.[1]);
};

export const mimeFromFormat = (format) => {
  const normalized = String(format || "").toLowerCase();
  if (normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "png") return "image/png";
  if (normalized === "webp") return "image/webp";
  if (normalized === "gif") return "image/gif";
  if (normalized === "svg") return "image/svg+xml";
  if (normalized === "avif") return "image/avif";
  if (normalized === "bmp") return "image/bmp";
  return "";
};

export const mimeToExtension = (mimeType, fallback = "jpg") => {
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

const firstAscii = (bytes, limit = 512) => {
  const slice = bytes.slice(0, Math.min(bytes.length, limit));
  let text = "";
  for (const byte of slice) {
    text += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " ";
  }
  return text.trim().toLowerCase();
};

const detectMagicFormat = (bytes) => {
  if (!bytes || bytes.length < 4) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) return "png";
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) return "gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return "webp";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    (
      (bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66) ||
      (bytes[8] === 0x68 && bytes[9] === 0x65 && bytes[10] === 0x69 && bytes[11] === 0x63)
    )
  ) return "avif";

  const text = firstAscii(bytes);
  if (/^<\?xml\b/.test(text) && /<svg\b/.test(text)) return "svg";
  if (/^<svg\b/.test(text)) return "svg";

  return "";
};

export const inspectImagePayload = ({ bytes, mimeType = "", url = "" } = {}) => {
  const length = Number(bytes?.length) || 0;
  if (!bytes || length <= 0) {
    return { ok: false, reason: "empty image data", extension: "", mimeType: "" };
  }

  const normalizedMime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const textHead = firstAscii(bytes);
  if (
    normalizedMime === "text/html" ||
    /^<!doctype html\b/i.test(textHead) ||
    /^<html[\s>]/i.test(textHead)
  ) {
    return { ok: false, reason: "html response is not an image", extension: "", mimeType: normalizedMime };
  }

  const magicFormat = detectMagicFormat(bytes);
  if (magicFormat) {
    return {
      ok: true,
      reason: "",
      extension: magicFormat === "jpeg" ? "jpg" : magicFormat,
      mimeType: mimeFromFormat(magicFormat) || normalizedMime || "application/octet-stream"
    };
  }

  if (normalizedMime.startsWith("image/")) {
    const ext = mimeToExtension(normalizedMime, formatFromUrl(url) || "jpg");
    return { ok: true, reason: "", extension: ext, mimeType: normalizedMime };
  }

  const urlFormat = formatFromUrl(url);
  if (urlFormat === "svg" && /<svg\b/i.test(textHead)) {
    return { ok: true, reason: "", extension: "svg", mimeType: "image/svg+xml" };
  }

  return {
    ok: false,
    reason: normalizedMime ? `non-image response: ${normalizedMime}` : "unknown non-image response",
    extension: "",
    mimeType: normalizedMime
  };
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

export const buildZipBlob = (entries) => {
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
