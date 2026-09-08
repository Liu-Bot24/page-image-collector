import { buildRefererModifyRule, normalizeDnrHostname, normalizeRefererOrigin } from './dnrCore.js';

// Requests without a tab (worker/offscreen/downloads) share an initiator. Keep
// concurrent requests from one origin together; conflicting origins take turns.
export const createRefererRequestBroker = ({ extensionId, updateRules, ruleIdStart = 20200, ruleIdMax = 20400 }) => {
  if (typeof extensionId !== 'string' || !extensionId.trim()) throw new Error('Missing extension initiator');
  if (!Number.isInteger(ruleIdStart) || ruleIdStart <= 0 || !Number.isInteger(ruleIdMax) || ruleIdMax <= ruleIdStart) {
    throw new Error('Invalid Referer rule id range');
  }
  const lanes = new Map();
  const leases = new Map();
  const usedIds = new Set();
  const sessionId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  let sequence = 0;
  let mutationTail = Promise.resolve();
  const enqueue = (operation) => {
    const task = mutationTail.then(operation);
    mutationTail = task.catch(() => {});
    return task;
  };

  const pump = async (lane) => {
    if (lanes.get(lane.hostname) !== lane) return;
    try {
      while (lane.pending.length) {
        const next = lane.pending[0];
        if (lane.tokens.size && lane.origin !== next.origin) break;
        if (!lane.tokens.size) {
          lane.origin = next.origin;
          try {
            if (lane.origin) await updateRules({ removeRuleIds: [lane.ruleId], addRules: [buildRefererModifyRule({
              id: lane.ruleId, hostname: lane.hostname, refererOrigin: lane.origin,
              initiatorDomains: [extensionId], tabIds: [-1], priority: 20,
              // requestDomains also matches subdomains, which have independent lanes.
              regexFilter: `^https?://${lane.hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?(?::[0-9]+)?/`,
              resourceTypes: ['xmlhttprequest', 'other']
            })] });
          } catch (error) {
            lane.pending.shift().reject(error);
            continue;
          }
        }
        lane.pending.shift();
        const token = `referer_${sessionId}_${++sequence}`;
        lane.tokens.add(token);
        leases.set(token, lane);
        next.resolve(token);
      }
    } finally {
      if (!lane.tokens.size && !lane.pending.length && lanes.get(lane.hostname) === lane) {
        // A failed installation must not exhaust the finite rule pool.
        usedIds.delete(lane.ruleId);
        lanes.delete(lane.hostname);
      }
    }
  };

  const acquire = (url, sourceUrl) => {
    let parsed;
    try { parsed = new URL(url); } catch { return Promise.resolve(''); }
    if (!/^https?:$/.test(parsed.protocol)) return Promise.resolve('');
    const hostname = normalizeDnrHostname(parsed.hostname);
    if (!hostname) return Promise.resolve('');
    const origin = /(^|\.)sinaimg\.cn$/i.test(hostname)
      ? 'https://weibo.com' : normalizeRefererOrigin(sourceUrl);
    // An unknown source still shares the host's rule scope. Its requests must
    // run only while that host has no installed Referer override.
    let lane = lanes.get(hostname);
    if (!lane) {
      let ruleId = ruleIdStart;
      while (usedIds.has(ruleId) && ruleId < ruleIdMax) ruleId += 1;
      if (ruleId >= ruleIdMax) return Promise.reject(new Error('Too many concurrent image hosts'));
      usedIds.add(ruleId);
      lane = { hostname, ruleId, origin: '', tokens: new Set(), pending: [], cleanupError: null };
      lanes.set(hostname, lane);
    }
    if (lane.cleanupError && lane.origin !== origin) return Promise.reject(lane.cleanupError);
    return new Promise((resolve, reject) => {
      lane.pending.push({ origin, resolve, reject });
      enqueue(() => pump(lane)).catch(reject);
    });
  };

  const release = (token) => enqueue(async () => {
    const lane = leases.get(token);
    if (!lane) return;
    // Keep the final token retryable if Chrome rejects rule removal. In that
    // state the old rule is still installed and its id must remain reserved.
    if (lane.tokens.size === 1 && lane.origin) {
      try {
        await updateRules({ removeRuleIds: [lane.ruleId] });
        lane.cleanupError = null;
      } catch (cause) {
        const error = Object.assign(new Error(`Failed to release image Referer rule: ${cause?.message || cause}`, { cause }), {
          cleanupToken: token, retryable: false
        });
        lane.cleanupError = error;
        // No conflicting waiter can run while the old header is installed.
        // Reject explicitly rather than leaving a request waiting indefinitely.
        for (const pending of lane.pending.splice(0)) pending.reject(error);
        throw error;
      }
    }
    leases.delete(token);
    lane.tokens.delete(token);
    if (lane.tokens.size) return;
    if (!lane.pending.length) {
      if (lanes.get(lane.hostname) === lane) {
        usedIds.delete(lane.ruleId);
        lanes.delete(lane.hostname);
      }
    } else {
      await pump(lane);
    }
  });

  const run = async (url, sourceUrl, operation) => {
    const token = await acquire(url, sourceUrl);
    let operationError;
    try { return await operation(); } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try { await release(token); } catch (cleanupError) {
        if (!operationError) throw cleanupError;
        // Preserve cancellation/error codes used by the candidate fallback loop.
        const error = operationError instanceof Error && Object.isExtensible(operationError)
          ? operationError
          : Object.assign(new Error(operationError?.message || String(operationError), { cause: operationError }), {
              code: operationError?.code, cancelled: operationError?.cancelled
            });
        Object.assign(error, { cleanupError, cleanupToken: token, retryable: false });
        throw error;
      }
    }
  };
  return { acquire, release, run };
};
