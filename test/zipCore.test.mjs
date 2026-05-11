import test from "node:test";
import assert from "node:assert/strict";

import { inspectImagePayload, normalizeZipPartOptions } from "../shared/zipCore.js";

const bytes = (...values) => new Uint8Array(values);
const textBytes = (value) => new TextEncoder().encode(value);

test("rejects HTML responses even when the URL looks like an image", () => {
  const result = inspectImagePayload({
    bytes: textBytes("<!doctype html><html><body>blocked</body></html>"),
    mimeType: "text/html",
    url: "https://cdn.example.com/photo.jpg"
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /html/i);
});

test("accepts binary image data with missing or generic MIME when the URL is image-like", () => {
  const result = inspectImagePayload({
    bytes: bytes(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43),
    mimeType: "application/octet-stream",
    url: "https://cdn.example.com/photo"
  });

  assert.equal(result.ok, true);
  assert.equal(result.extension, "jpg");
  assert.equal(result.mimeType, "image/jpeg");
});

test("accepts SVG text as an image payload but rejects generic non-image text", () => {
  const svg = inspectImagePayload({
    bytes: textBytes("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
    mimeType: "text/plain",
    url: "https://cdn.example.com/vector.svg"
  });
  const plainText = inspectImagePayload({
    bytes: textBytes("not an image"),
    mimeType: "text/plain",
    url: "https://cdn.example.com/file.txt"
  });

  assert.equal(svg.ok, true);
  assert.equal(svg.extension, "svg");
  assert.equal(plainText.ok, false);
});

test("keeps the existing ZIP split limits as the default", () => {
  const options = normalizeZipPartOptions();

  assert.equal(options.zipPartPreset, "balanced");
  assert.equal(options.zipPartMaxBytes, 192 * 1024 * 1024);
  assert.equal(options.zipPartMaxFiles, 300);
});

test("normalizes ZIP split presets for larger archive parts", () => {
  const options = normalizeZipPartOptions({ zipPartPreset: "large" });

  assert.equal(options.zipPartPreset, "large");
  assert.equal(options.zipPartMaxBytes, 384 * 1024 * 1024);
  assert.equal(options.zipPartMaxFiles, 500);
});
