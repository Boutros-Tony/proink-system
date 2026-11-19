import { describe, expect, it } from "vitest";
import { buildCuttingPlan } from "../production/cutting";
import { seedCatalog } from "./catalog";
import { defaultMaterials, defaultPriceBook, defaultPriceItems, priceBookSchema } from "./materials";
import { SHOP_BOARDS, SHOP_ITEMS } from "./shop-list";
import { finishingLines } from "./finishing";
import { addJobMaterial, bookForJob } from "./modular/job-materials";
import { addParts, updateParts } from "./modular/ops";
import { applyDesignPatch, createEmptyDesign } from "./modular/patch";
import { produceDesign } from "./modular/produce";
import type { ScenePart } from "./modular/schema";
import { validateDesign } from "./modular/validate";

function panel(id: string, name: string, depth: number, material: ScenePart["material"] = "mdf", materialId?: string): ScenePart {
  return { id, name, shape: "box", x: 0, y: 0, z: 0, width: 500, height: 400, depth, material, ...(materialId ? { materialId } : {}) };
}

describe("the shop price list", () => {
  it("has unique ids and fits the price book", () => {
    const materialIds = defaultMaterials().map((material) => material.id);
    const itemIds = defaultPriceItems().map((item) => item.id);
    expect(new Set(materialIds).size).toBe(materialIds.length);
    expect(new Set(itemIds).size).toBe(itemIds.length);
    expect(materialIds).toEqual(SHOP_BOARDS.map((board) => board.id));
    expect(itemIds.slice(0, SHOP_ITEMS.length)).toEqual(SHOP_ITEMS.map((item) => item.id));
    expect(defaultMaterials().length).toBeLessThanOrEqual(100);
    expect(defaultPriceItems().length).toBeLessThanOrEqual(300);
    expect(defaultMaterials().every((material) => material.unit === "board" && material.wastePercent === 10)).toBe(true);
    expect(defaultPriceItems().find((item) => item.id === "fin-paint")?.priceCents).toBe(925);
    expect(priceBookSchema.safeParse(defaultPriceBook()).success).toBe(true);
  });
});

describe("painted MDF and board thickness", () => {
  const book = defaultPriceBook();

  it("cuts painted pieces from the MDF boards, and a painted board still wins when the book has one", () => {
    expect(book.materials.some((material) => material.piece === "paint")).toBe(false);
    const painted = panel("p", "Side", 17, "paint");
    const plan = buildCuttingPlan([painted], book.materials);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].tally.every((line) => line.thicknessMm === 17)).toBe(true);
    expect(plan.groups[0].tally.every((line) => book.materials.find((material) => material.id === line.id)?.piece === "mdf")).toBe(true);
    const lines = finishingLines([painted], book);
    expect(lines.some((line) => line.key === "FIN-fin-primer")).toBe(true);
    expect(lines.some((line) => line.key === "FIN-fin-paint")).toBe(true);

    const paintBoard = { id: "paint-18", name: "Painted board", piece: "paint" as const, unit: "board" as const, priceCents: 100, boardWidthMm: 2440, boardHeightMm: 1220, thicknessMm: 18, wastePercent: 10 };
    const chosen = buildCuttingPlan([panel("p", "Side", 18, "paint")], [...book.materials, paintBoard]);
    expect(chosen.groups[0].tally.map((line) => line.id)).toEqual(["paint-18"]);
  });

  it("puts a 17 mm piece and a 6 mm piece on boards of their own thickness", () => {
    const plan = buildCuttingPlan([panel("thick", "Back", 17), panel("thin", "Shelf", 6)], book.materials);
    expect(plan.groups).toHaveLength(2);
    const thick = plan.groups.find((group) => group.partIds.includes("thick"))!;
    const thin = plan.groups.find((group) => group.partIds.includes("thin"))!;
    expect(thick.id).not.toBe(thin.id);
    expect(thick.tally.length).toBeGreaterThan(0);
    expect(thin.tally.length).toBeGreaterThan(0);
    expect(thick.tally.every((line) => line.thicknessMm === 17)).toBe(true);
    expect(thin.tally.every((line) => line.thicknessMm === 6)).toBe(true);
  });

  it("uses the 17 mm boards for an 18 mm piece and does not warn", () => {
    const plan = buildCuttingPlan([panel("shelf", "Shelf", 18)], book.materials);
    expect(plan.groups[0].tally.every((line) => line.thicknessMm === 17)).toBe(true);
    const document = addParts(createEmptyDesign(), [panel("shelf", "Shelf", 18)]).document;
    expect(validateDesign(document, seedCatalog(), book).some((issue) => issue.code === "parts.thickness")).toBe(false);
  });

  it("warns when a piece is 25 mm and the nearest MDF board is 30 mm", () => {
    const document = addParts(createEmptyDesign(), [
      panel("a", "Shelf 1", 25),
      panel("b", "Shelf 2", 25),
      panel("c", "Shelf 3", 25),
      panel("d", "Shelf 4", 25),
    ]).document;
    const issue = validateDesign(document, seedCatalog(), book).find((item) => item.code === "parts.thickness");
    expect(issue?.message).toBe("4 pieces are 25 mm thick, but the nearest MDF board is 30 mm: Shelf 1, Shelf 2, Shelf 3 and 1 more.");
  });

  it("keeps a piece that names its sheet on that sheet", () => {
    const named = panel("lip", "Lip", 6, "mdf", "mdf-17-2440x1220");
    const plan = buildCuttingPlan([named, panel("other", "Shelf", 6)], book.materials);
    const row = plan.groups.find((group) => group.id === "row:mdf-17-2440x1220")!;
    expect(row.partIds).toEqual(["lip"]);
    expect(row.tally.map((line) => line.id)).toEqual(["mdf-17-2440x1220"]);
    const loose = plan.groups.find((group) => group.partIds.includes("other"))!;
    expect(loose.tally.every((line) => line.thicknessMm === 6)).toBe(true);
  });
});

describe("materials estimated for one job", () => {
  const sheet = { name: "Aluminium sheet 3 mm", piece: "metal" as const, unit: "board" as const, priceCents: 9000, boardWidthMm: 2000, boardHeightMm: 1000, thicknessMm: 3 };
  const glass = { name: "Tempered glass 8 mm", piece: "glass" as const, unit: "m2" as const, priceCents: 8500, thicknessMm: 8 };

  it("adds a job material, replaces the same name, and leaves the book alone when there are none", () => {
    const book = defaultPriceBook();
    expect(bookForJob(book, createEmptyDesign())).toBe(book);
    const first = addJobMaterial(createEmptyDesign(), sheet);
    expect(first.id).toBe("est-aluminium-sheet-3-mm");
    expect(first.document.jobMaterials?.[0]).toMatchObject({ id: first.id, estimated: true, wastePercent: 10, priceCents: 9000 });
    const again = addJobMaterial(first.document, { ...sheet, priceCents: 9500 });
    expect(again.id).toBe(first.id);
    expect(again.document.jobMaterials).toHaveLength(1);
    expect(again.document.jobMaterials?.[0].priceCents).toBe(9500);
    const priced = bookForJob(book, again.document);
    expect(priced).not.toBe(book);
    expect(priced.materials.at(-1)?.id).toBe(first.id);
    const clash = { ...createEmptyDesign(), jobMaterials: [{ ...book.materials[0], priceCents: 1, estimated: true }] };
    expect(bookForJob(book, clash)).toBe(book);
  });

  it("prices the piece from the estimate and warns only about materials a piece uses", () => {
    const saved = addJobMaterial(addJobMaterial(createEmptyDesign(), sheet).document, glass);
    const unused = addJobMaterial(saved.document, { name: "Foam board 5 mm", piece: null, unit: "board", priceCents: 900, boardWidthMm: 2440, boardHeightMm: 1220, thicknessMm: 5 });
    const document = addParts(unused.document, [
      { name: "Plate", shape: "box", x: 0, y: 0, z: 0, width: 400, height: 300, depth: 3, material: "metal", materialId: "est-aluminium-sheet-3-mm" },
      { name: "Window", shape: "box", x: 0, y: 0, z: 0, width: 400, height: 300, depth: 8, material: "glass", materialId: "est-tempered-glass-8-mm" },
    ]).document;
    const produced = produceDesign(document, seedCatalog());
    const board = produced.lines.find((line) => line.sku === "MAT-est-aluminium-sheet-3-mm");
    expect(board?.description.endsWith(", estimated price")).toBe(true);
    const warning = produced.issues.find((issue) => issue.code === "parts.estimated");
    expect(warning?.message).toBe("2 materials are priced by estimate, not from the price list: Aluminium sheet 3 mm, Tempered glass 8 mm. Confirm the price, or add them in Settings, Materials.");
  });

  it("keeps job materials through a patch and an edit", () => {
    const { document, id } = addJobMaterial(createEmptyDesign(), sheet);
    const patched = applyDesignPatch(document, { envelope: { width: 2000 } });
    expect(patched.jobMaterials).toEqual(document.jobMaterials);
    const added = addParts(patched, [panel("p", "Plate", 3, "metal", id)]);
    const edited = updateParts(added.document, added.ids, { name: "Renamed plate" });
    expect(edited.jobMaterials).toEqual(document.jobMaterials);
    expect(edited.parts[0].name).toBe("Renamed plate");
  });
});
