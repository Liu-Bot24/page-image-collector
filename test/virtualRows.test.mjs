import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../workspace/workspace.js', import.meta.url), 'utf8');
const renderSource = source.slice(source.indexOf('const renderVirtualGridRows ='), source.indexOf('const scheduleVirtualGridRowsRender ='));
class Node {
  constructor(fragment = false) { this.fragment = fragment; this.children = []; this.style = {}; this.dataset = {}; this.parentNode = null; this.isConnected = true; }
  get firstElementChild() { return this.children[0] || null; }
  get childElementCount() { return this.children.length; }
  appendChild(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) {
    if (node.fragment) { for (const child of [...node.children]) this.insertBefore(child, before); return node; }
    node.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, node); node.parentNode = this; return node;
  }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); for (const node of nodes) this.appendChild(node); }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
}
const harness = () => {
  let visible = [0, 1, 2, 3, 4]; let created = 0;
  const rows = Array.from({ length: 20 }, (_, index) => ({ startIndex: index * 4, items: Array.from({ length: 4 }, (_, offset) => ({ id: `${index}-${offset}` })) }));
  const state = { enabled: true, renderToken: 1, rowRenderFrame: 0, rows, renderedKey: '', rowNodes: new Map(),
    metrics: { cardHeight: 90, cardWidth: 90, gap: 10 }, spacer: new Node(),
    instance: { getVirtualItems: () => visible.map(index => ({ index, start: index * 100 })), getTotalSize: () => 2000 } };
  const context = vm.createContext({ virtualGridState: state, document: { createElement: () => new Node(), createDocumentFragment: () => new Node(true) },
    createCard: image => { created++; const node = new Node(); node.dataset.id = image.id; return node; } });
  vm.runInContext(renderSource + '\nglobalThis.render = renderVirtualGridRows;', context);
  return { state, render: context.render, created: () => created, visible: next => { visible = next; } };
};

test('scrolling one virtual row preserves overlapping rows and creates only entering cards', () => {
  const h = harness(); h.render();
  const old = [...h.state.spacer.children];
  assert.equal(h.created(), 20);
  h.visible([1, 2, 3, 4, 5]); h.render();
  assert.equal(h.created(), 24);
  assert.deepEqual(h.state.spacer.children.slice(0, 4), old.slice(1));
  assert.equal(h.state.spacer.children[0].style.transform, 'translateY(100px)');
  assert.equal(h.state.rowNodes.has(0), false);
  assert.equal(h.state.rowNodes.size, 5);
});

test('obsolete virtual rows release references and stale renders cannot recreate them', () => {
  const h = harness(); h.render();
  h.visible([]); h.render();
  assert.equal(h.state.spacer.childElementCount, 0); assert.equal(h.state.rowNodes.size, 0);
  const created = h.created(); h.visible([9, 10]); h.render(0);
  assert.equal(h.created(), created);
  h.render(); assert.equal(h.created(), created + 8);
  assert.deepEqual([...h.state.rowNodes.keys()], [9, 10]);
});
