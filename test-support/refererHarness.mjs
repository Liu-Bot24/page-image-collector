import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as core from '../shared/dnrCore.js';
import { createRefererRequestBroker } from '../shared/refererRequests.js';

const source = readFileSync(new URL('../background/background.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('const IMAGE_REFERER_RULE_ID_START ='), source.indexOf('const timeout = (ms) =>'));
export const createRefererHarness = (legacy = {}) => {
  let failRules = false;
  let failStorage = false;
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const rules = new Map();
  const images = new Map([[1, [{ src: 'https://cdn.example.com/a.jpg', sourceUrl: 'https://a.example/page' }]], [2, [{ src: 'https://cdn.example.com/a.jpg', sourceUrl: 'https://b.example/page' }]]]);
  const tabs = new Map([[1, { url: 'https://a.example/page' }], [2, { url: 'https://b.example/page' }]]);
  const writes = [];
  const updates = [];
  const removedTabIds = new Set();
  const storage = { old: legacy };
  const context = vm.createContext({ ...core, createRefererRequestBroker, URL, Map, Set, Date, console,
    SINAIMG_REFERER_RULE_ID: 10086, IMAGE_REFERER_METADATA_STORAGE_KEY: 'old', removedTabIds,
    tabsNavigating: new Set(), getCollectionEpoch: () => 0, isRuntimeCacheClearActive: () => false,
    withDisplaySource: image => image,
    stateManager: {
      getAllImages: id => images.get(id) || [], getConfig: () => ({ enableHD: true }), getCollectionId: id => 'collection_' + id,
      getImageRequestSource: (id, url) => {
        const matches=(images.get(id) || []).filter(image => [image.src,image.hdSrc,image.originalSrc,...(image.candidateUrls||[])].includes(url));
        const origins = new Set(matches.map(image => core.normalizeRefererOrigin(image.sourceUrl)).filter(Boolean));
        return { found: matches.length > 0, ambiguous: origins.size > 1, sourceUrl: origins.size === 1 ? matches.find(image => image.sourceUrl).sourceUrl : '' };
      }
    },
    chrome: {
      runtime: { id: extensionId, getURL: path => `chrome-extension://${extensionId}/${path}` },
      tabs: { get: async id => tabs.get(id) },
      storage: { local: { get: async () => storage, set: async value => { if (failStorage) throw new Error('metadata save failed'); writes.push(value); Object.assign(storage, value); } } },
      declarativeNetRequest: {
        updateDynamicRules: async update => { updates.push({ dynamic: update }); },
        getSessionRules: async () => [...rules.values()],
        updateSessionRules: async update => {
          if (failRules) throw new Error('DNR install rejected');
          updates.push(update);
          for (const id of update.removeRuleIds || []) rules.delete(id);
          for (const rule of update.addRules || []) rules.set(rule.id, rule);
        }
      }
    }
  });
  vm.runInContext(block + '\nglobalThis.api = { registerImageRefererConsumer, updateImageRefererRulesForTab, clearImageRefererRulesForTab, withImageRefererRequest, resolveImageRequestSource, ...(typeof getImagesForTab === \"function\" ? { getImagesForTab } : {}), snapshot: () => JSON.stringify([...imageRefererRuleMap]) };', context);
  const sender = requestTabId => ({ id: extensionId, url: `chrome-extension://${extensionId}/workspace/workspace.html`, tab: { id: requestTabId } });
  return { failRules: value => { failRules = value; }, failStorage: value => { failStorage = value; }, api: context.api, rules, images, tabs, sender, writes, updates, removedTabIds };
};
