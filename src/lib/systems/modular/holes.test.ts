import { describe, expect, it } from "vitest";
import { checkAssembly } from "./assemble";
import { frontFaceGeometry } from "./front-face";
import { clampHoles, HOLE_RIM_MM } from "./geometry";
import { addParts, updateParts } from "./ops";
import { createEmptyDesign } from "./patch";
import type { ScenePart } from "./schema";

const round = (size: number) => ({ topLeft: size / 2, topRight: size / 2, bottomLeft: size / 2, bottomRight: size / 2 });

function ring(): ScenePart {
  return { id: "ring", name: "Ring", shape: "box", x: 0, y: 0, z: 0, width: 2000, height: 2000, depth: 300, corners: round(2000), holes: [{ x: 200, y: 200, width: 1600, height: 1600, corners: round(1600) }] };
}

function volume(geometry: NonNullable<ReturnType<typeof frontFaceGeometry>>) {
  const position = geometry.getAttribute("position");
  let total = 0;
  for (let i = 0; i < position.count; i += 3) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2].flatMap((k) => [position.getX(i + k), position.getY(i + k), position.getZ(i + k)]);
    total += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(total);
}

describe("openings through a box", () => {
  it("cuts a round hole out of a round board, leaving a ring", () => {
    const geometry = frontFaceGeometry(2000, 2000, 300, round(2000), undefined, ring().holes)!;
    const ringArea = Math.PI * (1 ** 2 - 0.8 ** 2);
    expect(volume(geometry)).toBeCloseTo(ringArea * 0.3, 2);
  });

  it("cuts an arch open at the bottom", () => {
    const arch = [{ x: 300, y: 0, width: 1400, height: 1900, corners: { topLeft: 700, topRight: 700 } }];
    const geometry = frontFaceGeometry(2000, 2600, 200, { topLeft: 1000, topRight: 1000 }, undefined, arch)!;
    const outer = 2 * 1.6 + (Math.PI * 1 ** 2) / 2;
    const opening = 1.4 * 1.2 + (Math.PI * 0.7 ** 2) / 2;
    expect(volume(geometry)).toBeCloseTo((outer - opening) * 0.2, 2);
  });

  it("keeps a rim of board around a closed opening and drops overlapping ones", () => {
    const kept = clampHoles(1000, 1000, [
      { x: 0, y: 3, width: 2000, height: 2000 },
      { x: 400, y: 400, width: 100, height: 100 },
    ]);
    expect(kept).toEqual([{ x: HOLE_RIM_MM, y: HOLE_RIM_MM, width: 1000 - 2 * HOLE_RIM_MM, height: 1000 - 2 * HOLE_RIM_MM }]);
  });

  it("keeps an arch clear of rounded bottom corners and squares its bottom", () => {
    const [arch] = clampHoles(1000, 1000, [{ x: 0, y: 0, width: 600, height: 500, corners: round(600) }], { bottomLeft: 100 })!;
    expect(arch.x).toBe(100 + HOLE_RIM_MM);
    expect(arch.corners?.bottomLeft).toBeUndefined();
    expect(arch.corners?.topLeft).toBeGreaterThan(0);
  });

  it("saves openings on a box and drops them from a cylinder", () => {
    const { document, ids } = addParts(createEmptyDesign(), [{ ...ring(), id: undefined }]);
    expect(document.parts[0].holes).toHaveLength(1);
    const turned = updateParts(document, ids, { shape: "cylinder" });
    expect(turned.parts[0].holes).toBeUndefined();
  });

  it("lets a shelf sit inside a ring without calling it a clash", () => {
    const shelf: ScenePart = { id: "shelf", name: "Shelf", shape: "box", x: 400, y: 900, z: 0, width: 1200, height: 18, depth: 300 };
    expect(checkAssembly([ring(), shelf]).overlaps).toEqual([]);
    const through: ScenePart = { ...shelf, id: "through", x: 0, width: 2000 };
    expect(checkAssembly([ring(), through]).overlaps).toHaveLength(1);
  });
});
