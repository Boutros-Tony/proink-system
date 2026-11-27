import { describe, expect, it } from "vitest";
import { emptyCosting, readCosting } from "./costing";
import { createEmptyDesign } from "./modular/patch";
import type { DesignDocument } from "./modular/schema";
import type { CostLine } from "./costing";
import { buildQuotationPdf } from "../production/pdf";
import { placeElements } from "./modular/elements";
import { buildSections, clientSections, editSection, emptyQuoteMeta, quoteTotals, sectionMark, sellCents, standSizeText } from "./sections";

function line(key: string, group: CostLine["group"], description: string, totalCents: number): CostLine {
  return {
    key,
    sku: "EXTRA",
    group,
    description,
    quantity: 1,
    unit: "each",
    unitCostCents: totalCents,
    totalCents,
    origin: "extra",
    source: "manual",
    baseQuantity: 1,
    baseUnitCents: totalCents,
    quantityEdited: false,
    priceEdited: false,
    excluded: false,
  };
}

function stand(): DesignDocument {
  const document = createEmptyDesign();
  document.envelope = { width: 20000, depth: 3000, height: 3000 };
  document.parts = [
    { id: "floor", name: "Raised floor", shape: "box", x: 0, y: 0, z: 0, width: 20000, height: 50, depth: 3000, material: "mdf" },
    { id: "counter", name: "Reception counter", shape: "box", x: 0, y: 0, z: 0, width: 3500, height: 1000, depth: 400, material: "mdf" },
  ];
  return document;
}

describe("quotation sections", () => {
  it("states one size for the whole stand", () => {
    const document = createEmptyDesign();
    document.parts = [
      { id: "back", name: "Back", shape: "box", x: 0, y: 0, z: 0, width: 500, height: 1600, depth: 18, material: "paint" },
      { id: "side", name: "Side", shape: "box", x: 0, y: 0, z: 0, width: 488, height: 1600, depth: 18, material: "paint" },
    ];
    expect(standSizeText(document)).toBe("50cm x 48.8cm x 1.6m height");
  });

  it("adds the margin exactly, so $100 at 20% is $120", () => {
    expect(sellCents(0, 20)).toBe(0);
    expect(sellCents(10000, 20)).toBe(12000);
    expect(sellCents(401000, 20)).toBe(481200);
  });

  it("reads an older costing that has no sections yet", () => {
    const costing = readCosting({ version: 1, overrides: {}, extras: [], review: null });
    expect(costing.sections).toEqual([]);
    expect(costing.quote.vatPercent).toBe(11);
    expect(costing.quote.paymentTerms).toContain("70%");
  });

  it("prices one job as one item, with installation on its own row", () => {
    const sections = buildSections(
      stand(),
      [line("board", "materials", "MDF board", 100000), line("truck", "logistics", "Installation and transport", 40000), line("down", "logistics", "Dismantling", 30000)],
      20,
      emptyQuoteMeta(),
    );
    const item = sections.find((section) => section.itemId);
    const install = sections.find((section) => section.jobWide);
    expect(sections.filter((section) => !section.jobWide)).toHaveLength(1);
    expect(item?.partIds).toEqual(["floor", "counter"]);
    expect(item?.costCents).toBe(100000);
    expect(item?.sellCents).toBe(120000);
    expect(install?.lineKeys).toEqual(["truck", "down"]);
    expect(install?.costCents).toBe(70000);
    expect(sectionMark(sections, 0)).toBe("A");
    expect(sectionMark(sections, sections.length - 1)).toBe("");
    const totals = quoteTotals(sections, 11);
    expect(totals.sellCents).toBe(sections.reduce((sum, section) => sum + section.sellCents, 0));
    expect(totals.grandTotalCents).toBe(totals.sellCents + totals.vatCents);
  });

  it("splits a shared board by area and keeps print on its item", () => {
    const document = createEmptyDesign();
    document.groups = { "item-a": "Display A", "item-b": "Display B" };
    document.parts = [
      { id: "a", name: "Panel A", shape: "box", x: 0, y: 0, z: 0, width: 100, height: 100, depth: 18, material: "paint", group: "item-a" },
      { id: "b", name: "Panel B", shape: "box", x: 0, y: 0, z: 0, width: 300, height: 100, depth: 18, material: "paint", group: "item-b" },
    ];
    const board = { ...line("board", "materials", "Painted board", 10000), piece: "paint" };
    const print = { ...line("print", "graphics", "Print", 4920), item: "item-b" };
    const sections = buildSections(document, [board, print, line("truck", "logistics", "Installation and transport", 60000)], 0, emptyQuoteMeta());
    const first = sections.find((section) => section.itemId === "item-a");
    const second = sections.find((section) => section.itemId === "item-b");
    const install = sections.find((section) => section.jobWide);
    expect(first?.costCents).toBe(2500);
    expect(second?.costCents).toBe(7500 + 4920);
    expect(second?.lineKeys).toContain("print");
    expect(first?.lineKeys).not.toContain("print");
    expect(install?.costCents).toBe(60000);
    expect(install?.sellCents).toBe(60000);
    expect(sections.reduce((sum, section) => sum + (section.costCents ?? 0), 0)).toBe(10000 + 4920 + 60000);
  });

  it("rebuilds an older cost-type quotation into items", () => {
    const old = buildSections(stand(), [line("board", "materials", "MDF board", 10000)], 20, emptyQuoteMeta()).map((section) => ({
      ...section,
      itemId: undefined,
      jobWide: false as const,
    }));
    const fresh = clientSections(stand(), [line("board", "materials", "MDF board", 10000)], 20, emptyQuoteMeta(), old);
    expect(fresh.some((section) => section.itemId)).toBe(true);
  });

  it("keeps a selling price the user typed", () => {
    const document = stand();
    const first = buildSections(document, [line("board", "materials", "MDF board", 100000)], 20, emptyQuoteMeta());
    const edited = first.map((section) => (section.itemId ? { ...section, sellCents: 400000, sellEdited: true } : section));
    const again = buildSections(document, [line("board", "materials", "MDF board", 100000)], 20, emptyQuoteMeta(), edited);
    expect(again.find((section) => section.itemId)?.sellCents).toBe(400000);
    expect(again.find((section) => section.itemId)?.title).toBe("Stand");
    expect(emptyCosting().quote.vatPercent).toBe(11);
  });

  it("keeps a renamed item and groups pieces from the same unit", () => {
    const placed = placeElements(createEmptyDesign(), [
      { name: "Side", width: 488, height: 1600, depth: 18, material: "paint", item: "Retail display" },
      { name: "Shelf", width: 464, height: 488, depth: 18, material: "paint", quantity: 2, item: "Retail display" },
      { name: "Top", width: 1000, height: 18, depth: 400, material: "mdf", item: "Counter" },
    ]);
    const retail = placed.document.parts.filter((part) => part.name === "Side" || part.name.startsWith("Shelf")).map((part) => part.group);
    expect(new Set(retail)).toEqual(new Set(["item-retail-display"]));
    expect(placed.document.groups?.["item-retail-display"]).toBe("Retail display");
    const first = buildSections(placed.document, [], 20, emptyQuoteMeta());
    const renamed = editSection(first, "sec-item-retail-display", { title: "NIDO", titleEdited: true });
    const again = buildSections(placed.document, [], 20, emptyQuoteMeta(), renamed);
    expect(again.find((section) => section.itemId === "item-retail-display")?.title).toBe("NIDO");
    expect(again.filter((section) => !section.jobWide)).toHaveLength(2);
  });

  it("follows the item name until the user types one", () => {
    const placed = placeElements(createEmptyDesign(), [{ name: "Side", width: 488, height: 1600, depth: 18, material: "paint", item: "Retail display" }]);
    const first = buildSections(placed.document, [], 20, emptyQuoteMeta());
    const named = { ...placed.document, groups: { ...placed.document.groups, "item-retail-display": "NIDO shelf" } };
    expect(buildSections(named, [], 20, emptyQuoteMeta(), first)[0]?.title).toBe("NIDO shelf");
  });

  it("adds a new item to saved rows without a rebuild", () => {
    const placed = placeElements(createEmptyDesign(), [{ name: "Side", width: 488, height: 1600, depth: 18, material: "paint", item: "Retail display" }]);
    const saved = buildSections(placed.document, [], 20, emptyQuoteMeta());
    const more = placeElements(placed.document, [{ name: "Top", width: 1000, height: 18, depth: 400, material: "mdf", item: "Counter" }]);
    expect(clientSections(more.document, [], 20, emptyQuoteMeta(), saved).filter((section) => !section.jobWide)).toHaveLength(2);
  });

  it("writes a client PDF", async () => {
    const sections = buildSections(stand(), [line("board", "materials", "MDF board", 100000)], 20, emptyQuoteMeta());
    const totals = quoteTotals(sections, 11);
    const pdf = await buildQuotationPdf({
      ref: "PI117327",
      issuedAt: new Date("2026-11-09"),
      jobTitle: "60 SQM Exhibition Stand",
      clientName: "MEPTICO",
      document: stand(),
      quote: emptyQuoteMeta(),
      sections,
      sellCents: totals.sellCents,
      vatCents: totals.vatCents,
      grandTotalCents: totals.grandTotalCents,
    });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("gives a priced job with no pieces one row per named item", () => {
    const document = createEmptyDesign();
    document.groups = { "item-shelf": "Shelf", "item-counter": "Counter" };
    const lines = [
      { ...line("extra:cut-1", "materials", "MDF board", 4000), item: "item-shelf" },
      { ...line("extra:cut-2", "materials", "MDF board", 6000), item: "item-counter" },
      { ...line("extra:led", "lighting", "LED strip", 2000), item: "item-shelf" },
      { ...line("extra:truck", "logistics", "Transport to site", 3000) },
    ];
    const rows = buildSections(document, lines, 0, { ...emptyQuoteMeta(), title: "Beirut shelf" });
    expect(rows.filter((row) => !row.jobWide).map((row) => row.title)).toEqual(["Shelf", "Counter"]);
    expect(rows.find((row) => row.title === "Shelf")?.costCents).toBe(6000);
    expect(rows.find((row) => row.jobWide)?.title).toBe("Installation and transport");
    expect(rows.find((row) => row.jobWide)?.costCents).toBe(3000);
  });

  it("keeps one row named from the quote when a priced job has no items", () => {
    const rows = buildSections(createEmptyDesign(), [line("extra:labor", "labor", "Workshop labor", 5000)], 0, { ...emptyQuoteMeta(), title: "Beirut shelf" });
    expect(rows.map((row) => row.title)).toEqual(["Beirut shelf"]);
    expect(rows[0].costCents).toBe(5000);
    const untitled = buildSections(createEmptyDesign(), [line("extra:labor", "labor", "Workshop labor", 5000)], 0, emptyQuoteMeta());
    expect(untitled.map((row) => row.title)).toEqual(["Stand"]);
  });
});
