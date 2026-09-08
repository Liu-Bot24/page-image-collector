import test from "node:test";
import assert from "node:assert/strict";
import { createRefererRequestBroker } from "../shared/refererRequests.js";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const imageUrl = "https://cdn.example.com/image.jpg";
const sourceA = "https://source-a.example/page";
const sourceB = "https://source-b.example/other";
const flush = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness({ intercept, ...options } = {}) {
  const rules = new Map();
  const updates = [];
  const broker = createRefererRequestBroker({ extensionId, ...options, updateRules: async (update) => {
    updates.push(update);
    if (intercept) await intercept(update);
    // Chrome updates a rule set atomically: a rejected update changes nothing.
    for (const id of update.removeRuleIds || []) rules.delete(id);
    for (const rule of update.addRules || []) rules.set(rule.id, rule);
  } });
  return { broker, rules, updates };
}

test("same-host same-origin requests overlap under one installed rule", async () => {
  const { broker, rules, updates } = harness();
  const first = await broker.acquire(imageUrl, sourceA);
  const second = await broker.acquire(`${imageUrl}?different`, "https://source-a.example/next");
  assert.notEqual(first, second);
  assert.equal(updates.length, 1);
  assert.equal(rules.size, 1);
  await broker.release(first);
  assert.equal(rules.size, 1, "the remaining lease still needs its rule");
  await broker.release(second);
  assert.equal(rules.size, 0);
});

test("conflicting origin waits for every existing lease and does not starve behind later arrivals", async () => {
  const { broker, rules } = harness();
  const first = await broker.acquire(imageUrl, sourceA);
  const second = await broker.acquire(imageUrl, sourceA);
  let conflictToken = "";
  const conflict = broker.acquire(imageUrl, sourceB).then((token) => { conflictToken = token; return token; });
  let laterToken = "";
  const later = broker.acquire(imageUrl, sourceA).then((token) => { laterToken = token; return token; });
  await flush();
  assert.equal(conflictToken, "");
  assert.equal(laterToken, "");
  assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://source-a.example/");
  await broker.release(first);
  assert.equal(conflictToken, "");
  await broker.release(second);
  await conflict;
  assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://source-b.example/");
  assert.equal(laterToken, "");
  await broker.release(conflictToken);
  await later;
  assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://source-a.example/");
  await broker.release(laterToken);
  assert.equal(rules.size, 0);
});

test("a host waiting for an origin switch does not block an independent host", async () => {
  const { broker, rules } = harness();
  const first = await broker.acquire(imageUrl, sourceA);
  let waiting = true;
  const conflict = broker.acquire(imageUrl, sourceB).then((token) => { waiting = false; return token; });
  const independent = await broker.acquire("https://independent.example.com/image.jpg", sourceB);
  assert.equal(waiting, true);
  assert.equal(rules.size, 2);
  await broker.release(independent);
  await broker.release(first);
  await broker.release(await conflict);
});

test("run waits for installation, releases on success and releases when its operation fails", async () => {
  const gate = deferred();
  const { broker, rules } = harness({ intercept: (update) => update.addRules ? gate.promise : undefined });
  let started = false;
  const result = broker.run(imageUrl, sourceA, async () => { started = true; return 42; });
  await flush();
  assert.equal(started, false);
  gate.resolve();
  assert.equal(await result, 42);
  assert.equal(rules.size, 0);
  await assert.rejects(broker.run(imageUrl, sourceA, async () => { throw new Error("fetch failed"); }), /fetch failed/);
  assert.equal(rules.size, 0);
});

test("failed installation rejects callers and returns the rule id to the pool", async () => {
  let fail = true;
  const { broker, rules } = harness({ ruleIdStart: 20200, ruleIdMax: 20201,
    intercept: (update) => { if (fail && update.addRules) throw new Error("install failed"); } });
  await assert.rejects(broker.acquire(imageUrl, sourceA), /install failed/);
  assert.equal(rules.size, 0);
  fail = false;
  const token = await broker.acquire(imageUrl, sourceA);
  assert.equal(rules.size, 1);
  await broker.release(token);
});

test("a stale queued pump cannot free an id that has already been assigned to a new host", async () => {
  const { broker, rules } = harness({ ruleIdStart: 20200, ruleIdMax: 20202,
    intercept: (update) => {
      if (update.addRules?.[0].condition.requestDomains[0] === "cdn.example.com") throw new Error("install failed");
    } });
  const failed = broker.acquire(imageUrl, sourceA).catch(() => "");
  const replacement = broker.acquire(imageUrl, sourceA)
    .catch(() => broker.acquire("https://replacement.example.com/a.jpg", sourceA));
  await failed;
  const second = await replacement;
  const third = await broker.acquire("https://third.example.com/a.jpg", sourceA);
  assert.equal(rules.size, 2, "independent active hosts must have distinct ids");
  await broker.release(second);
  await broker.release(third);
});

test("failed removal retains a retryable lease instead of leaking a rule and reusing its id", async () => {
  let fail = true;
  const { broker, rules } = harness({ ruleIdStart: 20200, ruleIdMax: 20201,
    intercept: (update) => { if (fail && !update.addRules) throw new Error("remove failed"); } });
  const token = await broker.acquire(imageUrl, sourceA);
  await assert.rejects(broker.release(token), /remove failed/);
  assert.equal(rules.size, 1);
  await assert.rejects(broker.acquire("https://different.example.com/a.jpg", sourceB), /Too many concurrent image hosts/);
  fail = false;
  await broker.release(token);
  assert.equal(rules.size, 0, "the same release token remains retryable");
});

test("failed removal rejects queued and future conflicting waiters until cleanup is retried", async () => {
  let fail = true;
  const { broker, rules } = harness({ intercept: (update) => {
    if (fail && !update.addRules) throw new Error("remove failed");
  } });
  const first = await broker.acquire(imageUrl, sourceA);
  let waiterError;
  const waiter = broker.acquire(imageUrl, sourceB).catch((error) => { waiterError = error; });
  await assert.rejects(broker.release(first), /remove failed/);
  await flush();
  assert.ok(waiterError, "existing conflicting requests must reject instead of hanging");
  await waiter;
  assert.equal(waiterError.retryable, false);
  await assert.rejects(broker.acquire(imageUrl, sourceB), (error) => error.retryable === false);
  assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://source-a.example/");
  fail = false;
  await broker.release(first);
  const second = await broker.acquire(imageUrl, sourceB);
  await broker.release(first);
  assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://source-b.example/");
  await broker.release(second);
});

test("run reports an actionable cleanup token if rule removal fails", async () => {
  let fail = true;
  const { broker, rules } = harness({ intercept: (update) => {
    if (fail && !update.addRules) throw new Error("remove failed");
  } });
  let cleanupToken = "";
  await assert.rejects(broker.run(imageUrl, sourceA, async () => 42), (error) => {
    assert.equal(error.cause.message, "remove failed");
    assert.ok(error.cleanupToken);
    assert.equal(error.retryable, false, "successful work must not be duplicated just because cleanup failed");
    cleanupToken = error.cleanupToken;
    return true;
  });
  fail = false;
  await broker.release(cleanupToken);
  assert.equal(rules.size, 0);
});

test("operation cancellation survives a simultaneous cleanup failure", async () => {
  let fail = true;
  const { broker, rules } = harness({ intercept: (update) => {
    if (fail && !update.addRules) throw new Error("remove failed");
  } });
  const cancelled = Object.assign(new Error("Download cancelled"), { code: "USER_CANCELED", cancelled: true });
  let cleanupToken;
  await assert.rejects(broker.run(imageUrl, sourceA, async () => { throw cancelled; }), (error) => {
    assert.equal(error.code, "USER_CANCELED");
    assert.equal(error.cancelled, true);
    assert.equal(error.message, "Download cancelled");
    assert.equal(error.retryable, false);
    assert.equal(error.cleanupError.cause.message, "remove failed");
    cleanupToken = error.cleanupToken;
    return true;
  });
  fail = false;
  await broker.release(cleanupToken);
  assert.equal(rules.size, 0);
});

test("duplicate and unknown releases cannot revoke another request", async () => {
  const { broker, rules, updates } = harness();
  const first = await broker.acquire(imageUrl, sourceA);
  const second = await broker.acquire(imageUrl, sourceA);
  await Promise.all([broker.release(first), broker.release(first), broker.release("unknown")]);
  assert.equal(rules.size, 1);
  assert.equal(updates.length, 1);
  await broker.release(second);
  const updatesAfterRelease = updates.length;
  await broker.release(second);
  assert.equal(updates.length, updatesAfterRelease);
});

test("worker rules are extension-only and match an exact host without overlapping child-host lanes", async () => {
  const { broker, rules } = harness();
  const parent = await broker.acquire(imageUrl, sourceA);
  const child = await broker.acquire("https://nested.cdn.example.com/a.jpg", sourceB);
  for (const rule of rules.values()) {
    assert.deepEqual(rule.condition.initiatorDomains, [extensionId]);
    assert.deepEqual(rule.condition.tabIds, [-1]);
    assert.deepEqual(rule.condition.resourceTypes, ["xmlhttprequest", "other"]);
    assert.ok(rule.condition.regexFilter, "requestDomains also includes subdomains, so an exact-host filter is necessary");
  }
  const parentRule = [...rules.values()].find((rule) => rule.condition.requestDomains[0] === "cdn.example.com");
  const filter = new RegExp(parentRule.condition.regexFilter);
  assert.equal(filter.test(imageUrl), true);
  assert.equal(filter.test("http://cdn.example.com:8080/a.jpg"), true);
  assert.equal(filter.test("https://nested.cdn.example.com/a.jpg"), false);
  assert.equal(filter.test("https://cdn.example.com.evil.test/a.jpg"), false);
  await broker.release(parent);
  await broker.release(child);
});

test("invalid protocols skip rule mutation and the Weibo override only matches its real image domain", async () => {
  const { broker, rules, updates } = harness();
  assert.equal(await broker.acquire("data:image/png;base64,AA==", sourceA), "");
  assert.equal(await broker.acquire("blob:https://cdn.example.com/image", sourceA), "");
  const noOrigin = await broker.acquire(imageUrl, "chrome-extension://abc/page");
  assert.ok(noOrigin, "an HTTP request still needs a coordination token without a valid source");
  await broker.release(noOrigin);
  assert.equal(updates.length, 0);
  const weibo = await broker.acquire("https://wx1.sinaimg.cn/a.jpg", sourceA);
  assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://weibo.com/");
  await broker.release(weibo);
  const lookalike = await broker.acquire("https://sinaimg.cn.example.com/a.jpg", sourceA);
  assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://source-a.example/");
  await broker.release(lookalike);
});

for (const sourceUrl of ["", "not a valid URL", "chrome-extension://abc/page"]) {
  test(`unknown source ${JSON.stringify(sourceUrl)} waits between two conflicting Referer origins`, async () => {
    const { broker, rules, updates } = harness();
    const first = await broker.acquire(imageUrl, sourceA);
    let unknownStarted = false;
    const unknown = broker.acquire(imageUrl, sourceUrl).then((token) => { unknownStarted = true; return token; });
    let nextStarted = false;
    const next = broker.acquire(imageUrl, sourceB).then((token) => { nextStarted = true; return token; });
    await flush();
    assert.equal(unknownStarted, false, "missing source must not borrow the active origin's header");
    assert.equal(nextStarted, false);
    await broker.release(first);
    const unknownToken = await unknown;
    assert.ok(unknownToken);
    assert.equal(rules.size, 0, "the previous rule is removed before the unmodified request starts");
    assert.equal(nextStarted, false, "a sourced request must wait until the unmodified request releases");
    assert.equal(updates.length, 2, "the unmodified lane installs no rule");
    await broker.release(unknownToken);
    const nextToken = await next;
    assert.equal(updates.length, 3, "releasing an unmodified lane removes no rule");
    assert.equal([...rules.values()][0].action.requestHeaders[0].value, "https://source-b.example/");
    await broker.release(nextToken);
    assert.equal(rules.size, 0);
  });
}

test("unknown-source requests overlap without any rule mutation while non-HTTP requests bypass coordination", async () => {
  const { broker, rules, updates } = harness();
  const first = await broker.acquire(imageUrl, "");
  const second = await broker.acquire(imageUrl, "invalid source");
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
  assert.equal(await broker.acquire("data:image/png;base64,AA==", sourceA), "");
  assert.equal(await broker.acquire("blob:https://cdn.example.com/image", sourceB), "");
  await broker.release(first);
  await broker.release(second);
  assert.equal(rules.size, 0);
  assert.equal(updates.length, 0);
});

test("missing extension scope and invalid id pools are rejected before rule installation", () => {
  const updateRules = async () => { throw new Error("must not be called"); };
  assert.throws(() => createRefererRequestBroker({ updateRules, extensionId: "" }), /Missing extension initiator/);
  assert.throws(() => createRefererRequestBroker({ updateRules, extensionId, ruleIdStart: 5, ruleIdMax: 5 }), /Invalid Referer rule id range/);
});
