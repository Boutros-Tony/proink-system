import { describe, expect, it } from "vitest";
import { buildCuttingPlan } from "./cutting";
import { cuttingPlanSvg } from "./cutting-svg";
import { defaultPriceBook } from "../systems/materials";
import type { ScenePart } from "../systems/modular/schema";

function box(part: Pick<ScenePart, "width" | "height" | "depth"> & Partial<ScenePart>): ScenePart {
  return { id: "p", name: "Panel", shape: "box", x: 0, y: 0, z: 0, material: "mdf", ...part };
}

function piecesOf(part: ScenePart) {
  const plan = buildCuttingPlan([part], defaultPriceBook().materials);
  return plan.groups.flatMap((group) => group.boards.flatMap((board) => board.pieces));
}

describe("cutting shapes", () => {
  const side = box({
    width: 18,
    height: 1200,
    depth: 400,
    face: "side",
    outline: [[0, 0], [400, 0], [400, 1200], [150, 1200], [50, 100], [0, 100]],
  });

  it("puts a side outline on the blank, inside the rectangle", () => {
    const piece = piecesOf(side).find((item) => item.shape);
    expect(piece?.shape?.outer).toHaveLength(6);
    const outer = piece!.shape!.outer;
    const xs = outer.map(([x]) => x);
    const ys = outer.map(([, y]) => y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(piece!.width + 0.5);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(piece!.height + 0.5);
  });

  it("draws a rounded corner as an arc of extra points", () => {
    const front = box({ width: 400, height: 1200, depth: 18, corners: { topRight: 80 } });
    const piece = piecesOf(front).find((item) => item.shape);
    expect(piece?.shape?.outer.length).toBeGreaterThan(6);
  });

  it("leaves a plain panel as a rectangle", () => {
    const plain = box({ width: 400, height: 1200, depth: 18 });
    expect(piecesOf(plain).every((piece) => piece.shape === undefined)).toBe(true);
  });

  it("draws the shaped piece as a path", () => {
    const plan = buildCuttingPlan([side], defaultPriceBook().materials);
    expect(cuttingPlanSvg(plan)).toContain("<path");
    expect(cuttingPlanSvg(plan)).toContain("shaped");
  });
});
