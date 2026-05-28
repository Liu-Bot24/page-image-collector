(function () {
  "use strict";

  const i18n = globalThis.PageImageCollectorI18n;
  if (!i18n) return;

  let currentLanguage = "zh";
  let applying = false;
  let scheduled = false;

  const languageSwitch = document.getElementById("language-switch");

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

  const syncLanguageSwitch = () => {
    if (!languageSwitch) return;
    languageSwitch.querySelectorAll("[data-language]").forEach((button) => {
      const active = i18n.normalizeLanguage(button.dataset.language) === currentLanguage;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  };

  const syncScanButton = () => {
    const button = document.getElementById("btn-scan");
    if (!button) return;
    const text = button.textContent.trim();
    if (text === i18n.t("zh", "common.scanning") || text === i18n.t("en", "common.scanning")) {
      button.textContent = i18n.t(currentLanguage, "common.scanning");
      return;
    }
    if (text === i18n.t("zh", "popup.scanContinue") || text === i18n.t("en", "popup.scanContinue")) {
      button.textContent = i18n.t(currentLanguage, "popup.scanContinue");
      return;
    }
    button.textContent = i18n.t(currentLanguage, "popup.scanStart");
  };

  const syncStaticControls = () => {
    document.title = i18n.t(currentLanguage, "popup.documentTitle");
    setText(".logo-text", "app.title");
    setText("#btn-workspace", "workspace.open");
    setAttrs("#btn-clear", "common.clearResults");
    setAttrs("#btn-comic-mode", "common.enterComic");
    setAttrs("#btn-auto-scroll", document.getElementById("btn-auto-scroll")?.classList.contains("active")
      ? "toggle.disableAutoScroll"
      : "toggle.enableAutoScroll");
    syncScanButton();
  };

  const applyTranslations = () => {
    if (applying) return;
    applying = true;
    try {
      syncStaticControls();
      i18n.applyDomTranslations(currentLanguage);
      syncLanguageSwitch();
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

  const setLanguage = async (language) => {
    const next = i18n.normalizeLanguage(language);
    if (!next || next === currentLanguage) return;
    currentLanguage = next;
    await i18n.setStoredLanguage(next);
    applyTranslations();
  };

  const bindLanguageSwitch = () => {
    if (!languageSwitch) return;
    languageSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("[data-language]");
      if (!button) return;
      setLanguage(button.dataset.language).catch(() => {});
    });
  };

  const init = async () => {
    currentLanguage = await i18n.resolveInitialLanguage();
    bindLanguageSwitch();
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
