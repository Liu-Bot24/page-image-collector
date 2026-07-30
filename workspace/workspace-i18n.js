(function () {
  "use strict";

  const i18n = globalThis.PageImageCollectorI18n;
  if (!i18n) return;

  let currentLanguage = "zh";
  let applying = false;
  let scheduled = false;
  const pendingRoots = new Set();

  const setText = (selector, key) => {
    const node = document.querySelector(selector);
    i18n.setTextContent(node, i18n.t(currentLanguage, key));
  };

  const setAttrs = (selector, key) => {
    const node = document.querySelector(selector);
    if (!node) return;
    const text = i18n.t(currentLanguage, key);
    i18n.setAttributeIfChanged(node, "aria-label", text);
    i18n.setAttributeIfChanged(node, "title", text);
  };

  const syncScanButton = () => {
    const button = document.getElementById("btn-scan");
    if (!button) return;
    const text = button.textContent.trim();
    if (text === i18n.t("zh", "common.scanning") || text === i18n.t("en", "common.scanning")) {
      i18n.setTextContent(button, i18n.t(currentLanguage, "common.scanning"));
      return;
    }
    if (text === i18n.t("zh", "workspace.scanContinue") || text === i18n.t("en", "workspace.scanContinue")) {
      i18n.setTextContent(button, i18n.t(currentLanguage, "workspace.scanContinue"));
      return;
    }
    i18n.setTextContent(button, i18n.t(currentLanguage, "workspace.scanStart"));
  };

  const syncStaticControls = () => {
    i18n.setDocumentTitle(document, i18n.t(currentLanguage, "workspace.documentTitle"));
    setText(".logo-text", "workspace.logo");
    setAttrs("#btn-clear", "common.clearResults");
    setAttrs("#comic-banner-pagination-go", "workspace.comicStartPagination");
    setAttrs("#fullscreen-close", "workspace.closeFullscreen");
    setAttrs("#lightbox-prev", "common.prev");
    setAttrs("#lightbox-next", "common.next");
    setAttrs("#fullscreen-prev", "common.prev");
    setAttrs("#fullscreen-next", "common.next");
    syncScanButton();
  };

  const applyTranslations = (root = document.body, syncStatic = true) => {
    if (applying) return;
    applying = true;
    try {
      if (syncStatic) syncStaticControls();
      i18n.applyDomTranslations(currentLanguage, root);
    } finally {
      applying = false;
    }
  };

  const addPendingRoot = (node) => {
    if (!node) return;
    const root = node.nodeType === 1 ? node : node.parentElement;
    if (root) pendingRoots.add(root);
  };

  const scheduleApplyTranslations = (mutations = []) => {
    if (applying) return;
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach(addPendingRoot);
        if (mutation.addedNodes.length === 0) addPendingRoot(mutation.target);
      } else {
        addPendingRoot(mutation.target);
      }
    }
    if (pendingRoots.size === 0) pendingRoots.add(document.body);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      roots.forEach((root) => applyTranslations(root, false));
    });
  };

  const init = async () => {
    currentLanguage = await i18n.resolveInitialLanguage();
    applyTranslations();
    const observer = new MutationObserver(scheduleApplyTranslations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "class"]
    });
    i18n.onLanguageChange((language) => {
      currentLanguage = language;
      applyTranslations();
    });
  };

  init().catch(() => {});
})();
