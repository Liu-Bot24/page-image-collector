import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../background/background.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../shared/imageMetadataCore.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('const PROBE_HEADER_BYTES ='), source.indexOf('const probeImageDimensionsUnscoped ='));
const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const harness = () => {
  const started = [];
  const pending = [];
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout,
    normalizeRefererOrigin: source => new URL(source).origin,
    withImageRefererRequest: (url, source, operation) => { started.push({ url, source }); return operation(); },
    probeImageDimensionsUnscoped: () => new Promise(resolve => pending.push(resolve))
  });
  vm.runInContext(core + '\n' + block + '\nglobalThis.probe = probeImageDimensions;', context);
  return { probe: context.probe, started, pending };
};

test('all extension pages share one bounded background probe queue', async () => {
  const h = harness();
  const tasks = Array.from({ length: 40 }, (_, i) => h.probe(`https://cdn.example/${i}.jpg`, `https://source${i % 4}.example/page`));
  await settle();
  assert.equal(h.started.length, 8);
  while (h.pending.length) {
    h.pending.splice(0).forEach(resolve => resolve({ success: true, width: 1920, height: 1080 }));
    await settle();
  }
  assert.equal((await Promise.all(tasks)).length, 40);
});

test('background merges simultaneous probes only when URL and Referer origin agree', async () => {
  const h = harness();
  const a = h.probe('https://cdn.example/a.jpg', 'https://a.example/page');
  const duplicate = h.probe('https://cdn.example/a.jpg', 'https://a.example/other-page');
  const b = h.probe('https://cdn.example/a.jpg', 'https://b.example/page');
  await settle();
  assert.equal(h.started.length, 2);
  h.pending.splice(0).forEach(resolve => resolve({ success: true, width: 10, height: 10 }));
  await Promise.all([a, duplicate, b]);
  const again = h.probe('https://cdn.example/a.jpg', 'https://a.example/page');
  await settle();
  assert.equal(h.started.length, 3, 'completed results are not cached across clear/retry');
  h.pending.splice(0).forEach(resolve => resolve({ success: true, width: 10, height: 10 }));
  await again;
});
