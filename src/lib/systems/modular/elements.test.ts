import { describe, expect, it } from "vitest";
import { unionBounds } from "./geometry";
import { placeElements } from "./elements";
import { createEmptyDesign } from "./patch";
import { applyDesignPatch } from "./patch";

describe("quote-mode elements", () => {
  it("adds one numbered piece per unit with the size and material given", () => {
    const { document, ids } = placeElements(createEmptyDesign(), [
      { name: "Shelf", width: 900, height: 18, depth: 300, material: "mdf", quantity: 3 },
    ]);
    expect(ids).toHaveLength(3);
    expect(document.parts.map((part) => part.name)).toEqual(["Shelf 1", "Shelf 2", "Shelf 3"]);
    expect(document.parts.every((part) => part.width === 900 && part.height === 18 && part.depth === 300 && part.material === "mdf")).toBe(true);
  });

  it("lays elements out in a row with gaps, so none overlap", () => {
    const { document } = placeElements(createEmptyDesign(), [
      { name: "Counter", width: 1800, height: 1000, depth: 600, material: "laminate" },
      { name: "Plinth", width: 1000, height: 300, depth: 500, material: "wood", quantity: 2 },
    ]);
    const boxes = document.parts.map((part) => ({ min: part.x, max: part.x + part.width }));
    for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].min).toBeGreaterThan(boxes[index - 1].max);
  });

  it("wraps to a new row instead of running off to one side", () => {
    const { document } = placeElements(createEmptyDesign(), [{ name: "Panel", width: 2000, height: 2400, depth: 18, material: "mdf", quantity: 6 }]);
    const rows = new Set(document.parts.map((part) => part.z));
    expect(rows.size).toBeGreaterThan(1);
    expect(Math.max(...document.parts.map((part) => part.x + part.width))).toBeLessThanOrEqual(6000);
  });

  it("marks assumed elements, and gives a cylinder a round footprint", () => {
    const { document } = placeElements(createEmptyDesign(), [
      { name: "Round table", shape: "cylinder", width: 1200, height: 750, material: "wood", estimated: true },
    ]);
    expect(document.parts[0].name).toBe("Round table (est.)");
    expect(document.parts[0].depth).toBe(1200);
  });

  it("places new elements clear of what is already there, and leaves existing pieces alone", () => {
    const first = placeElements(createEmptyDesign(), [{ name: "Counter", width: 1800, height: 1000, depth: 600, material: "mdf" }]);
    const second = placeElements(first.document, [{ name: "Counter", width: 1800, height: 1000, depth: 600, material: "mdf" }]);
    expect(second.document.parts).toHaveLength(2);
    expect(second.document.parts[0]).toEqual(first.document.parts[0]);
    expect(second.document.parts[1].id).not.toBe(second.document.parts[0].id);
    expect(second.document.parts[1].z).toBeGreaterThan(first.document.parts[0].z + 600);
  });

  it("makes a spaced logo one cut-letter piece, not a box per letter", () => {
    const { document } = placeElements(createEmptyDesign(), [
      { name: "Logo", text: "S I C", width: 900, height: 280, depth: 10, material: "glass", color: "#6b2430" },
    ]);
    expect(document.parts).toHaveLength(1);
    expect(document.parts[0].shape).toBe("letters");
    expect(document.parts[0].label).toBe("S I C");
    expect(document.parts[0].material).toBe("glass");
    expect(document.parts[0].depth).toBe(10);
  });

  it("stays beside a modular booth instead of inside it", () => {
    const booth = applyDesignPatch(createEmptyDesign(), {
      walls: [
        { edge: "back", bays: [{ span: 3, kind: "solid" }] },
        { edge: "left", bays: [] },
        { edge: "right", bays: [] },
        { edge: "front", bays: [] },
      ],
    });
    const { document } = placeElements(booth, [{ name: "Shelf", width: 800, height: 18, depth: 300, material: "mdf" }]);
    expect(unionBounds(document.parts)!.minX).toBeGreaterThanOrEqual(booth.envelope.width);
  });
});
