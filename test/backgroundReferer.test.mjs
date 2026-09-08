import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefererHarness as harness } from '../test-support/refererHarness.mjs';

test('background registers actual workspace request tabs and keeps shared-CDN origins independent', async () => {
  const h = harness();
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  await h.api.registerImageRefererConsumer(2, h.sender(32));
  assert.equal(h.rules.size, 2);
  const byTab = new Map([...h.rules.values()].map(rule => [rule.condition.tabIds[0], rule]));
  assert.equal(byTab.get(31).action.requestHeaders[0].value, 'https://a.example/');
  assert.equal(byTab.get(32).action.requestHeaders[0].value, 'https://b.example/');
  assert.equal(byTab.has(1), false, 'the source page is not the extension image requester');
  const filter = new RegExp(byTab.get(31).condition.regexFilter);
  assert.equal(filter.test('https://cdn.example.com/a.jpg'), true);
  assert.equal(filter.test('https://child.cdn.example.com/a.jpg'), false);
  h.removedTabIds.add(2);
  await h.api.clearImageRefererRulesForTab(2);
  assert.equal(h.rules.size, 1);
  assert.equal([...h.rules.values()][0].action.requestHeaders[0].value, 'https://a.example/');
});

test('unchanged image results do not rewrite DNR or its metadata', async () => {
  const h = harness();
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  const counts = [h.updates.length, h.writes.length];
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  await h.api.updateImageRefererRulesForTab(1);
  assert.deepEqual([h.updates.length, h.writes.length], counts);
});

test('same workspace switches source without keeping its previous origin rule', async () => {
  const h = harness();
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  await h.api.registerImageRefererConsumer(2, h.sender(31));
  assert.equal(h.rules.size, 1);
  assert.equal([...h.rules.values()][0].action.requestHeaders[0].value, 'https://b.example/');
});

test('paginated sources sharing a CDN get exact candidate rules, while ambiguous URLs stay unmodified', async () => {
  const h = harness();
  h.images.set(1, [
    { src: 'https://cdn.example.com/a.jpg?sig=a+b', sourceUrl: 'https://a.example/page', candidateUrls: ['https://cdn.example.com/shared.jpg'] },
    { src: 'https://cdn.example.com/b.jpg', sourceUrl: 'https://b.example/page', candidateUrls: ['https://cdn.example.com/shared.jpg'] }
  ]);
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  assert.equal(h.rules.size, 2);
  for (const rule of h.rules.values()) {
    const pattern = new RegExp(rule.condition.regexFilter);
    assert.equal(pattern.test('https://cdn.example.com/shared.jpg'), false);
    assert.equal(pattern.test('https://cdn.example.com/uncollected.jpg'), false);
  }
  const a = [...h.rules.values()].find(rule => rule.action.requestHeaders[0].value === 'https://a.example/');
  assert.equal(new RegExp(a.condition.regexFilter).test('https://cdn.example.com/a.jpg?sig=a+b'), true);
});

test('legacy host-only metadata is discarded and never installed in the new session', async () => {
  const h = harness({ 'cdn.example.com': { ruleId: 20001, hostname: 'cdn.example.com', sourceOrigin: 'https://wrong.example', expiresAt: Date.now() + 1e6 } });
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  assert.equal([...h.rules.values()].some(rule => !rule.condition.tabIds), false);
  assert.equal([...h.rules.values()].some(rule => rule.action.requestHeaders[0].value === 'https://wrong.example/'), false);
});

test('an ambiguous probe URL never borrows the first image source, while explicit downloads retain their source', async () => {
  const h = harness();
  const url = 'https://cdn.example.com/shared.jpg';
  h.images.set(1, [
    { src: 'https://cdn.example.com/a.jpg', originalSrc: url, sourceUrl: 'https://a.example/page' },
    { src: 'https://cdn.example.com/b.jpg', originalSrc: url, sourceUrl: 'https://b.example/page' }
  ]);
  assert.equal(await h.api.resolveImageRequestSource(1, url), '');
  assert.equal(await h.api.resolveImageRequestSource(1, url, h.images.get(1)[1]), 'https://b.example/page');
});
