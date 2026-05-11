import test from "node:test";
import assert from "node:assert/strict";

await import("../src/vendor/workspace-virtual.entry.js");

const virtual = globalThis.PageImageCollectorVirtual;

test("calculates stable virtual grid metrics from container width and zoom", () => {
  assert.deepEqual(
    virtual.calculateVirtualGridMetrics({
      containerWidth: 1000,
      paddingLeft: 24,
      paddingRight: 24,
      gap: 20,
      zoom: 100,
      baseMinWidth: 220,
      footerHeight: 38
    }),
    {
      contentWidth: 952,
      columns: 4,
      cardWidth: 223,
      cardHeight: 261,
      rowHeight: 281,
      gap: 20,
      minWidth: 220,
      footerHeight: 38
    }
  );

  assert.equal(
    virtual.calculateVirtualGridMetrics({
      containerWidth: 1000,
      paddingLeft: 24,
      paddingRight: 24,
      gap: 20,
      zoom: 150,
      baseMinWidth: 220,
      footerHeight: 38
    }).columns,
    2
  );
});

test("splits images into virtual rows without changing item order", () => {
  const images = Array.from({ length: 7 }, (_, index) => ({ id: `img-${index}` }));
  assert.deepEqual(
    virtual.buildVirtualGridRows(images, 3).map((row) => ({
      index: row.index,
      startIndex: row.startIndex,
      ids: row.items.map((item) => item.id)
    })),
    [
      { index: 0, startIndex: 0, ids: ["img-0", "img-1", "img-2"] },
      { index: 1, startIndex: 3, ids: ["img-3", "img-4", "img-5"] },
      { index: 2, startIndex: 6, ids: ["img-6"] }
    ]
  );
});
