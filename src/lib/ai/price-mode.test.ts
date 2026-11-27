import { describe, expect, it } from "vitest";
import { lineCents, seedCatalog } from "@/lib/systems/catalog";
import { splitPricedLines } from "@/lib/systems/board-split";
import { applyCosting, emptyCosting, replaceCutExtras } from "@/lib/systems/costing";
import { defaultPriceBook } from "@/lib/systems/materials";
import { createInlineBooth, createEmptyDesign } from "@/lib/systems/modular/patch";
import { produceDesign } from "@/lib/systems/modular/produce";
import { reviewIssues } from "@/lib/systems/modular/review";
import type { ScenePart } from "@/lib/systems/modular/schema";
import { hasBlockingIssues, validateDesign } from "@/lib/systems/modular/validate";
import { buildSections, emptyQuoteMeta } from "@/lib/systems/sections";
import type { BomLine } from "@/lib/systems/types";
import { PRICE_TOOLS, pricePrompt } from "./price-prompt";
import { priceBoardPieces } from "./price-boards";

const DRAWING_TOOLS = ["addElements", "addParts", "updateParts", "moveParts", "removeParts", "arrangeParts", "assemble", "applyTemplate", "applyDesignPatch", "inspect", "generateStandImage", "blenderPython", "blenderLook"];

function box(id: string, width: number, group?: string): ScenePart {
  return { id, name: id, shape: "box", x: 0, y: 0, z: 0, width, height: 1000, depth: 18, material: "paint", ...(group ? { group } : {}) };
}

function boardLine(totalCents: number): BomLine {
  return { key: "MAT-paint", sku: "MAT-paint-18", group: "materials", description: "Painted MDF", quantity: 2, unit: "board", unitCostCents: 10000, totalCents, piece: "paint" };
}

describe("pricing mode", () => {
  it("builds the pricing prompt and offers none of the drawing or check tools", () => {
    const document = createEmptyDesign();
    const book = defaultPriceBook();
    const costed = applyCosting(produceDesign(document, seedCatalog(), book).lines, emptyCosting());
    const prompt = pricePrompt({ document, book, refs: [], costed, hasFiles: false });
    expect(prompt).toContain("priceBoards");
    expect(prompt).toContain("<already-on-cost>");
    for (const name of DRAWING_TOOLS) expect(PRICE_TOOLS).not.toContain(name);
    expect(PRICE_TOOLS).toEqual(["askUser", "priceBoards", "suggestCosts", "editCosts", "nameItems", "addJobMaterial"]);
  });

  it("splits one board total across items by area, and the shares add back", () => {
    const parts = [box("small", 1000, "item-shelf"), box("large", 3000, "item-counter")];
    const extras = splitPricedLines([boardLine(20000)], parts, defaultPriceBook(), { "item-shelf": "Shelf", "item-counter": "Counter" });
    expect(extras.map((line) => line.item)).toEqual(["item-shelf", "item-counter"]);
    expect(extras.map((line) => lineCents(line.quantity, line.unitCents))).toEqual([5000, 15000]);
    expect(extras.every((line) => line.source === "data" && line.id.startsWith("cut-") && line.ref === "material:paint-18")).toBe(true);
  });

  it("leaves a single item as one line with no item", () => {
    const extras = splitPricedLines([boardLine(10000)], [box("only", 1000, "item-shelf")], defaultPriceBook(), { "item-shelf": "Shelf" });
    expect(extras).toHaveLength(1);
    expect(extras[0].item).toBeUndefined();
    expect(lineCents(extras[0].quantity, extras[0].unitCents)).toBe(10000);
  });

  it("prices flat pieces without drawing them, and a booth frame does not leak in", () => {
    const book = defaultPriceBook();
    const document = createInlineBooth();
    const priced = priceBoardPieces(
      document,
      [
        { name: "Shelf", width: 1000, height: 1800, thickness: 18, material: "paint", quantity: 1, item: "Shelf unit" },
        { name: "Side", width: 400, height: 1800, thickness: 18, material: "paint", quantity: 2, item: "Shelf unit" },
      ],
      book,
    );
    expect(document.parts).toEqual([]);
    expect(priced.document.parts).toEqual([]);
    expect(priced.groupsChanged).toBe(true);
    expect(priced.document.groups?.["item-shelf-unit"]).toBe("Shelf unit");
    expect(priced.extras.every((line) => line.item == null)).toBe(true);
    expect(priced.boards.length).toBeGreaterThan(0);
    const text = [...priced.boards.map((board) => board.name), ...priced.other.map((line) => line.description)].join("\n").toLowerCase();
    expect(text).not.toMatch(/extrusion|floor|connector|labor/);
    const shares = priced.extras.reduce((sum, line) => sum + lineCents(line.quantity, line.unitCents), 0);
    expect(Math.abs(shares - priced.totalCents)).toBeLessThanOrEqual(priced.extras.length);
  });

  it("splits two items so each engine line adds back within a cent", () => {
    const book = defaultPriceBook();
    const priced = priceBoardPieces(
      createEmptyDesign(),
      [
        { name: "Small shelf", width: 500, height: 1000, thickness: 18, material: "paint", item: "Shelf" },
        { name: "Wide shelf", width: 1500, height: 1000, thickness: 18, material: "paint", item: "Counter" },
      ],
      book,
    );
    expect(priced.extras.filter((line) => line.item === "item-shelf").length).toBeGreaterThan(0);
    expect(priced.extras.filter((line) => line.item === "item-counter").length).toBeGreaterThan(0);
    const byRef = new Map<string, number>();
    for (const line of priced.extras) {
      const key = line.ref ?? line.description;
      byRef.set(key, (byRef.get(key) ?? 0) + lineCents(line.quantity, line.unitCents));
    }
    expect(Math.abs([...byRef.values()].reduce((sum, cents) => sum + cents, 0) - priced.totalCents)).toBeLessThanOrEqual(1);
  });

  it("says an unknown sheet was priced by material", () => {
    const priced = priceBoardPieces(createEmptyDesign(), [{ name: "Sign", width: 600, height: 400, thickness: 5, material: "paint", materialId: "missing-sheet" }], defaultPriceBook());
    expect(priced.note).toContain("missing-sheet");
    expect(priced.note).toContain("priced by material");
    expect(priced.document.parts).toEqual([]);
  });

  it("prices a job with no pieces from the extras, with no production-check warning", () => {
    const book = defaultPriceBook();
    const document = createEmptyDesign();
    const priced = priceBoardPieces(document, [{ name: "Shelf", width: 1000, height: 1800, thickness: 18, material: "paint" }], book);
    const costing = replaceCutExtras(emptyCosting(), priced.extras);
    const produced = produceDesign(priced.document, seedCatalog(), book);
    const costed = applyCosting(produced.lines, costing);
    expect(produced.lines.filter((line) => line.quantity > 0)).toHaveLength(0);
    expect(costed.lines.some((line) => line.origin === "extra" && line.totalCents > 0)).toBe(true);
    const rows = buildSections(priced.document, costed.lines, 20, emptyQuoteMeta());
    expect(rows.some((row) => (row.costCents ?? 0) > 0)).toBe(true);
    expect(reviewIssues(priced.document)).toEqual([]);
    expect(hasBlockingIssues(validateDesign(priced.document, seedCatalog(), book))).toBe(false);
  });
});
