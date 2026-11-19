import { describe, expect, it } from "vitest";
import { buildCuttingPlan, shapeOnBoard } from "../../production/cutting";
import { defaultPriceBook } from "../materials";
import { technicalSvg } from "./drawings";
import { compileDesign } from "./compile";
import { clampOutline, edgeArc, faceShape, outlineMeasure, outlineRing, reverseOutline, scaleOutline, swapOutlineAxes } from "./geometry";
import { addParts } from "./ops";
import { createEmptyDesign } from "./patch";
import type { Outline, ScenePart } from "./schema";

const ARCH: Outline = [[0, 0], [1000, 0], [1000, 1500, 1], [0, 1500]];
const CLOUD: Outline = [[300, 0], [2100, 0, 1], [2100, 600, 1], [1600, 1000, 1], [800, 1000, 1], [300, 600, 1]];

function bounds(ring: [number, number][]) {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function signed(ring: [number, number][]) {
  return ring.reduce((sum, [x0, y0], index) => {
    const [x1, y1] = ring[(index + 1) % ring.length];
    return sum + x0 * y1 - x1 * y0;
  }, 0) / 2;
}

describe("arc edges on an outline", () => {
  it("reads the bulge the DXF way", () => {
    const half = edgeArc([0, 0], [1000, 0], 1)!;
    expect(half.radius).toBeCloseTo(500);
    expect(half.sweep).toBeCloseTo(Math.PI);
    const quarter = edgeArc([0, 0], [1000, 0], Math.tan(Math.PI / 8))!;
    expect(quarter.sweep).toBeCloseTo(Math.PI / 2);
    expect(quarter.radius).toBeCloseTo(1000 / Math.SQRT2);
    expect(edgeArc([0, 0], [1000, 0], 0)).toBeNull();
  });

  it("measures an arch-topped panel exactly: half circle on top, the rest straight", () => {
    const measure = outlineMeasure(ARCH);
    expect(measure.curved).toBeCloseTo(Math.PI * 500, 3);
    expect(measure.straight).toBeCloseTo(4000, 3);
    expect(measure.curvedEdges).toBe(1);
    expect(measure.area).toBeCloseTo(1000 * 1500 + (Math.PI * 500 * 500) / 2, -2);
    expect(bounds(outlineRing(ARCH)).maxY).toBeCloseTo(2000, 0);
  });

  it("follows the circle within a quarter millimeter", () => {
    for (const [x, y] of outlineRing(ARCH).filter(([, v]) => v > 1500.5)) expect(Math.abs(Math.hypot(x - 500, y - 1500) - 500)).toBeLessThan(0.26);
  });

  it("keeps the cloud as drawn, every bump on the face", () => {
    const kept = clampOutline(2400, 1400, CLOUD)!;
    expect(kept).toEqual(CLOUD);
    const box = bounds(outlineRing(kept));
    expect(box.minX).toBeGreaterThanOrEqual(-0.5);
    expect(box.maxX).toBeLessThanOrEqual(2400.5);
    expect(box.maxY).toBeLessThanOrEqual(1400.5);
    expect(box.maxY).toBeGreaterThan(1390);
  });

  it("flattens an arc only as far as it must to stay on the face", () => {
    const kept = clampOutline(1000, 1800, ARCH)!;
    const bulge = kept.find((point) => point.length === 3)![2]!;
    expect(bulge).toBeGreaterThan(0.5);
    expect(bulge).toBeLessThan(1);
    expect(bounds(outlineRing(kept)).maxY).toBeLessThanOrEqual(1800.5);
    expect(bounds(outlineRing(kept)).maxY).toBeGreaterThan(1795);
  });

  it("turns a clockwise outline round and keeps its arcs bulging the same way", () => {
    const backward = reverseOutline(CLOUD);
    expect(signed(outlineRing(backward))).toBeLessThan(0);
    expect(Math.abs(signed(outlineRing(backward)))).toBeCloseTo(signed(outlineRing(CLOUD)), -1);
    const kept = clampOutline(2400, 1400, backward)!;
    expect(signed(outlineRing(kept))).toBeCloseTo(signed(outlineRing(CLOUD)), -1);
    expect(bounds(outlineRing(kept))).toEqual(bounds(outlineRing(CLOUD)));
  });

  it("mirrors across the diagonal for a turned piece without losing the round", () => {
    const swapped = swapOutlineAxes(ARCH);
    const ring = outlineRing(swapped);
    expect(signed(ring)).toBeGreaterThan(0);
    expect(bounds(ring).maxX).toBeCloseTo(2000, 0);
    expect(bounds(ring).maxY).toBeCloseTo(1000, 0);
    expect(outlineMeasure(swapped).curved).toBeCloseTo(Math.PI * 500, 3);
  });

  it("keeps the arcs when the piece is resized", () => {
    expect(scaleOutline(ARCH, { width: 1000, height: 2000 }, { width: 500, height: 1000 })).toEqual([[0, 0], [500, 0], [500, 750, 1], [0, 750]]);
  });

  it("cuts, draws, and builds the cloud as one round piece", () => {
    const small = scaleOutline(CLOUD, { width: 2400, height: 1400 }, { width: 1800, height: 1050 });
    const cloud: ScenePart = { id: "cloud", name: "Cloud", shape: "box", x: 0, y: 0, z: 0, width: 1800, height: 1050, depth: 18, material: "mdf", outline: small };
    expect(faceShape(cloud)!.outer.length).toBeGreaterThan(100);
    const pieces = buildCuttingPlan([cloud], defaultPriceBook().materials).groups[0].boards[0].pieces;
    expect(shapeOnBoard(pieces[0])!.outer.length).toBeGreaterThan(100);
    const document = addParts(createEmptyDesign(), [cloud]).document;
    const svg = technicalSvg(document, compileDesign(document));
    expect(svg).toMatch(/ A \d/);
  });
});
