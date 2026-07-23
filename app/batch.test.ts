import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCrop,
  effectiveSettings,
  imageCountLabel,
  nextQueuedId,
  uniqueOutputNames,
} from "./batch.ts";

test("batch helpers keep crops centered, names unique, and active work first", () => {
  assert.deepEqual(defaultCrop(1600, 900, "square"), {
    x: 350,
    y: 0,
    width: 900,
    height: 900,
  });
  assert.deepEqual(defaultCrop(800, 1000, "free"), {
    x: 80,
    y: 100,
    width: 640,
    height: 800,
  });
  assert.deepEqual(uniqueOutputNames(["photo.webp", "photo.webp", "photo-2.webp"]), [
    "photo.webp",
    "photo-2.webp",
    "photo-2-2.webp",
  ]);
  assert.equal(
    nextQueuedId(
      [
        { id: "first", status: "queued" },
        { id: "active", status: "queued" },
      ],
      "active",
    ),
    "active",
  );
  assert.deepEqual(
    [1, 2, 5, 11, 21, 24].map(imageCountLabel),
    [
      "1 изображение",
      "2 изображения",
      "5 изображений",
      "11 изображений",
      "21 изображение",
      "24 изображения",
    ],
  );
  assert.deepEqual(
    effectiveSettings(
      { cropMode: "none", quality: 82, outputSize: 1024 },
      { cropMode: "square", quality: 92 },
    ),
    { cropMode: "square", quality: 92, outputSize: 1024 },
  );
});
