import test from "node:test";
import assert from "node:assert/strict";

import {
  formatFromUrl,
  inspectImagePayload,
  normalizeZipPartOptions,
  resolveImagePayloadExtension,
  shouldConvertImageToJpg
} from "../shared/zipCore.js";

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

test("trusts payload bytes over a misleading URL extension", () => {
  const result = inspectImagePayload({
    bytes: bytes(
      0x52, 0x49, 0x46, 0x46,
      0x18, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20
    ),
    mimeType: "image/jpeg",
    url: "https://cdn.example.com/photo.jpg"
  });

  assert.equal(result.ok, true);
  assert.equal(result.extension, "webp");
  assert.equal(result.mimeType, "image/webp");
  assert.equal(resolveImagePayloadExtension({
    inspection: result,
    mimeType: "image/jpeg",
    url: "https://cdn.example.com/photo.jpg"
  }), "webp");
  assert.equal(shouldConvertImageToJpg({
    inspection: result,
    mimeType: "image/jpeg",
    url: "https://cdn.example.com/photo.jpg"
  }), true);
});

test("keeps JPEG, GIF, and SVG payloads out of JPG conversion", () => {
  assert.equal(shouldConvertImageToJpg({
    inspection: { extension: "jpg" },
    mimeType: "image/webp",
    url: "https://cdn.example.com/photo.webp"
  }), false);
  assert.equal(shouldConvertImageToJpg({
    inspection: { extension: "gif" },
    mimeType: "image/gif",
    url: "https://cdn.example.com/animation"
  }), false);
  assert.equal(shouldConvertImageToJpg({
    inspection: { extension: "svg" },
    mimeType: "image/svg+xml",
    url: "https://cdn.example.com/vector"
  }), false);
});

test("keeps HEIC payloads labeled as HEIC instead of AVIF", () => {
  const result = inspectImagePayload({
    bytes: bytes(
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63
    ),
    mimeType: "application/octet-stream",
    url: "https://cdn.example.com/image"
  });

  assert.equal(result.ok, true);
  assert.equal(result.extension, "heic");
  assert.equal(result.mimeType, "image/heic");
  assert.equal(resolveImagePayloadExtension({ inspection: result }), "heic");
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

test("keeps only image format query values from URL guessing", () => {
  assert.equal(formatFromUrl("https://cdn.example.com/photo?format=webp"), "webp");
  assert.equal(formatFromUrl("https://cdn.example.com/photo?format=jpeg"), "jpg");
  assert.equal(formatFromUrl("https://cdn.example.com/photo?format=auto"), "");
  assert.equal(formatFromUrl("https://cdn.example.com/photo?format=raw"), "");
});

test("detects data URL image MIME during format guessing", () => {
  assert.equal(formatFromUrl("data:image/jpeg;base64,/9j/4AAQ"), "jpg");
  assert.equal(formatFromUrl("data:image/webp;base64,UklGRg=="), "webp");
  assert.equal(formatFromUrl("data:image/svg+xml;base64,PHN2Zy8+"), "svg");
  assert.equal(formatFromUrl("data:text/html;base64,PGh0bWw+"), "");
});
