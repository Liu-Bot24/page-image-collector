import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildRefererModifyRule, normalizeRefererOrigin, normalizeDnrHostname } from '../shared/dnrCore.js';

test('opening an original image uses a temporary rule limited to its new tab and exact URL', async () => {
  const source = readFileSync(new URL('../background/background.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const openOriginalImageInTab ='), source.indexOf('const decodeUrlMaybe ='));
  const rules = new Map();
  const creates = [];
  const navigations = [];
  let waited = false;
  const context = vm.createContext({ URL, buildRefererModifyRule, normalizeRefererOrigin, normalizeDnrHostname,
    resolveOriginalImageUrl: url => url, regexEscape: value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    loadImageRefererMetadata: async () => {}, queueImageRefererMutation: async operation => operation(),
    getScopedDnrRules: async () => [...rules.values()],
    updateScopedDnrRules: async ({ removeRuleIds = [], addRules = [] }) => { removeRuleIds.forEach(id => rules.delete(id)); addRules.forEach(rule => rules.set(rule.id, rule)); },
    waitForTabComplete: async tabId => {
      waited = true;
      assert.equal(tabId, 31);
      const rule = [...rules.values()][0];
      assert.equal(rule.condition.tabIds[0], 31);
      assert.equal(rule.action.requestHeaders[0].value, 'https://weibo.com/');
      const pattern = new RegExp(rule.condition.regexFilter);
      assert.equal(pattern.test('https://wx1.sinaimg.cn/large/a.jpg?token=a+b'), true);
      assert.equal(pattern.test('https://wx1.sinaimg.cn/large/b.jpg'), false);
    },
    chrome: { tabs: { create: async options => { creates.push(options); return { id: 31 }; }, update: async (id, options) => navigations.push({ id, ...options }) } }
  });
  vm.runInContext(block + '\nglobalThis.openImage = openOriginalImageInTab;', context);
  await context.openImage('https://wx1.sinaimg.cn/large/a.jpg?token=a+b', 'https://weibo.com/status');
  assert.equal(waited, true);
  assert.equal(creates[0].url, 'about:blank');
  assert.equal(navigations[0].url, 'https://wx1.sinaimg.cn/large/a.jpg?token=a+b');
  assert.equal(rules.size, 0, 'navigation rules are removed when the load settles');
});
