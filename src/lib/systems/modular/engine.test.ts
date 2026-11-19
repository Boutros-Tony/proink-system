import { describe, expect, it } from "vitest";
import { seedCatalog } from "../catalog";
import { defaultPriceBook, type PriceBook } from "../materials";
import { getBoothSystem } from "../registry";
import { compileDesign } from "./compile";
import { planSvg, technicalSvg } from "./drawings";
import { applyDesignPatch, createEmptyDesign, createInlineBooth } from "./patch";
import { produceDesign } from "./produce";
import { openDesignDocument } from "./schema";
import { hasBlockingIssues, validateDesign } from "./validate";

const catalog = seedCatalog();

function inline() {
  return createInlineBooth();
}

describe("modular exhibition compiler", () => {
  it("builds a 3×3 m inline booth with shared corner posts", () => {
    const model = compileDesign(inline());
    expect(model.posts).toHaveLength(10);
    expect(model.panels).toHaveLength(9);
    expect(model.beams).toHaveLength(18);
    expect(model.panels.filter((panel) => panel.edge === "front")).toHaveLength(0);
    expect(model.panels[0]).toMatchObject({ width: 960, height: 2920, kind: "graphic" });
  });

  it("omits the base beam across a door", () => {
    const document = inline();
    const back = document.walls.find((wall) => wall.edge === "back");
    if (!back) throw new Error("missing back wall");
    back.bays[1] = { span: 1, kind: "door" };
    const model = compileDesign(document);
    const backBeams = model.beams.filter((beam) => beam.edge === "back");
    expect(backBeams.filter((beam) => beam.level === "base")).toHaveLength(2);
    expect(backBeams.filter((beam) => beam.level === "head")).toHaveLength(3);
  });
});

describe("validation rules", () => {
  it("accepts the inline booth with an artwork warning only", () => {
    const issues = validateDesign(inline(), catalog);
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(issues.map((issue) => issue.code)).toEqual(["graphic.artwork", "graphic.artwork", "graphic.artwork"]);
  });

  it("flags envelope width, depth, and height", () => {
    const narrow = applyDesignPatch(inline(), { envelope: { width: 500 } });
    expect(validateDesign(narrow, catalog).some((issue) => issue.code === "envelope.width")).toBe(true);
    const shallow = applyDesignPatch(inline(), { envelope: { depth: 13000 } });
    expect(validateDesign(shallow, catalog).some((issue) => issue.code === "envelope.depth")).toBe(true);
    const short = applyDesignPatch(inline(), { envelope: { height: 2000 } });
    expect(validateDesign(short, catalog).some((issue) => issue.code === "envelope.height")).toBe(true);
  });

  it("flags a module that does not divide the edge", () => {
    const document = { ...inline(), module: 800 };
    expect(validateDesign(document, catalog).some((issue) => issue.code === "edge.module")).toBe(true);
  });

  it("flags bay spans that do not cover the edge", () => {
    const document = inline();
    const back = document.walls.find((wall) => wall.edge === "back");
    if (!back) throw new Error("missing back wall");
    back.bays = back.bays.slice(0, 2);
    expect(validateDesign(document, catalog).some((issue) => issue.code === "edge.span")).toBe(true);
  });

  it("flags a panel larger than the sheet", () => {
    const document = inline();
    const back = document.walls.find((wall) => wall.edge === "back");
    if (!back) throw new Error("missing back wall");
    back.bays = [{ span: 3, kind: "graphic", finishId: "white" }];
    expect(validateDesign(document, catalog).some((issue) => issue.code === "panel.size")).toBe(true);
  });

  it("flags a door narrower than 900 mm", () => {
    const document = createInlineBooth({ width: 1600, depth: 1600 });
    document.module = 800;
    document.walls = document.walls.map((wall) => {
      if (wall.edge === "back") {
        return { edge: wall.edge, bays: [{ span: 1, kind: "door" }, { span: 1, kind: "solid" }] };
      }
      return { edge: wall.edge, bays: [{ span: 1, kind: "solid" }, { span: 1, kind: "solid" }] };
    });
    const issues = validateDesign(document, catalog);
    expect(issues.some((issue) => issue.code === "door.width")).toBe(true);
  });

  it("flags a counter outside the envelope", () => {
    const document = applyDesignPatch(inline(), {
      features: [
        { id: "counter-1", type: "counter", edge: "back", bayIndex: 1, width: 900, depth: 3500, height: 1100 },
        { id: "floor-1", type: "floor", materialId: "FLR-CARPET" },
      ],
    });
    expect(validateDesign(document, catalog).some((issue) => issue.code === "counter.inside")).toBe(true);
  });

  it("flags a counter that occupies a post", () => {
    const document = applyDesignPatch(inline(), {
      features: [
        { id: "counter-1", type: "counter", edge: "back", bayIndex: 1, width: 1500, depth: 600, height: 1100 },
        { id: "floor-1", type: "floor", materialId: "FLR-CARPET" },
      ],
    });
    const issues = validateDesign(document, catalog);
    expect(issues.some((issue) => issue.code === "counter.post")).toBe(true);
    expect(issues.some((issue) => issue.code === "counter.inside")).toBe(false);
  });

  it("flags a booth with no closed wall", () => {
    const document = inline();
    document.walls = document.walls.map((wall) => ({
      edge: wall.edge,
      bays: wall.bays.map((bay) => ({ span: bay.span, kind: "open" as const })),
    }));
    expect(validateDesign(document, catalog).some((issue) => issue.code === "structure.missing")).toBe(true);
  });

  it("flags a graphic bay without a finish and warns when artwork is missing", () => {
    const document = inline();
    const back = document.walls.find((wall) => wall.edge === "back");
    if (!back) throw new Error("missing back wall");
    back.bays[0] = { span: 1, kind: "graphic" };
    const issues = validateDesign(document, catalog);
    expect(issues.some((issue) => issue.code === "graphic.finish" && issue.severity === "error")).toBe(true);
    expect(issues.some((issue) => issue.code === "graphic.artwork" && issue.severity === "warning")).toBe(true);
  });
});

describe("production engine", () => {
  it("prices the 3×3 m inline booth in exact cents", () => {
    const result = produceDesign(inline(), catalog);
    expect(result.bars).toBe(9);
    expect(result.connectorCount).toBe(36);
    expect(result.panels).toHaveLength(9);
    expect(result.laborHours).toBe(14.75);
    expect(result.floorAreaM2).toBe(9);
    expect(result.lines.find((line) => line.sku === "GFX-PRINT")?.totalCents).toBe(29434);
    expect(result.lines.find((line) => line.sku === "EXT-ALU-40")?.quantity).toBe(54);
    expect(result.subtotalCents).toBe(243209);
  });

  it("draws the plan with the envelope dimension", () => {
    const document = inline();
    const svg = planSvg(document, compileDesign(document));
    expect(svg).toContain("3000 mm");
  });

  it("starts empty and prices a round table from the material prices", () => {
    const empty = createEmptyDesign();
    expect(compileDesign(empty).posts).toHaveLength(0);
    expect(hasBlockingIssues(validateDesign(empty, catalog))).toBe(false);

    const table = applyDesignPatch(empty, {
      walls: [
        { edge: "back", bays: [] },
        { edge: "left", bays: [] },
        { edge: "right", bays: [] },
        { edge: "front", bays: [] },
      ],
      features: [],
      parts: [
        { id: "leg", name: "Table leg", shape: "cylinder", x: 580, y: 0, z: 580, width: 40, height: 720, depth: 40 },
        { id: "top", name: "Table top", shape: "cylinder", x: 0, y: 720, z: 0, width: 1200, height: 30, depth: 1200 },
      ],
    });
    const model = compileDesign(table);
    expect(model.posts).toHaveLength(0);
    expect(model.parts).toHaveLength(2);
    expect(model.parts[1]?.shape).toBe("cylinder");
    expect(table.envelope).toEqual({ width: 1200, depth: 1200, height: 750 });
    const book: PriceBook = {
      ...defaultPriceBook(),
      materials: [{ id: "mdf-painted-18", name: "Painted MDF board 18 mm", piece: "paint", unit: "board", priceCents: 14000, boardWidthMm: 2000, boardHeightMm: 2000, thicknessMm: 18, wastePercent: 15 }],
    };
    const production = produceDesign(table, catalog, book);
    // 1.22 m² of painted board plus offcuts is one 2 × 2 m board, at 140 dollars.
    expect(production.lines.filter((line) => line.group === "materials").reduce((sum, line) => sum + line.totalCents, 0)).toBe(14000);
    expect(production.lines.some((line) => line.key === "FIN-fin-paint")).toBe(true);
    expect(production.materials.map((usage) => usage.quantity)).toEqual([1]);
    expect(hasBlockingIssues(production.issues)).toBe(false);
    expect(planSvg(table, model)).toContain("<circle");
    const technical = technicalSvg(table, model);
    expect(technical).toContain("TECHNICAL DRAWING");
    expect(technical).toContain("1200");
    expect(technical).toContain("750");
    expect(technical).toContain("Table top");
    expect(technical).toContain("Table leg");
  });
});

describe("booth system registry", () => {
  it("exposes modular exhibition and rejects carpentry", () => {
    expect(getBoothSystem("modular_exhibition")?.id).toBe("modular_exhibition");
    expect(getBoothSystem("custom_carpentry")).toBeNull();
    expect(openDesignDocument({ system: "custom_carpentry" })).toEqual({
      status: "unavailable",
      system: "custom_carpentry",
    });
  });
});
