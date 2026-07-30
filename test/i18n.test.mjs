import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const rootDir = resolve(import.meta.dirname, "..");
const storageKey = "pageImageCollector.language";

const loadI18n = ({ language = "en-US", languages = [language], stored = {} } = {}) => {
  const source = readFileSync(resolve(rootDir, "shared/i18n.js"), "utf8");
  const storageState = { ...stored };
  const context = {
    console,
    navigator: {
      language,
      languages
    },
    chrome: {
      storage: {
        local: {
          get: async (keys) => {
            const result = {};
            const requestedKeys = Array.isArray(keys) ? keys : [keys];
            for (const key of requestedKeys) {
              result[key] = storageState[key];
            }
            return result;
          },
          set: async (values) => {
            Object.assign(storageState, values);
          },
          remove: async (keys) => {
            const requestedKeys = Array.isArray(keys) ? keys : [keys];
            for (const key of requestedKeys) {
              delete storageState[key];
            }
          }
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "shared/i18n.js" });
  return {
    api: context.PageImageCollectorI18n,
    storageState
  };
};

test("shared i18n follows Chinese browser languages and defaults other browsers to English", async () => {
  assert.equal((await loadI18n({ language: "zh-CN" }).api.resolveInitialLanguage()), "zh");
  assert.equal((await loadI18n({ language: "zh-TW" }).api.resolveInitialLanguage()), "zh");
  assert.equal((await loadI18n({ language: "en-US" }).api.resolveInitialLanguage()), "en");
});

test("shared i18n persists manual language choices ahead of browser language", async () => {
  const { api, storageState } = loadI18n({
    language: "zh-CN",
    stored: { [storageKey]: "en" }
  });

  assert.equal(await api.resolveInitialLanguage(), "en");
  assert.equal(await api.setStoredLanguage("zh"), true);
  assert.equal(storageState[storageKey], "zh");
  assert.equal(await api.setStoredLanguage("fr"), false);
  assert.equal(storageState[storageKey], "zh");
});

test("shared i18n translates popup and workspace labels", () => {
  const { api } = loadI18n();

  assert.equal(api.t("en", "popup.scanStart"), "Start Scan");
  assert.equal(api.t("en", "workspace.open"), "Open Workspace");
  assert.equal(api.t("zh", "workspace.emptyTitle"), "暂无图片");
});

test("manifest declares Chrome locale metadata", () => {
  const manifest = JSON.parse(readFileSync(resolve(rootDir, "manifest.json"), "utf8"));

  assert.equal(manifest.default_locale, "zh_CN");
  assert.equal(manifest.name, "__MSG_extensionName__");
  assert.equal(manifest.description, "__MSG_extensionDescription__");
  assert.equal(existsSync(resolve(rootDir, "_locales/zh_CN/messages.json")), true);
  assert.equal(existsSync(resolve(rootDir, "_locales/en/messages.json")), true);
});

test("shared i18n DOM setters do not rewrite unchanged content", () => {
  const { api } = loadI18n();
  let textWrites = 0;
  let attributeWrites = 0;
  let titleWrites = 0;
  let textValue = "Start Scan";
  let titleValue = "Page Image Collector";
  const attributes = new Map([["aria-label", "Download"]]);
  const node = {
    get textContent() {
      return textValue;
    },
    set textContent(value) {
      textWrites += 1;
      textValue = value;
    }
  };
  const element = {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributeWrites += 1;
      attributes.set(name, value);
    }
  };
  const documentRef = {
    get title() {
      return titleValue;
    },
    set title(value) {
      titleWrites += 1;
      titleValue = value;
    }
  };

  assert.equal(api.setTextContent(node, "Start Scan"), false);
  assert.equal(api.setAttributeIfChanged(element, "aria-label", "Download"), false);
  assert.equal(api.setDocumentTitle(documentRef, "Page Image Collector"), false);
  assert.equal(textWrites, 0);
  assert.equal(attributeWrites, 0);
  assert.equal(titleWrites, 0);

  assert.equal(api.setTextContent(node, "Scan More"), true);
  assert.equal(api.setAttributeIfChanged(element, "aria-label", "Save"), true);
  assert.equal(api.setDocumentTitle(documentRef, "Workspace"), true);
  assert.equal(textWrites, 1);
  assert.equal(attributeWrites, 1);
  assert.equal(titleWrites, 1);
});

test("shared i18n translates partial batch download results", () => {
  const { api } = loadI18n();

  assert.equal(
    api.translateText("en", "打包完成 8/10，失败 2"),
    "ZIP complete: 8/10, 2 failed"
  );
  assert.equal(
    api.translateText("en", "下载完成 8/10，失败 2"),
    "Downloads complete: 8/10, 2 failed"
  );
  assert.equal(
    api.translateText("zh", "Downloads complete: 8/10, 2 failed"),
    "下载完成 8/10，失败 2"
  );
});

test("shared i18n translates dynamic viewer labels and nested runtime errors", () => {
  const { api } = loadI18n();

  assert.equal(api.translateText("en", "加载原图..."), "Loading original...");
  assert.equal(api.translateText("en", "原图模式"), "Original mode");
  assert.equal(api.translateText("en", "预览模式"), "Preview mode");
  assert.equal(
    api.translateText("en", "复制失败: 剪贴板不可用"),
    "Copy failed: Clipboard unavailable"
  );
  assert.equal(
    api.translateText("en", "下载失败: 当前已有批量下载任务进行中，请稍后再试"),
    "Download failed: A batch download is already running. Try again later"
  );
  assert.equal(
    api.translateText("en", "分页加载失败: 漫画分页加载已取消"),
    "Pagination load failed: Comic pagination was cancelled"
  );
});
