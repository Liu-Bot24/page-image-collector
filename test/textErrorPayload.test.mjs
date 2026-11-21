import test from "node:test";
import assert from "node:assert/strict";
import { isTextErrorPayload } from "../shared/zipCore.js";

const bytes = (text) => new TextEncoder().encode(text);

test("HTML documents and JSON bodies count as not an image", () => {
  assert.equal(isTextErrorPayload(bytes("<!doctype html><html><body>denied</body></html>")), true);
  assert.equal(isTextErrorPayload(bytes("\n  <html><body>403</body></html>")), true);
  assert.equal(isTextErrorPayload(bytes("<!-- cdn --><!DOCTYPE html><html></html>")), true);
  assert.equal(isTextErrorPayload(bytes('<html><body><svg width="16"></svg> Sign in</body></html>')), true);
  assert.equal(isTextErrorPayload(bytes('<?xml version="1.0"?><html><body><svg width="16"></svg> Sign in</body></html>')), true);
  assert.equal(isTextErrorPayload(bytes('{"error":"expired"}')), true);
  assert.equal(isTextErrorPayload(bytes("﻿[1,2]")), true);
  assert.equal(isTextErrorPayload(new Uint8Array(0)), true);
});

test("image bodies are never counted, whatever the server labels them", () => {
  const pngHead = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  assert.equal(isTextErrorPayload(pngHead), false);
  assert.equal(isTextErrorPayload(bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), false);
  const longComment = "<!-- " + "x".repeat(2000) + " -->";
  assert.equal(isTextErrorPayload(bytes(`${longComment}<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg/>`)), false);
});

test("SVG bodies are never counted as error pages", () => {
  const svgs = [
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
    '﻿<?xml version="1.0"?>\n<!-- icon -->\n<svg xmlns="http://www.w3.org/2000/svg"/>',
    '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>',
    '<?xml version="1.0"?><!DOCTYPE svg [ <!ENTITY a "]>"> ]><svg xmlns="http://www.w3.org/2000/svg"/>',
    '<?xml version="1.0"?><!DOCTYPE svg [ <!ENTITY a "]><html>"> ]><svg xmlns="http://www.w3.org/2000/svg"/>'
  ];
  for (const svg of svgs) assert.equal(isTextErrorPayload(bytes(svg)), false, svg);
});

test("unclear bodies keep the old fallback", () => {
  // ICO header, which the signature table does not list; its bytes include '<' later on.
  assert.equal(isTextErrorPayload(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0x3c, 0, 0, 0])), false);
  assert.equal(isTextErrorPayload(bytes("Access denied")), false);
  // TGA whose image-ID length byte happens to be "{" or "[".
  assert.equal(isTextErrorPayload(new Uint8Array([0x7b, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 0, 0xff, 0x10])), false);
  assert.equal(isTextErrorPayload(new Uint8Array([0x5b, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 24, 0])), false);
  assert.equal(isTextErrorPayload(bytes("<div>error</div>")), false);
  assert.equal(isTextErrorPayload(bytes("<!-- never closed")), false);
});
