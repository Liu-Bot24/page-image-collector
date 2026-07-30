export const createComicPaginationJobManager = (options = {}) => {
  const closeTab = typeof options.closeTab === "function"
    ? options.closeTab
    : async () => {};
  const activeJobs = new Map();
  let sequence = 0;

  const closeTemporaryTab = (job) => {
    if (!job) return Promise.resolve();
    const temporaryTabId = job.temporaryTabId;
    job.temporaryTabId = null;
    if (!Number.isInteger(temporaryTabId)) return Promise.resolve();
    if (!job.closeTask) {
      job.closeTask = Promise.resolve(closeTab(temporaryTabId)).catch(() => {});
    }
    return job.closeTask;
  };

  const cancelJob = (job) => {
    if (!job) return Promise.resolve(false);
    if (!job.cancelled) {
      job.cancelled = true;
      job.resolveCancellation();
    }
    return closeTemporaryTab(job).then(() => true);
  };

  const start = (sourceTabId, ownerToken = "", requesterTabId = null) => {
    if (!Number.isInteger(sourceTabId)) {
      throw new Error("Invalid comic pagination source tab");
    }

    const previous = activeJobs.get(sourceTabId);
    if (previous) {
      activeJobs.delete(sourceTabId);
    }
    const previousCloseTask = cancelJob(previous);

    let resolveCancellation;
    const cancellation = new Promise((resolve) => {
      resolveCancellation = resolve;
    });
    sequence += 1;
    const job = {
      id: sequence,
      sourceTabId,
      ownerToken: String(ownerToken || ""),
      requesterTabId: Number.isInteger(requesterTabId) ? requesterTabId : null,
      cancelled: false,
      cancellation,
      resolveCancellation,
      temporaryTabId: null,
      closeTask: null,
      ready: previousCloseTask
    };
    activeJobs.set(sourceTabId, job);
    return job;
  };

  const isCurrent = (sourceTabId, job) =>
    activeJobs.get(sourceTabId) === job && job?.cancelled !== true;

  const attachTemporaryTab = (sourceTabId, job, temporaryTabId) => {
    if (!isCurrent(sourceTabId, job) || !Number.isInteger(temporaryTabId)) {
      return false;
    }
    job.temporaryTabId = temporaryTabId;
    job.closeTask = null;
    return true;
  };

  const releaseTemporaryTab = (job, temporaryTabId) => {
    if (!job || job.temporaryTabId !== temporaryTabId) return false;
    job.temporaryTabId = null;
    job.closeTask = null;
    return true;
  };

  const cancel = (sourceTabId, ownerToken = "") => {
    const job = activeJobs.get(sourceTabId);
    if (!job) return Promise.resolve(false);
    const normalizedOwnerToken = String(ownerToken || "");
    if (normalizedOwnerToken && job.ownerToken !== normalizedOwnerToken) {
      return Promise.resolve(false);
    }
    activeJobs.delete(sourceTabId);
    return cancelJob(job);
  };

  const finish = (sourceTabId, job) => {
    if (activeJobs.get(sourceTabId) !== job) return false;
    activeJobs.delete(sourceTabId);
    return true;
  };

  const cancelByRequesterTab = async (requesterTabId) => {
    if (!Number.isInteger(requesterTabId)) return 0;
    const cancellations = [];
    for (const [sourceTabId, job] of activeJobs.entries()) {
      if (job.requesterTabId !== requesterTabId) continue;
      activeJobs.delete(sourceTabId);
      cancellations.push(cancelJob(job));
    }
    await Promise.all(cancellations);
    return cancellations.length;
  };

  return {
    start,
    isCurrent,
    attachTemporaryTab,
    releaseTemporaryTab,
    cancel,
    cancelByRequesterTab,
    finish
  };
};
