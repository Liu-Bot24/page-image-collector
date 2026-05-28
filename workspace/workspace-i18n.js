(function () {
  "use strict";

  const i18n = globalThis.PageImageCollectorI18n;
  if (!i18n) return;

  let currentLanguage = "zh";
  let applying = false;
  let scheduled = false;

  const setText = (selector, key) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = i18n.t(currentLanguage, key);
  };

  const setAttrs = (selector, key) => {
    const node = document.querySelector(selector);
    if (!node) return;
    const text = i18n.t(currentLanguage, key);
    node.setAttribute("aria-label", text);
    node.title = text;
  };

  const syncScanButton = () => {
    const button = document.getElementById("btn-scan");
    if (!button) return;
    const text = button.textContent.trim();
    if (text === i18n.t("zh", "common.scanning") || text === i18n.t("en", "common.scanning")) {
      button.textContent = i18n.t(currentLanguage, "common.scanning");
      return;
    }
    if (text === i18n.t("zh", "workspace.scanContinue") || text === i18n.t("en", "workspace.scanContinue")) {
      button.textContent = i18n.t(currentLanguage, "workspace.scanContinue");
      return;
    }
    button.textContent = i18n.t(currentLanguage, "workspace.scanStart");
  };

  const syncStaticControls = () => {
    document.title = i18n.t(currentLanguage, "workspace.documentTitle");
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

  const applyTranslations = () => {
    if (applying) return;
    applying = true;
    try {
      syncStaticControls();
      i18n.applyDomTranslations(currentLanguage);
    } finally {
      applying = false;
    }
  };

  const scheduleApplyTranslations = () => {
    if (applying || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyTranslations();
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
