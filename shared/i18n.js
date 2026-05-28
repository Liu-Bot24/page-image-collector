(function () {
  "use strict";

  const STORAGE_KEY = "pageImageCollector.language";
  const SUPPORTED_LANGUAGES = new Set(["zh", "en"]);

  const MESSAGES = {
    zh: {
      "app.title": "图片采集查看器",
      "app.description": "一款基于 Chrome Manifest V3 的生产力级网页视觉资产采集器",
      "popup.documentTitle": "图片采集查看器",
      "workspace.documentTitle": "图片采集查看器 - WORKSPACE",
      "workspace.logo": "图片采集查看器 · WORKSPACE",
      "workspace.open": "打开WORKSPACE",
      "popup.scanStart": "开始扫描",
      "popup.scanContinue": "继续扫描",
      "common.scanning": "采集中...",
      "common.scanComplete": "采集完成",
      "common.refreshFailed": "刷新失败，请重试",
      "common.clearResults": "清理当前采集结果",
      "common.enterComic": "进入漫画模式",
      "common.prev": "上一张",
      "common.next": "下一张",
      "common.download": "下载",
      "common.copy": "复制",
      "common.source": "图片来源",
      "common.close": "关闭",
      "common.all": "全部",
      "common.any": "不限",
      "common.selectAll": "全选",
      "common.selectAllSpaced": "全 选",
      "common.unselectAll": "取消全选",
      "common.copyLinks": "批量复制链接",
      "common.downloadBatch": "批量下载",
      "common.openFolder": "打开下载目录",
      "common.openedFolder": "已打开下载目录",
      "common.noSource": "未记录图片来源",
      "common.unknownError": "未知错误",
      "common.loading": "加载中...",
      "stats.total": "总图片",
      "stats.filtered": "已筛选",
      "stats.selected": "已选中",
      "toggle.autoCollect": "自动采集",
      "toggle.enableAutoScroll": "开启自动滚动",
      "toggle.disableAutoScroll": "关闭自动滚动",
      "toggle.rightClick": "解锁右键",
      "toggle.originals": "采集原图",
      "toggle.largestFirst": "大到小排序",
      "toggle.portraitOnly": "仅显示竖图",
      "toggle.saveAsJpg": "下载转JPG",
      "toggle.zipBatch": "批量下载ZIP",
      "filter.loading": "格式统计中...",
      "filter.other": "其他",
      "filter.hidden": "隐藏",
      "filter.shortSide": "最小短边",
      "filter.longSide": "最小长边",
      "filter.pixels": "最小像素",
      "popup.emptyHint": "点击「开始扫描」获取本页图片",
      "workspace.layout": "布局",
      "workspace.grid": "网格",
      "workspace.waterfall": "瀑布流",
      "workspace.zoom": "缩放",
      "workspace.zipParts": "ZIP分卷",
      "workspace.zipPartsTitle": "控制每个 ZIP 分卷的最大体积和图片数量",
      "workspace.zipStable": "稳定 96MB/200张",
      "workspace.zipBalanced": "默认 192MB/300张",
      "workspace.zipLarge": "大包 384MB/500张",
      "workspace.zipXLarge": "超大 768MB/800张",
      "workspace.scanStart": "开始扫描",
      "workspace.scanContinue": "继续扫描",
      "workspace.hide": "隐藏",
      "workspace.show": "显示",
      "workspace.comicExperimental": "漫画模式（实验性）",
      "workspace.comicActive": "当前处于漫画模式（实验性）",
      "workspace.comicDescription": "图片结果会按原网页中的阅读顺序排列。",
      "workspace.comicNeedScrollPrefix": "注意，如果原网页未完全加载，请",
      "workspace.comicNeedScrollLink": "将原网页滚动到页面底部",
      "workspace.comicNeedScrollSuffix": "后再返回本页面。",
      "workspace.comicPaginationText": "检测到原页面可向后翻页，支持获取后续分页图片。",
      "workspace.comicLoadPages": "立即向后加载",
      "workspace.comicPagesSuffix": "页，",
      "workspace.comicWait": "每页最长等待加载",
      "workspace.comicSeconds": "秒",
      "workspace.comicStartPagination": "开始分页查看",
      "workspace.comicMode": "漫画模式",
      "workspace.emptyTitle": "暂无图片",
      "workspace.emptyHint": "点击「扫描」按钮获取本页图片",
      "workspace.preview": "预览图",
      "workspace.viewOriginal": "查看大图",
      "workspace.viewOneToOne": "1:1查看",
      "workspace.fullscreen": "全屏看图",
      "workspace.closeFullscreen": "关闭全屏",
      "status.zipPreparing": "正在打包 ZIP，请稍候…",
      "status.zipPreparingShort": "准备打包",
      "status.zipWorking": "打包中",
      "status.directPreparing": "正在准备批量下载…",
      "status.directPreparingShort": "准备下载",
      "status.downloading": "下载中…",
      "status.downloadingShort": "下载中",
      "status.zipDone": "打包下载完毕",
      "status.batchDone": "批量下载完毕",
      "status.autoCollectOn": "已开启自动采集",
      "status.autoCollectOff": "已关闭自动采集",
      "status.autoCollectOffComic": "已关闭自动采集，漫画模式仍会在后台继续采集",
      "status.autoScrollOn": "已开启自动滚动",
      "status.autoScrollOff": "已关闭自动滚动",
      "status.rightClickOn": "已启用解锁右键",
      "status.rightClickOff": "已关闭解锁右键",
      "status.zipBatchOn": "已开启批量ZIP下载",
      "status.zipBatchOff": "已关闭批量ZIP下载",
      "status.scanCompleteAutoFailed": "采集完成，但自动采集启动失败",
      "status.cleared": "已清理采集结果",
      "status.queued": "已加入下载队列",
      "status.copyFailed": "复制失败",
      "status.copiedImage": "已复制图片",
      "status.copiedLink": "已复制链接",
      "status.openedSource": "已打开图片来源",
      "status.autoScrollStopped": "当前页面已无新增内容，自动滚动已停止",
      "status.comicNoSourceTab": "未绑定原网页，无法开启漫画模式",
      "status.comicOn": "已开启漫画模式（实验性）",
      "status.comicOff": "已关闭漫画模式",
      "status.comicLoadingPages": "正在获取后续分页图片，请稍候…",
      "status.zipPartsUpdated": "已更新ZIP分卷设置",
      "status.workspaceNoSourceTab": "未绑定原网页标签页，请从原网页重新打开 Workspace",
      "status.comicStartFailed": "漫画模式启动失败"
    },
    en: {
      "app.title": "Page Image Collector",
      "app.description": "A productivity-focused Chrome Manifest V3 extension for collecting visual assets from web pages",
      "popup.documentTitle": "Page Image Collector",
      "workspace.documentTitle": "Page Image Collector - Workspace",
      "workspace.logo": "Page Image Collector · Workspace",
      "workspace.open": "Open Workspace",
      "popup.scanStart": "Start Scan",
      "popup.scanContinue": "Scan More",
      "common.scanning": "Scanning...",
      "common.scanComplete": "Scan complete",
      "common.refreshFailed": "Refresh failed, try again",
      "common.clearResults": "Clear collected images",
      "common.enterComic": "Enter comic mode",
      "common.prev": "Previous image",
      "common.next": "Next image",
      "common.download": "Download",
      "common.copy": "Copy",
      "common.source": "Image Source",
      "common.close": "Close",
      "common.all": "All",
      "common.any": "Any",
      "common.selectAll": "Select All",
      "common.selectAllSpaced": "Select All",
      "common.unselectAll": "Deselect",
      "common.copyLinks": "Copy Links",
      "common.downloadBatch": "Batch Download",
      "common.openFolder": "Open Folder",
      "common.openedFolder": "Opened folder",
      "common.noSource": "No image source recorded",
      "common.unknownError": "Unknown error",
      "common.loading": "Loading...",
      "stats.total": "Images",
      "stats.filtered": "Filtered",
      "stats.selected": "Selected",
      "toggle.autoCollect": "Auto collect",
      "toggle.enableAutoScroll": "Start auto scroll",
      "toggle.disableAutoScroll": "Stop auto scroll",
      "toggle.rightClick": "Unlock right-click",
      "toggle.originals": "Originals",
      "toggle.largestFirst": "Largest first",
      "toggle.portraitOnly": "Portrait only",
      "toggle.saveAsJpg": "Save as JPG",
      "toggle.zipBatch": "ZIP batch",
      "filter.loading": "Counting formats...",
      "filter.other": "Other",
      "filter.hidden": "Hidden",
      "filter.shortSide": "Short side",
      "filter.longSide": "Long side",
      "filter.pixels": "Pixels",
      "popup.emptyHint": "Click Start Scan to collect images on this page",
      "workspace.layout": "Layout",
      "workspace.grid": "Grid",
      "workspace.waterfall": "Waterfall",
      "workspace.zoom": "Zoom",
      "workspace.zipParts": "ZIP parts",
      "workspace.zipPartsTitle": "Controls the max size and image count for each ZIP part",
      "workspace.zipStable": "Stable 96MB/200 images",
      "workspace.zipBalanced": "Default 192MB/300 images",
      "workspace.zipLarge": "Large 384MB/500 images",
      "workspace.zipXLarge": "XL 768MB/800 images",
      "workspace.scanStart": "Start Scan",
      "workspace.scanContinue": "Scan More",
      "workspace.hide": "Hide",
      "workspace.show": "Show",
      "workspace.comicExperimental": "Comic mode (experimental)",
      "workspace.comicActive": "Comic mode active (experimental)",
      "workspace.comicDescription": "Images are ordered by their reading order in the original page.",
      "workspace.comicNeedScrollPrefix": "If the source page has not fully loaded,",
      "workspace.comicNeedScrollLink": "scroll the source page to the bottom",
      "workspace.comicNeedScrollSuffix": "and then return here.",
      "workspace.comicPaginationText": "More pages were detected; later page images can be collected.",
      "workspace.comicLoadPages": "Load next",
      "workspace.comicPagesSuffix": "pages,",
      "workspace.comicWait": "wait up to",
      "workspace.comicSeconds": "sec per page",
      "workspace.comicStartPagination": "Start pagination",
      "workspace.comicMode": "Comic mode",
      "workspace.emptyTitle": "No Images",
      "workspace.emptyHint": "Click Scan to collect images on this page",
      "workspace.preview": "Preview",
      "workspace.viewOriginal": "View Original",
      "workspace.viewOneToOne": "1:1 View",
      "workspace.fullscreen": "Fullscreen",
      "workspace.closeFullscreen": "Close fullscreen",
      "status.zipPreparing": "Preparing ZIP...",
      "status.zipPreparingShort": "Preparing ZIP",
      "status.zipWorking": "Zipping",
      "status.directPreparing": "Preparing downloads...",
      "status.directPreparingShort": "Preparing",
      "status.downloading": "Downloading...",
      "status.downloadingShort": "Downloading",
      "status.zipDone": "ZIP download complete",
      "status.batchDone": "Batch download complete",
      "status.autoCollectOn": "Auto collect on",
      "status.autoCollectOff": "Auto collect off",
      "status.autoCollectOffComic": "Auto collect off; comic mode keeps collecting in the background",
      "status.autoScrollOn": "Auto scroll on",
      "status.autoScrollOff": "Auto scroll off",
      "status.rightClickOn": "Right-click unlock on",
      "status.rightClickOff": "Right-click unlock off",
      "status.zipBatchOn": "ZIP batch download on",
      "status.zipBatchOff": "ZIP batch download off",
      "status.scanCompleteAutoFailed": "Scan complete, but auto collect failed to start",
      "status.cleared": "Cleared collected images",
      "status.queued": "Added to download queue",
      "status.copyFailed": "Copy failed",
      "status.copiedImage": "Copied image",
      "status.copiedLink": "Copied link",
      "status.openedSource": "Opened image source",
      "status.autoScrollStopped": "No new content found; auto scroll stopped",
      "status.comicNoSourceTab": "No source tab is bound, so comic mode cannot start",
      "status.comicOn": "Comic mode on (experimental)",
      "status.comicOff": "Comic mode off",
      "status.comicLoadingPages": "Collecting later page images...",
      "status.zipPartsUpdated": "Updated ZIP part settings",
      "status.workspaceNoSourceTab": "No source tab is bound. Reopen Workspace from the source page",
      "status.comicStartFailed": "Comic mode failed to start"
    }
  };

  const ACTION_LABELS = {
    "打开下载目录": "Open folder",
    "开启自动采集": "Start auto collect",
    "关闭自动采集": "Stop auto collect",
    "加载": "Load",
    "操作": "Operation",
    "扫描": "Scan",
    "清理": "Clear",
    "设置": "Setting",
    "自动滚动": "Auto scroll",
    "解锁右键": "Right-click unlock",
    "下载": "Download",
    "复制": "Copy",
    "打开来源": "Open source",
    "漫画模式顺序分析": "Comic order analysis",
    "分页加载": "Pagination load",
    "分页加载出错": "Pagination load",
    "切换原网页": "Switch to source page",
    "隐藏操作": "Hide operation",
    "框选": "Drag selection"
  };

  const EXACT_TEXT_KEY_BY_VALUE = new Map();

  const normalizeLanguage = (language) => {
    const raw = String(language || "").trim().toLowerCase().replace("_", "-");
    if (!raw) return "";
    if (raw === "zh" || raw.startsWith("zh-")) return "zh";
    if (raw === "cn" || raw === "chinese") return "zh";
    if (raw === "en" || raw.startsWith("en-")) return "en";
    if (SUPPORTED_LANGUAGES.has(raw)) return raw;
    return "";
  };

  const t = (language, key, values = {}) => {
    const lang = normalizeLanguage(language) || "en";
    const template = MESSAGES[lang]?.[key] || MESSAGES.zh[key] || key;
    return String(template).replace(/\{(\w+)\}/g, (_match, name) => {
      const value = values[name];
      return value === undefined || value === null ? "" : String(value);
    });
  };

  for (const key of Object.keys(MESSAGES.zh)) {
    const zhText = MESSAGES.zh[key];
    const enText = MESSAGES.en[key];
    if (typeof zhText === "string" && !zhText.includes("{")) {
      EXACT_TEXT_KEY_BY_VALUE.set(zhText, key);
    }
    if (typeof enText === "string" && !enText.includes("{")) {
      EXACT_TEXT_KEY_BY_VALUE.set(enText, key);
    }
  }

  const preserveWhitespace = (source, translated) => {
    const leading = source.match(/^\s*/)?.[0] || "";
    const trailing = source.match(/\s*$/)?.[0] || "";
    return `${leading}${translated}${trailing}`;
  };

  const translateErrorText = (language, value) => {
    const text = String(value || "");
    if (language === "en") {
      return text
        .replaceAll("未知错误", t("en", "common.unknownError"))
        .replaceAll("未记录来源", "No source recorded");
    }
    return text
      .replaceAll("Unknown error", t("zh", "common.unknownError"))
      .replaceAll("No source recorded", "未记录来源");
  };

  const translateActionName = (language, value) => {
    const text = String(value || "");
    if (language === "en") return ACTION_LABELS[text] || text;
    const found = Object.entries(ACTION_LABELS).find((entry) => entry[1] === text);
    return found ? found[0] : text;
  };

  const applyTemplate = (template, match, language) =>
    template.replace(/\$(\d+)/g, (_token, index) => translateErrorText(language, match[Number(index)] || ""));

  const DYNAMIC_PATTERNS = [
    {
      zh: /^(.+)失败: (.+)$/,
      en: /^(.+) failed: (.+)$/,
      toEn: (match) => `${translateActionName("en", match[1])} failed: ${translateErrorText("en", match[2])}`,
      toZh: (match) => `${translateActionName("zh", match[1])}失败: ${translateErrorText("zh", match[2])}`
    },
    {
      zh: /^已复制 (\d+) 条链接$/,
      en: /^Copied (\d+) links$/,
      toEn: (match) => `Copied ${match[1]} links`,
      toZh: (match) => `已复制 ${match[1]} 条链接`
    },
    {
      zh: /^打包中 (\d+)\/(\d+)$/,
      en: /^Zipping (\d+)\/(\d+)$/,
      toEn: (match) => `Zipping ${match[1]}/${match[2]}`,
      toZh: (match) => `打包中 ${match[1]}/${match[2]}`
    },
    {
      zh: /^正在生成ZIP第 (\d+) 卷$/,
      en: /^Building ZIP part (\d+)$/,
      toEn: (match) => `Building ZIP part ${match[1]}`,
      toZh: (match) => `正在生成ZIP第 ${match[1]} 卷`
    },
    {
      zh: /^正在下载ZIP第 (\d+) 卷$/,
      en: /^Downloading ZIP part (\d+)$/,
      toEn: (match) => `Downloading ZIP part ${match[1]}`,
      toZh: (match) => `正在下载ZIP第 ${match[1]} 卷`
    },
    {
      zh: /^下载中 (\d+)\/(\d+)$/,
      en: /^Downloading (\d+)\/(\d+)$/,
      toEn: (match) => `Downloading ${match[1]}/${match[2]}`,
      toZh: (match) => `下载中 ${match[1]}/${match[2]}`
    },
    {
      zh: /^生成ZIP (\d+)$/,
      en: /^Build ZIP (\d+)$/,
      toEn: (match) => `Build ZIP ${match[1]}`,
      toZh: (match) => `生成ZIP ${match[1]}`
    },
    {
      zh: /^下载ZIP (\d+)$/,
      en: /^Download ZIP (\d+)$/,
      toEn: (match) => `Download ZIP ${match[1]}`,
      toZh: (match) => `下载ZIP ${match[1]}`
    },
    {
      zh: /^框选覆盖 (\d+) 张$/,
      en: /^Drag selected (\d+) images$/,
      toEn: (match) => `Drag selected ${match[1]} images`,
      toZh: (match) => `框选覆盖 ${match[1]} 张`
    },
    {
      zh: /^框选切换 (\d+) 张$/,
      en: /^Drag toggled (\d+) images$/,
      toEn: (match) => `Drag toggled ${match[1]} images`,
      toZh: (match) => `框选切换 ${match[1]} 张`
    },
    {
      zh: /^分页加载中断，已加载 (\d+) 页，新增 (\d+) 张图片，点击 Go 将从中断页重试$/,
      en: /^Pagination interrupted after (\d+) pages and (\d+) new images. Click Go to retry from the interrupted page$/,
      toEn: (match) => `Pagination interrupted after ${match[1]} pages and ${match[2]} new images. Click Go to retry from the interrupted page`,
      toZh: (match) => `分页加载中断，已加载 ${match[1]} 页，新增 ${match[2]} 张图片，点击 Go 将从中断页重试`
    },
    {
      zh: /^分页加载完成，共加载 (\d+) 页，新增 (\d+) 张图片，可继续向后加载$/,
      en: /^Pagination complete: loaded (\d+) pages and (\d+) new images. More pages are available$/,
      toEn: (match) => `Pagination complete: loaded ${match[1]} pages and ${match[2]} new images. More pages are available`,
      toZh: (match) => `分页加载完成，共加载 ${match[1]} 页，新增 ${match[2]} 张图片，可继续向后加载`
    },
    {
      zh: /^分页加载完成，共加载 (\d+) 页，新增 (\d+) 张图片，未检测到更多后续分页$/,
      en: /^Pagination complete: loaded (\d+) pages and (\d+) new images. No more pages detected$/,
      toEn: (match) => `Pagination complete: loaded ${match[1]} pages and ${match[2]} new images. No more pages detected`,
      toZh: (match) => `分页加载完成，共加载 ${match[1]} 页，新增 ${match[2]} 张图片，未检测到更多后续分页`
    }
  ];

  const translateDynamicText = (language, value) => {
    const text = String(value || "");
    for (const pattern of DYNAMIC_PATTERNS) {
      const sourcePattern = language === "en" ? pattern.zh : pattern.en;
      const match = text.match(sourcePattern);
      if (match) {
        return language === "en" ? pattern.toEn(match) : pattern.toZh(match);
      }
    }
    return "";
  };

  const translateText = (language, text) => {
    const raw = String(text ?? "");
    const trimmed = raw.trim();
    if (!trimmed) return raw;
    const lang = normalizeLanguage(language) || "en";
    const key = EXACT_TEXT_KEY_BY_VALUE.get(trimmed);
    if (key) return preserveWhitespace(raw, t(lang, key));
    const dynamic = translateDynamicText(lang, trimmed);
    if (dynamic) return preserveWhitespace(raw, dynamic);
    const common = applyTemplate("$1", ["", trimmed], lang);
    return preserveWhitespace(raw, common);
  };

  const detectBrowserLanguage = () => {
    const languages = Array.isArray(globalThis.navigator?.languages) && globalThis.navigator.languages.length > 0
      ? globalThis.navigator.languages
      : [globalThis.navigator?.language || ""];
    return normalizeLanguage(languages[0]) || "en";
  };

  const getStorageArea = () => globalThis.chrome?.storage?.local || null;

  const storageGet = async (key) => {
    const area = getStorageArea();
    if (!area || typeof area.get !== "function") return {};
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || {});
      };
      try {
        const maybePromise = area.get([key], finish);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(finish).catch(() => finish({}));
        }
      } catch (_error) {
        finish({});
      }
    });
  };

  const storageSet = async (values) => {
    const area = getStorageArea();
    if (!area || typeof area.set !== "function") return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      try {
        const maybePromise = area.set(values, finish);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(finish).catch(finish);
        }
      } catch (_error) {
        finish();
      }
    });
  };

  const getStoredLanguage = async () => {
    const stored = await storageGet(STORAGE_KEY);
    return normalizeLanguage(stored[STORAGE_KEY]);
  };

  const resolveInitialLanguage = async () => {
    const stored = await getStoredLanguage();
    return stored || detectBrowserLanguage();
  };

  const notifyLanguageChanged = (language) => {
    try {
      globalThis.dispatchEvent(new CustomEvent("pageImageCollectorLanguageChanged", {
        detail: { language }
      }));
    } catch (_error) {
      // CustomEvent may be unavailable in small test contexts.
    }
  };

  const setStoredLanguage = async (language) => {
    const normalized = normalizeLanguage(language);
    if (!normalized) return false;
    await storageSet({ [STORAGE_KEY]: normalized });
    notifyLanguageChanged(normalized);
    return true;
  };

  const onLanguageChange = (callback) => {
    if (typeof callback !== "function") return () => {};
    const storageListener = (changes, areaName) => {
      if (areaName && areaName !== "local") return;
      const change = changes?.[STORAGE_KEY];
      const next = normalizeLanguage(change?.newValue);
      if (next) callback(next);
    };
    const eventListener = (event) => {
      const next = normalizeLanguage(event?.detail?.language);
      if (next) callback(next);
    };
    try {
      globalThis.chrome?.storage?.onChanged?.addListener?.(storageListener);
    } catch (_error) {
      // Ignore unavailable storage change events.
    }
    try {
      globalThis.addEventListener?.("pageImageCollectorLanguageChanged", eventListener);
    } catch (_error) {
      // Ignore unavailable DOM events.
    }
    return () => {
      try {
        globalThis.chrome?.storage?.onChanged?.removeListener?.(storageListener);
      } catch (_error) {
        // Ignore unavailable storage change events.
      }
      try {
        globalThis.removeEventListener?.("pageImageCollectorLanguageChanged", eventListener);
      } catch (_error) {
        // Ignore unavailable DOM events.
      }
    };
  };

  const shouldSkipTextNode = (node) => {
    const parent = node?.parentElement;
    if (!parent) return true;
    const tagName = parent.tagName;
    return tagName === "SCRIPT" || tagName === "STYLE" || tagName === "SVG" || tagName === "TEXTAREA";
  };

  const translateNodeText = (node, language) => {
    if (shouldSkipTextNode(node)) return;
    const next = translateText(language, node.nodeValue || "");
    if (next !== node.nodeValue) {
      node.nodeValue = next;
    }
  };

  const translateElementAttributes = (element, language) => {
    for (const attr of ["aria-label", "title", "alt"]) {
      if (!element.hasAttribute?.(attr)) continue;
      const value = element.getAttribute(attr);
      const next = translateText(language, value);
      if (next !== value) element.setAttribute(attr, next);
    }
  };

  const applyDomTranslations = (language, root = globalThis.document?.body) => {
    const documentRef = globalThis.document;
    if (!documentRef || !root) return;
    const lang = normalizeLanguage(language) || "en";
    documentRef.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    documentRef.documentElement.dataset.language = lang;
    documentRef.title = translateText(lang, documentRef.title);

    if (root.nodeType === 1) translateElementAttributes(root, lang);
    if (typeof root.querySelectorAll === "function") {
      root.querySelectorAll("[aria-label], [title], [alt]").forEach((element) => {
        translateElementAttributes(element, lang);
      });
    }

    const showText = globalThis.NodeFilter?.SHOW_TEXT || 4;
    const walker = documentRef.createTreeWalker(root, showText, {
      acceptNode: (node) => shouldSkipTextNode(node)
        ? (globalThis.NodeFilter?.FILTER_REJECT || 2)
        : (globalThis.NodeFilter?.FILTER_ACCEPT || 1)
    });
    let node = walker.nextNode();
    while (node) {
      translateNodeText(node, lang);
      node = walker.nextNode();
    }
  };

  globalThis.PageImageCollectorI18n = {
    STORAGE_KEY,
    MESSAGES,
    normalizeLanguage,
    detectBrowserLanguage,
    getStoredLanguage,
    resolveInitialLanguage,
    setStoredLanguage,
    onLanguageChange,
    t,
    translateText,
    applyDomTranslations
  };
})();
