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
      continue;
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
