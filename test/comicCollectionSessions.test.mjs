import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createComicPaginationJobManager } from '../background/comicPaginationJobs.js';

const source = readFileSync(new URL('../background/background.js', import.meta.url), 'utf8');
const scopeCheck = source.slice(source.indexOf('const isImageCollectionCurrent ='), source.indexOf('const backgroundDimensionProbeQueue ='));
const cases = source.slice(source.indexOf('    case MSG.GET_COMIC_SEQUENCE:'), source.indexOf('    case MSG.CANCEL_COMIC_PAGINATION:'));
const types = ['GET_COMIC_SEQUENCE', 'GET_COMIC_PAGINATION', 'LOAD_COMIC_PAGINATION_PAGES'];
const tick = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

const harness = (overrides = {}) => {
  let collectionId = 'current';
  const queries = []; const loads = [];
  const jobs = createComicPaginationJobManager(overrides.jobs);
  const context = vm.createContext({
    MSG: Object.fromEntries(types.map(type => [type, type])),
    stateManager: { getCollectionId: () => collectionId },
    removedTabIds: new Set(), tabsNavigating: new Set(), isRuntimeCacheClearActive: () => false,
    comicPaginationJobs: jobs,
    sendMessageToTab: async (_tabId, message) => { queries.push(message); return overrides.query ? overrides.query(message) : { success: true, sequence: [{ normalized: 'current' }], pagination: { supported: true, nextUrl: 'B/2' } }; },
    loadComicPaginationPages: async (tabId, url, options) => { loads.push({ tabId, url, options }); return { success: true, results: [], nextUrl: '' }; }
  });
  vm.runInContext(scopeCheck + '\nglobalThis.request = async (type, payload = {}) => { const tabId = 1; const sender = {tab:{id:10}}; switch(type) {\n' + cases + '\n} };', context);
  return { request: context.request, setCollection: value => { collectionId = value; }, queries, loads, jobs };
};

test('comic endpoints reject missing and retired collection tokens before querying pages or starting jobs', async () => {
  const h = harness();
  for (const type of types) {
    for (const collectionId of [undefined, 'retired']) {
      const result = await h.request(type, { collectionId, nextUrl: 'https://comic.example/A/2' });
      assert.equal(result.success, false, type);
      assert.equal(result.stale, true, type);
    }
  }
  assert.equal(h.queries.length, 0); assert.equal(h.loads.length, 0);
  for (const type of types) {
    const result = await h.request(type, { collectionId: 'current', nextUrl: 'https://comic.example/B/2' });
    assert.equal(result.success, true, type); assert.equal(result.collectionId, 'current');
  }
  assert.equal(h.loads[0].options.collectionId, 'current');
});

test('comic query responses become stale when the page collection changes during the query', async () => {
  for (const type of types.slice(0, 2)) {
    let complete;
    const h = harness({ query: () => new Promise(resolve => { complete = resolve; }) });
    const pending = h.request(type, { collectionId: 'current' }); await tick();
    h.setCollection('new'); complete({ success: true, sequence: [{ normalized: 'old' }], pagination: { supported: true, nextUrl: 'A/2' } });
    const result = await pending;
    assert.equal(result.stale, true); assert.equal(result.sequence, undefined); assert.equal(result.pagination, undefined);
  }
});

test('comic pagination rechecks collection after awaiting the previous temporary tab cleanup', async () => {
  let finishClose;
  const h = harness({ jobs: { closeTab: () => new Promise(resolve => { finishClose = resolve; }) } });
  const previous = h.jobs.start(1, 'old-client', 10); h.jobs.attachTemporaryTab(1, previous, 77);
  const pending = h.request('LOAD_COMIC_PAGINATION_PAGES', { collectionId: 'current', nextUrl: 'https://comic.example/A/2', clientId: 'new-client' });
  await tick(); h.setCollection('new'); finishClose();
  const result = await pending;
  assert.equal(result.stale, true); assert.equal(h.loads.length, 0);
});
