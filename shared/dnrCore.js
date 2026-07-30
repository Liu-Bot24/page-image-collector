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

const LEGACY_TAB_OWNER = "legacy";

export const normalizeRefererTabOwners = (rawOwners, legacyTabIds = []) => {
  const owners = new Map();
  const entries = rawOwners instanceof Map
    ? rawOwners.entries()
    : (
        rawOwners &&
        typeof rawOwners === "object" &&
        !Array.isArray(rawOwners)
          ? Object.entries(rawOwners)
          : []
      );

  for (const [rawTabId, rawOwnerToken] of entries) {
    const tabId = Number(rawTabId);
    const ownerToken = String(rawOwnerToken || "").trim();
    if (Number.isInteger(tabId) && ownerToken) {
      owners.set(tabId, ownerToken);
    }
  }

  for (const rawTabId of Array.isArray(legacyTabIds) ? legacyTabIds : []) {
    const tabId = Number(rawTabId);
    if (Number.isInteger(tabId) && !owners.has(tabId)) {
      owners.set(tabId, LEGACY_TAB_OWNER);
    }
  }

  return owners;
};

export const serializeRefererTabOwners = (owners) => {
  const serialized = {};
  if (!(owners instanceof Map)) return serialized;
  for (const [rawTabId, rawOwnerToken] of owners.entries()) {
    const tabId = Number(rawTabId);
    const ownerToken = String(rawOwnerToken || "").trim();
    if (Number.isInteger(tabId) && ownerToken) {
      serialized[String(tabId)] = ownerToken;
    }
  }
  return serialized;
};

export const setRefererTabOwner = (record, tabId, ownerToken) => {
  if (!record || !Number.isInteger(tabId)) return false;
  const normalizedOwnerToken = String(ownerToken || "").trim();
  if (!normalizedOwnerToken) return false;
  if (!(record.tabOwners instanceof Map)) {
    record.tabOwners = normalizeRefererTabOwners(record.tabOwners, record.tabIds);
  }
  record.tabOwners.set(tabId, normalizedOwnerToken);
  return true;
};

export const removeRefererTabOwner = (record, tabId, options = {}) => {
  if (!record || !Number.isInteger(tabId)) return false;
  if (!(record.tabOwners instanceof Map)) {
    record.tabOwners = normalizeRefererTabOwners(record.tabOwners, record.tabIds);
  }

  const currentOwner = record.tabOwners.get(tabId);
  if (!currentOwner) return false;

  const ownerToken = String(options.ownerToken || "").trim();
  if (ownerToken && currentOwner !== ownerToken) return false;

  const preserveOwnerToken = String(options.preserveOwnerToken || "").trim();
  if (preserveOwnerToken && currentOwner === preserveOwnerToken) return false;

  record.tabOwners.delete(tabId);
  return true;
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

const sortedStrings = (values = [], normalize = (value) => String(value || "")) =>
  (Array.isArray(values) ? values : [])
    .map(normalize)
    .filter(Boolean)
    .sort();

const normalizeRequestHeaders = (headers = []) =>
  (Array.isArray(headers) ? headers : [])
    .map((header) => ({
      header: String(header?.header || "").trim().toLowerCase(),
      operation: String(header?.operation || "").trim().toLowerCase(),
      value: String(header?.value || "")
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

const isEquivalentRefererRule = (actual, expected) => {
  const actualAction = actual?.action || {};
  const actualCondition = actual?.condition || {};
  const allowedActionKeys = new Set(["type", "requestHeaders"]);
  const allowedConditionKeys = new Set(["requestDomains", "resourceTypes"]);
  if (Object.keys(actualAction).some((key) => !allowedActionKeys.has(key))) return false;
  if (Object.keys(actualCondition).some((key) => !allowedConditionKeys.has(key))) return false;

  return (
    Number(actual?.id) === Number(expected?.id) &&
    (Number(actual?.priority) || 1) === (Number(expected?.priority) || 1) &&
    String(actualAction.type || "") === String(expected?.action?.type || "") &&
    JSON.stringify(normalizeRequestHeaders(actualAction.requestHeaders)) ===
      JSON.stringify(normalizeRequestHeaders(expected?.action?.requestHeaders)) &&
    JSON.stringify(sortedStrings(actualCondition.requestDomains, (value) =>
      normalizeDnrHostname(value)
    )) ===
      JSON.stringify(sortedStrings(expected?.condition?.requestDomains, (value) =>
        normalizeDnrHostname(value)
      )) &&
    JSON.stringify(sortedStrings(actualCondition.resourceTypes, (value) =>
      String(value || "").trim().toLowerCase()
    )) ===
      JSON.stringify(sortedStrings(expected?.condition?.resourceTypes, (value) =>
        String(value || "").trim().toLowerCase()
      ))
  );
};

export const reconcileRefererRuleSet = ({
  records = [],
  scopedRules = [],
  ruleIdStart,
  ruleIdMax,
  resourceTypes = ["image", "xmlhttprequest", "media", "other"]
} = {}) => {
  const start = Number(ruleIdStart);
  const max = Number(ruleIdMax);
  if (!Number.isInteger(start) || !Number.isInteger(max) || max <= start) {
    throw new Error("Invalid DNR rule id range");
  }

  const expectedById = new Map();
  for (const record of records) {
    const ruleId = Number(record?.ruleId);
    if (!Number.isInteger(ruleId) || ruleId < start || ruleId >= max) continue;
    try {
      expectedById.set(ruleId, buildRefererModifyRule({
        id: ruleId,
        hostname: record.hostname,
        refererOrigin: record.sourceOrigin,
        resourceTypes
      }));
    } catch (_error) {
      // Invalid persisted metadata is ignored by reconciliation.
    }
  }

  const matchingIds = new Set();
  const removeRuleIds = [];
  for (const rule of scopedRules) {
    const ruleId = Number(rule?.id);
    if (!Number.isInteger(ruleId) || ruleId < start || ruleId >= max) continue;
    const expected = expectedById.get(ruleId);
    if (!expected || !isEquivalentRefererRule(rule, expected)) {
      removeRuleIds.push(ruleId);
      continue;
    }
    matchingIds.add(ruleId);
  }

  const addRules = [];
  for (const [ruleId, rule] of expectedById.entries()) {
    if (!matchingIds.has(ruleId)) {
      addRules.push(rule);
    }
  }

  return {
    removeRuleIds: [...new Set(removeRuleIds)],
    addRules
  };
};
