import test from "node:test";
import assert from "node:assert/strict";

await import("../src/vendor/content-parsers.entry.js");

const parsers = globalThis.PageImageCollectorParsers;

test("orders srcset candidates by width or density", () => {
  assert.deepEqual(
    parsers.parseSrcsetUrls("small.jpg 400w, large.jpg 1600w, retina.jpg 2x"),
    ["retina.jpg", "large.jpg", "small.jpg"]
  );
  assert.deepEqual(
    parsers.parseSrcsetUrls("small.jpg 1x, large.jpg 3x"),
    ["large.jpg", "small.jpg"]
  );
});

test("preserves data URL srcset candidates without splitting on the media comma", () => {
  const dataUrl = "data:image/svg+xml,%3Csvg%3E%3C/svg%3E";
  assert.deepEqual(
    parsers.parseSrcsetUrls(`${dataUrl} 1x, large.jpg 2x`),
    ["large.jpg", dataUrl]
  );
});

test("extracts CSS image-set URLs by descriptor strength", () => {
  const value = 'image-set(url("a.avif") type("image/avif") 1x, url("a@2x.jpg") type("image/jpeg") 2x)';
  assert.deepEqual(parsers.extractCssImageUrls(value), ["a@2x.jpg", "a.avif"]);
});

test("extracts quoted and unquoted CSS url values", () => {
  assert.deepEqual(parsers.extractCssImageUrls('url("hero large.jpg")'), ["hero large.jpg"]);
  assert.deepEqual(parsers.extractCssImageUrls("url(/images/hero.webp)"), ["/images/hero.webp"]);
});
