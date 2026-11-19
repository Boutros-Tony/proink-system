import { describe, expect, it } from "vitest";
import { dataRefs, equipmentSuggestions, readReview, resolveSuggestions } from "../ai/cost-review";
import { seedCatalog } from "./catalog";
import { addExtras, applyCostEdits, applyCosting, billableLines, emptyCosting, readCosting, removeExtra, setOverride, type Costing } from "./costing";
import { applyPriceBook, defaultPriceBook, estimateMaterials, readPriceBook, type PriceBook } from "./materials";
import { createEmptyDesign } from "./modular/patch";
import { produceDesign } from "./modular/produce";
import type { DesignDocument } from "./modular/schema";

function stand(): DesignDocument {
  const document = createEmptyDesign();
  return {
    ...document,
    parts: [{ id: "p1", name: "Plinth", shape: "box", x: 0, y: 0, z: 0, width: 1000, height: 400, depth: 500, material: "mdf" }],
  };
}

/** A small book with the ids these tests match, so they do not depend on the shop's prices. */
function fixtureBook(): PriceBook {
  const book = defaultPriceBook();
  return {
    ...book,
    materials: [{ id: "mdf-18", name: "MDF board 18 mm", piece: "mdf", unit: "board", priceCents: 10000, boardWidthMm: 2000, boardHeightMm: 2000, thicknessMm: 18, wastePercent: 15 }],
    items: [
      ...book.items,
      { id: "hw-screws", name: "Screws and fixings, box of 200", group: "hardware", unit: "box", priceCents: 600 },
      { id: "ltg-led-strip", name: "LED strip", group: "lighting", unit: "meter", priceCents: 700 },
    ],
  };
}

const priced = fixtureBook();

function job(costing: Costing = emptyCosting()) {
  const production = produceDesign(stand(), seedCatalog(), priced);
  return { production, costed: applyCosting(production.lines, costing) };
}

describe("job costing", () => {
  it("quotes the engine's lines untouched when nothing was changed", () => {
    const { production, costed } = job();
    expect(costed.subtotalCents).toBe(production.subtotalCents);
    expect(costed.lines.every((line) => !line.priceEdited && !line.quantityEdited && !line.excluded)).toBe(true);
  });

  it("changes a price for this job only", () => {
    const { costed } = job();
    const board = costed.lines.find((line) => line.sku === "MAT-mdf-18");
    expect(board).toBeDefined();
    const dearer = setOverride(emptyCosting(), board!, { unitCents: 20000 });
    const after = applyCosting(job().production.lines, dearer);
    const edited = after.lines.find((line) => line.sku === "MAT-mdf-18")!;
    expect(edited.unitCostCents).toBe(20000);
    expect(edited.priceEdited).toBe(true);
    expect(edited.totalCents).toBe(edited.quantity * 20000);
    expect(after.subtotalCents).toBe(costed.subtotalCents + edited.quantity * 10000);
    expect(priced.materials.find((material) => material.id === "mdf-18")?.priceCents).toBe(10000);
  });

  it("forgets an edit that puts the value back", () => {
    const { costed } = job();
    const board = costed.lines.find((line) => line.sku === "MAT-mdf-18")!;
    const changed = setOverride(emptyCosting(), board, { unitCents: 20000 });
    const undone = setOverride(changed, board, { unitCents: board.baseUnitCents });
    expect(undone.overrides).toEqual({});
  });

  it("leaves an excluded line out of the total and the quotation", () => {
    const { costed } = job();
    const board = costed.lines.find((line) => line.sku === "MAT-mdf-18")!;
    const after = applyCosting(job().production.lines, setOverride(emptyCosting(), board, { excluded: true }));
    expect(after.subtotalCents).toBe(costed.subtotalCents - board.totalCents);
    expect(after.excludedCents).toBe(board.totalCents);
    expect(billableLines(after).some((line) => line.sku === "MAT-mdf-18")).toBe(false);
  });

  it("adds extra lines to the total and sorts them under their group", () => {
    const costing: Costing = {
      ...emptyCosting(),
      extras: [{ id: "a", description: "Screws", group: "hardware", quantity: 2, unit: "box", unitCents: 600, source: "data", ref: "item:hw-screws" }],
    };
    const { production, costed } = job(costing);
    expect(costed.subtotalCents).toBe(production.subtotalCents + 1200);
    const groups = costed.lines.map((line) => line.group);
    expect(groups.indexOf("hardware")).toBeGreaterThan(groups.indexOf("materials"));
    expect(billableLines(costed).some((line) => line.description === "Screws")).toBe(true);
  });

  it("changes and takes off lines from the chat", () => {
    const hooks = { id: "h", description: "Peg hooks", group: "hardware" as const, quantity: 20, unit: "pcs", unitCents: 100, source: "data" as const, ref: "item:hw-hooks", reason: "Hooks" };
    const truck = { id: "t", description: "Transport", group: "logistics" as const, quantity: 1, unit: "trip", unitCents: 5000, source: "new" as const };
    const { costed } = job({ ...emptyCosting(), extras: [hooks, truck] });
    const board = costed.lines.find((line) => line.sku === "MAT-mdf-18")!;
    const after = applyCostEdits({ ...emptyCosting(), extras: [hooks, truck] }, [
      { key: "extra:h", quantity: 48 },
      { key: "extra:t", remove: true },
      { key: board.key, unitCents: 12000, baseQuantity: board.baseQuantity, baseUnitCents: board.baseUnitCents },
    ]);
    expect(after.extras).toEqual([{ ...hooks, quantity: 48 }]);
    expect(after.overrides[board.key]).toEqual({ unitCents: 12000 });
    const off = applyCostEdits(after, [{ key: board.key, remove: true, baseQuantity: board.baseQuantity, baseUnitCents: board.baseUnitCents }]);
    expect(applyCosting(job().production.lines, off).lines.find((line) => line.key === board.key)?.excluded).toBe(true);
  });

  it("falls back to an empty costing for anything unreadable", () => {
    expect(readCosting({ nonsense: true })).toEqual(emptyCosting());
    expect(readCosting(null)).toEqual(emptyCosting());
  });
});

describe("cost review", () => {
  const book = fixtureBook();
  const refs = dataRefs(book, applyPriceBook(seedCatalog(), book));
  const { costed } = job();

  it("lists the shop's own prices, stand items, boards, and other items", () => {
    expect(refs.some((item) => item.ref === "item:hw-screws")).toBe(true);
    expect(refs.some((item) => item.ref === "material:mdf-18")).toBe(true);
    expect(refs.some((item) => item.ref === "catalog:LAB-HOUR")).toBe(true);
    expect(refs.some((item) => item.ref.startsWith("catalog:SYS-LIMITS"))).toBe(false);
  });

  it("takes the price and unit from the shop when the item exists", () => {
    const reply = JSON.stringify({
      summary: "Needs fixings.",
      checked: [{ area: "Hardware and fixings", status: "suggested", note: "Cam locks." }],
      items: [{ description: "Whatever the model called it", group: "labor", quantity: 3, unit: "pcs", reason: "Joints.", match: "item:hw-screws", estimateUsd: 999 }],
    });
    const review = readReview(reply, { refs, costed });
    expect(review?.suggestions).toHaveLength(1);
    expect(review?.suggestions[0]).toMatchObject({ source: "data", ref: "item:hw-screws", unit: "box", unitCents: 600, group: "hardware", quantity: 3 });
    expect(review?.suggestions[0].description).toBe("Screws and fixings, box of 200");
  });

  it("suggests a priced estimate when nothing in the shop's prices fits", () => {
    const reply = `\`\`\`json\n${JSON.stringify({ summary: "", checked: [], items: [{ description: "Glass edge polishing", group: "finishing", quantity: 4.567, unit: "meter", reason: "Exposed glass edge.", match: null, estimateUsd: 12.5 }] })}\n\`\`\``;
    const review = readReview(reply, { refs, costed });
    expect(review?.suggestions[0]).toMatchObject({ source: "new", unitCents: 1250, quantity: 4.57, group: "finishing" });
  });

  it("does not buy again what the engine already counts, and drops unusable items", () => {
    const reply = JSON.stringify({
      summary: "",
      checked: [],
      items: [
        { description: "MDF", group: "materials", quantity: 1, unit: "board", reason: "", match: "material:mdf-18" },
        { description: "Nothing", group: "other", quantity: 0, unit: "each", reason: "", match: null, estimateUsd: 5 },
        { description: "Bad quantity", group: "other", quantity: "many", unit: "each", reason: "", match: null, estimateUsd: 5 },
        { description: "Real", group: "nonsense", quantity: 1, unit: "each", reason: "", match: "item:not-a-thing", estimateUsd: 5 },
      ],
    });
    const review = readReview(reply, { refs, costed });
    expect(review?.suggestions.map((item) => item.description)).toEqual(["Real"]);
    expect(review?.suggestions[0]).toMatchObject({ source: "new", group: "other" });
  });

  it("rejects a reply that is not a list of items", () => {
    expect(readReview("no json here", { refs, costed })).toBeNull();
    expect(readReview('{"summary":"x"}', { refs, costed })).toBeNull();
  });
});

describe("a TV on the stand", () => {
  const book = defaultPriceBook();
  const refs = dataRefs(book, applyPriceBook(seedCatalog(), book));
  const withTv = (): DesignDocument => ({
    ...stand(),
    parts: [...stand().parts, { id: "tv", name: "TV 55 inch", shape: "box", x: 0, y: 1200, z: 0, width: 1250, height: 720, depth: 50, material: "paint" }],
  });

  it("is bought-in equipment, so it is not counted as board", () => {
    const estimate = estimateMaterials(withTv().parts, book);
    expect(estimate.equipment.map((part) => part.name)).toEqual(["TV 55 inch"]);
    expect(estimate.unpriced).toHaveLength(0);
  });

  it("is never forgotten: the TV, its mount, a cable, and a player are suggested without the model", () => {
    const document = withTv();
    const costed = applyCosting(produceDesign(document, seedCatalog(), book).lines, emptyCosting());
    const suggested = equipmentSuggestions(document, refs, costed);
    expect(suggested.map((item) => item.ref)).toEqual(["item:av-tv", "item:av-tv-mount", "item:av-hdmi", "item:av-player"]);
    expect(suggested.every((item) => item.source === "data" && item.group === "equipment" && item.quantity === 1)).toBe(true);
  });

  it("suggests nothing when there is no screen", () => {
    const costed = applyCosting(produceDesign(stand(), seedCatalog(), book).lines, emptyCosting());
    expect(equipmentSuggestions(stand(), refs, costed)).toEqual([]);
  });

  it("keeps the preset lines and does not let the model repeat them", () => {
    const document = withTv();
    const costed = applyCosting(produceDesign(document, seedCatalog(), book).lines, emptyCosting());
    const preset = equipmentSuggestions(document, refs, costed);
    const reply = JSON.stringify({ summary: "", checked: [], items: [{ description: "TV mount", group: "equipment", quantity: 1, unit: "each", reason: "", match: "item:av-tv-mount" }] });
    const review = readReview(reply, { refs, costed, preset });
    expect(review?.suggestions).toHaveLength(4);
  });

  it("gives an older saved price book the equipment items once, and keeps what the shop already has", () => {
    const old = { ...defaultPriceBook(), starter: undefined, items: [{ id: "mine", name: "Mine", group: "other", unit: "each", priceCents: 100 }] };
    const upgraded = readPriceBook(old);
    expect(upgraded.items.map((item) => item.id)).toEqual(["mine", "hw-data-strip", "av-tv", "av-tv-mount", "av-hdmi", "av-player", "fin-edge-filler", "gfx-print", "pos-shelf-talker", "pos-wobbler", "hw-alu-price-rail", "hw-standoffs", "ltg-lightbox", "lab-cnc", "hw-plinth-clips", "hw-foot-rail-tube", "hw-foot-rail-bracket", "hw-foot-rail-fitting", "fab-steel", "lab-kerf-bend"]);
    expect(readPriceBook(upgraded).items).toEqual(upgraded.items);
  });
});

describe("prices suggested from the chat", () => {
  const book = fixtureBook();
  const refs = () => dataRefs(book, applyPriceBook(seedCatalog(), book));

  it("takes the shop's price for a known item and an honest estimate for an unknown one", () => {
    const { costed } = job();
    const [known, unknown] = resolveSuggestions(
      [
        { description: "Screws", group: "hardware", quantity: 2, unit: "box", reason: "joints", match: "item:hw-screws", estimateUsd: null },
        { description: "Neon sign", group: "lighting", quantity: 1, unit: "each", reason: "header", match: null, estimateUsd: 240 },
      ],
      { refs: refs(), costed },
    );
    expect(known).toMatchObject({ source: "data", ref: "item:hw-screws", unitCents: 600, quantity: 2 });
    expect(unknown).toMatchObject({ source: "new", unitCents: 24000 });
  });

  it("adds up one price item named twice in the same list instead of dropping the second", () => {
    const { costed } = job();
    const lines = resolveSuggestions(
      [
        { description: "LED strip, counter", group: "lighting", quantity: 5.6, unit: "meter", reason: "counter", match: "item:ltg-led-strip", estimateUsd: null },
        { description: "LED strip, shelves", group: "lighting", quantity: 3.6, unit: "meter", reason: "shelves", match: "item:ltg-led-strip", estimateUsd: null },
      ],
      { refs: refs(), costed },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(9.2);
  });

  it("does not repeat a line already on the cost or already suggested", () => {
    const { costed } = job();
    const item = { description: "Screws", group: "hardware", quantity: 1, unit: "box", reason: "", match: "item:hw-screws", estimateUsd: null };
    const once = resolveSuggestions([item], { refs: refs(), costed });
    expect(once).toHaveLength(1);
    expect(resolveSuggestions([item], { refs: refs(), costed, preset: once })).toHaveLength(0);
  });

  it("adds suggested lines to the price, once", () => {
    const { costed } = job();
    const lines = resolveSuggestions([{ description: "Neon sign", group: "lighting", quantity: 1, unit: "each", reason: "Shown on the sheet", match: null, estimateUsd: 240 }], { refs: refs(), costed });
    const once = addExtras(emptyCosting(), lines);
    expect(applyCosting(job().production.lines, once).subtotalCents).toBe(costed.subtotalCents + 24000);
    expect(addExtras(once, lines.map((line) => ({ ...line, id: "other" })))).toBe(once);
  });

  it("does not add back a suggested line the user removed", () => {
    const { costed } = job();
    const lines = resolveSuggestions([{ description: "Neon sign", group: "lighting", quantity: 1, unit: "each", reason: "Shown on the sheet", match: null, estimateUsd: 240 }], { refs: refs(), costed });
    const added: Costing = addExtras(emptyCosting(), lines);
    const removed = removeExtra(added, lines[0].id);
    expect(removed.extras).toHaveLength(0);
    expect(addExtras(removed, lines).extras).toHaveLength(0);
  });
});
