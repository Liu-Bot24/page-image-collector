import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Runs the content script's own srcset code.
const contentSource = readFileSync(new URL("../content/content.js", import.meta.url), "utf8");
const from = contentSource.indexOf("const splitSrcsetCandidates =");
const to = contentSource.indexOf("const getHDUrl =", from);
assert.ok(from >= 0 && to > from, "cannot locate the srcset code");
const context = vm.createContext({ URL });
vm.runInContext(contentSource.slice(from, to) + "globalThis.parseSrcsetUrls = parseSrcsetUrls;", context);
const parse = (srcset) => [...context.parseSrcsetUrls(srcset)];

test("commas inside srcset addresses stay part of the address", () => {
  const srcset = "https://res.cloudinary.com/demo/image/upload/w_300,h_200,c_fill/a.jpg 300w, " +
    "https://res.cloudinary.com/demo/image/upload/w_900,h_600,c_fill/a.jpg 900w";
  assert.deepEqual(parse(srcset), [
    "https://res.cloudinary.com/demo/image/upload/w_900,h_600,c_fill/a.jpg",
    "https://res.cloudinary.com/demo/image/upload/w_300,h_200,c_fill/a.jpg"
  ]);
  assert.deepEqual(parse("a 1x, /images/w_300,h_200/art.jpg 2x"), ["/images/w_300,h_200/art.jpg", "a"]);
});

test("plain srcset keeps the largest candidate first", () => {
  assert.deepEqual(parse("/s.jpg 1x, /l.jpg 2x"), ["/l.jpg", "/s.jpg"]);
  assert.deepEqual(parse("/a.jpg 320w, /b.jpg 1280w, /c.jpg 640w"), ["/b.jpg", "/c.jpg", "/a.jpg"]);
  assert.deepEqual(parse("/only.jpg"), ["/only.jpg"]);
  assert.deepEqual(parse("/a.jpg, /b.jpg 2x, /a.jpg 3x"), ["/a.jpg", "/b.jpg"]);
});

test("data addresses and candidates without descriptors are kept whole", () => {
  assert.deepEqual(parse("data:image/png;base64,AAAA 1x, /b.jpg 2x"), ["/b.jpg", "data:image/png;base64,AAAA"]);
  assert.deepEqual(parse("data:image/png;base64,AAAA, /b.jpg 2x"), ["/b.jpg", "data:image/png;base64,AAAA"]);
  assert.deepEqual(parse("a, /b.jpg 2x"), ["/b.jpg", "a"]);
});

test("line breaks and one-letter addresses do not lose the best candidate", () => {
  assert.deepEqual(parse("/a.jpg\n2x, /b.jpg 1x"), ["/a.jpg", "/b.jpg"]);
  assert.deepEqual(parse("/a.jpg 2x,\n   /b.jpg 1x"), ["/a.jpg", "/b.jpg"]);
  assert.deepEqual(parse("a 2x, /b 1x"), ["a", "/b"]);
});
