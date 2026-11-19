import {
  constraintNumber,
  findSku,
  LIMIT_DEFAULTS,
  lineCents,
  SKU,
  type CatalogItem,
} from "../catalog";
import { finishingLines } from "../finishing";
import { applyPriceBook, defaultPriceBook, estimateMaterials, type MaterialEstimate, type MaterialUsage, type PriceBook } from "../materials";
import { bookForJob } from "./job-materials";
import { reviewIssues } from "./review";
import { QUOTE_GROUPS, type BomLine, type CutPiece, type PanelScheduleRow, type QuoteGroup } from "../types";
import { compileDesign } from "./compile";
import { edgeLength, stockBarCount } from "./geometry";
import type { DesignDocument } from "./schema";
import { validateDesign } from "./validate";

export type ProductionResult = {
  lines: BomLine[];
  cuts: CutPiece[];
  stockLengthMm: number;
  bars: number;
  panels: PanelScheduleRow[];
  /** Boards and sheets the custom pieces need, from the price book. */
  materials: MaterialUsage[];
  /** Sheet layout: which boards to buy and how to cut them. */
  cutting: MaterialEstimate["cutting"];
  connectorCount: number;
  printAreaM2: number;
  floorAreaM2: number;
  laborHours: number;
  subtotalCents: number;
  issues: ReturnType<typeof validateDesign>;
};

const GROUP_ORDER: readonly QuoteGroup[] = QUOTE_GROUPS;

function pushLine(lines: BomLine[], item: CatalogItem | undefined, group: QuoteGroup, description: string, quantity: number, key = item?.sku ?? "") {
  if (!item || quantity <= 0) return;
  lines.push({
    key,
    sku: item.sku,
    group,
    description,
    quantity,
    unit: item.unit,
    unitCostCents: item.unitCostCents,
    totalCents: lineCents(quantity, item.unitCostCents),
  });
}

export function produceDesign(
  document: DesignDocument,
  baseCatalog: CatalogItem[],
  book: PriceBook = defaultPriceBook(),
): ProductionResult {
  // The shop's own prices replace the built-in ones. Estimated sheets for this job are added for the pieces below.
  const priced = bookForJob(book, document);
  const catalog = applyPriceBook(baseCatalog, book);
  const compiled = compileDesign(document);
  const issues = validateDesign(document, catalog, book);
  const extrusion = findSku(catalog, SKU.extrusion);
  const panelItem = findSku(catalog, SKU.panel);
  const printItem = findSku(catalog, SKU.print);
  const counterItem = findSku(catalog, SKU.counter);
  const fasciaItem = findSku(catalog, SKU.fascia);
  const lightboxItem = findSku(catalog, SKU.lightbox);
  const spotItem = findSku(catalog, SKU.spotlight);
  const floorItem = findSku(catalog, SKU.floor);
  const connectorItem = findSku(catalog, SKU.connector);
  const laborItem = findSku(catalog, SKU.labor);

  const stockLengthMm = constraintNumber(extrusion, "stockLengthMm", LIMIT_DEFAULTS.stockLengthMm);
  const wasteFactor = constraintNumber(extrusion, "wasteFactor", LIMIT_DEFAULTS.wasteFactor);
  const lengths = [
    ...compiled.posts.map((post) => post.height),
    ...compiled.beams.map((beam) => beam.length),
  ];
  const packed = stockBarCount(lengths, stockLengthMm, wasteFactor);
  if (packed.overflow > 0) {
    issues.push({
      severity: "error",
      code: "cut.stock",
      message: `A ${packed.overflow} mm part is longer than the ${stockLengthMm} mm extrusion stock.`,
      componentId: "structure",
    });
  }

  const bars = packed.bars;
  const extrusionMeters = (bars * stockLengthMm) / 1000;
  const connectorCount = compiled.beams.length * 2;
  const printAreaMm2 = compiled.panels
    .filter((panel) => panel.kind === "graphic" || panel.kind === "lightbox")
    .reduce((sum, panel) => sum + panel.width * panel.height, 0);
  const printAreaM2 = printAreaMm2 / 1_000_000;
  const floorAreaM2 = compiled.floor ? (document.envelope.width * document.envelope.depth) / 1_000_000 : 0;
  const envelopeM2 = (document.envelope.width * document.envelope.depth) / 1_000_000;
  const boothBuilt = document.walls.some((wall) => wall.bays.length > 0);
  const laborHours = boothBuilt
    ? constraintNumber(laborItem, "baseHours", LIMIT_DEFAULTS.baseHours) +
      constraintNumber(laborItem, "hoursPerSquareMeter", LIMIT_DEFAULTS.hoursPerSquareMeter) * envelopeM2 +
      constraintNumber(laborItem, "hoursPerPanel", LIMIT_DEFAULTS.hoursPerPanel) * compiled.panels.length
    : 0;

  const lines: BomLine[] = [];
  pushLine(lines, extrusion, "structure", "Aluminum extrusion, stock bars", extrusionMeters);
  pushLine(lines, connectorItem, "structure", "Frame connectors", connectorCount);
  pushLine(
    lines,
    panelItem,
    "panels",
    "Infill panel sheets",
    compiled.panels.filter((panel) => panel.kind !== "lightbox").length,
  );
  pushLine(lines, printItem, "graphics", "Printed graphic faces", printAreaM2);
  pushLine(lines, counterItem, "furniture", "Reception counters", compiled.counters.length);
  for (const fascia of compiled.fascias) {
    pushLine(lines, fasciaItem, "furniture", `Fascia on ${fascia.edge}`, edgeLength(fascia.edge, document.envelope) / 1000, `${SKU.fascia}:${fascia.edge}`);
  }
  pushLine(lines, lightboxItem, "lighting", "Lightboxes", compiled.panels.filter((panel) => panel.kind === "lightbox").length);
  pushLine(lines, spotItem, "lighting", "Spotlights", compiled.spots.length);
  pushLine(lines, floorItem, "flooring", "Floor covering", floorAreaM2);
  pushLine(lines, laborItem, "labor", "Assembly labor", laborHours);
  const estimate = estimateMaterials(document.parts, priced);
  for (const usage of estimate.usage) {
    if (usage.quantity <= 0) continue;
    const material = priced.materials.find((item) => item.id === usage.materialId);
    const estimated = material?.estimated && usage.unit === "board" ? ", estimated price" : "";
    lines.push({
      key: `MAT-${usage.materialId}`,
      sku: `MAT-${usage.materialId}`,
      group: "materials",
      description: `${usage.name}${usage.boardSize ? ` (${usage.boardSize})` : ""}, ${usage.pieces} ${usage.pieces === 1 ? "piece" : "pieces"}${estimated}`,
      quantity: usage.quantity,
      unit: usage.unit === "board" ? "board" : "m2",
      unitCostCents: usage.unitCents,
      totalCents: usage.totalCents,
      piece: material?.piece ?? null,
    });
  }
  lines.push(...finishingLines(document.parts, priced));

  lines.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  issues.push(...reviewIssues(document));

  const cuts = groupCuts(compiled.posts.map((post) => ({ part: "Post", lengthMm: post.height })), compiled.beams.map((beam) => ({ part: "Beam", lengthMm: beam.length })));
  const panels: PanelScheduleRow[] = compiled.panels.map((panel) => ({
    id: panel.id,
    edge: panel.edge,
    bayIndex: panel.bayIndex,
    kind: panel.kind,
    widthMm: panel.width,
    heightMm: panel.height,
    finish: panel.finishId ?? "",
    graphicAssetId: panel.graphicAssetId ?? "",
  }));

  return {
    lines,
    cuts,
    stockLengthMm,
    bars,
    panels,
    materials: estimate.usage,
    cutting: estimate.cutting,
    connectorCount,
    printAreaM2,
    floorAreaM2,
    laborHours,
    subtotalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    issues,
  };
}

function groupCuts(posts: Array<{ part: string; lengthMm: number }>, beams: Array<{ part: string; lengthMm: number }>): CutPiece[] {
  const grouped = new Map<string, CutPiece>();
  for (const piece of [...posts, ...beams]) {
    const lengthMm = Math.round(piece.lengthMm);
    const key = `${piece.part}:${lengthMm}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += 1;
    else grouped.set(key, { part: piece.part, lengthMm, quantity: 1 });
  }
  return [...grouped.values()];
}
