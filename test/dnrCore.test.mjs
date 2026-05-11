import test from "node:test";
import assert from "node:assert/strict";

import { buildRefererModifyRule, normalizeDnrHostname, normalizeRefererOrigin } from "../shared/dnrCore.js";

test("builds image Referer rules scoped to request domains without main-frame navigation", () => {
  const rule = buildRefererModifyRule({
    id: 20001,
    hostname: "Img.Example.COM",
    refererOrigin: "https://source.example/path/page.html",
    resourceTypes: ["image", "xmlhttprequest", "media", "other"]
  });

  assert.equal(rule.id, 20001);
  assert.deepEqual(rule.condition.requestDomains, ["img.example.com"]);
  assert.deepEqual(rule.condition.resourceTypes, ["image", "xmlhttprequest", "media", "other"]);
  assert.equal(rule.condition.urlFilter, undefined);
  assert.equal(rule.condition.resourceTypes.includes("main_frame"), false);
  assert.equal(rule.action.requestHeaders[0].value, "https://source.example/");
});

test("normalizes DNR hostnames and rejects non-http Referer origins", () => {
  assert.equal(normalizeDnrHostname(" CDN.Example.COM. "), "cdn.example.com");
  assert.equal(normalizeRefererOrigin("https://example.com/path?q=1"), "https://example.com");
  assert.equal(normalizeRefererOrigin("chrome-extension://abc/page.html"), "");
});
