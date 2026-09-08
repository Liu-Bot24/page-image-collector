const STORAGE_KEY = "pic_collector_direct_download_jobs_v1";
const COMPLETED_TTL_MS = 15000;

const networkUrl = (value) => {
  if (typeof value !== 'string') return '';
  try { return /^https?:$/.test(new URL(value).protocol) ? value : ''; } catch { return ''; }
};
const recoveryImage = (image = {}) => ({
  id: String(image.id || ''),
  collectionId: image.collectionId,
  src: networkUrl(image.src),
  hdSrc: networkUrl(image.hdSrc),
  originalSrc: networkUrl(image.originalSrc),
  sourceUrl: networkUrl(image.sourceUrl),
  candidateUrls: [...new Set((image.candidateUrls || []).map(networkUrl).filter(Boolean))]
});
const recoveryPending = (pending) => pending ? {
  itemIndex: pending.itemIndex,
  imageId: pending.imageId,
  downloadId: pending.downloadId,
  candidateIndex: pending.candidateIndex,
  remainingCandidateUrls: Array.isArray(pending.remainingCandidateUrls)
    ? pending.remainingCandidateUrls.map(networkUrl).filter(Boolean) : undefined,
  fallbackUsed: pending.fallbackUsed === true,
  candidateUrl: networkUrl(pending.candidateUrl) || networkUrl(pending.url),
  url: networkUrl(pending.url) || networkUrl(pending.candidateUrl),
  transport: /^(data|blob):/i.exec(pending.url || '')?.[1].toLowerCase() || pending.transport || 'http',
  filename: pending.filename,
  converted: pending.converted === true,
  startedAt: pending.startedAt
} : null;
const recoveryResult = (result, fallbackUrl = '') => result ? {
  imageId: result.imageId,
  success: result.success === true,
  downloadId: result.downloadId,
  url: networkUrl(result.url) || networkUrl(fallbackUrl),
  state: result.state,
  converted: result.converted === true,
  fallbackUsed: result.fallbackUsed === true,
  cancelled: result.cancelled === true,
  retryable: result.retryable,
  error: String(result.error || '').replace(/data:[^\s]+/gi, '[inline image]').slice(0, 2048)
} : null;
const recoveryJob = (job) => ({
  tabId: job.tabId, taskId: job.taskId, done: job.done === true,
  completedAt: job.completedAt, pending: recoveryPending(job.pending),
  options: { convertToJpg: job.options?.convertToJpg === true, preferHD: job.options?.preferHD !== false, downloadTimeoutMs: job.options?.downloadTimeoutMs },
  items: job.items.map(item => ({ image: job.done ? { id: item.image.id } : recoveryImage(item.image), result: recoveryResult(item.result, item.image.src) }))
});

// Persist the browser download handle before awaiting its terminal state. Recovery
// observes that handle and never re-enqueues an item whose outcome is unknown.
export const createDirectDownloadJobManager = ({
  storage,
  downloadImage,
  getDownloadState,
  waitForTerminal,
  cancelDownload,
  onStatus = () => {},
  onImageResult = () => {},
  createTaskId = () => `direct_${Date.now()}_${Math.random().toString(36).slice(2)}`,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) => {
  const jobs = new Map();
  const running = new Map();
  let loadTask = null;
  let persistTail = Promise.resolve();
  let cleanupTimer = null;
  let cleanupPending = false;

  const ensureLoaded = async () => {
    if (!loadTask) {
      loadTask = storage.get(STORAGE_KEY).then(async (stored) => {
        let migrated = false;
        for (const [key, job] of Object.entries(stored?.[STORAGE_KEY] || {})) {
          const tabId = Number(key);
          if (Number.isInteger(tabId) && job && Array.isArray(job.items) && !jobs.has(tabId)) {
            if (job.done && now() - (Number(job.completedAt) || 0) >= COMPLETED_TTL_MS) { migrated = true; continue; }
            const sanitized = recoveryJob(job);
            migrated ||= JSON.stringify(sanitized) !== JSON.stringify(job);
            jobs.set(tabId, sanitized);
          }
        }
        if (migrated) await persist();
        scheduleCleanup();
      });
    }
    try { await loadTask; } catch (error) { loadTask = null; throw error; }
  };

  const persist = () => {
    // The running job may temporarily hold source bytes; its recovery snapshot
    // contains only metadata. In particular, never serialize a transport URL.
    const task = persistTail.then(() => storage.set({ [STORAGE_KEY]: Object.fromEntries([...jobs].map(([tabId, job]) => [tabId, recoveryJob(job)])) }));
    persistTail = task.catch(() => {});
    return task;
  };

  const cleanupExpired = async () => {
    for (const [tabId, job] of jobs) {
      if (job.done && !running.has(tabId) && now() - (Number(job.completedAt) || 0) >= COMPLETED_TTL_MS) {
        jobs.delete(tabId);
        cleanupPending = true;
      }
    }
    if (cleanupPending) { await persist(); cleanupPending = false; }
  };
  const scheduleCleanup = () => {
    if (cleanupTimer !== null) clearTimer(cleanupTimer);
    cleanupTimer = null;
    const expirations = [...jobs.values()].filter(job => job.done).map(job => (Number(job.completedAt) || 0) + COMPLETED_TTL_MS);
    if (!expirations.length && !cleanupPending) return;
    const delay = cleanupPending ? 30000 : Math.max(1, Math.min(...expirations) - now());
    cleanupTimer = setTimer(async () => {
      cleanupTimer = null;
      try { await cleanupExpired(); } catch (error) {
        console.warn('[图片采集查看器] Failed to remove expired download records:', error);
      } finally { scheduleCleanup(); }
    }, delay);
    cleanupTimer?.unref?.();
  };

  const summary = (job) => {
    const results = job.items.map((item) => item.result).filter(Boolean);
    const succeeded = results.filter((result) => result.success).length;
    const failed = results.length - succeeded;
    return {
      active: !job.done,
      mode: "direct",
      phase: job.done ? failed ? "completed_with_errors" : "completed" : job.pending ? "direct" : "direct_prepare",
      taskId: job.taskId,
      current: job.done ? succeeded : results.length,
      total: job.items.length,
      succeeded,
      failed,
      cancelled: results.filter((result) => result.cancelled).length,
      downloadId: job.pending?.downloadId || null,
      error: ""
    };
  };

  const resultForTerminal = (pending, terminal) => ({
    success: terminal.state === "complete",
    downloadId: pending.downloadId,
    url: pending.url,
    converted: pending.converted === true,
    fallbackUsed: pending.fallbackUsed === true || Number(pending.candidateIndex) > 0,
    cancelled: terminal.error === "USER_CANCELED",
    error: terminal.state === "complete" ? "" : terminal.error || `Download ${terminal.state}`
  });

  const run = (job) => {
    if (running.has(job.tabId)) return running.get(job.tabId);
    const task = Promise.resolve().then(async () => {
      // A concurrent status request may enter recovery while start is still saving.
      await persist();
      onStatus(job.tabId, summary(job));
      for (let index = 0; index < job.items.length; index += 1) {
        const item = job.items[index];
        if (item.result) continue;
        let result = null;
        let startCandidateIndex = 0;
        let recoveryOptions = {};
        const pending = job.pending?.itemIndex === index ? job.pending : null;
        if (pending) {
          if (!Number.isInteger(pending.downloadId)) {
            result = { success: false, error: "无法确认上次下载是否创建，请检查浏览器下载记录", fallbackUsed: false };
          } else {
            const current = getDownloadState ? await getDownloadState(pending.downloadId) : null;
            let terminal = current && current.state !== "in_progress"
              ? current
              : await waitForTerminal(pending.downloadId, job.options.downloadTimeoutMs, pending, item.image.sourceUrl);
            if (terminal.state === "timeout") {
              try { await cancelDownload(pending.downloadId); }
              catch (_error) {
                const afterCancel = getDownloadState ? await getDownloadState(pending.downloadId) : null;
                if (afterCancel?.state === "complete" || afterCancel?.state === "interrupted") terminal = afterCancel;
                else result = { success: false, error: "无法停止超时下载，请检查浏览器下载记录", fallbackUsed: false };
              }
            }
            if (!result) {
              if (terminal.state === "complete" || terminal.error === "USER_CANCELED") {
                result = resultForTerminal(pending, terminal);
              } else if (terminal.state === "interrupted" || terminal.state === "timeout") {
                // The previous candidate is terminal; it is now safe to try another.
                startCandidateIndex = (Number(pending.candidateIndex) || 0) + 1;
                // Binary candidates are omitted from the stored image. The old
                // numeric cursor no longer describes the reconstructed list.
                recoveryOptions = { recoveryFallback: true, resumeAfterUrl: pending.candidateUrl || pending.url || '' };
                if (Array.isArray(pending.remainingCandidateUrls)) {
                  recoveryOptions.remainingCandidateUrls = pending.remainingCandidateUrls;
                  startCandidateIndex = 0;
                }
              } else {
                result = { success: false, error: "无法确认上次下载状态，请检查浏览器下载记录", fallbackUsed: false };
              }
            }
          }
        }

        if (!result) {
          result = await downloadImage(item.image, {
            ...job.options,
            ...recoveryOptions,
            awaitCompletion: true,
            index: index + 1,
            startCandidateIndex,
            onStarting: async (record) => {
              job.pending = recoveryPending({ ...record, itemIndex: index, imageId: item.image.id });
              await persist();
            },
            onQueued: async (record) => {
              job.pending = recoveryPending({ ...job.pending, ...record, itemIndex: index, imageId: item.image.id });
              await persist();
              onStatus(job.tabId, summary(job));
            }
          });
        }
        item.result = recoveryResult({ imageId: item.image.id, ...result }, job.pending?.candidateUrl || item.image.src);
        job.pending = null;
        await persist();
        onImageResult(job.tabId, item.image, result);
        onStatus(job.tabId, summary(job));
      }
      job.done = true;
      job.completedAt = now();
      // Finished jobs need only their result records, not large image URL payloads.
      job.items = job.items.map((item) => ({ image: { id: item.image.id }, result: item.result }));
      await persist();
      const status = summary(job);
      onStatus(job.tabId, status);
      return { success: true, zipped: false, results: job.items.map((item) => item.result), ...status };
    }).catch((error) => {
      onStatus(job.tabId, { ...summary(job), active: false, phase: "failed", error: error?.message || String(error) });
      throw error;
    }).finally(() => { running.delete(job.tabId); scheduleCleanup(); });
    running.set(job.tabId, task);
    return task;
  };

  const start = async (tabId, images, options = {}) => {
    await ensureLoaded();
    await cleanupExpired();
    if (running.has(tabId) || jobs.get(tabId)?.done === false) throw new Error("当前已有批量下载任务进行中，请稍后再试");
    const job = {
      tabId, taskId: createTaskId(), done: false, pending: null,
      options: {
        convertToJpg: options.convertToJpg === true,
        preferHD: options.preferHD !== false,
        downloadTimeoutMs: options.downloadTimeoutMs
      },
      items: images.map((image) => ({ image, result: null }))
    };
    jobs.set(tabId, job);
    return await run(job);
  };

  const getStatus = async (tabId) => {
    await ensureLoaded();
    await cleanupExpired();
    const job = jobs.get(tabId);
    return job ? summary(job) : null;
  };

  const resume = async (tabId) => {
    await ensureLoaded();
    const job = jobs.get(tabId);
    if (!job || job.done) return null;
    return await run(job);
  };

  const resumeAll = async () => {
    await ensureLoaded();
    return await Promise.allSettled([...jobs.values()].filter((job) => !job.done && !running.has(job.tabId)).map(run));
  };

  return { start, getStatus, resume, resumeAll };
};
