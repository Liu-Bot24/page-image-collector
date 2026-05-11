const normalizeNonNegativeInteger = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
};

const imageOrderKeys = (image) => [
  image?.normalized,
  image?.hdNormalized,
  image?.hdSrc,
  image?.originalSrc,
  image?.src
]
  .map((value) => String(value || "").trim())
  .filter(Boolean);

export const buildComicSequenceOrderMap = (sequence = []) => {
  const orderByKey = new Map();
  if (!Array.isArray(sequence)) return orderByKey;

  sequence.forEach((item, order) => {
    for (const key of imageOrderKeys(item)) {
      if (!orderByKey.has(key)) {
        orderByKey.set(key, order);
      }
    }
  });

  return orderByKey;
};

export const annotateComicPageImages = (images = [], sequence = [], options = {}) => {
  if (!Array.isArray(images) || images.length === 0) return [];
  const pageIndex = normalizeNonNegativeInteger(options.pageIndex);
  if (pageIndex === null) return images;

  const pageUrl = String(options.pageUrl || "").trim();
  const orderByKey = buildComicSequenceOrderMap(sequence);
  const hasSequence = orderByKey.size > 0;

  return images.map((image, scanOrder) => {
    let comicPageOrder = null;
    if (hasSequence) {
      for (const key of imageOrderKeys(image)) {
        if (orderByKey.has(key)) {
          comicPageOrder = orderByKey.get(key);
          break;
        }
      }
    } else {
      comicPageOrder = scanOrder;
    }

    if (comicPageOrder === null) return image;
    return {
      ...image,
      comicPageIndex: pageIndex,
      comicPageOrder,
      comicPageUrl: pageUrl || image?.sourceUrl || ""
    };
  });
};
