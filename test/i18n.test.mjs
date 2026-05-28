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
