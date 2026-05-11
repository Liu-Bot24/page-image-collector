export const normalizeDnrHostname = (hostname) => {
  const normalized = String(hostname || "").trim().replace(/\.$/, "").toLowerCase();
  if (!normalized) return "";
  if (!/^[a-z0-9.-]+$/i.test(normalized)) return "";
  if (!normalized.includes(".")) return "";
  return normalized;
};

export const normalizeRefererOrigin = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.origin;
  } catch (_error) {
    return "";
  }
};

export const buildRefererModifyRule = ({
  id,
  hostname,
  refererOrigin,
  resourceTypes = ["image", "xmlhttprequest", "media", "other"],
  priority = 1
} = {}) => {
  const requestDomain = normalizeDnrHostname(hostname);
  const origin = normalizeRefererOrigin(refererOrigin);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid DNR rule id");
  }
  if (!requestDomain) {
    throw new Error("Invalid DNR request domain");
  }
  if (!origin) {
    throw new Error("Invalid DNR Referer origin");
  }
  if (!Array.isArray(resourceTypes) || resourceTypes.length === 0) {
    throw new Error("Invalid DNR resource types");
  }

  return {
    id,
    priority,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        {
          header: "referer",
          operation: "set",
          value: `${origin}/`
        }
      ]
    },
    condition: {
      requestDomains: [requestDomain],
      resourceTypes: [...resourceTypes]
    }
  };
};
