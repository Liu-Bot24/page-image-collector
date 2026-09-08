import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { inspectImagePayload, mimeFromFormat } from '../shared/zipCore.js';

const source = readFileSync(new URL('../background/background.js', import.meta.url), 'utf8');
const fetchBlock = source.slice(source.indexOf('const fetchBlobUnscoped ='), source.indexOf('const arrayBufferToBase64 ='));
const fetchHarness = response => {
  const context = vm.createContext({ URL, Blob, AbortController, setTimeout, clearTimeout, fetch: async () => response });
  vm.runInContext(fetchBlock + '\nglobalThis.read = fetchBlobUnscoped;', context);
  return context.read;
};

test('compatibility previews reject declared oversize bodies before reading and cancel the response', async () => {
  let cancelled = false; let read = false;
  const fetch = fetchHarness({ ok: true, headers: new Headers({ 'content-length': '8' }), body: { cancel: async () => { cancelled = true; }, getReader() { read = true; } } });
  await assert.rejects(fetch('https://cdn.example/image.png', 1000, 4), /大小限制/);
  assert.equal(cancelled, true); assert.equal(read, false);
});

test('unknown-length compatibility previews stop and cancel as soon as streamed bytes exceed the limit', async () => {
  let cancelled = false; let reads = 0;
  const fetch = fetchHarness({ ok: true, headers: new Headers(), body: { getReader: () => ({ read: async () => { reads++; return { done: false, value: new Uint8Array(4) }; }, cancel: async () => { cancelled = true; } }) } });
  await assert.rejects(fetch('https://cdn.example/image.png', 1000, 5), /大小限制/);
  assert.equal(cancelled, true); assert.equal(reads, 2);
});

test('ordinary image downloads retain their unbounded Blob transport; preview limits are not a download size cap', async () => {
  const blob = new Blob([new Uint8Array(8)]);
  const fetch = fetchHarness({ ok: true, blob: async () => blob });
  assert.equal((await fetch('https://cdn.example/image.png', 1000)).size, 8);
});

test('a preview request must name a current image candidate, and stale responses never return binary content', async () => {
  const shared = readFileSync(new URL('../shared/imageMetadataCore.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const COMPATIBILITY_PREVIEW_MAX_BYTES ='), source.indexOf('const probeImageDimensionsUnscoped ='));
  let current = 'old'; let requests = 0; let encode = 0; let complete;
  const context = vm.createContext({ URL, Blob, AbortController, setTimeout, clearTimeout,
    isImageCollectionCurrent: scope => scope.collectionId === current,
    stateManager: { getImageById: () => ({ id: 'one', src: 'https://cdn.example/allowed.png' }) },
    getDownloadCandidates: image => [image.src], resolveImageRequestSource: async () => 'https://source.example/',
    normalizeRefererOrigin: value => new URL(value).origin,
    withImageRefererRequest: async (_url, _origin, operation) => operation(),
    fetchBlobUnscoped: async () => { requests++; return await new Promise(resolve => { complete = resolve; }); },
    inspectImagePayload: () => ({ ok: true, mimeType: 'image/png' }),
    blobToDataUrl: async () => { encode++; return 'data:image/png;base64,AA=='; }
  });
  vm.runInContext(shared + '\n' + block + '\nglobalThis.preview = getImagePreview;', context);
  assert.equal((await context.preview(1, { imageId: 'one', collectionId: 'retired', url: 'https://cdn.example/allowed.png' })).stale, true);
  assert.equal((await context.preview(1, { imageId: 'one', collectionId: 'old', url: 'https://other.example/uncollected.png' })).success, false);
  assert.equal(requests, 0);
  const task = context.preview(1, { imageId: 'one', collectionId: 'old', url: 'https://cdn.example/allowed.png' });
  for (let i = 0; i < 30 && !complete; i++) await Promise.resolve();
  assert.equal(requests, 1); current = 'new'; complete(new Blob([new Uint8Array(8)]));
  const result = await task;
  assert.equal(result.stale, true); assert.equal(result.dataUrl, undefined); assert.equal(encode, 0);
});

test('compatibility encoding uses the verified image MIME instead of a generic or incorrect response header', async () => {
  const bytes = readFileSync(new URL('../icons/icon128.png', import.meta.url));
  const shared = readFileSync(new URL('../shared/imageMetadataCore.js', import.meta.url), 'utf8');
  const encoding = source.slice(source.indexOf('const arrayBufferToBase64 ='), source.indexOf('const convertBlobToJpg ='));
  const preview = source.slice(source.indexOf('const COMPATIBILITY_PREVIEW_MAX_BYTES ='), source.indexOf('const probeImageDimensionsUnscoped ='));
  for (const mime of ['application/octet-stream', 'text/plain', 'image/jpeg', '']) {
    let body = new Blob([bytes], { type: mime });
    const context = vm.createContext({ URL, Blob, AbortController, setTimeout, clearTimeout,
      btoa: value => Buffer.from(value, 'binary').toString('base64'), inspectImagePayload, mimeFromFormat,
      isImageCollectionCurrent: () => true,
      stateManager: { getImageById: () => ({ id: 'one', src: 'https://cdn.example/image' }) },
      getDownloadCandidates: image => [image.src], resolveImageRequestSource: async () => 'https://source.example/',
      normalizeRefererOrigin: value => new URL(value).origin,
      withImageRefererRequest: async (_url, _origin, operation) => operation(),
      fetchBlobUnscoped: async () => body
    });
    vm.runInContext(shared + '\n' + encoding + '\n' + preview + '\nglobalThis.preview = getImagePreview;', context);
    const request = { imageId: 'one', collectionId: 'current', url: 'https://cdn.example/image' };
    const result = await context.preview(1, request);
    assert.equal(result.success, true);
    assert.ok(result.dataUrl.startsWith('data:image/png;base64,'), `UI rejects or misidentifies ${mime}: ${result.dataUrl.slice(0, 50)}`);
    assert.deepEqual(Buffer.from(result.dataUrl.split(',')[1], 'base64'), bytes);
    body = new Blob(['<html>Access denied</html>'], { type: 'image/png' });
    const rejected = await context.preview(1, request);
    assert.equal(rejected.success, false);
    assert.equal(rejected.dataUrl, undefined);
  }
});
