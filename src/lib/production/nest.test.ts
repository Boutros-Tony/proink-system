import { describe, expect, it } from "vitest";
import type { ScenePart } from "../systems/modular/schema";
import { buildCuttingPlan, cutterGap, shapeOnBoard, type CuttingMaterial } from "./cutting";
import { nestPair } from "./nest";

const metalSheet: CuttingMaterial = {
  id: "aluminum-sheet-3",
  name: "Aluminum sheet 3 mm",
  piece: "metal",
  unit: "board",
  priceCents: 9000,
  boardWidthMm: 2000,
  boardHeightMm: 1000,
  thicknessMm: 3,
  wastePercent: 10,
};

/** A metal side 1750 long, 400 high at one end and 150 at the other. */
function side(id: string): ScenePart {
  return { id, name: `Side ${id}`, shape: "box", x: 0, y: 0, z: 0, width: 1750, height: 400, depth: 3, material: "metal", outline: [[0, 0], [1750, 0], [1750, 150], [0, 400]] };
}

function inside(point: [number, number], ring: [number, number][]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

describe("shaped pieces nested in pairs", () => {
  it("lays two sloped sides head to tail", () => {
    const shape = { outer: side("a").outline! as [number, number][], holes: [] };
    const layout = nestPair({ w: 1750, h: 400, shape }, { w: 1750, h: 400, shape }, 1)!;
    expect(layout.second.flipped).toBe(true);
    expect(layout.w).toBe(1750);
    expect(layout.h).toBeLessThan(560);
  });

  it("turns the lower one when both sides have a flat top and a sloped bottom with a toe", () => {
    const outer: [number, number][] = [[0, 0], [80, 0], [80, 30], [1750, 310], [1750, 400], [0, 400]];
    const layout = nestPair({ w: 1750, h: 400, shape: { outer, holes: [] } }, { w: 1750, h: 400, shape: { outer, holes: [] } }, 1)!;
    expect(layout).not.toBeNull();
    expect(layout.first.flipped).not.toBe(layout.second.flipped);
    expect(layout.h).toBeLessThan(560);
    const part = (id: string): ScenePart => ({ ...side(id), outline: outer });
    const pieces = buildCuttingPlan([part("sp1"), part("sp2")], [metalSheet]).groups[0].boards[0].pieces;
    expect(pieces.every((piece) => piece.nested)).toBe(true);
    const [one, two] = pieces.map((piece) => shapeOnBoard(piece)!.outer);
    const centroid = (ring: [number, number][]) => ring.reduce(([sx, sy], [x, y]) => [sx + x / ring.length, sy + y / ring.length], [0, 0]) as [number, number];
    expect(inside(centroid(one), two)).toBe(false);
    expect(inside(centroid(two), one)).toBe(false);
  });

  it("leaves pieces alone when nesting saves nothing", () => {
    const square = { outer: [[0, 0], [500, 0], [500, 500], [0, 500]] as [number, number][], holes: [] };
    expect(nestPair({ w: 500, h: 500, shape: square }, { w: 500, h: 500, shape: square }, 3)).toBeNull();
  });

  it("puts three sides on one 2 × 1 m laser-cut sheet without overlap, where rectangles need two", () => {
    const plan = buildCuttingPlan(["a", "b", "c"].map(side), [metalSheet]);
    const group = plan.groups[0];
    expect(group.blade.title).toContain("Laser");
    expect(group.boards).toHaveLength(1);
    const shapes = group.boards[0].pieces.map((piece) => shapeOnBoard(piece)!.outer);
    for (const ring of shapes) for (const [x, y] of ring) expect(x >= -0.01 && x <= 2000.01 && y >= -0.01 && y <= 1000.01).toBe(true);
    for (let a = 0; a < shapes.length; a += 1) {
      for (let b = 0; b < shapes.length; b += 1) {
        if (a === b) continue;
        const [cx, cy] = shapes[a].reduce(([sx, sy], [x, y]) => [sx + x / shapes[a].length, sy + y / shapes[a].length], [0, 0]);
        expect(inside([cx, cy], shapes[b])).toBe(false);
      }
    }
  });

  it("spaces pieces by the cutter and the thickness", () => {
    expect(cutterGap("laser", "metal", 1, 3)).toBe(1.5);
    expect(cutterGap("laser", "metal", 3, 3)).toBe(2);
    expect(cutterGap("laser", "metal", 6, 3)).toBe(2.5);
    expect(cutterGap("laser", "metal", 10, 3)).toBe(3);
    expect(cutterGap("laser", "glass", 5, 3)).toBe(5);
    expect(cutterGap("laser", "glass", 2, 3)).toBe(3);
    expect(cutterGap("cnc", "mdf", 18, 4)).toBe(9);
    expect(cutterGap("saw", "mdf", 18, 4)).toBe(4);
  });

  it("keeps the edge margin clear and never turns a grained board a quarter turn", () => {
    const board: CuttingMaterial = { id: "mdf-grain", name: "MDF", piece: "mdf", unit: "board", priceCents: 1000, boardWidthMm: 2440, boardHeightMm: 1220, thicknessMm: 18, wastePercent: 10 };
    const materials: CuttingMaterial[] = [{ ...board, cutter: "cnc", grain: true, edgeMarginMm: 15 }];
    const tall = (id: string): ScenePart => ({ id, name: id, shape: "box", x: 0, y: 0, z: 0, width: 300, height: 1100, depth: 18, material: "mdf", materialId: board.id });
    const pieces = buildCuttingPlan(["a", "b", "c"].map(tall), materials).groups[0].boards.flatMap((sheet) => sheet.pieces);
    expect(pieces).toHaveLength(3);
    for (const piece of pieces) {
      expect(piece.rotated).toBe(false);
      expect(piece.x).toBeGreaterThanOrEqual(15);
      expect(piece.y).toBeGreaterThanOrEqual(15);
      expect(piece.x + piece.width).toBeLessThanOrEqual(2440 - 15);
      expect(piece.y + piece.height).toBeLessThanOrEqual(1220 - 15);
    }
  });

  it("uses the saw when the material says so", () => {
    const materials: CuttingMaterial[] = [{ ...metalSheet, cutter: "saw" }];
    expect(buildCuttingPlan([side("a")], materials).groups[0].blade.kerfMm).toBe(3);
  });
});
