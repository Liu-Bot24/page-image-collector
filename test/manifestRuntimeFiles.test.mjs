import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");
const STATIC_IMPORT_PATTERN = /(?:^|\n)\s*import\s+(?:[\w*{]|["'])/;
const DYNAMIC_IMPORT_PATTERN = /\bimport\s*\(/;
const EXPORT_PATTERN = /(?:^|\n)\s*export\s+/;
const PROCESS_PATTERN = /(?:^|[^\w$])process(?:[^\w$]|$)/;
const EVAL_LIKE_PATTERN = /(?:^|[^\w$.])(?:eval|Function)\s*\(|(?:^|[^\w$])globalThis\s*\.\s*eval\s*\(/;

test("content script runtime files exist and load parsers before content", () => {
  const manifest = JSON.parse(readFileSync(resolve(rootDir, "manifest.json"), "utf8"));
  const scripts = manifest.content_scripts?.[0]?.js || [];

  assert.deepEqual(scripts.slice(0, 2), ["vendor/content-parsers.js", "content/content.js"]);
  for (const script of scripts) {
    assert.equal(existsSync(resolve(rootDir, script)), true, `${script} should exist in extension root`);
  }
});

test("background fallback injection loads parser vendor before content script", () => {
  const background = readFileSync(resolve(rootDir, "background/background.js"), "utf8");
  const vendorIndex = background.indexOf('files: ["vendor/content-parsers.js"]');
  const contentIndex = background.indexOf('files: ["content/content.js"]');

  assert.notEqual(vendorIndex, -1);
  assert.notEqual(contentIndex, -1);
  assert.ok(vendorIndex < contentIndex, "parser vendor should be injected before content script");
});

test("workspace runtime files exist and load virtual vendor before workspace app", () => {
  const html = readFileSync(resolve(rootDir, "workspace/workspace.html"), "utf8");
  const vendorPath = "../vendor/workspace-virtual.js";
  const sharedI18nPath = "../shared/i18n.js";
  const appPath = "workspace.js";
  const pageI18nPath = "workspace-i18n.js";
  const vendorIndex = html.indexOf(`src="${vendorPath}"`);
  const sharedI18nIndex = html.indexOf(`src="${sharedI18nPath}"`);
  const appIndex = html.indexOf(`src="${appPath}"`);
  const pageI18nIndex = html.indexOf(`src="${pageI18nPath}"`);

  assert.equal(existsSync(resolve(rootDir, "vendor/workspace-virtual.js")), true);
  assert.notEqual(vendorIndex, -1);
  assert.notEqual(sharedI18nIndex, -1);
  assert.notEqual(appIndex, -1);
  assert.notEqual(pageI18nIndex, -1);
  assert.ok(vendorIndex < appIndex, "workspace virtual vendor should load before workspace.js");
  assert.ok(sharedI18nIndex < pageI18nIndex, "shared i18n should load before workspace page i18n");
  assert.ok(appIndex < pageI18nIndex, "workspace i18n should run after workspace.js so it cannot block core rendering");
});

test("popup runtime files load shared i18n and page i18n around the existing app script", () => {
  const html = readFileSync(resolve(rootDir, "popup/popup.html"), "utf8");
  const sharedI18nPath = "../shared/i18n.js";
  const appPath = "popup.js";
  const pageI18nPath = "popup-i18n.js";
  const sharedI18nIndex = html.indexOf(`src="${sharedI18nPath}"`);
  const appIndex = html.indexOf(`src="${appPath}"`);
  const pageI18nIndex = html.indexOf(`src="${pageI18nPath}"`);

  assert.notEqual(sharedI18nIndex, -1);
  assert.notEqual(appIndex, -1);
  assert.notEqual(pageI18nIndex, -1);
  assert.ok(sharedI18nIndex < appIndex, "shared i18n should load before popup.js for initial language state");
  assert.ok(appIndex < pageI18nIndex, "popup i18n should run after popup.js so dynamic core labels can be translated");
});

test("popup exposes the only visible language switch", () => {
  const popupHtml = readFileSync(resolve(rootDir, "popup/popup.html"), "utf8");
  const workspaceHtml = readFileSync(resolve(rootDir, "workspace/workspace.html"), "utf8");

  assert.match(popupHtml, /id="language-switch"/);
  assert.match(popupHtml, /data-language="en"/);
  assert.match(popupHtml, /data-language="zh"/);
  assert.doesNotMatch(workspaceHtml, /id="language-switch"/);
});

test("language support stays outside core collection scripts", () => {
  for (const file of ["popup/popup.js", "workspace/workspace.js"]) {
    const source = readFileSync(resolve(rootDir, file), "utf8");
    assert.doesNotMatch(source, /PageImageCollectorI18n/, `${file} should not import or call the i18n layer directly`);
    assert.doesNotMatch(source, /pageImageCollector\.language/, `${file} should not own language persistence`);
  }
});

test("vendor runtime files are bundled for MV3 extension pages", () => {
  for (const file of ["vendor/content-parsers.js", "vendor/workspace-virtual.js"]) {
    const source = readFileSync(resolve(rootDir, file), "utf8");
    assert.doesNotMatch(source, PROCESS_PATTERN, `${file} should not reference Node process`);
    assert.doesNotMatch(source, STATIC_IMPORT_PATTERN, `${file} should not contain static imports`);
    assert.doesNotMatch(source, DYNAMIC_IMPORT_PATTERN, `${file} should not contain dynamic imports`);
    assert.doesNotMatch(source, EXPORT_PATTERN, `${file} should not contain runtime exports`);
    assert.doesNotMatch(source, EVAL_LIKE_PATTERN, `${file} should not use eval-like code`);
  }
});

test("classic extension scripts do not contain module-only syntax or eval-like code", () => {
  for (const file of [
    "content/content.js",
    "popup/popup.js",
    "popup/popup-i18n.js",
    "shared/i18n.js",
    "workspace/workspace.js",
    "workspace/workspace-i18n.js"
  ]) {
    const source = readFileSync(resolve(rootDir, file), "utf8");
    assert.doesNotMatch(source, STATIC_IMPORT_PATTERN, `${file} should load as a classic script`);
    assert.doesNotMatch(source, DYNAMIC_IMPORT_PATTERN, `${file} should not use dynamic imports`);
    assert.doesNotMatch(source, EXPORT_PATTERN, `${file} should not contain runtime exports`);
    assert.doesNotMatch(source, EVAL_LIKE_PATTERN, `${file} should not use eval-like code`);
  }
});
