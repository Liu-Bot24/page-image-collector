import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { inspectImagePayload, mimeFromFormat, formatFromUrl, resolveImagePayloadExtension, shouldConvertImageToJpg } from "../shared/zipCore.js";

const source = await readFile(new URL("../background/background.js", import.meta.url), "utf8");
const functionSource = (name) => {
  const start = source.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf("\nconst ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
};

const image = { id: "img_test", src: "https://cdn.example.com/thumb.jpg", hdSrc: "https://cdn.example.com/full.jpg", sourceUrl: "https://example.com/gallery" };
const loadFunctions = (names, overrides = {}) => {
  const context = vm.createContext({
    console, URL, Blob, Uint8Array, setTimeout, clearTimeout,
    pendingFilenameHints: new Map(),
    getDownloadCandidates: (record) => [record.hdSrc, record.src],
    baseFilename: () => "image", extensionFromUrl: formatFromUrl,
    formatFromUrl, mimeFromFormat, inspectImagePayload, resolveImagePayloadExtension, shouldConvertImageToJpg,
    withImageRefererRequest: async (_url, _sourceUrl, operation) => await operation(),
    fetchBlob: async () => { throw new Error("fetch unavailable"); },
    ...overrides
  });
  for (const name of names) vm.runInContext(functionSource(name), context);
  return { context, run: (code) => vm.runInContext(code, context) };
};

test("downloadImage forwards completion and source context through direct downloads", async () => {
  const calls = [];
  const loaded = loadFunctions(["downloadImage"], {
    fixture: image,
    downloadByUrl: async (url, filename, options) => {
      calls.push({ url, filename, options });
      return { success: true, downloadId: 7 };
    }
  });
  const result = await loaded.run("downloadImage(fixture, { awaitCompletion: true })");
  assert.equal(result.success, true);
  assert.equal(calls[0].options?.awaitCompletion, true);
  assert.equal(calls[0].options?.sourceUrl, image.sourceUrl);
  assert.deepEqual([...calls[0].options.remainingCandidateUrls], [image.src]);
  assert.equal(calls[0].options.fallbackUsed, false);
});

test("user cancellation stops candidate fallback instead of creating more downloads", async () => {
  const calls = [];
  const loaded = loadFunctions(["downloadImage"], {
    fixture: image,
    downloadByUrl: async (url) => {
      calls.push(url);
      throw Object.assign(new Error("Download interrupted: USER_CANCELED"), { code: "USER_CANCELED", cancelled: true });
    }
  });
  const result = await loaded.run("downloadImage(fixture, { awaitCompletion: true })");
  assert.equal(calls.length, 1);
  assert.equal(result.success, false);
  assert.equal(result.cancelled, true);
});

test("a download timeout cancels the browser task before returning failure", async () => {
  const cancelled = [];
  const loaded = loadFunctions(["downloadByUrl"], {
    chrome: { downloads: {
      download: async () => 7,
      cancel: async (id) => { cancelled.push(id); }
    } },
    waitForDownloadTerminal: async () => ({ state: "timeout", error: "download_timeout" })
  });
  await assert.rejects(loaded.run("downloadByUrl('https://cdn.example.com/full.jpg', 'image.jpg', { awaitCompletion: true })"), /timeout/);
  assert.deepEqual(cancelled, [7]);
});

test("download terminal observation registers its listener before querying current state", async () => {
  const listeners = new Set();
  let listenersAtFirstQuery;
  const loaded = loadFunctions(["waitForDownloadTerminal"], {
    chrome: { downloads: { onChanged: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener)
    } } },
    getDownloadStats: async () => {
      listenersAtFirstQuery ??= listeners.size;
      return { state: "complete", fileSize: 123 };
    }
  });
  const result = await loaded.run("waitForDownloadTerminal(7, 100)");
  assert.equal(result.state, "complete");
  assert.equal(listenersAtFirstQuery, 1);
  assert.equal(listeners.size, 0);
});

test("payload verification and JPG conversion preserve completion callbacks", async () => {
  const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });
  for (const convertToJpg of [false, true]) {
    const calls = [];
    const loaded = loadFunctions(["downloadImage"], {
      fixture: { ...image, src: "https://cdn.example.com/thumb", hdSrc: "https://cdn.example.com/full" },
      fixtureOptions: { awaitCompletion: true, convertToJpg, onQueued: () => {} },
      fetchBlob: async (_url, _timeout, sourceUrl) => { assert.equal(sourceUrl, image.sourceUrl); return png; },
      convertBlobToJpg: async () => new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }),
      downloadBlobAsFile: async (_blob, _filename, _mime, options) => { calls.push(options); return { success: true }; },
      downloadByBlob: async (_blob, _filename, options) => { calls.push(options); return { success: true }; }
    });
    const result = await loaded.run("downloadImage(fixture, fixtureOptions)");
    assert.equal(result.success, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].awaitCompletion, true);
    assert.equal(calls[0].onQueued, loaded.context.fixtureOptions.onQueued);
    assert.equal(calls[0].sourceUrl, image.sourceUrl);
  }
});

test("blob and converted downloads forward options to the browser downloader", async () => {
  const calls = [];
  const onQueued = () => {};
  const loaded = loadFunctions(["downloadBlobAsFile", "downloadByBlob"], {
    fixtureBlob: new Blob(["bytes"]), fixtureOptions: { awaitCompletion: true, onQueued, forceDataUrl: true, sourceUrl: image.sourceUrl },
    blobToDataUrl: async () => "data:image/jpeg;base64,AA==",
    downloadByUrl: async (_url, _filename, options) => { calls.push(options); return { success: true }; }
  });
  await loaded.run("downloadByBlob(fixtureBlob, 'image.jpg', fixtureOptions)");
  assert.equal(calls[0].awaitCompletion, true);
  assert.equal(calls[0].onQueued, onQueued);
  assert.equal(calls[0].sourceUrl, image.sourceUrl);
});

test("network interruptions may use another candidate while cancellation cannot", async () => {
  const calls = [];
  const loaded = loadFunctions(["downloadImage"], {
    fixture: image,
    downloadByUrl: async (url) => {
      calls.push(url);
      if (url === image.hdSrc) throw Object.assign(new Error("NETWORK_FAILED"), { code: "NETWORK_FAILED" });
      return { success: true, downloadId: 8 };
    }
  });
  const result = await loaded.run("downloadImage(fixture, { awaitCompletion: true })");
  assert.deepEqual(calls, [image.hdSrc, image.src]);
  assert.equal(result.success, true);
  assert.equal(result.fallbackUsed, true);
});

test("failed progress persistence cancels a newly created download and blocks fallback", async () => {
  const cancelled = [];
  const loaded = loadFunctions(["downloadByUrl"], {
    chrome: { downloads: { download: async () => 7, cancel: async (id) => cancelled.push(id) } },
    fixtureOptions: { awaitCompletion: true, onQueued: async () => { throw new Error("storage full"); } }
  });
  await assert.rejects(loaded.run("downloadByUrl('https://cdn.example.com/full.jpg', 'image.jpg', fixtureOptions)"), (error) => {
    assert.equal(error.retryable, false);
    assert.equal(error.code, "DOWNLOAD_PROGRESS_SAVE_FAILED");
    return true;
  });
  assert.deepEqual(cancelled, [7]);
});

test("a cancellation event without an error delta reads the browser cancellation reason", async () => {
  const listeners = new Set();
  let interrupted = false;
  const loaded = loadFunctions(["waitForDownloadTerminal"], {
    chrome: { downloads: { onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } } },
    getDownloadStats: async () => interrupted ? { state: "interrupted", error: "USER_CANCELED" } : { state: "in_progress" }
  });
  const pending = loaded.run("waitForDownloadTerminal(7, 100)");
  interrupted = true;
  for (const listener of listeners) listener({ id: 7, state: { current: "interrupted" } });
  const result = await pending;
  assert.equal(result.error, "USER_CANCELED");
  assert.equal(listeners.size, 0);
});

test("the request Referer lease encloses download terminal observation", async () => {
  const events = [];
  const loaded = loadFunctions(["downloadByUrl"], {
    chrome: { downloads: { download: async () => { events.push("queued"); return 7; } } },
    withImageRefererRequest: async (_url, sourceUrl, operation) => {
      assert.equal(sourceUrl, image.sourceUrl);
      events.push("lease");
      const result = await operation();
      events.push("release");
      return result;
    },
    waitForDownloadTerminal: async () => { events.push("complete"); return { state: "complete", fileSize: 123 }; }
  });
  await loaded.run(`downloadByUrl('https://cdn.example.com/full.jpg', 'image.jpg', { awaitCompletion: true, sourceUrl: '${image.sourceUrl}' })`);
  assert.deepEqual(events, ["lease", "queued", "complete", "release"]);
});

test("status polling resumes a durable job even when the separate status snapshot was lost", async () => {
  const statuses = new Map();
  let resumeCount = 0;
  let sequence = 0;
  const saved = { active: true, mode: "direct", taskId: "direct_saved", current: 0, total: 1 };
  const loaded = loadFunctions(["recoverActiveDownloadStatus", "getDownloadStatus"], {
    batchDownloadStatusByTab: statuses,
    activeBatchDownloads: new Set(),
    ensureDownloadStatusesLoaded: async () => true,
    cleanupExpiredDownloadStatuses: () => {},
    cloneDownloadStatus: (status) => ({ ...status }),
    updateDownloadStatus: (tabId, patch) => {
      const status = { ...patch, updatedAt: ++sequence };
      statuses.set(tabId, status);
      return { ...status };
    },
    directDownloadJobs: { getStatus: async () => saved, resume: async () => { resumeCount += 1; } }
  });
  const status = await loaded.run("getDownloadStatus(42)");
  assert.equal(status.active, true);
  assert.equal(resumeCount, 1);
});

test("status polling does not replace a newer task while loading a previous direct job", async () => {
  const old = { active: true, mode: "direct", taskId: "old", updatedAt: 1 };
  const newer = { active: true, mode: "zip", taskId: "new", updatedAt: 2 };
  const statuses = new Map([[42, old]]);
  let resumeCount = 0;
  const loaded = loadFunctions(["recoverActiveDownloadStatus"], {
    fixture: old,
    batchDownloadStatusByTab: statuses,
    directDownloadJobs: {
      getStatus: async () => { statuses.set(42, newer); return { ...old }; },
      resume: async () => { resumeCount += 1; }
    }
  });
  const result = await loaded.run("recoverActiveDownloadStatus(42, fixture)");
  assert.equal(result.taskId, "new");
  assert.equal(resumeCount, 0);
});
