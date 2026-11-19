import { describe, expect, it } from "vitest";
import { buildCuttingPlan } from "../../production/cutting";
import { defaultPriceBook } from "../materials";
import { arrangeParts, checkAssembly } from "./assemble";
import { technicalSvg } from "./drawings";
import { compileDesign } from "./compile";
import { partBounds } from "./geometry";
import { addParts, updateParts } from "./ops";
import { createEmptyDesign } from "./patch";
import type { ScenePart } from "./schema";

const board: ScenePart = { id: "roof", name: "Roof board", shape: "box", x: 0, y: 1491, z: 0, width: 1000, height: 18, depth: 100, material: "mdf", tilt: 45 };
const block: ScenePart = { id: "block", name: "Block", shape: "box", x: 700, y: 0, z: 0, width: 300, height: 1200, depth: 100, material: "mdf" };

describe("a tilted board", () => {
  it("reaches as far as its slope, around its own center", () => {
    const bounds = partBounds({ ...board, width: 600, tilt: 30 });
    const across = 300 * Math.cos(Math.PI / 6) + 9 * Math.sin(Math.PI / 6);
    const up = 300 * Math.sin(Math.PI / 6) + 9 * Math.cos(Math.PI / 6);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(across * 2, 3);
    expect((bounds.minY + bounds.maxY) / 2).toBeCloseTo(1500, 3);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(up * 2, 3);
  });

  it("does not clash with a piece its straight bounds only seem to reach", () => {
    // The board rises to the right, so it passes well above the block even though their bounds overlap.
    expect(checkAssembly([board, block]).overlaps).toEqual([]);
  });

  it("still reports a real clash", () => {
    // Sloping down to the right, its low end goes into the block.
    expect(checkAssembly([{ ...board, tilt: -45 }, block]).overlaps).toHaveLength(1);
  });

  it("rests on what it touches instead of floating", () => {
    // A 600 board at 45°: its lowest corner is 205.8 mm left of its center and 218.5 mm below it.
    const below = 300 * Math.SQRT1_2 + 9 * Math.SQRT1_2;
    const post: ScenePart = { ...block, id: "post", x: 80, width: 50, height: 1200 };
    const rafter: ScenePart = { ...board, x: 0, width: 600, y: 1200 + below - 9, tilt: 45 };
    const check = checkAssembly([post, rafter]);
    expect(check.overlaps).toEqual([]);
    expect(check.floating.some((line) => line.includes("roof"))).toBe(false);
  });

  it("is cut and priced at its true flat size", () => {
    const plan = buildCuttingPlan([board], defaultPriceBook().materials);
    const sizes = plan.groups.flatMap((group) => group.boards.flatMap((sheet) => sheet.pieces)).map((piece) => [piece.width, piece.height].sort((a, b) => a - b));
    expect(sizes).toContainEqual([100, 1000]);
  });

  it("is kept by assembly and by edits, and a level tilt is dropped", () => {
    const { document } = addParts(createEmptyDesign(), [{ ...board, tilt: undefined }]);
    const laid = arrangeParts(document, [{ id: "roof", x: 0, y: 1500, z: 0, width: 1000, height: 18, depth: 100, tilt: 390 }]);
    expect(laid.document.parts[0].tilt).toBe(30);
    const level = updateParts(laid.document, ["roof"], { tilt: 0 });
    expect(level.parts[0].tilt).toBeUndefined();
    const round = addParts(createEmptyDesign(), [{ id: "pole", name: "Pole", shape: "cylinder", x: 0, y: 0, z: 0, width: 60, height: 900, depth: 60, tilt: 20 }]);
    expect(round.document.parts[0].tilt).toBeUndefined();
  });

  it("is drawn sloped in the front view", () => {
    const { document } = addParts(createEmptyDesign(), [board]);
    expect(technicalSvg(document, compileDesign(document))).toContain("rotate(-45");
  });
});
