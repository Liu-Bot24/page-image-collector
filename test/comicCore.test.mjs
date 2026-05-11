import test from "node:test";
import assert from "node:assert/strict";

import { annotateComicPageImages } from "../shared/comicCore.js";

test("annotates pagination images with page index and within-page order", () => {
  const images = [
    { src: "https://cdn.example.com/p2-b.jpg", normalized: "https://cdn.example.com/p2-b.jpg" },
    { src: "https://cdn.example.com/p2-a-thumb.jpg", normalized: "https://cdn.example.com/p2-a-thumb.jpg" },
    { src: "https://cdn.example.com/unmatched.jpg", normalized: "https://cdn.example.com/unmatched.jpg" }
  ];
  const sequence = [
    {
      normalized: "https://cdn.example.com/p2-a-thumb.jpg",
      hdNormalized: "https://cdn.example.com/p2-a.jpg"
    },
    {
      normalized: "https://cdn.example.com/p2-b.jpg",
      hdNormalized: ""
    }
  ];

  const annotated = annotateComicPageImages(images, sequence, {
    pageIndex: 2,
    pageUrl: "https://comic.example.com/2"
  });

  assert.equal(annotated[0].comicPageIndex, 2);
  assert.equal(annotated[0].comicPageOrder, 1);
  assert.equal(annotated[0].comicPageUrl, "https://comic.example.com/2");
  assert.equal(annotated[1].comicPageIndex, 2);
  assert.equal(annotated[1].comicPageOrder, 0);
  assert.equal(annotated[2].comicPageIndex, undefined);
});
