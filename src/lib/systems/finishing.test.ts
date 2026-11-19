import { describe, expect, it } from "vitest";
import { finishingLines, finishingNeeds } from "./finishing";
import { defaultPriceBook, type PriceBook } from "./materials";
import type { ScenePart } from "./modular/schema";

function panel(extra: Partial<ScenePart> = {}): ScenePart {
  return { id: "p1", name: "Panel", shape: "box", x: 0, y: 0, z: 0, width: 1000, height: 2000, depth: 18, material: "paint", ...extra };
}

function book(rules: Partial<PriceBook["rules"]> = {}): PriceBook {
  const base = defaultPriceBook();
  return { ...base, rules: { ...base.rules, ...rules } };
}

const line = (lines: ReturnType<typeof finishingLines>, id: string) => lines.find((entry) => entry.key === `FIN-${id}`);

describe("edge finishing", () => {
  it("bands the four straight edges of a painted panel", () => {
    const needs = finishingNeeds([panel()], book());
    expect(needs.bandingMm).toBe(6000);
    expect(needs.fillerMm).toBe(0);
    // 6 m + 4 edges × 2 × 25 mm, plus 10%, rounded up to whole meters.
    expect(line(finishingLines([panel()], book()), "fin-edge-banding")?.quantity).toBe(7);
  });

  it("fills curved edges and the inside of a ring", () => {
    const ring = panel({ width: 1000, height: 1000, corners: { topLeft: 500, topRight: 500, bottomLeft: 500, bottomRight: 500 }, holes: [{ x: 100, y: 100, width: 800, height: 800, corners: { topLeft: 400, topRight: 400, bottomLeft: 400, bottomRight: 400 } }] });
    const needs = finishingNeeds([ring], book());
    expect(needs.bandingMm).toBeCloseTo(0, 6);
    expect(needs.fillerMm).toBeCloseTo(Math.PI * 1000 + Math.PI * 800, 3);
  });

  it("leaves no bottom edge on an opening that reaches the floor", () => {
    const arch = panel({ width: 1000, height: 1000, holes: [{ x: 200, y: 0, width: 600, height: 500 }] });
    // Outer 4000 less the 600 gap, plus the opening's two sides and top.
    expect(finishingNeeds([arch], book()).bandingMm).toBeCloseTo(4000 - 600 + 500 * 2 + 600, 6);
  });

  it("fills straight painted edges when the shop fills instead of banding", () => {
    const needs = finishingNeeds([panel()], book({ paintedEdges: "filler" }));
    expect(needs.bandingMm).toBe(0);
    expect(needs.fillerMm).toBe(6000);
  });

  it("does not finish glass, metal, equipment, or letters", () => {
    const parts = [panel({ material: "glass" }), panel({ material: "metal" }), panel({ kind: "equipment" }), panel({ shape: "letters", label: "ABC" })];
    expect(finishingLines(parts, book())).toEqual([]);
  });
});

describe("paint", () => {
  it("primes and paints both faces and the edges", () => {
    const needs = finishingNeeds([panel()], book());
    expect(needs.paintedMm2).toBe(2 * 1000 * 2000 + 6000 * 18);
    const lines = finishingLines([panel()], book());
    // 4.108 m² × 2 coats × 1.25 spray waste ÷ 12 m²/L = 0.86 L, bought by the half liter.
    expect(line(lines, "fin-primer")?.quantity).toBe(1);
    expect(line(lines, "fin-paint")?.quantity).toBe(1);
  });

  it("does not paint laminate, and leaves raw edges unbanded when the shop says so", () => {
    expect(finishingLines([panel({ material: "laminate" })], book({ rawEdges: "none" }))).toEqual([]);
  });

  it("skips primer when the shop uses no primer coats", () => {
    const lines = finishingLines([panel()], book({ primerCoats: 0 }));
    expect(line(lines, "fin-primer")).toBeUndefined();
    expect(line(lines, "fin-paint")).toBeDefined();
  });
});
