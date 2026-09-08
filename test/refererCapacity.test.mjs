import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefererHarness } from '../test-support/refererHarness.mjs';

const mixed = count => Array.from({ length: count }, (_, i) => ({ id: `image_${i}`, src: `https://cdn.example.com/${i}.jpg`, sourceUrl: `https://${i % 2 ? 'b' : 'a'}.example/page` }));

test('201 scoped candidates retain all image records and use a bounded, explicitly degraded rule set', async () => {
  const h = createRefererHarness(); h.images.set(1, mixed(201));
  const status = await h.api.registerImageRefererConsumer(1, h.sender(31));
  assert.equal(status.degraded, true);
  assert.equal(status.requested, 201);
  assert.equal(h.rules.size, 200);
  const response = await h.api.getImagesForTab(1, h.sender(31));
  assert.equal(response.success, true);
  assert.equal(response.images.length, 201);
  assert.equal(response.referer.degraded, true);
  assert.ok([...h.rules.values()].every(rule => rule.condition.tabIds?.length && rule.condition.initiatorDomains?.length));
});

test('an exhausted pool preserves other workspaces and never blocks GET_IMAGES', async () => {
  const h = createRefererHarness(); h.images.set(1, mixed(200));
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  const previous = JSON.stringify([...h.rules]);
  const response = await h.api.getImagesForTab(2, h.sender(32));
  assert.equal(response.success, true);
  assert.equal(response.images.length, 1);
  assert.equal(response.referer.degraded, true);
  assert.equal(JSON.stringify([...h.rules]), previous);
});

test('a rejected DNR update leaves the previous registry intact and still returns images', async () => {
  const h = createRefererHarness();
  await h.api.registerImageRefererConsumer(1, h.sender(31));
  const previous = h.api.snapshot();
  const rules = JSON.stringify([...h.rules]);
  h.images.set(1, mixed(4)); h.failRules(true);
  const response = await h.api.getImagesForTab(1, h.sender(31));
  assert.equal(response.success, true);
  assert.equal(response.images.length, 4);
  assert.equal(response.referer.degraded, true);
  assert.match(response.referer.error, /DNR install rejected/);
  assert.equal(h.api.snapshot(), previous);
  assert.equal(JSON.stringify([...h.rules]), rules);
});

test('failed metadata persistence rolls back the installed DNR change before publishing a new registry', async () => {
  const h = createRefererHarness(); await h.api.registerImageRefererConsumer(1, h.sender(31));
  const previous = h.api.snapshot(); const rules = JSON.stringify([...h.rules]);
  h.images.set(1, mixed(3)); h.failStorage(true);
  const response = await h.api.getImagesForTab(1, h.sender(31));
  assert.equal(response.success, true);
  assert.equal(response.referer.degraded, true);
  assert.equal(h.api.snapshot(), previous);
  assert.equal(JSON.stringify([...h.rules]), rules);
});
