import { describe, expect, it } from "vitest";
import { faceSize, freeFace, imageLayout, withImage } from "./images";
import { IMAGE_FACES, designDocumentSchema } from "./schema";
import { createEmptyDesign } from "./patch";
import { addParts, duplicateParts, updateParts } from "./ops";

const box = { shape: "box" as const, width: 1000, height: 500, depth: 400 };

describe("faceSize", () => {
  it("uses the right pair of sides for each face of a box", () => {
    expect(faceSize(box, "front")).toEqual({ width: 1000, height: 500 });
    expect(faceSize(box, "right")).toEqual({ width: 400, height: 500 });
    expect(faceSize(box, "top")).toEqual({ width: 1000, height: 400 });
  });

  it("wraps a cylinder around its circumference", () => {
    const size = faceSize({ shape: "cylinder", width: 200, height: 800, depth: 200 }, "front");
    expect(size.width).toBeCloseTo(Math.PI * 200);
    expect(size.height).toBe(800);
  });
});

describe("imageLayout", () => {
  it("fits a wide logo inside the face without stretching it", () => {
    const layout = imageLayout(box, { assetId: "a" }, 4);
    expect(layout.width).toBe(1000);
    expect(layout.height).toBe(250);
  });

  it("fits a tall logo by height", () => {
    const layout = imageLayout(box, { assetId: "a" }, 0.5);
    expect(layout.height).toBe(500);
    expect(layout.width).toBe(250);
  });

  it("shrinks with scale and cannot slide off the face", () => {
    const layout = imageLayout(box, { assetId: "a", scale: 0.5, x: 0.5, y: -0.5 }, 1);
    expect(layout.width).toBe(250);
    expect(layout.offsetX).toBe(375);
    expect(layout.offsetY).toBe(-125);
  });

  it("fills the face and crops the long side of a photo", () => {
    const layout = imageLayout(box, { assetId: "a", fit: "cover" }, 4);
    expect(layout.width).toBe(1000);
    expect(layout.height).toBe(500);
    // The face is 2:1 and the photo is 4:1, so half the width is cropped.
    expect(layout.uv.u0).toBeCloseTo(0.25);
    expect(layout.uv.u1).toBeCloseTo(0.75);
    expect(layout.uv.v0).toBe(0);
  });

  it("keeps a logo on the front half of a cylinder", () => {
    const layout = imageLayout({ shape: "cylinder", width: 400, height: 800, depth: 400 }, { assetId: "a" }, 1);
    expect(layout.area.width).toBeCloseTo((Math.PI * 400) / 2);
    expect(layout.width).toBeLessThanOrEqual(layout.area.width);
  });
});

describe("pictures on pieces", () => {
  it("replaces the picture on a face and keeps the others", () => {
    const first = withImage(undefined, { assetId: "a", face: "front" });
    const second = withImage(first, { assetId: "b", face: "top" });
    const third = withImage(second, { assetId: "c", face: "front" });
    expect(third.map((image) => `${image.face}:${image.assetId}`).sort()).toEqual(["front:c", "top:b"]);
  });

  it("offers the first face that is still free", () => {
    expect(freeFace([{ assetId: "a", face: "front" }], IMAGE_FACES)).toBe("back");
    expect(freeFace(undefined, IMAGE_FACES)).toBe("front");
  });

  it("saves images with the design, copies them on duplicate, and clears them with an empty list", () => {
    const base = createEmptyDesign();
    const added = addParts(base, [
      { name: "Counter", shape: "box", x: 0, y: 0, z: 0, width: 1000, height: 900, depth: 500, images: [{ assetId: "logo", face: "front", fit: "contain", scale: 0.6 }] },
    ]);
    expect(added.document.parts[0].images).toEqual([{ assetId: "logo", face: "front", fit: "contain", scale: 0.6 }]);
    expect(designDocumentSchema.safeParse(added.document).success).toBe(true);

    const copy = duplicateParts(added.document, added.ids);
    expect(copy.document.parts[1].images).toEqual(added.document.parts[0].images);

    const cleared = updateParts(added.document, added.ids, { images: [] });
    expect(cleared.parts[0].images).toBeUndefined();
  });

  it("rejects a picture that is scaled outside its range", () => {
    const base = createEmptyDesign();
    expect(() =>
      addParts(base, [{ name: "Box", shape: "box", x: 0, y: 0, z: 0, width: 100, height: 100, depth: 100, images: [{ assetId: "a", scale: 4 }] }]),
    ).toThrow();
  });
});
