(() => {
  const dimensions = (value = {}) => {
    const width = Math.max(0, Number(value.width) || 0);
    const height = Math.max(0, Number(value.height) || 0);
    return { ...value, width, height, area: width * height };
  };

  // Select the whole candidate so its dimensions, URL and detected format stay together.
  const selectLargestDimensions = (base, candidates) => candidates.reduce((best, candidate) => {
    const next = dimensions(candidate);
    return next.area > 0 && next.area >= best.area ? next : best;
  }, dimensions(base));

  const createDimensionProbeQueue = ({ probe, concurrency = 6, failureTtlMs = 30000,
    successTtlMs = 5 * 60 * 1000, maxEntries = 2000 }) => {
    const cache = new Map();
    const pending = new Map();
    const queued = [];
    let active = 0;
    const empty = () => ({ width: 0, height: 0, area: 0 });
    const drain = () => {
      while (active < concurrency && queued.length) {
        const entry = queued.shift();
        if (entry.controller.signal.aborted) continue;
        active += 1;
        Promise.resolve().then(() => probe(entry.url, entry.controller.signal, entry.context))
          .catch(() => empty()).then((result) => {
            const value = dimensions(result);
            if (entry.controller.signal.aborted) { entry.resolve(empty()); return; }
            if (pending.get(entry.key) === entry) {
              pending.delete(entry.key);
              entry.expiresAt = Date.now() + (value.area > 0 ? successTtlMs : failureTtlMs);
              cache.set(entry.key, entry);
              while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
            }
            entry.resolve(value);
          }).finally(() => {
            active -= 1;
            drain();
          });
      }
    };
    return {
      get(url, context = "") {
        const normalizedUrl = String(url || "").trim();
        if (!normalizedUrl) return Promise.resolve(empty());
        const key = JSON.stringify([context, normalizedUrl]);
        const cached = cache.get(key);
        if (cached && cached.expiresAt > Date.now()) {
          cache.delete(key);
          cache.set(key, cached);
          return cached.promise;
        }
        cache.delete(key);
        if (pending.has(key)) return pending.get(key).promise;
        const entry = { key, url: normalizedUrl, context, controller: new AbortController() };
        entry.promise = new Promise((resolve) => { entry.resolve = resolve; });
        pending.set(key, entry);
        queued.push(entry);
        drain();
        return entry.promise;
      },
      clear(matches = () => true) {
        for (const entry of pending.values()) {
          if (!matches(entry.context)) continue;
          entry.controller.abort();
          entry.resolve(empty());
          pending.delete(entry.key);
        }
        for (const [key, entry] of cache) if (matches(entry.context)) cache.delete(key);
        for (let i = queued.length - 1; i >= 0; i--) if (queued[i].controller.signal.aborted) queued.splice(i, 1);
        // Running transports retain their slots until settled, including non-abortable runtime messages.
      }
    };
  };

  const probeDomDimensions = (url, signal, timeoutMs = 10000) => new Promise((resolve) => {
    if (signal.aborted) { resolve({ width: 0, height: 0 }); return; }
    const image = new Image();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      resolve(result);
    };
    const abort = () => finish({ width: 0, height: 0 });
    const timer = setTimeout(abort, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => finish({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
    image.onerror = abort;
    image.src = url;
  });

  globalThis.PageImageCollectorMetadata = { dimensions, selectLargestDimensions, createDimensionProbeQueue, probeDomDimensions };
})();
