import { describe, expect, it } from "vitest";
import { buildCuttingPlan } from "../../production/cutting";
import { defaultPriceBook, partBoardAreaMm2 } from "../materials";
import { compileDesign } from "./compile";
import { technicalSvg } from "./drawings";
import { addParts, updateParts } from "./ops";
import { createEmptyDesign } from "./patch";
import { rolledFromSheet, roundBlanks, roundMeasure, tubeLength } from "./round";
import { roundGeometry, tubeGeometry } from "./round-geometry";
import type { PartDraft, ScenePart } from "./schema";

const add = (draft: PartDraft) => addParts(createEmptyDesign(), [draft]).document.parts[0];

function size(part: Pick<ScenePart, "width" | "height" | "depth" | "face" | "path" | "closed" | "round">, geometry: ReturnType<typeof roundGeometry>) {
  geometry!.computeBoundingBox();
  const box = geometry!.boundingBox!;
  return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map((value) => Math.round(value * 1000));
}

describe("round pieces", () => {
  it("keeps a cone, a wall, and a part circle, and drops a plain cylinder's round", () => {
    const cone = add({ name: "Cone", shape: "cylinder", x: 0, y: 0, z: 0, width: 600, height: 900, depth: 600, round: { top: 0 } });
    expect(cone.round).toEqual({ top: 0 });
    const plain = add({ name: "Drum", shape: "cylinder", x: 0, y: 0, z: 0, width: 600, height: 900, depth: 600, round: { top: 600 } });
    expect(plain.round).toBeUndefined();
    const half = add({ name: "Half column", shape: "cylinder", x: 0, y: 0, z: 0, width: 600, height: 2400, depth: 600, round: { sweep: 180, wall: 900 } });
    expect(half.round).toEqual({ sweep: 180 });
  });

  it("measures a hollow drum and a dome by Pappus", () => {
    const drum = roundMeasure({ width: 1000, height: 1000, round: { wall: 100 } });
    expect(drum.volume / 1e9).toBeCloseTo(Math.PI * (0.25 - 0.16), 2);
    const dome = roundMeasure({ width: 1200, height: 600, round: { profile: [[600, 0, 0.414], [0, 600]] } });
    expect(dome.volume / 1e9).toBeCloseTo((2 / 3) * Math.PI * 0.6 ** 3, 2);
    expect(dome.surface / 1e6).toBeCloseTo(2 * Math.PI * 0.36 + Math.PI * 0.36, 1);
  });

  it("cuts a rolled half column from sheet and leaves a dome to the turner", () => {
    const half = { width: 600, height: 2400, round: { sweep: 180 } };
    const blanks = roundBlanks(half);
    expect(blanks[0]).toEqual({ w: Math.ceil(Math.PI * 300), h: 2400, detail: "unrolled side" });
    expect(blanks.filter((blank) => blank.detail === "cut face")).toHaveLength(2);
    const dome = { width: 1200, height: 600, round: { profile: [[600, 0, 0.414], [0, 600]] as [number, number, number][] } };
    expect(rolledFromSheet(dome)).toBe(false);
    expect(roundBlanks(dome)).toEqual([]);
    const part = add({ name: "Dome", shape: "cylinder", x: 0, y: 0, z: 0, depth: 1200, material: "mdf", ...dome });
    expect(partBoardAreaMm2(part)).toBe(0);
    expect(buildCuttingPlan([part], defaultPriceBook().materials).groups.flatMap((group) => group.boards)).toHaveLength(0);
  });

  it("builds each shape to its own size, a part circle facing the front", () => {
    const cone = size({ width: 600, height: 900, depth: 600 }, roundGeometry({ width: 600, height: 900, round: { top: 0 } }));
    expect(cone).toEqual([600, 900, 600]);
    const half = roundGeometry({ width: 600, height: 2400, round: { sweep: 180 } })!;
    half.computeBoundingBox();
    expect(Math.round(half.boundingBox!.min.z * 1000)).toBe(0);
    expect(Math.round(half.boundingBox!.max.z * 1000)).toBe(300);
    const ball = size({ width: 600, height: 600, depth: 600 }, roundGeometry({ width: 600, height: 600, round: { profile: [[0, 0, 1], [0, 600]] } }));
    expect(ball).toEqual([600, 600, 600]);
  });

  it("scales a profile when the piece is resized", () => {
    const document = addParts(createEmptyDesign(), [{ id: "dome", name: "Dome", shape: "cylinder", x: 0, y: 0, z: 0, width: 1200, height: 600, depth: 1200, round: { profile: [[600, 0, 0.414], [0, 600]] } }]).document;
    const resized = updateParts(document, ["dome"], { width: 600, height: 300 }).parts[0];
    expect(resized.round?.profile).toEqual([[300, 0, 0.414], [0, 300]]);
  });
});

describe("tubes", () => {
  it("closes a two-point hoop and measures it as a full circle", () => {
    const hoop = add({ name: "Hoop", shape: "tube", x: 0, y: 0, z: 0, width: 1000, height: 1000, depth: 40, path: [[0, 500, 1], [1000, 500, 1]], closed: true });
    expect(hoop.closed).toBe(true);
    expect(tubeLength(hoop)).toBeCloseTo(Math.PI * 1000, 0);
    for (const [got, want] of size(hoop, tubeGeometry(hoop)).map((value, index) => [value, [1040, 1040, 40][index]])) expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
  });

  it("lays a path on the top face flat, and gives a tube no board", () => {
    const rail = add({ name: "Rail", shape: "tube", x: 0, y: 0, z: 0, width: 2000, height: 40, depth: 600, face: "top", path: [[0, 0], [2000, 0, 0.3], [2000, 600]], material: "metal" });
    const geometry = tubeGeometry(rail)!;
    geometry.computeBoundingBox();
    expect(Math.round((geometry.boundingBox!.max.y - geometry.boundingBox!.min.y) * 1000)).toBe(40);
    expect(partBoardAreaMm2(rail)).toBe(0);
    expect(buildCuttingPlan([rail], defaultPriceBook().materials).groups.flatMap((group) => group.boards)).toHaveLength(0);
  });

  it("gives a tube with no path a straight one through the middle, and draws it", () => {
    const document = addParts(createEmptyDesign(), [{ name: "Neon", shape: "tube", x: 0, y: 1000, z: 0, width: 800, height: 200, depth: 12 }]).document;
    expect(document.parts[0].path).toEqual([[0, 100], [800, 100]]);
    const svg = technicalSvg(document, compileDesign(document));
    expect(svg).toContain('stroke-linecap="round"');
  });
});
