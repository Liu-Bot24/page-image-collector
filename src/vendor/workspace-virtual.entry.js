import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect
} from "@tanstack/virtual-core";

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const calculateVirtualGridMetrics = (options = {}) => {
  const containerWidth = Math.max(0, toFiniteNumber(options.containerWidth));
  const paddingLeft = Math.max(0, toFiniteNumber(options.paddingLeft));
  const paddingRight = Math.max(0, toFiniteNumber(options.paddingRight));
  const gap = Math.max(0, Math.round(toFiniteNumber(options.gap, 20)));
  const zoom = Math.max(10, toFiniteNumber(options.zoom, 100));
  const baseMinWidth = Math.max(1, toFiniteNumber(options.baseMinWidth, 220));
  const footerHeight = Math.max(0, Math.round(toFiniteNumber(options.footerHeight, 38)));
  const contentWidth = Math.max(0, containerWidth - paddingLeft - paddingRight);
  const minWidth = Math.max(1, Math.round(baseMinWidth * (zoom / 100)));
  const columns = Math.max(1, Math.floor((contentWidth + gap) / (minWidth + gap)));
  const cardWidth = Math.max(1, Math.floor((contentWidth - gap * (columns - 1)) / columns));
  const cardHeight = cardWidth + footerHeight;
  const rowHeight = cardHeight + gap;
  return {
    contentWidth,
    columns,
    cardWidth,
    cardHeight,
    rowHeight,
    gap,
    minWidth,
    footerHeight
  };
};

const buildVirtualGridRows = (images, columns) => {
  const list = Array.isArray(images) ? images : [];
  const columnCount = Math.max(1, Math.floor(toFiniteNumber(columns, 1)));
  const rows = [];
  for (let startIndex = 0; startIndex < list.length; startIndex += columnCount) {
    rows.push({
      index: rows.length,
      startIndex,
      items: list.slice(startIndex, startIndex + columnCount)
    });
  }
  return rows;
};

const createElementVirtualizer = (options = {}) => {
  const instance = new Virtualizer({
    ...options,
    scrollToFn: options.scrollToFn || elementScroll,
    observeElementRect: options.observeElementRect || observeElementRect,
    observeElementOffset: options.observeElementOffset || observeElementOffset
  });
  let cleanup = null;
  return {
    instance,
    mount() {
      if (!cleanup && typeof instance._didMount === "function") {
        cleanup = instance._didMount();
      }
      if (typeof instance._willUpdate === "function") {
        instance._willUpdate();
      }
      instance.measure();
      return instance;
    },
    refresh() {
      if (typeof instance._willUpdate === "function") {
        instance._willUpdate();
      }
      instance.measure();
      return instance;
    },
    destroy() {
      if (typeof cleanup === "function") cleanup();
      cleanup = null;
    }
  };
};

globalThis.PageImageCollectorVirtual = Object.freeze({
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  calculateVirtualGridMetrics,
  buildVirtualGridRows,
  createElementVirtualizer
});
