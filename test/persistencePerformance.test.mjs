import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabStateManager } from '../background/stateManager.js';

const mainKey = 'pic_collector_tab_states_v2';
const metaKey = 'pic_collector_tab_metadata_v1';
const fixture = () => {
  const stored = {}; const writes = [];
  let fail = false; let gate;
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async payload => {
      const copy = structuredClone(payload); writes.push(copy);
      if (gate) { const wait = gate; gate = null; await wait; }
      if (fail) throw new Error('disk unavailable');
      Object.assign(stored, copy);
    }
  } } };
  return { stored, writes, fail: value => { fail = value; }, gate: value => { gate = value; } };
};
const seed = async () => {
  const manager = createTabStateManager(); await manager.ensureReady();
  manager.mergeImages(1, Array.from({ length: 1000 }, (_, i) => ({ src: `https://cdn.example/${i}.jpg`, width: 200, height: 100 })));
  await manager.flushPersistence(); return manager;
};
const restored = async () => { const manager = createTabStateManager(); await manager.ensureReady(); return manager; };

for (const collectionId of [undefined, 'invalid-old-id']) {
  test(`legacy v2 snapshots establish a durable collection before metadata-only edits (${collectionId})`, async () => {
    const h = fixture();
    h.stored[mainKey] = { 1: { collectionId, images: [{ src: 'https://cdn.example/legacy.jpg', width: 200, height: 100 }] } };
    const m = await restored(); const id = m.getAllImages(1)[0].id;
    m.setSelectionByIds(1, [id]); m.setConfig(1, { enableHD: false }); await m.flushPersistence();
    const r = await restored();
    assert.equal(r.getSelectedImages(1).length, 1);
    assert.equal(r.getConfig(1).enableHD, false);
    assert.equal(r.getCollectionId(1), m.getCollectionId(1));
  });
}

test('selection, hidden state and config use a small overlay and survive restart', async () => {
  const h = fixture(); const m = await seed(); const [a, b] = m.getAllImages(1);
  m.setSelectionByIds(1, [a.id]); m.setHiddenByIds(1, [b.id]); m.setConfig(1, { enableHD: false });
  await m.flushPersistence();
  const payload = h.writes.at(-1);
  assert.equal(mainKey in payload, false);
  assert.ok(JSON.stringify(payload).length < 1500);
  const r = await restored();
  assert.equal(r.getSelectedImages(1)[0].id, a.id);
  assert.equal(r.getAllImages(1).find(image => image.id === b.id).hidden, true);
  assert.equal(r.getConfig(1).enableHD, false);
  assert.equal(r.getAllImages(1).length, 1000);
});

test('new tab config persists its base and an old overlay cannot revive cleared selections', async () => {
  const h = fixture(); const m = await seed(); const id = m.getAllImages(1)[0].id;
  m.setSelectionByIds(1, [id]); await m.flushPersistence();
  const oldOverlay = structuredClone(h.stored[metaKey]);
  m.clearTabImages(1); m.mergeImages(1, [{ src: 'https://cdn.example/0.jpg', width: 400, height: 200 }]);
  m.setConfig(2, { enableHD: false }); await m.flushPersistence();
  h.stored[metaKey] = oldOverlay;
  const r = await restored();
  assert.equal(r.getSelectedImages(1).length, 0);
  assert.equal(r.getConfig(2).enableHD, false);
});

test('failed overlay writes are visible, retryable and preserve the full image snapshot', async () => {
  const h = fixture(); const m = await seed(); const baseline = structuredClone(h.stored[mainKey]);
  h.fail(true); m.setSelectionByIds(1, [m.getAllImages(1)[0].id]);
  await assert.rejects(m.flushPersistence(), /disk unavailable/);
  assert.match(m.getPersistenceStatus().error, /disk unavailable/);
  assert.deepEqual(h.stored[mainKey], baseline);
  h.fail(false); await m.flushPersistence();
  assert.equal((await restored()).getSelectedImages(1).length, 1);
});

test('changes arriving during an image write survive a restart in their latest order', async () => {
  const h = fixture(); const m = await seed(); const id = m.getAllImages(1)[0].id;
  let release; h.gate(new Promise(resolve => { release = resolve; }));
  m.mergeImages(1, [{ src: 'https://cdn.example/new.jpg', width: 200, height: 100 }]);
  await Promise.resolve(); await Promise.resolve();
  m.setSelectionByIds(1, [id]); m.setConfig(1, { enableHD: false });
  release(); await m.flushPersistence();
  const r = await restored();
  assert.equal(r.getAllImages(1).length, 1001);
  assert.equal(r.getSelectedImages(1)[0].id, id);
  assert.equal(r.getConfig(1).enableHD, false);
});
