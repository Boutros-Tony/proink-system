import { describe, expect, it } from "vitest";
import { applyPriceBook, defaultPriceBook, defaultShopRules, estimateMaterials, partBoardAreaMm2, pricePerM2Cents, readPriceBook, type PriceBook, type PricedMaterial } from "./materials";
import { SKU, seedCatalog } from "./catalog";
import { createEmptyDesign } from "./modular/patch";
import { addParts } from "./modular/ops";
import { produceDesign } from "./modular/produce";
import type { PartDraft } from "./modular/schema";
import { validateDesign } from "./modular/validate";

const panel = (width: number, height: number, material: PartDraft["material"] = "mdf", name = "Panel"): PartDraft => ({
  name,
  shape: "box",
  x: 0,
  y: 0,
  z: 0,
  width,
  height,
  depth: 18,
  material,
});

function parts(...drafts: PartDraft[]) {
  return addParts(createEmptyDesign(), drafts).document.parts;
}

function sampleBoard(id: string, name: string, piece: PricedMaterial["piece"], priceCents: number, width: number, height: number): PricedMaterial {
  return { id, name, piece, unit: "board", priceCents, boardWidthMm: width, boardHeightMm: height, thicknessMm: 18, wastePercent: 15 };
}

/** The old worked example, so these tests do not depend on the shop's prices. */
function sampleBook(): PriceBook {
  return {
    ...defaultPriceBook(),
    materials: [
      sampleBoard("mdf-18", "MDF board 18 mm", "mdf", 10000, 2000, 2000),
      sampleBoard("mdf-painted-18", "Painted MDF board 18 mm", "paint", 14000, 2000, 2000),
      sampleBoard("plywood-birch-18", "Birch plywood 18 mm", "wood", 7500, 2440, 1220),
      { id: "glass-tempered-8", name: "Tempered glass 8 mm", piece: "glass", unit: "m2", priceCents: 8500, thicknessMm: 8, wastePercent: 10 },
    ],
  };
}

describe("board area", () => {
  it("counts a thin piece as one panel and a thick piece as a hollow box", () => {
    expect(partBoardAreaMm2({ shape: "box", width: 1000, height: 500, depth: 18 })).toBe(500_000);
    expect(partBoardAreaMm2({ shape: "box", width: 600, height: 600, depth: 600 })).toBe(6 * 600 * 600);
    expect(partBoardAreaMm2({ shape: "cylinder", width: 1000, height: 30, depth: 1000 })).toBeCloseTo(Math.PI * 500 * 500);
  });
});

describe("board counts", () => {
  it("prices the 2 × 2 m MDF board at 100 dollars and rounds up to whole boards", () => {
    const book = sampleBook();
    const mdf = book.materials.find((material) => material.piece === "mdf");
    expect(mdf?.priceCents).toBe(10000);
    expect(mdf?.boardWidthMm).toBe(2000);
    expect(mdf?.boardHeightMm).toBe(2000);
    expect(pricePerM2Cents(mdf!)).toBe(2500);

    // Two 1.8 × 1.0 m panels: 3.6 m², 4.14 m² with 15 % offcuts, so two boards.
    const two = estimateMaterials(parts(panel(1800, 1000), panel(1800, 1000, "mdf", "Second")), book);
    expect(two.usage).toHaveLength(1);
    expect(two.usage[0].quantity).toBe(2);
    expect(two.usage[0].totalCents).toBe(20000);

    // A 1 × 1 m panel needs 1.15 m² of a 4 m² board: still one whole board.
    expect(estimateMaterials(parts(panel(1000, 1000)), book).usage[0].quantity).toBe(1);
  });

  it("adds up pieces of the same material and keeps other materials separate", () => {
    const book = sampleBook();
    const estimate = estimateMaterials(parts(panel(1000, 1000), panel(1000, 1000, "wood", "Oak"), panel(500, 500, "mdf", "Shelf")), book);
    const byName = Object.fromEntries(estimate.usage.map((usage) => [usage.name, usage]));
    expect(byName["MDF board 18 mm"].pieces).toBe(2);
    expect(byName["Birch plywood 18 mm"].pieces).toBe(1);
  });

  it("buys glass by the square meter", () => {
    const estimate = estimateMaterials(parts(panel(1000, 1000, "glass")), sampleBook());
    expect(estimate.usage[0].unit).toBe("m2");
    expect(estimate.usage[0].quantity).toBe(1.1);
    expect(estimate.usage[0].totalCents).toBe(Math.round(1.1 * 8500));
  });

  it("buys one 2 × 2 m board and five 1 × 1 m boards for a 3 × 3 m panel", () => {
    const book = sampleBook();
    const small = {
      id: "paint-1m",
      name: "Painted MDF board 1 × 1 m",
      piece: "paint" as const,
      unit: "board" as const,
      priceCents: 4000,
      boardWidthMm: 1000,
      boardHeightMm: 1000,
      thicknessMm: 18,
      wastePercent: 15,
    };
    book.materials = book.materials.map((material) => (material.piece === "paint" ? { ...material, priceCents: 10000, boardWidthMm: 2000, boardHeightMm: 2000 } : material));
    book.materials.push(small);
    const estimate = estimateMaterials(parts(panel(3000, 3000, "paint", "Wall")), book);
    const counts = Object.fromEntries(estimate.usage.map((usage) => [usage.materialId, usage.quantity]));
    expect(counts["mdf-painted-18"]).toBe(1);
    expect(counts["paint-1m"]).toBe(5);
    expect(estimate.usage.reduce((sum, usage) => sum + usage.totalCents, 0)).toBe(10000 + 5 * 4000);
  });

  it("flags a piece that cannot fit on one board", () => {
    const book = sampleBook();
    const estimate = estimateMaterials(parts(panel(2600, 1000, "mdf", "Long")), book);
    expect(estimate.usage[0].oversize).toEqual(["Long"]);
    const issues = validateDesign(addParts(createEmptyDesign(), [panel(2600, 1000, "mdf", "Long")]).document, seedCatalog(), book);
    expect(issues.some((issue) => issue.code === "parts.oversize")).toBe(true);
  });

  it("reports pieces whose material has no price", () => {
    const book: PriceBook = { ...sampleBook(), materials: sampleBook().materials.filter((material) => material.piece !== "glass") };
    const estimate = estimateMaterials(parts(panel(500, 500, "glass")), book);
    expect(estimate.unpriced).toHaveLength(1);
    const document = addParts(createEmptyDesign(), [panel(500, 500, "glass")]).document;
    expect(validateDesign(document, seedCatalog(), book).some((issue) => issue.code === "parts.unpriced")).toBe(true);
  });
});

describe("the price book drives the quote", () => {
  it("changes the total when a price changes, and lists boards in the bill of materials", () => {
    const document = addParts(createEmptyDesign(), [panel(1800, 1000)]).document;
    const base = produceDesign(document, seedCatalog(), sampleBook());
    const line = base.lines.find((item) => item.group === "materials");
    expect(line?.unit).toBe("board");
    expect(line?.quantity).toBe(1);
    const boards = (result: typeof base) => result.lines.filter((item) => item.group === "materials").reduce((sum, item) => sum + item.totalCents, 0);
    expect(boards(base)).toBe(10000);

    const dearer = sampleBook();
    dearer.materials = dearer.materials.map((material) => (material.piece === "mdf" ? { ...material, priceCents: 15000 } : material));
    expect(boards(produceDesign(document, seedCatalog(), dearer))).toBe(15000);
  });

  it("overrides stand-system prices by SKU and leaves the rest alone", () => {
    const book = { ...defaultPriceBook(), catalog: { [SKU.floor]: 2000 } };
    const catalog = applyPriceBook(seedCatalog(), book);
    expect(catalog.find((item) => item.sku === SKU.floor)?.unitCostCents).toBe(2000);
    expect(catalog.find((item) => item.sku === SKU.panel)?.unitCostCents).toBe(4500);
    expect(applyPriceBook(catalog, book)).toEqual(catalog);
  });
});

describe("reading a stored price book", () => {
  it("falls back to the defaults when the data is not a price book", () => {
    expect(readPriceBook({ nonsense: true })).toEqual(defaultPriceBook());
    expect(readPriceBook(null)).toEqual(defaultPriceBook());
  });

  it("keeps every board size when two entries are the same piece", () => {
    const book = sampleBook();
    const doubled = { ...book, materials: book.materials.map((material) => (material.piece === "paint" ? { ...material, piece: "mdf" as const } : material)) };
    const read = readPriceBook(doubled);
    expect(read.materials.filter((material) => material.piece === "mdf")).toHaveLength(2);
  });

  it("gives a board without a size the standard sheet size", () => {
    const book = readPriceBook({ version: 1, catalog: {}, materials: [{ id: "x", name: "X", piece: null, unit: "board", priceCents: 100, wastePercent: 0 }] });
    expect(book.materials[0].boardWidthMm).toBe(2440);
    expect(book.materials[0].boardHeightMm).toBe(1220);
  });
});

describe("a retail display cut from painted board", () => {
  it("fits the sheet's pieces on two 2440 × 1220 boards", () => {
    const book: PriceBook = {
      version: 1,
      starter: 2,
      catalog: {},
      items: [],
      rules: defaultShopRules(),
      materials: [
        {
          id: "mdf-painted-18",
          name: "Painted MDF board 18 mm",
          piece: "paint",
          unit: "board",
          priceCents: 5000,
          boardWidthMm: 2440,
          boardHeightMm: 1220,
          thicknessMm: 18,
          wastePercent: 10,
        },
      ],
    };
    const cut = parts(
      panel(1600, 500, "paint", "Side"),
      panel(1600, 500, "paint", "Side 2"),
      panel(1600, 465, "paint", "Back"),
      ...Array.from({ length: 5 }, (_, index) => panel(465, 488, "paint", `Shelf ${index + 1}`)),
      ...Array.from({ length: 4 }, (_, index) => panel(465, 40, "paint", `Lip ${index + 1}`)),
      panel(465, 100, "paint", "Plinth"),
      panel(465, 300, "paint", "Header"),
    );
    const usage = estimateMaterials(cut, book).usage;
    expect(usage).toHaveLength(1);
    expect(usage[0].name).toBe("Painted MDF board 18 mm");
    expect(usage[0].quantity).toBe(2);
    expect(usage[0].totalCents).toBe(10000);
  });
});
