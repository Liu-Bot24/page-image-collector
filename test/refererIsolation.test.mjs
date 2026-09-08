import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRefererModifyRule, reconcileRefererRuleSet } from '../shared/dnrCore.js';

test('referer scope separates two workspaces sharing a CDN from unrelated tabs', () => {
  const a = buildRefererModifyRule({ id: 20001, hostname: 'cdn.example.com', refererOrigin: 'https://a.example', tabIds: [31], initiatorDomains: ['extensionid'], resourceTypes: ['image'] });
  const b = buildRefererModifyRule({ id: 20002, hostname: 'cdn.example.com', refererOrigin: 'https://b.example', tabIds: [32], initiatorDomains: ['extensionid'], resourceTypes: ['image'] });
  assert.deepEqual(a.condition.tabIds, [31]);
  assert.deepEqual(b.condition.tabIds, [32]);
  assert.deepEqual(a.condition.initiatorDomains, ['extensionid']);
  assert.equal(a.condition.tabIds.includes(99), false);
});

test('reconciliation preserves scope and replaces old ambient rules', () => {
  const record = { ruleId: 20001, hostname: 'cdn.example.com', sourceOrigin: 'https://a.example', tabIds: [31], initiatorDomains: ['extensionid'], regexFilter: '^https://cdn\\.example\\.com/a\\.jpg$' };
  const options = { records: [record], ruleIdStart: 20000, ruleIdMax: 20200, resourceTypes: ['image'] };
  const scoped = buildRefererModifyRule({ ...record, id: record.ruleId, refererOrigin: record.sourceOrigin, resourceTypes: ['image'] });
  assert.equal(scoped.condition.regexFilter, record.regexFilter);
  assert.deepEqual(reconcileRefererRuleSet({ ...options, scopedRules: [scoped] }), { removeRuleIds: [], addRules: [] });
  const ambient = structuredClone(scoped);
  delete ambient.condition.tabIds;
  assert.deepEqual(reconcileRefererRuleSet({ ...options, scopedRules: [ambient] }).removeRuleIds, [20001]);
});
