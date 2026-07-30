import {
  buildZipBlob,
  formatFromUrl,
  inspectImagePayload,
  mimeFromFormat,
  normalizeZipPartOptions,
  resolveImagePayloadExtension,
  shouldConvertImageToJpg
} from "../shared/zipCore.js";

const MSG = {
  OFFSCREEN_ZIP_START: "OFFSCREEN_ZIP_START",
  OFFSCREEN_ZIP_PROGRESS: "OFFSCREEN_ZIP_PROGRESS",
  OFFSCREEN_ZIP_PART_READY: "OFFSCREEN_ZIP_PART_READY",
  OFFSCREEN_ZIP_PART_DONE: "OFFSCREEN_ZIP_PART_DONE",
  OFFSCREEN_ZIP_DONE: "OFFSCREEN_ZIP_DONE",
  OFFSCREEN_ZIP_STATUS: "OFFSCREEN_ZIP_STATUS"
};

const JPG_CONVERT_QUALITY = 1.0;
const ZIP_PART_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const activeTasks = new Map();
const partWaiters = new Map();

const safeFilenamePart = (text) =>
  String(text || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);

const baseFilename = (image, index = 0) => {
  const idPart = safeFilenamePart(image?.id || `img_${Date.now()}`);
  return index > 0 ? `${idPart}_${index}` : idPart;
};

const buildBatchZipPartFilename = (baseZipFilename, partIndex, totalParts) => {
  if (!Number.isInteger(totalParts) || totalParts <= 1) return baseZipFilename;
  const base = String(baseZipFilename || "images.zip");
  const withoutExt = base.replace(/\.zip$/i, "");
  const current = String(partIndex + 1).padStart(3, "0");
  return `${withoutExt}.part${current}.zip`;
};

const ensureUniqueArchiveFilename = (filename, usedNames) => {
  const safe = safeFilenamePart(filename || "image") || "image";
  const match = safe.match(/^(.*?)(\.[a-z0-9]{1,8})$/i);
  const base = match ? match[1] : safe;
  const ext = match ? match[2] : "";
  if (!usedNames.has(safe)) {
    usedNames.add(safe);
    return safe;
  }
  let counter = 2;
  while (counter < 100000) {
    const candidate = `${base}_${counter}${ext}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    counter += 1;
  }
  const fallback = `${base}_${Date.now()}${ext}`;
  usedNames.add(fallback);
  return fallback;
};

const getDownloadCandidates = (image, preferHD = true) => {
  const first = preferHD ? image?.hdSrc || image?.src : image?.src || image?.hdSrc;
  const second = preferHD ? image?.src : image?.hdSrc;
  const base = [first, second, image?.originalSrc].filter(Boolean);
  const expanded = [];
  for (const url of base) {
    expanded.push(url);
    if (/\.webp(?:\?|$)/i.test(url)) {
      const jpgAlt = url.replace(/\.webp(?=\?|$)/i, ".jpg");
      if (jpgAlt !== url) expanded.push(jpgAlt);
    }
  }
  return [...new Set(expanded)];
};

const fetchBlob = async (url, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const baseOptions = {
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow"
    };

    const tryFetch = async (extraOptions = {}) => {
      const response = await fetch(url, { ...baseOptions, ...extraOptions });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.blob();
    };

    const isSinaImage = (() => {
      try {
        const parsed = new URL(url);
        return /\.sinaimg\.cn$/i.test(parsed.hostname);
      } catch (_error) {
        return false;
      }
    })();

    try {
      return await tryFetch();
    } catch (error) {
      if (!isSinaImage) throw error;
      return await tryFetch({
        referrer: "https://weibo.com/",
        referrerPolicy: "strict-origin-when-cross-origin"
      });
    }
  } finally {
    clearTimeout(timer);
  }
};

const convertBlobToJpg = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: JPG_CONVERT_QUALITY });
  } finally {
    bitmap.close();
  }
};

const sendProgress = async (tabId, taskId, patch = {}) => {
  await chrome.runtime.sendMessage({
    type: MSG.OFFSCREEN_ZIP_PROGRESS,
    payload: { tabId, taskId, patch }
  }).catch(() => {});
};

const createPartDoneWaiter = (partId, timeoutMs = ZIP_PART_DOWNLOAD_TIMEOUT_MS) => {
  let timer = null;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => {
      partWaiters.delete(partId);
      resolve({
        success: false,
        error: "ZIP part download timeout"
      });
    }, Math.max(1000, Number(timeoutMs) || ZIP_PART_DOWNLOAD_TIMEOUT_MS));

    partWaiters.set(partId, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

  return {
    promise,
    cancel() {
      clearTimeout(timer);
      partWaiters.delete(partId);
    }
  };
};

const buildZipEntryFromImage = async (image, options = {}) => {
  const { convertToJpg = false, index = 0, preferHD = true } = options;
  const candidates = getDownloadCandidates(image, preferHD);
  if (candidates.length === 0) {
    return { success: false, error: "No image URL available", fallbackUsed: false };
  }

  let lastError = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const url = candidates[i];
    try {
      let blob = await fetchBlob(url);
      let filename = "";
      let converted = false;

      const type = String(blob.type || "").toLowerCase() || mimeFromFormat(formatFromUrl(url)).toLowerCase();
      const originalBytes = new Uint8Array(await blob.arrayBuffer());
      const inspection = inspectImagePayload({ bytes: originalBytes, mimeType: type, url });
      if (!inspection.ok) {
        lastError = new Error(inspection.reason || "Non-image response");
        continue;
      }

      if (convertToJpg && shouldConvertImageToJpg({ inspection, mimeType: type, url })) {
        try {
          blob = await convertBlobToJpg(blob);
          filename = `${baseFilename(image, index)}.jpg`;
          converted = true;
        } catch (_convertError) {
          const ext = resolveImagePayloadExtension({
            inspection,
            mimeType: blob.type,
            url
          });
          filename = `${baseFilename(image, index)}.${ext}`;
        }
      } else {
        const ext = resolveImagePayloadExtension({
          inspection,
          mimeType: blob.type,
          url
        });
        filename = `${baseFilename(image, index)}.${ext}`;
      }

      const bytes = converted ? new Uint8Array(await blob.arrayBuffer()) : originalBytes;
      if (bytes.length === 0) {
        lastError = new Error("Empty image data");
        continue;
      }

      return {
        success: true,
        filename,
        bytes,
        converted,
        fallbackUsed: i > 0
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    success: false,
    error: lastError?.message || "Download failed",
    fallbackUsed: false
  };
};

const requestPartDownload = async (task, entries, expectMoreParts = false) => {
  if (!entries.length) return { success: true };

  const partIndex = task.downloadedParts;
  const partCount = expectMoreParts ? task.downloadedParts + 2 : task.downloadedParts + 1;
  const partId = `${task.taskId}_part_${partIndex + 1}`;
  const filename = buildBatchZipPartFilename(task.baseZipFilename, partIndex, partCount);

  await sendProgress(task.tabId, task.taskId, {
    active: true,
    mode: "zip",
    phase: "zip_part_build",
    partIndex: partIndex + 1,
    partCount,
    current: task.processed,
    total: task.total
  });

  const zipBlob = buildZipBlob(entries);
  if (!zipBlob || Number(zipBlob.size) <= 0) {
    return { success: false, error: `ZIP第 ${partIndex + 1} 卷构建失败: Empty zip blob` };
  }

  const objectUrl = URL.createObjectURL(zipBlob);
  try {
    const doneWaiter = createPartDoneWaiter(partId);
    const started = await chrome.runtime.sendMessage({
      type: MSG.OFFSCREEN_ZIP_PART_READY,
      payload: {
        taskId: task.taskId,
        tabId: task.tabId,
        partId,
        partIndex: partIndex + 1,
        partCount,
        objectUrl,
        filename,
        size: zipBlob.size
      }
    });

    if (!started?.success) {
      doneWaiter.cancel();
      return { success: false, error: started?.error || `ZIP第 ${partIndex + 1} 卷下载失败` };
    }

    const done = await doneWaiter.promise;
    if (!done?.success) {
      return { success: false, error: done?.error || `ZIP第 ${partIndex + 1} 卷下载失败` };
    }

    task.zipFileNames.push(filename);
    task.downloadedParts += 1;
    return { success: true };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const runZipTask = async (payload = {}) => {
  const taskId = String(payload.taskId || "");
  const tabId = Number(payload.tabId);
  const images = Array.isArray(payload.images) ? payload.images : [];
  const options = payload.options || {};
  const task = {
    taskId,
    tabId,
    baseZipFilename: String(options.baseZipFilename || "images.zip"),
    total: images.length,
    processed: 0,
    downloadedParts: 0,
    packedCount: 0,
    zipFileNames: []
  };
  const results = [];
  const usedNames = new Set();
  const currentPartEntries = [];
  let currentPartBytes = 0;

  activeTasks.set(taskId, task);

  const fail = async (error) => {
    const result = {
      success: false,
      error: error?.message || String(error || "ZIP 任务失败"),
      zipped: true,
      total: task.total,
      zipFileNames: task.zipFileNames,
      zipPartCount: task.zipFileNames.length + (currentPartEntries.length > 0 ? 1 : 0),
      downloadedPartCount: task.downloadedParts,
      packed: task.packedCount,
      failed: task.total - task.packedCount,
      results
    };
    await chrome.runtime.sendMessage({
      type: MSG.OFFSCREEN_ZIP_DONE,
      payload: { taskId, tabId, result }
    }).catch(() => {});
  };

  try {
    const zipPartOptions = normalizeZipPartOptions(options);
    const maxBytes = zipPartOptions.zipPartMaxBytes;
    const maxFiles = zipPartOptions.zipPartMaxFiles;

    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      const entryResult = await buildZipEntryFromImage(image, {
        convertToJpg: options.convertToJpg === true,
        preferHD: options.preferHD !== false,
        index: i + 1
      });

      task.processed = i + 1;

      if (entryResult.success) {
        const uniqueName = ensureUniqueArchiveFilename(entryResult.filename, usedNames);
        const entryBytes = Number(entryResult.bytes?.length) || 0;
        const willOverflowByFiles = currentPartEntries.length >= maxFiles;
        const willOverflowByBytes =
          currentPartEntries.length > 0 &&
          currentPartBytes + entryBytes > maxBytes;

        if (willOverflowByFiles || willOverflowByBytes) {
          const entriesToFlush = currentPartEntries.splice(0, currentPartEntries.length);
          currentPartBytes = 0;
          const flushResult = await requestPartDownload(task, entriesToFlush, true);
          if (!flushResult.success) {
            throw new Error(flushResult.error || "ZIP 分卷下载失败");
          }
        }

        currentPartEntries.push({
          filename: uniqueName,
          bytes: entryResult.bytes,
          date: new Date()
        });
        currentPartBytes += entryBytes;
        task.packedCount += 1;
        results.push({
          imageId: image.id,
          success: true,
          converted: entryResult.converted,
          fallbackUsed: entryResult.fallbackUsed
        });
      } else {
        results.push({
          imageId: image.id,
          success: false,
          error: entryResult.error || "Download failed",
          fallbackUsed: entryResult.fallbackUsed === true
        });
      }

      await sendProgress(tabId, taskId, {
        active: true,
        mode: "zip",
        current: i + 1,
        total: images.length,
        phase: "zip",
        partIndex: task.downloadedParts + 1,
        result: {
          success: entryResult.success === true,
          converted: entryResult.converted === true,
          fallbackUsed: entryResult.fallbackUsed === true,
          filename: entryResult.filename || "",
          error: entryResult.error ? String(entryResult.error).slice(0, 200) : ""
        }
      });
    }

    if (task.packedCount === 0) {
      throw new Error("未能获取可打包的图片");
    }

    const finalFlush = await requestPartDownload(task, currentPartEntries.splice(0, currentPartEntries.length), false);
    if (!finalFlush.success) {
      throw new Error(finalFlush.error || "ZIP 最终分卷下载失败");
    }

    await chrome.runtime.sendMessage({
      type: MSG.OFFSCREEN_ZIP_DONE,
      payload: {
        taskId,
        tabId,
        result: {
          success: true,
          zipped: true,
          total: images.length,
          zipFileName: task.zipFileNames[0] || task.baseZipFilename,
          zipFileNames: task.zipFileNames,
          zipPartCount: task.zipFileNames.length,
          splitZip: task.zipFileNames.length > 1,
          downloadedPartCount: task.downloadedParts,
          packed: task.packedCount,
          failed: images.length - task.packedCount,
          results
        }
      }
    }).catch(() => {});
  } catch (error) {
    await fail(error);
  } finally {
    activeTasks.delete(taskId);
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const payload = message?.payload || {};

  if (message?.type === MSG.OFFSCREEN_ZIP_STATUS) {
    const taskId = String(payload.taskId || "");
    const task = activeTasks.get(taskId);
    sendResponse({
      success: true,
      active: Boolean(task),
      taskId,
      tabId: Number(task?.tabId),
      processed: Number(task?.processed) || 0,
      total: Number(task?.total) || 0
    });
    return false;
  }

  if (message?.type === MSG.OFFSCREEN_ZIP_PART_DONE) {
    const partId = String(payload.partId || "");
    const resolve = partWaiters.get(partId);
    if (resolve) {
      partWaiters.delete(partId);
      resolve(payload);
    }
    sendResponse({ success: true });
    return false;
  }

  if (message?.type !== MSG.OFFSCREEN_ZIP_START) {
    return false;
  }

  const taskId = String(payload.taskId || "");
  if (!taskId) {
    sendResponse({ success: false, error: "Missing ZIP task id" });
    return false;
  }
  if (activeTasks.has(taskId)) {
    sendResponse({ success: false, error: "ZIP task already running" });
    return false;
  }

  runZipTask(payload).catch(() => {});
  sendResponse({ success: true, taskId });
  return false;
});
