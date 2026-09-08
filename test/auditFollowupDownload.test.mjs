import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createDirectDownloadJobManager } from '../background/directDownloadJobs.js';

const key = 'pic_collector_direct_download_jobs_v1';
const networkImage = { id: 'image_one', src: 'https://cdn.example/one.webp', hdSrc: 'https://cdn.example/one.webp', sourceUrl: 'https://source.example/page' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const makeStorage = (initial = {}) => {
  const stored = structuredClone(initial);
  let maxBytes = 0;
  const storage = {
    get: async () => structuredClone(stored),
    set: async value => {
      const encoded = JSON.stringify(value);
      maxBytes = Math.max(maxBytes, Buffer.byteLength(encoded));
      if (Buffer.byteLength(encoded) > 10 * 1024 * 1024) throw new Error('QUOTA_BYTES exceeded');
      assert.equal(encoded.includes('data:image'), false, 'no binary image URL belongs in a recovery snapshot');
      Object.assign(stored, JSON.parse(encoded));
    }
  };
  return { storage, stored, maxBytes: () => maxBytes };
};

test('an 8 MiB converted Blob downloads under a 10 MiB metadata quota without persisting its Data URL', async () => {
  const source = readFileSync(new URL('../background/background.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const downloadByUrl ='), source.indexOf('const buildZipEntryFromImage ='));
  const requests = [];
  const context = vm.createContext({ URL: {}, Date, Map, Number, String, setTimeout, clearTimeout,
    pendingFilenameHints: new Map(), withImageRefererRequest: async (_url, _source, operation) => operation(),
    chrome: { downloads: { download: async options => { requests.push({ length: options.url.length }); return 71; }, cancel: async () => {} } },
    waitForDownloadTerminal: async () => ({ state: 'complete', fileSize: 8 * 1024 * 1024 }),
    waitForDownloadNonZeroSize: async () => 8 * 1024 * 1024,
    blobToDataUrl: async blob => 'data:image/jpeg;base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64')
  });
  vm.runInContext(block + '\nglobalThis.saveBlob = downloadBlobAsFile;', context);
  const h = makeStorage();
  const manager = createDirectDownloadJobManager({ storage: h.storage,
    downloadImage: async (_image, options) => context.saveBlob(new Blob([new Uint8Array(8 * 1024 * 1024)]), 'one.jpg', 'image/jpeg', { ...options, candidateUrl: networkImage.src, converted: true })
  });
  const result = await manager.start(1, [networkImage]);
  assert.equal(result.succeeded, 1);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].length > 10 * 1024 * 1024, 'exercise the real large Data URL transport');
  assert.ok(h.maxBytes() < 16000, 'snapshot size depends on job metadata, not image bytes');
  assert.equal(h.stored[key][1].items[0].result.url, networkImage.src);
});

test('completed and cancelled jobs are actually deleted after their display TTL', async () => {
  for (const cancelled of [false, true]) {
    let time = 1000;
    const timers = new Map();
    let timerId = 0;
    const h = makeStorage();
    const manager = createDirectDownloadJobManager({ storage: h.storage, now: () => time,
      setTimer: (fn, ms) => { timers.set(++timerId, { fn, due: time + ms }); return timerId; },
      clearTimer: id => timers.delete(id),
      downloadImage: async () => ({ success: !cancelled, cancelled, downloadId: 73, url: networkImage.src })
    });
    await manager.start(1, [networkImage]);
    assert.ok(h.stored[key][1]);
    time += 15001;
    for (const [id, timer] of [...timers]) if (timer.due <= time) { timers.delete(id); await timer.fn(); }
    await tick();
    assert.equal(h.stored[key][1], undefined, 'expiration must remove storage, not just hide its status');
    assert.equal(await manager.getStatus(1), null);
  }
});

test('startup removes expired legacy jobs and strips legacy binary URLs while preserving pending download IDs', async () => {
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(20000);
  const h = makeStorage({ [key]: {
    1: { tabId: 1, taskId: 'expired', done: true, completedAt: 1, options: {}, items: [{ image: { id: 'old' }, result: { success: true, url: dataUrl } }] },
    2: { tabId: 2, taskId: 'active', done: false, options: {}, pending: { itemIndex: 0, imageId: networkImage.id, downloadId: 77, candidateIndex: 0, url: dataUrl, candidateUrl: networkImage.src }, items: [{ image: networkImage, result: null }] }
  } });
  const manager = createDirectDownloadJobManager({ storage: h.storage, now: () => 20000 });
  assert.equal(await manager.getStatus(1), null);
  assert.equal(h.stored[key][1], undefined);
  assert.equal((await manager.getStatus(2)).active, true);
  assert.equal(h.stored[key][2].pending.downloadId, 77);
  assert.equal(h.stored[key][2].pending.url, networkImage.src);
  assert.equal(JSON.stringify(h.stored).includes('data:image'), false);
});

test('recovery resumes by candidate identity after binary URLs have been removed', async () => {
  const source = readFileSync(new URL('../background/background.js', import.meta.url), 'utf8');
  const functionSource = name => {
    const start = source.indexOf(`const ${name} =`);
    return source.slice(start, source.indexOf('\nconst ', start + 1));
  };
  const fallback = 'https://cdn.example/fallback.jpg';
  const first = 'https://cdn.example/first.jpg';
  for (const scenario of [
    { image: { hdSrc: 'data:image/png;base64,AA==', src: fallback }, pending: { candidateIndex: 0, url: 'data:image/png;base64,AA==' } },
    { image: { hdSrc: first, src: 'blob:https://source.example/blob', candidateUrls: [fallback] }, pending: { candidateIndex: 1, url: 'blob:https://source.example/blob', remainingCandidateUrls: [fallback] } },
    { image: { hdSrc: first, src: fallback }, pending: { candidateIndex: 0, candidateUrl: first, url: 'data:image/jpeg;base64,AA==' } }
  ]) {
    const requested = [];
    const context = vm.createContext({
      baseFilename: () => 'image', extensionFromUrl: () => 'jpg',
      downloadByUrl: async url => { requested.push(url); return { success: true, url, downloadId: 88 }; }
    });
    vm.runInContext(functionSource('getDownloadCandidates') + '\n' + functionSource('downloadImage') + '\nglobalThis.download = downloadImage;', context);
    const h = makeStorage({ [key]: { 1: { tabId: 1, taskId: 'pending', done: false, options: {},
      pending: { itemIndex: 0, imageId: 'one', downloadId: 77, ...scenario.pending },
      items: [{ image: { id: 'one', ...scenario.image }, result: null }]
    } } });
    const manager = createDirectDownloadJobManager({ storage: h.storage,
      getDownloadState: async () => ({ state: 'interrupted', error: 'NETWORK_FAILED' }),
      downloadImage: (image, options) => context.download(image, options)
    });
    const result = await manager.resume(1);
    assert.equal(result.succeeded, 1);
    assert.deepEqual(requested, [fallback]);
    assert.equal(result.results[0].fallbackUsed, true);
  }
});
