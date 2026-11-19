import { describe, expect, it } from "vitest";
import { defaultPriceBook } from "../materials";
import { seedCatalog } from "../catalog";
import { arrangeParts, checkAssembly } from "./assemble";
import { placeElements } from "./elements";
import { createEmptyDesign } from "./patch";
import { produceDesign } from "./produce";

function display() {
  return placeElements(createEmptyDesign(), [
    { name: "Side", width: 488, height: 1600, depth: 18, material: "paint", quantity: 2 },
    { name: "Back", width: 500, height: 1600, depth: 18, material: "paint" },
    { name: "Shelf", width: 464, height: 488, depth: 18, material: "paint", quantity: 2 },
  ]).document;
}

describe("assembly", () => {
  it("turns a shelf flat without changing what the job costs", () => {
    const document = display();
    const before = produceDesign(document, seedCatalog(), defaultPriceBook()).materials;
    const arranged = arrangeParts(document, [
      { id: "side-1", x: 0, y: 0, z: 0, width: 18, height: 1600, depth: 488 },
      { id: "side-2", x: 482, y: 0, z: 0, width: 18, height: 1600, depth: 488 },
      { id: "back", x: 0, y: 0, z: 0, width: 500, height: 1600, depth: 18 },
      { id: "shelf-1", x: 18, y: 400, z: 18, width: 464, height: 18, depth: 488 },
      { id: "shelf-2", x: 18, y: 900, z: 18, width: 464, height: 18, depth: 488 },
    ]);
    expect(arranged.rejected).toEqual([]);
    expect(arranged.placed).toHaveLength(5);
    expect(arranged.document.assembled).toBe(true);
    const shelf = arranged.document.parts.find((part) => part.id === "shelf-1")!;
    expect([shelf.width, shelf.height, shelf.depth]).toEqual([464, 18, 488]);
    const after = produceDesign(arranged.document, seedCatalog(), defaultPriceBook()).materials;
    expect(after.map((usage) => [usage.quantity, usage.totalCents])).toEqual(before.map((usage) => [usage.quantity, usage.totalCents]));
  });

  it("refuses a resized piece and leaves it where it was", () => {
    const document = display();
    const shelf = document.parts.find((part) => part.id === "shelf-1")!;
    const arranged = arrangeParts(document, [{ id: "shelf-1", x: 18, y: 400, z: 18, width: 500, height: 18, depth: 488 }]);
    expect(arranged.placed).toEqual([]);
    expect(arranged.rejected[0]?.reason).toContain("sizes changed");
    expect(arranged.document.parts.find((part) => part.id === "shelf-1")).toEqual(shelf);
    expect(arranged.document.assembled).toBeUndefined();
  });

  it("reports pieces that pass through each other or float", () => {
    const document = display();
    const arranged = arrangeParts(document, [
      { id: "side-1", x: 0, y: 0, z: 0, width: 18, height: 1600, depth: 488 },
      { id: "back", x: 0, y: 0, z: 0, width: 500, height: 1600, depth: 18 },
      { id: "shelf-1", x: 0, y: 400, z: 0, width: 464, height: 18, depth: 488 },
      { id: "shelf-2", x: 2000, y: 900, z: 2000, width: 464, height: 18, depth: 488 },
    ]);
    const check = checkAssembly(arranged.document.parts);
    expect(check.overlaps.some((line) => line.includes("shelf-1") && line.includes("side-1"))).toBe(true);
    expect(check.floating.some((line) => line.includes("shelf-2"))).toBe(true);
  });

  it("counts pieces that meet face to face as touching, not clashing", () => {
    const document = display();
    const arranged = arrangeParts(document, [
      { id: "back", x: 0, y: 0, z: 0, width: 500, height: 1600, depth: 18 },
      { id: "side-1", x: 0, y: 0, z: 18, width: 18, height: 1600, depth: 488 },
      { id: "side-2", x: 482, y: 0, z: 18, width: 18, height: 1600, depth: 488 },
      { id: "shelf-1", x: 18, y: 400, z: 18, width: 464, height: 18, depth: 488 },
      { id: "shelf-2", x: 18, y: 900, z: 18, width: 464, height: 18, depth: 488 },
    ]);
    expect(arranged.rejected).toEqual([]);
    expect(checkAssembly(arranged.document.parts)).toEqual({ overlaps: [], floating: [] });
  });

  it("marks a job unassembled again when new pieces arrive", () => {
    const arranged = arrangeParts(display(), [{ id: "back", x: 0, y: 0, z: 0, width: 500, height: 1600, depth: 18 }]);
    expect(arranged.document.assembled).toBe(true);
    const more = placeElements(arranged.document, [{ name: "Header", width: 500, height: 200, depth: 18, material: "paint" }]);
    expect(more.document.assembled).toBeUndefined();
  });
});
