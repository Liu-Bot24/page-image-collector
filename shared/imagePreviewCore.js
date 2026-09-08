(() => {
  const candidateUrls = (image = {}, preferred = '', normalize = value => String(value || '').trim()) => {
    const base = [preferred, image.originalSrc, image.src, image.hdSrc, ...(image.candidateUrls || [])].map(normalize).filter(Boolean);
    const alternatives = base.filter(url => /\.webp(?=\?|#|$)/i.test(url)).map(url => url.replace(/\.webp(?=\?|#|$)/i, '.jpg'));
    return [...new Set([...base, ...alternatives])];
  };

  const createLoader = ({ normalize, fetchPreview, isCurrent = () => true, onExhausted = () => {} }) => {
    const states = new WeakMap();
    const active = new Set();
    let generation = 0;
    const current = state => states.get(state.element) === state && state.generation === generation && isCurrent(state.image);
    const release = state => { state.release?.(); state.release = null; };
    const cancel = element => {
      const state = states.get(element);
      if (!state) return;
      states.delete(element); active.delete(state);
      state.observer?.disconnect();
      release(state);
    };
    const prune = () => {
      for (const state of active) {
        if (state.element.isConnected === true) state.connected = true;
        else if (state.connected) cancel(state.element);
      }
    };
    // Filtering to an empty gallery creates no new cards, so cleanup cannot
    // depend only on the next start() call to release detached preview blobs.
    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
      const observer = new MutationObserver(prune);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    const advance = async state => {
      if (!current(state) || state.busy || state.failed) return false;
      state.busy = true;
      try {
        release(state);
        while (current(state)) {
          let url = state.queue.shift();
          if (!url && state.phase === 'native' && fetchPreview) {
            state.phase = 'proxy';
            state.queue = candidateUrls(state.image, state.preferred, normalize).filter(candidate => /^https?:/i.test(candidate));
            url = state.queue.shift();
          }
          if (!url) {
            state.failed = true;
            state.element.dataset.previewFailed = '1';
            state.element.removeAttribute?.('src');
            onExhausted(state.element, state.image);
            return false;
          }
          state.candidate = url;
          state.element.dataset.previewCandidate = url;
          state.element.dataset.previewFailed = '';
          if (state.phase === 'native' || !/^https?:/i.test(url)) { state.element.src = url; return true; }
          let result;
          try { result = await fetchPreview(url, state.image); } catch { continue; }
          if (!current(state) || (state.connected && state.element.isConnected === false)) { result?.release?.(); return false; }
          if (!result?.url) continue;
          state.release = result.release;
          state.element.src = result.url;
          return true;
        }
        return false;
      } finally { state.busy = false; }
    };
    return {
      has(element, image) { const state = states.get(element); return Boolean(state && current(state) && state.image === image); },
      start(element, image, preferred, compatibility = false) {
        cancel(element);
        element.removeAttribute?.('src');
        element.dataset.previewFailed = '';
        const state = { element, image, preferred, generation, connected: element.isConnected === true,
          phase: compatibility ? 'proxy' : 'native', busy: false, failed: false, release: null,
          queue: candidateUrls(image, preferred, normalize) };
        states.set(element, state); active.add(state);
        // Preserve lazy loading when compatibility previews need a background fetch.
        if (compatibility && element.loading === 'lazy' && typeof IntersectionObserver !== 'undefined') {
          state.observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { state.observer.disconnect(); void advance(state); }
          }, { rootMargin: '200px' });
          state.observer.observe(element);
        } else void advance(state);
        Promise.resolve().then(prune);
      },
      error(element) { const state = states.get(element); return state ? advance(state) : Promise.resolve(false); },
      loadedUrl(element) { return states.get(element)?.candidate || element.currentSrc || element.src || ''; },
      cancel,
      prune,
      clear() { generation += 1; for (const state of [...active]) cancel(state.element); }
    };
  };
  globalThis.PageImageCollectorPreview = { candidateUrls, createLoader };
})();
