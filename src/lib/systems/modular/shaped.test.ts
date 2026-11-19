import { describe, expect, it } from "vitest";
import { buildCuttingPlan } from "../../production/cutting";
import { finishingLines } from "../finishing";
import { defaultPriceBook, partBoardAreaMm2 } from "../materials";
import { arrangeParts, checkAssembly } from "./assemble";
import { technicalSvg } from "./drawings";
import { boxGeometry } from "./front-face";
import { compileDesign } from "./compile";
import { curveShape, flatPiece, holeBounds } from "./geometry";
import { addParts, updateParts } from "./ops";
import { createEmptyDesign } from "./patch";
import type { ScenePart } from "./schema";

function sized(geometry: NonNullable<ReturnType<typeof boxGeometry>>) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map((size) => Math.round(size * 1000));
}

describe("corners on the top and side faces", () => {
  it("rounds a table top seen from above, and keeps the radius inside the top", () => {
    const { document, ids } = addParts(createEmptyDesign(), [{ name: "Top", shape: "box", x: 0, y: 700, z: 0, width: 1200, height: 30, depth: 600, face: "top", corners: { topLeft: 900, bottomRight: 100 } }]);
    const top = document.parts.find((part) => part.id === ids[0])!;
    expect(top.face).toBe("top");
    expect(top.corners?.topLeft).toBeLessThanOrEqual(600);
    expect(top.corners?.bottomRight).toBe(100);
    expect(sized(boxGeometry(top)!)).toEqual([1200, 30, 600]);
  });

  it("puts a top-face opening through the height, at the right place in plan", () => {
    const top: ScenePart = { id: "t", name: "Top", shape: "box", x: 0, y: 700, z: 0, width: 1000, height: 30, depth: 600, face: "top", holes: [{ x: 100, y: 50, width: 200, height: 100 }] };
    const [bounds] = holeBounds(top);
    expect(bounds).toMatchObject({ minX: 100, maxX: 300, minY: 700, maxY: 730, minZ: 450, maxZ: 550 });
  });

  it("draws a side face on a box seen from the right", () => {
    const side: ScenePart = { id: "s", name: "Side", shape: "box", x: 0, y: 0, z: 0, width: 18, height: 900, depth: 500, face: "side", corners: { topRight: 200 } };
    expect(sized(boxGeometry(side)!)).toEqual([18, 900, 500]);
    const document = addParts(createEmptyDesign(), [side]).document;
    expect(technicalSvg(document, compileDesign(document))).toContain("scale(-1 1)");
  });
});

describe("assembly turning a shaped piece", () => {
  const arch: ScenePart = { id: "arch", name: "Arch", shape: "box", x: 0, y: 0, z: 0, width: 1000, height: 2000, depth: 18, corners: { topLeft: 500, topRight: 500 }, holes: [{ x: 200, y: 0, width: 600, height: 1500, corners: { topLeft: 300, topRight: 300 } }] };

  it("keeps the outline when a panel is tipped onto its back", () => {
    const document = addParts(createEmptyDesign(), [arch]).document;
    const { document: laid } = arrangeParts(document, [{ id: "arch", x: 0, y: 0, z: 0, width: 1000, height: 18, depth: 2000 }]);
    const part = laid.parts[0];
    expect(part.face).toBe("top");
    expect(part.corners).toEqual(arch.corners);
    expect(part.holes).toEqual(arch.holes);
  });

  it("mirrors the outline when the two sizes trade places", () => {
    const document = addParts(createEmptyDesign(), [arch]).document;
    const { document: turned } = arrangeParts(document, [{ id: "arch", x: 0, y: 0, z: 0, width: 2000, height: 1000, depth: 18 }]);
    const part = turned.parts[0];
    expect(part.face).toBeUndefined();
    expect(part.corners).toEqual({ topRight: 500, bottomRight: 500 });
    expect(part.holes?.[0]).toMatchObject({ x: 0, y: 200, width: 1500, height: 600 });
  });

  it("will not swap the sizes of a bent panel", () => {
    const bent: ScenePart = { id: "bent", name: "Bent", shape: "box", x: 0, y: 0, z: 0, width: 1200, height: 1000, depth: 300, curve: { thickness: 9 } };
    const document = addParts(createEmptyDesign(), [bent]).document;
    const result = arrangeParts(document, [{ id: "bent", x: 0, y: 0, z: 0, width: 1000, height: 1200, depth: 300 }]);
    expect(result.rejected).toHaveLength(1);
  });

  it("still sees a piece inside a laid-down ring as fitting", () => {
    const ring: ScenePart = { id: "ring", name: "Ring", shape: "box", x: 0, y: 0, z: 0, width: 1000, height: 18, depth: 1000, face: "top", holes: [{ x: 100, y: 100, width: 800, height: 800 }] };
    const post: ScenePart = { id: "post", name: "Post", shape: "box", x: 450, y: 0, z: 450, width: 100, height: 500, depth: 100 };
    expect(checkAssembly([ring, post]).overlaps).toEqual([]);
  });
});

const blank = (part: ScenePart) => {
  const flat = flatPiece(part);
  return [flat.width, flat.height, flat.depth];
};

describe("a frame's rounded corner, bent from one board", () => {
  const corner: ScenePart = { id: "c", name: "Frame corner", shape: "box", x: 0, y: 0, z: 0, width: 100, height: 100, depth: 300, material: "paint", curve: { thickness: 18, axis: "depth", corner: "topRight" } };

  it("is a quarter circle seen from the front, cut as one flat strip", () => {
    expect(sized(boxGeometry(corner)!)).toEqual([100, 100, 300]);
    expect(flatPiece(corner)).toMatchObject({ width: Math.round((Math.PI / 2) * 91), height: 300, depth: 18 });
  });

  it("turns between seen from the front and seen from above, keeping its blank", () => {
    const { document } = addParts(createEmptyDesign(), [corner]);
    const laid = arrangeParts(document, [{ id: "c", x: 0, y: 0, z: 0, width: 100, height: 300, depth: 100 }]);
    expect(laid.rejected).toEqual([]);
    expect(laid.document.parts[0].curve).toMatchObject({ corner: "topRight", thickness: 18 });
    expect(laid.document.parts[0].curve?.axis).toBeUndefined();
    expect(blank(laid.document.parts[0])).toEqual(blank(corner));
  });

  it("lets assembly pick which corner each copy faces", () => {
    const { document } = addParts(createEmptyDesign(), [corner]);
    const placed = arrangeParts(document, [{ id: "c", x: 0, y: 1700, z: 0, width: 100, height: 100, depth: 300, corner: "topLeft" }]);
    expect(placed.document.parts[0].curve?.corner).toBe("topLeft");
  });

  it("refuses a turn that would change the board, and says how to send it", () => {
    const { document } = addParts(createEmptyDesign(), [{ ...corner, width: 100, height: 100, depth: 300 }]);
    const wrong = arrangeParts(document, [{ id: "c", x: 0, y: 0, z: 0, width: 300, height: 100, depth: 100 }]);
    expect(wrong.rejected[0]?.reason).toContain("100 × 300 × 100");
  });

  it("keeps its curve when an edit only reorders the sizes", () => {
    const { document, ids } = addParts(createEmptyDesign(), [corner]);
    const turned = updateParts(document, ids, { width: 100, height: 300, depth: 100 });
    expect(blank(turned.parts[0])).toEqual(blank(corner));
  });

  it("draws an arched header seen from the front", () => {
    const header: ScenePart = { id: "h", name: "Arch", shape: "box", x: 0, y: 1800, z: 0, width: 1200, height: 300, depth: 400, curve: { thickness: 9, axis: "depth" } };
    expect(sized(boxGeometry(header)!)).toEqual([1200, 300, 400]);
    expect(flatPiece(header).height).toBe(400);
  });
});

describe("a bent panel", () => {
  const bent: ScenePart = { id: "bent", name: "Curved front", shape: "box", x: 0, y: 0, z: 0, width: 2000, height: 1000, depth: 1000, material: "paint", curve: { thickness: 9 } };

  it("fills its box, and a half circle's blank is half the circumference", () => {
    const shape = curveShape(2000, 1000, 9);
    expect(shape.sweep).toBeCloseTo(180, 3);
    expect(shape.blank).toBeCloseTo(Math.PI * (1000 - 4.5), 3);
    expect(sized(boxGeometry(bent)!)).toEqual([2000, 1000, 1000]);
  });

  it("works out the radius from a shallow bow", () => {
    const shape = curveShape(2000, 300, 18);
    const cos = Math.cos((shape.sweep * Math.PI) / 360);
    expect(shape.outer * (1 - cos) + 18 * cos).toBeCloseTo(300, 3);
    expect(sized(boxGeometry({ ...bent, depth: 300, curve: { thickness: 18 } })!)).toEqual([2000, 1000, 300]);
  });

  it("is cut and priced as its flat blank, and adds bending labor", () => {
    const flat = flatPiece(bent);
    expect(flat).toMatchObject({ width: 3127, height: 1000, depth: 9 });
    expect(partBoardAreaMm2(bent)).toBe(3127 * 1000);
    const plan = buildCuttingPlan([bent], defaultPriceBook().materials);
    expect(plan.groups[0].boards.flatMap((board) => board.pieces).some((piece) => piece.width * piece.height >= 1000 * 1000)).toBe(true);
    const lines = finishingLines([bent], defaultPriceBook());
    expect(lines.find((line) => line.key === "FIN-lab-kerf-bend")?.quantity).toBe(1);
    expect(lines.find((line) => line.key === "FIN-fin-edge-filler")).toBeDefined();
  });

  it("drops corners and openings, and goes flat again on request", () => {
    const { document, ids } = addParts(createEmptyDesign(), [{ ...bent, corners: { topLeft: 100 } }]);
    expect(document.parts[0].corners).toBeUndefined();
    expect(updateParts(document, ids, { curve: null }).parts[0].curve).toBeUndefined();
  });
});
