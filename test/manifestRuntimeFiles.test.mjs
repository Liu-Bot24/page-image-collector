import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dirname, "..");

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
