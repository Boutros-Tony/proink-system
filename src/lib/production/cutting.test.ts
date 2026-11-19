import { describe, expect, it } from "vitest";
import { buildCuttingPlan, bladeFor, tallyText, type CuttingMaterial } from "./cutting";
import type { ScenePart } from "../systems/modular/schema";

function sheet(id: string, name: string, width: number, height: number, priceCents: number, piece: CuttingMaterial["piece"] = "paint"): CuttingMaterial {
  return { id, name, piece, unit: "board", priceCents, boardWidthMm: width, boardHeightMm: height, thicknessMm: 18, wastePercent: 15 };
}

function panel(id: string, name: string, width: number, height: number, material: ScenePart["material"] = "paint"): ScenePart {
  return { id, name, shape: "box", x: 0, y: 0, z: 0, width, height, depth: 18, material };
}

describe("cutting plan", () => {
  const paint = [
    sheet("big", "Painted board 2 × 2 m", 2000, 2000, 10000),
    sheet("small", "Painted board 1 × 1 m", 1000, 1000, 4000),
  ];

  it("covers a 3 × 3 m panel with one 2 × 2 m board and five 1 × 1 m boards", () => {
    const plan = buildCuttingPlan([panel("wall", "Back panel", 3000, 3000)], paint);
    const group = plan.groups[0];
    const counts = Object.fromEntries(group.tally.map((line) => [line.id, line.count]));
    expect(counts).toEqual({ big: 1, small: 5 });
    expect(group.usedPercent).toBe(100);
    expect(group.oversize).toEqual(["Back panel"]);
    expect(tallyText(group)).toBe("1 board of 2 × 2 m and 5 boards of 1 × 1 m");
    expect(group.blade.kerfMm).toBe(4);
  });

  it("still starts from the large board when the small one is cheaper", () => {
    const dear = [sheet("big", "Painted board 2 × 2 m", 2000, 2000, 20000), sheet("small", "Painted board 1 × 1 m", 1000, 1000, 1000)];
    const plan = buildCuttingPlan([panel("wall", "Back panel", 3000, 3000)], dear);
    const counts = Object.fromEntries(plan.groups[0].tally.map((line) => [line.id, line.count]));
    expect(counts).toEqual({ big: 1, small: 5 });
  });

  it("fills the larger sheet first and uses the smaller sheet for the leftover", () => {
    const big = sheet("big", "Painted board 1800 × 3600", 1800, 3600, 10000);
    const small = sheet("small", "Painted board 1220 × 2440", 1220, 2440, 6000);
    const panels = Array.from({ length: 13 }, (_, index) => panel(`p${index}`, `Panel ${index + 1}`, 1100, 1700));
    const onlyBig = buildCuttingPlan(panels, [big]);
    expect(onlyBig.groups[0].tally).toEqual([expect.objectContaining({ id: "big", count: 5 })]);
    const both = buildCuttingPlan(panels, [big, small]);
    const counts = Object.fromEntries(both.groups[0].tally.map((line) => [line.id, line.count]));
    expect(counts).toEqual({ big: 4, small: 1 });
  });

  it("does not put two 1 m pieces on a 2 m board when the saw kerf will not allow it", () => {
    const plan = buildCuttingPlan([panel("strip", "Strip", 3000, 1000)], paint);
    const counts = Object.fromEntries(plan.groups[0].tally.map((line) => [line.id, line.count]));
    expect(counts).toEqual({ small: 3 });
    expect(plan.groups[0].usedPercent).toBe(100);
  });

  it("uses a second large board when the pieces cannot share one", () => {
    const onlyBig = [sheet("big", "MDF 2 × 2 m", 2000, 2000, 10000, "mdf")];
    const plan = buildCuttingPlan(
      [panel("a", "Side", 1800, 1000, "mdf"), panel("b", "Shelf", 1800, 1000, "mdf")],
      onlyBig,
    );
    expect(plan.groups[0].tally).toEqual([expect.objectContaining({ id: "big", count: 2 })]);
  });

  it("nests small pieces onto one board", () => {
    const onlyBig = [sheet("big", "MDF 2 × 2 m", 2000, 2000, 10000, "mdf")];
    const plan = buildCuttingPlan(
      [
        panel("a", "Shelf", 900, 400, "mdf"),
        panel("b", "Shelf", 900, 400, "mdf"),
        panel("c", "Shelf", 900, 400, "mdf"),
        panel("d", "Shelf", 900, 400, "mdf"),
      ],
      onlyBig,
    );
    expect(plan.groups[0].boards).toHaveLength(1);
  });

  it("joins a piece that is longer than every sheet", () => {
    const onlyBig = [sheet("big", "MDF 2 × 2 m", 2000, 2000, 10000, "mdf")];
    const plan = buildCuttingPlan([panel("long", "Long rail", 2600, 400, "mdf")], onlyBig);
    expect(plan.groups[0].oversize).toEqual(["Long rail"]);
    const pieces = plan.groups[0].boards.flatMap((board) => board.pieces);
    expect(pieces.some((piece) => piece.joinCount && piece.joinCount > 1)).toBe(true);
    expect(pieces.reduce((sum, piece) => sum + piece.width, 0)).toBe(2600);
  });

  it("suggests a sheet when the material is not in the price book", () => {
    const plan = buildCuttingPlan([panel("a", "Plexi logo", 800, 400, "glass")], []);
    const group = plan.groups[0];
    expect(group.suggested).toBe(true);
    expect(group.blade.id).toBe("acrylic");
    expect(group.boards.length).toBeGreaterThan(0);
    expect(group.suggestionNote).toMatch(/Materials/);
  });

  it("cuts acrylic pieces from the acrylic sheet in Materials, next to the painted boards", () => {
    const acrylic = sheet("acrylic-3", "Acrylic sheet 3 mm", 2440, 1220, 11000, null);
    const strips = Array.from({ length: 21 }, (_, index) => ({ ...panel(`lip${index}`, `Shelf lip ${index + 1}`, 1000, 60, "glass"), depth: 3, materialId: "acrylic-3" }));
    const plan = buildCuttingPlan([panel("back", "Back panel", 1000, 1900), ...strips], [...paint, acrylic]);
    expect(plan.groups).toHaveLength(2);
    const cut = plan.groups.find((group) => group.id === "row:acrylic-3")!;
    expect(cut.suggested).toBe(false);
    expect(cut.blade.id).toBe("acrylic");
    expect(cut.tally).toEqual([expect.objectContaining({ id: "acrylic-3", count: 1 })]);
    expect(cut.boards[0].pieces).toHaveLength(21);
    const painted = plan.groups.find((group) => group.id !== "row:acrylic-3")!;
    expect(painted.partIds).toEqual(["back"]);
  });

  it("picks the blade from the material", () => {
    expect(bladeFor("mdf", ["MDF board"]).kerfMm).toBe(4);
    expect(bladeFor("glass", ["Tempered glass"]).id).toBe("glass");
    expect(bladeFor("glass", ["Plexi letters S I C"]).id).toBe("acrylic");
    expect(bladeFor("metal", ["Aluminum sheet"]).id).toBe("metal");
  });
});
