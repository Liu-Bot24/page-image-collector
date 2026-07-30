import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRefererModifyRule,
  normalizeDnrHostname,
  normalizeRefererOrigin,
  normalizeRefererTabOwners,
  reconcileRefererRuleSet,
  removeRefererTabOwner,
  serializeRefererTabOwners,
  setRefererTabOwner
} from "../shared/dnrCore.js";

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

test("migrates legacy tab ids to owner tokens and serializes current owners", () => {
  const owners = normalizeRefererTabOwners(
    { "12": "scan-b", invalid: "ignored" },
    [11, 12, "bad"]
  );

  assert.equal(owners.get(11), "legacy");
  assert.equal(owners.get(12), "scan-b");
  assert.deepEqual(serializeRefererTabOwners(owners), {
    "11": "legacy",
    "12": "scan-b"
  });
});

test("stale referer cleanup cannot remove a newer scan owner", () => {
  const record = { tabOwners: new Map([[17, "scan-a"]]) };

  assert.equal(removeRefererTabOwner(record, 17, { ownerToken: "scan-b" }), false);
  assert.equal(record.tabOwners.get(17), "scan-a");

  assert.equal(setRefererTabOwner(record, 17, "scan-b"), true);
  assert.equal(removeRefererTabOwner(record, 17, { ownerToken: "scan-a" }), false);
  assert.equal(record.tabOwners.get(17), "scan-b");
});

test("tab cleanup removes old owners while preserving the new generation", () => {
  const oldRecord = { tabOwners: new Map([[23, "scan-a"]]) };
  const newRecord = { tabOwners: new Map([[23, "scan-b"]]) };

  assert.equal(
    removeRefererTabOwner(oldRecord, 23, { preserveOwnerToken: "scan-b" }),
    true
  );
  assert.equal(oldRecord.tabOwners.size, 0);

  assert.equal(
    removeRefererTabOwner(newRecord, 23, { preserveOwnerToken: "scan-b" }),
    false
  );
  assert.equal(newRecord.tabOwners.get(23), "scan-b");
});

test("rebuilds missing active referer rules and removes stale managed rules", () => {
  const result = reconcileRefererRuleSet({
    records: [
      {
        ruleId: 20001,
        hostname: "cdn.example.com",
        sourceOrigin: "https://source.example"
      }
    ],
    scopedRules: [
      { id: 20002, condition: {}, action: {} },
      { id: 90000, condition: {}, action: {} }
    ],
    ruleIdStart: 20000,
    ruleIdMax: 20200
  });

  assert.deepEqual(result.removeRuleIds, [20002]);
  assert.equal(result.addRules.length, 1);
  assert.equal(result.addRules[0].id, 20001);
  assert.deepEqual(result.addRules[0].condition.requestDomains, ["cdn.example.com"]);
});

test("leaves existing managed referer rules and unrelated rules untouched", () => {
  const existing = buildRefererModifyRule({
    id: 20001,
    hostname: "cdn.example.com",
    refererOrigin: "https://source.example"
  });
  const result = reconcileRefererRuleSet({
    records: [
      {
        ruleId: 20001,
        hostname: "cdn.example.com",
        sourceOrigin: "https://source.example"
      }
    ],
    scopedRules: [
      existing,
      { id: 10086, condition: {}, action: {} }
    ],
    ruleIdStart: 20000,
    ruleIdMax: 20200
  });

  assert.deepEqual(result, { removeRuleIds: [], addRules: [] });
});

test("replaces a managed referer rule when its id matches but its content is stale", () => {
  const result = reconcileRefererRuleSet({
    records: [
      {
        ruleId: 20001,
        hostname: "cdn.example.com",
        sourceOrigin: "https://source.example"
      }
    ],
    scopedRules: [
      buildRefererModifyRule({
        id: 20001,
        hostname: "old-cdn.example.com",
        refererOrigin: "https://old-source.example"
      })
    ],
    ruleIdStart: 20000,
    ruleIdMax: 20200
  });

  assert.deepEqual(result.removeRuleIds, [20001]);
  assert.equal(result.addRules.length, 1);
  assert.deepEqual(result.addRules[0].condition.requestDomains, ["cdn.example.com"]);
  assert.equal(result.addRules[0].action.requestHeaders[0].value, "https://source.example/");
});
