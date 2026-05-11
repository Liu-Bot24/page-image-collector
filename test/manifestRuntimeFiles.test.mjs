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
  const appPath = "workspace.js";
  const vendorIndex = html.indexOf(`src="${vendorPath}"`);
  const appIndex = html.indexOf(`src="${appPath}"`);

  assert.equal(existsSync(resolve(rootDir, "vendor/workspace-virtual.js")), true);
  assert.notEqual(vendorIndex, -1);
  assert.notEqual(appIndex, -1);
  assert.ok(vendorIndex < appIndex, "workspace virtual vendor should load before workspace.js");
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
  for (const file of ["content/content.js", "popup/popup.js", "workspace/workspace.js"]) {
    const source = readFileSync(resolve(rootDir, file), "utf8");
    assert.doesNotMatch(source, STATIC_IMPORT_PATTERN, `${file} should load as a classic script`);
    assert.doesNotMatch(source, DYNAMIC_IMPORT_PATTERN, `${file} should not use dynamic imports`);
    assert.doesNotMatch(source, EXPORT_PATTERN, `${file} should not contain runtime exports`);
    assert.doesNotMatch(source, EVAL_LIKE_PATTERN, `${file} should not use eval-like code`);
  }
});
