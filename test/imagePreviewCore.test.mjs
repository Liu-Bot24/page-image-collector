import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../shared/imagePreviewCore.js', import.meta.url), 'utf8'), context);
const { candidateUrls, createLoader } = context.PageImageCollectorPreview;
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const image = { id: 'one', src: 'https://cdn.example/bad.webp', hdSrc: 'https://cdn.example/bad.webp', originalSrc: 'https://cdn.example/working.jpg', candidateUrls: ['https://cdn.example/working.jpg', 'https://cdn.example/last.png'] };

test('preview candidates preserve the loaded original and signed URLs without duplicates', () => {
  const urls = [...candidateUrls({ ...image, originalSrc: 'https://cdn.example/thumb.jpg?token=a+b' }, image.src)];
  assert.equal(urls[1], 'https://cdn.example/thumb.jpg?token=a+b');
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.includes('https://cdn.example/bad.jpg'));
});

test('the native preview exhausts each distinct candidate once and stops instead of retrying a broken URL', async () => {
  const assignments = [];
  const node = { dataset: {}, get src() { return assignments.at(-1); }, set src(value) { assignments.push(value); } };
  const loader = createLoader({}); loader.start(node, image, image.src);
  for (let i = 0; i < 10; i++) await loader.error(node);
  assert.deepEqual(assignments, [...candidateUrls(image, image.src)]);
  assert.equal(node.dataset.previewFailed, '1');
});

test('compatibility preview uses its resolved network candidate for metadata and releases its Blob URL', async () => {
  const requested = []; let released = 0;
  const node = { dataset: {}, isConnected: true, src: '' };
  const loader = createLoader({ fetchPreview: async url => { requested.push(url); return { url: 'blob:extension-preview', release: () => released++ }; } });
  loader.start(node, image, image.src, true); await tick();
  assert.equal(requested[0], image.src, 'compatibility must respect the selected preferred URL');
  assert.equal(node.src, 'blob:extension-preview');
  assert.equal(loader.loadedUrl(node), image.src);
  node.isConnected = false; loader.prune();
  assert.equal(released, 1);
});

test('a late compatibility response cannot overwrite a reused lightbox or survive collection invalidation', async () => {
  for (const reuse of [false, true]) {
    let complete; let released = 0;
    const node = { dataset: {}, src: '' };
    const loader = createLoader({ fetchPreview: () => new Promise(resolve => { complete = resolve; }) });
    loader.start(node, image, image.src, true); await tick();
    if (reuse) loader.start(node, { src: 'https://cdn.example/new.jpg' }, 'https://cdn.example/new.jpg');
    else loader.clear();
    complete({ url: 'blob:old-result', release: () => released++ }); await tick();
    assert.equal(node.src, reuse ? 'https://cdn.example/new.jpg' : '');
    assert.equal(released, 1);
  }
});

test('compatibility previews keep safe inline originals usable without a background request', async () => {
  const node = { dataset: {}, src: '' }; let requests = 0;
  const loader = createLoader({ fetchPreview: async () => { requests++; return null; } });
  loader.start(node, { ...image, originalSrc: 'data:image/png;base64,AA==' }, 'data:image/png;base64,AA==', true); await tick();
  assert.equal(node.src, 'data:image/png;base64,AA==');
  assert.equal(requests, 0);
});

test('compatibility falls back to the loaded original only after the preferred URL fails', async () => {
  const requested = [];
  const node = { dataset: {}, src: '' };
  const loader = createLoader({ fetchPreview: async url => {
    requested.push(url);
    return url === image.originalSrc ? { url: 'blob:working-original' } : null;
  } });
  loader.start(node, image, image.src, true); await tick();
  assert.deepEqual(requested, [image.src, image.originalSrc]);
  assert.equal(node.src, 'blob:working-original');
  assert.equal(loader.loadedUrl(node), image.originalSrc);
});

test('compatibility exhaustion clears the old image and reports terminal failure exactly once', async () => {
  let failures = 0;
  const node = { dataset: {}, src: 'https://cdn.example/previous.jpg', removeAttribute(name) { delete this[name]; } };
  const loader = createLoader({ fetchPreview: async () => null, onExhausted: () => { failures++; } });
  loader.start(node, image, image.src, true); await tick();
  assert.equal(node.src, undefined, 'the previous image must not represent the newly selected record');
  assert.equal(node.dataset.previewFailed, '1');
  assert.equal(failures, 1);
  await loader.error(node); await loader.error(node);
  assert.equal(failures, 1);
});
