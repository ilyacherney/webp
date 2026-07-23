import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCrop,
  effectiveSettings,
  imageCountLabel,
  nextQueuedId,
  outputDimensions,
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
  assert.deepEqual(outputDimensions(3000, 2000, 0, "none", null), {
    width: 3000,
    height: 2000,
  });
  assert.deepEqual(
    outputDimensions(3000, 2000, 0, "free", {
      x: 300,
      y: 200,
      width: 1800,
      height: 1200,
    }),
    { width: 1800, height: 1200 },
  );
  assert.deepEqual(outputDimensions(3000, 2000, 1024, "none", null), {
    width: 1024,
    height: 683,
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
      { cropMode: "none", quality: 82, outputSize: 0 },
      { cropMode: "square", quality: 92 },
    ),
    { cropMode: "square", quality: 92, outputSize: 0 },
  );
});
