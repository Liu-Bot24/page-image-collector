import test from "node:test";
import assert from "node:assert/strict";
import { shouldResetForUrlOnlyNavigation } from "../shared/navigationCore.js";

test("URL-only page navigation resets collected images", () => {
  assert.equal(
    shouldResetForUrlOnlyNavigation(
      "https://example.com/gallery/page-1",
      "https://example.com/gallery/page-2"
    ),
    true
  );
});

test("a new SPA path still resets when the destination includes a hash", () => {
  assert.equal(
    shouldResetForUrlOnlyNavigation(
      "https://example.com/gallery/page-1",
      "https://example.com/gallery/page-2#comments"
    ),
    true
  );
});

test("Telegram hash routes reset collected images", () => {
  assert.equal(
    shouldResetForUrlOnlyNavigation(
      "https://web.telegram.org/k/#@first",
      "https://web.telegram.org/k/#@second"
    ),
    true
  );
});

test("ordinary in-page anchors keep collected images", () => {
  assert.equal(
    shouldResetForUrlOnlyNavigation(
      "https://example.com/gallery",
      "https://example.com/gallery#section-2"
    ),
    false
  );
  assert.equal(
    shouldResetForUrlOnlyNavigation(
      "https://example.com/gallery#section-2",
      "https://example.com/gallery"
    ),
    false
  );
});

test("extension and invalid URLs do not reset collected images", () => {
  assert.equal(
    shouldResetForUrlOnlyNavigation(
      "https://example.com/gallery",
      "chrome-extension://example/workspace.html"
    ),
    false
  );
  assert.equal(
    shouldResetForUrlOnlyNavigation("https://example.com/gallery", "not a URL"),
    false
  );
});

test("unknown previous URLs keep anchors but conservatively reset full routes", () => {
  assert.equal(
    shouldResetForUrlOnlyNavigation(null, "https://example.com/gallery#section-2"),
    false
  );
  assert.equal(
    shouldResetForUrlOnlyNavigation(null, "https://example.com/gallery/page-2"),
    true
  );
});
