import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../workspace/workspace.js', import.meta.url), 'utf8');
const hitSource = source.slice(source.indexOf('const hitTestSelectionCards ='), source.indexOf('const applyDragSelection ='));
function harness(visibleRows = 10, count = 128) {
  const rows = Array.from({ length: Math.ceil(count / 4) }, (_, r) => ({ items: Array.from({ length: Math.min(4, count - r * 4) }, (_, c) => ({ id: String(r * 4 + c) })) }));
  const cards = rows.slice(0, visibleRows).flatMap((row, r) => row.items.map((image, c) => ({
    dataset: { id: image.id },
    getBoundingClientRect: () => ({ left: 24 + c * 110, top: 224 + r * 140, width: 100, height: 130 })
  })));
  const gallery = { scrollTop: 0, scrollLeft: 0, getBoundingClientRect: () => ({ left: 0, top: 200 }), querySelectorAll: () => cards };
  const state = { enabled: true, rows, metrics: { columns: 4, cardWidth: 100, cardHeight: 130, rowHeight: 140, gap: 10 },
    spacer: { getBoundingClientRect: () => ({ left: 24, top: 224 }) } };
  const context = vm.createContext({ virtualGridState: state, elements: { gallery } });
  vm.runInContext(hitSource + '\nglobalThis.hit = hitTestSelectionCards;', context);
  return context.hit;
}

test('virtual marquee selects all 128 intersected records despite only 40 mounted cards', () => {
  const hit = harness();
  assert.equal(hit({ left: 24, top: 24, right: 454, bottom: 24 + 31 * 140 + 130 }).size, 128);
});

test('virtual marquee excludes row gaps, outside columns and missing cells in a partial final row', () => {
  const hit = harness(1, 127);
  assert.equal(hit({ left: 24, top: 155, right: 454, bottom: 163 }).size, 0);
  assert.equal(hit({ left: 455, top: 24, right: 500, bottom: 4500 }).size, 0);
  assert.deepEqual([...hit({ left: 245, top: 4365, right: 453, bottom: 4493 })], ['126']);
});

test('drag highlights use mounted cards while the selection data includes offscreen records', () => {
  const nodes = ['0', '100', '999'].map(id => ({ dataset: { id }, highlighted: false,
    classList: { toggle(_name, selected) { nodes.find(node => node.dataset.id === id).highlighted = selected; },
      remove() { nodes.find(node => node.dataset.id === id).highlighted = false; } } }));
  const context = vm.createContext({ dragPreviewIds: new Set(), elements: { gallery: {
    querySelectorAll: () => nodes, querySelector: () => { throw new Error('Do not search the DOM once per offscreen image'); }
  } } });
  const previewSource = source.slice(source.indexOf('const clearDragPreview ='), source.indexOf('const hitTestSelectionCards ='));
  vm.runInContext(previewSource + '\nglobalThis.update = updateDragPreview; globalThis.clear = clearDragPreview;', context);
  context.update(Array.from({ length: 128 }, (_, i) => String(i)));
  assert.deepEqual(nodes.map(node => node.highlighted), [true, true, false]);
  context.update(['0']);
  assert.deepEqual(nodes.map(node => node.highlighted), [true, false, false]);
  context.clear(); assert.ok(nodes.every(node => !node.highlighted));
});
