import test from 'node:test';
import assert from 'node:assert/strict';
import { createTabStateManager } from '../background/stateManager.js';

const mainKey = 'pic_collector_tab_states_v2';
const useStorage = () => {
  const stored = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(stored),
    set: async payload => { Object.assign(stored, structuredClone(payload)); }
  } } };
  return stored;
};
const image = name => ({ src: `https://cdn.example/${name}.jpg`, width: 200, height: 100 });

test('stored states of tabs that no longer exist are dropped and stay dropped', async () => {
  const stored = useStorage();
  const before = createTabStateManager(); await before.ensureReady();
  before.mergeImages(1, [image('live')]);
  before.mergeImages(2, [image('closed')]);
  before.setConfig(2, { enableAutoScan: true });
  await before.flushPersistence();

  const after = createTabStateManager(); await after.ensureReady();
  assert.equal(after.pruneStoredTabStates(new Set([1])), 1);
  await after.flushPersistence();
  assert.deepEqual(Object.keys(stored[mainKey]), ['1']);
  assert.equal(after.getAllImages(1).length, 1);

  const restarted = createTabStateManager(); await restarted.ensureReady();
  assert.equal(restarted.getAllImages(2).length, 0);
  assert.equal(restarted.getConfig(2).enableAutoScan, false);
});

test('a tab first seen after the live list was taken is not dropped', async () => {
  useStorage();
  const manager = createTabStateManager(); await manager.ensureReady();
  manager.mergeImages(5, [image('new')]);
  assert.equal(manager.pruneStoredTabStates(new Set()), 0);
  assert.equal(manager.getAllImages(5).length, 1);
});
