import test from "node:test";
import assert from "node:assert/strict";
import { createDirectDownloadJobManager } from "../background/directDownloadJobs.js";

const storageKey = "pic_collector_direct_download_jobs_v1";
const tabId = 42;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const image = (id) => ({ id, src: `https://cdn.example.com/${id}.jpg`, hdSrc: `https://cdn.example.com/${id}-full.jpg` });
const pendingJob = (overrides = {}) => ({
  tabId, taskId: "direct_saved", done: false,
  options: { preferHD: true, convertToJpg: false },
  items: [{ image: image("first"), result: null }],
  pending: { itemIndex: 0, imageId: "first", downloadId: 77, candidateIndex: 0, url: image("first").hdSrc },
  ...overrides
});

const harness = (job, overrides = {}) => {
  const stored = job ? { [storageKey]: { [tabId]: structuredClone(job) } } : {};
  const statuses = [];
  const downloads = [];
  const manager = createDirectDownloadJobManager({
    storage: {
      get: async () => structuredClone(stored),
      set: async (values) => Object.assign(stored, structuredClone(values))
    },
    waitForTerminal: async () => ({ state: "complete", fileSize: 123 }),
    cancelDownload: async () => {},
    downloadImage: async (record, options) => {
      downloads.push({ image: record, options });
      await options.onStarting({ url: record.hdSrc, candidateIndex: options.startCandidateIndex });
      await options.onQueued({ downloadId: 88, url: record.hdSrc, candidateIndex: options.startCandidateIndex });
      return { success: true, downloadId: 88, fallbackUsed: options.startCandidateIndex > 0 };
    },
    onStatus: (_tab, status) => statuses.push(structuredClone(status)),
    createTaskId: () => "direct_test",
    ...overrides
  });
  return { manager, stored, statuses, downloads };
};

test("direct batch persists queued IDs and counts success only after completion", async () => {
  let complete;
  const h = harness(null, { downloadImage: async (record, options) => {
    assert.equal(options.awaitCompletion, true);
    await options.onStarting({ url: record.hdSrc, candidateIndex: 0 });
    await options.onQueued({ downloadId: 77, url: record.hdSrc, candidateIndex: 0 });
    await new Promise((resolve) => { complete = resolve; });
    return { success: true, downloadId: 77 };
  } });
  const running = h.manager.start(tabId, [image("first")]);
  await tick();
  assert.equal(h.stored[storageKey][tabId].pending.downloadId, 77);
  assert.equal((await h.manager.getStatus(tabId)).succeeded, 0);
  assert.equal((await h.manager.getStatus(tabId)).active, true);
  complete();
  const result = await running;
  assert.equal(result.succeeded, 1);
  assert.equal(result.active, false);
  assert.equal(h.stored[storageKey][tabId].done, true);
});

test("recovery observes completed browser download without enqueuing it twice", async () => {
  const h = harness(pendingJob({ items: [{ image: image("first"), result: null }, { image: image("second"), result: null }] }));
  const result = await h.manager.resume(tabId);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.downloads[0].image.id, "second");
  assert.equal(result.succeeded, 2);
  assert.equal(result.results[0].downloadId, 77);
});

test("recovery waits for an in-progress task and does not restart a cancelled image", async () => {
  let complete;
  const h = harness(pendingJob(), { waitForTerminal: async (downloadId) => {
    assert.equal(downloadId, 77);
    return await new Promise((resolve) => { complete = resolve; });
  } });
  const resumed = h.manager.resume(tabId);
  const duplicateResume = h.manager.resume(tabId);
  await tick();
  assert.equal((await h.manager.getStatus(tabId)).succeeded, 0);
  assert.equal(h.downloads.length, 0);
  complete({ state: "interrupted", error: "USER_CANCELED" });
  const [result] = await Promise.all([resumed, duplicateResume]);
  assert.equal(result.failed, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(h.downloads.length, 0);
});

test("recovery continues with the next candidate only after a network interruption", async () => {
  const h = harness(pendingJob(), { waitForTerminal: async () => ({ state: "interrupted", error: "NETWORK_FAILED" }) });
  const result = await h.manager.resume(tabId);
  assert.equal(h.downloads[0].options.startCandidateIndex, 1);
  assert.equal(result.results[0].fallbackUsed, true);
  assert.equal(result.succeeded, 1);
});

test("recovery does not enqueue a duplicate when the stored creation outcome is ambiguous", async () => {
  const h = harness(pendingJob({ pending: { itemIndex: 0, candidateIndex: 0, url: image("first").hdSrc } }));
  const result = await h.manager.resume(tabId);
  assert.equal(h.downloads.length, 0);
  assert.equal(result.failed, 1);
  assert.match(result.results[0].error, /无法确认/);
});

test("a failed initial progress save prevents any browser download", async () => {
  const h = harness(null, { storage: { get: async () => ({}), set: async () => { throw new Error("storage full"); } } });
  await assert.rejects(h.manager.start(tabId, [image("first")]), /storage full/);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.statuses.at(-1).phase, "failed");
});

test("timeout recovery cancels the old task before trying another candidate", async () => {
  const order = [];
  const h = harness(pendingJob(), {
    waitForTerminal: async () => ({ state: "timeout", error: "download_timeout" }),
    cancelDownload: async (id) => { order.push(`cancel:${id}`); },
    downloadImage: async (_image, options) => {
      order.push(`candidate:${options.startCandidateIndex}`);
      return { success: true, downloadId: 88 };
    }
  });
  await h.manager.resume(tabId);
  assert.deepEqual(order, ["cancel:77", "candidate:1"]);
});

test("timeout recovery does not start a replacement when cancellation fails", async () => {
  const h = harness(pendingJob(), {
    waitForTerminal: async () => ({ state: "timeout", error: "download_timeout" }),
    cancelDownload: async () => { throw new Error("cannot cancel"); }
  });
  const result = await h.manager.resume(tabId);
  assert.equal(h.downloads.length, 0);
  assert.equal(result.failed, 1);
});

test("a missing browser download record is reported without waiting or enqueuing again", async () => {
  let waited = false;
  const h = harness(pendingJob(), {
    getDownloadState: async () => ({ state: "unknown" }),
    waitForTerminal: async () => { waited = true; return { state: "complete" }; }
  });
  const result = await h.manager.resume(tabId);
  assert.equal(waited, false);
  assert.equal(h.downloads.length, 0);
  assert.equal(result.failed, 1);
  assert.match(result.results[0].error, /无法确认/);
});

test("a task that completes at timeout is counted once when cancellation finds it finished", async () => {
  let queries = 0;
  const h = harness(pendingJob(), {
    getDownloadState: async () => ({ state: ++queries === 1 ? "in_progress" : "complete" }),
    waitForTerminal: async () => ({ state: "timeout" }),
    cancelDownload: async () => { throw new Error("already complete"); }
  });
  const result = await h.manager.resume(tabId);
  assert.equal(h.downloads.length, 0);
  assert.equal(result.succeeded, 1);
});
